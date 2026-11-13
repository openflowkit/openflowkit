import type { SceneNode, ScenePage } from '../document/types';
import type { Bounds2d, Matrix2d, Point2d } from '../geometry/types';
import type { ConnectorMarkerGlyph, ConnectorPathCommand, ProjectedConnector } from '../connectors/types';
import { multiplyMatrices } from '../geometry/matrix';
import { polylineLength } from '../geometry/polyline';
import { buildNodeStateMap } from '../scene/nodeState';
import { buildNodeWorldMatrices } from '../scene/worldGeometry';
import { projectPageConnectors } from '../connectors/routeProjection';
import { connectorMarkerShapes, markerOutward, type MarkerShape } from '../connectors/markers';
import { connectorLabelLineHeight, connectorLabelLines, connectorLabelPlate, connectorRichPlate } from '../connectors/labelStyle';
import { connectorStrokeOnCanvas } from '../connectors/presentation';
import { resolveBasicNodePresentation } from '../nodes/basicNodePresentation';
import { basicNodeDecorations } from '../nodes/basicNodeDecorations';
import { nodeLabelBounds, nodeOutline } from '../nodes/nodeLabelBounds';
import { isBackdropNode, isContainerNodeKind } from '../nodes/containerNodePresentation';
import { measurePortableText } from '../text/measurement';
import { layoutRichLabel, richLabelOf, type RichBlock } from '../text/richLabel';
import { richBand, richBaseOf, richInk, richOrigin } from '../text/richLabelStyle';
import { resolveLabelSizing } from '../node-sizing/labelWrap';
import { FONT_STACKS, resolveNodeStyle, type GradientDirection, type NodeStyle } from '../nodes/nodeStyle';
import { cameraFitMatrix } from './camera';
import { PULSE_DASH, PULSE_TRAVEL } from './frame';
import type { ElementFrameState, FrameState } from './types';

/**
 * One frame as an ordered, renderer-neutral draw list: what the SVG exporter
 * would emit for `frameAt(timeline, t)`, in the order it emits it, with every
 * transform resolved. The motion worker paints it into its own canvas, so a
 * video frame never touches the main thread's SVG rasteriser. Nothing here
 * invents geometry — shapes, outlines, decorations, markers, colours and fonts
 * all come from the resolvers the Pixi renderer and `canonicalSvg` read.
 *
 * A visible node the canvas cannot draw (chart, ink, image, annotation, the
 * architecture/wireframe/sequence families) marks the whole frame `fallback`:
 * one rule, no per-kind negotiation.
 *
 * ponytail: one chart or ink stroke in a page sends every frame back to the
 * SVG raster — upgrade = a per-node raster cache for the exotic kinds only.
 */

type DrawTheme = 'light' | 'dark' | 'print';

export interface DrawPaint {
  readonly color: string;
  readonly alpha: number;
}

interface DrawShadow {
  readonly color: string;
  readonly alpha: number;
  /** Canvas blur radius: twice the SVG `stdDeviation`. */
  readonly blur: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

interface DrawOpBase {
  /** Local space → world; the walkthrough camera is already folded in. */
  readonly transform: Matrix2d;
  readonly opacity: number;
  /** Node-local polygon the op is clipped to (sizing `clipContent`). */
  readonly clip: readonly Point2d[] | null;
}

interface DrawRectOp extends DrawOpBase {
  readonly kind: 'rect';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly fill: DrawPaint | null;
  readonly stroke: DrawPaint | null;
  readonly strokeWidth: number;
}

export interface DrawPathOp extends DrawOpBase {
  readonly kind: 'path';
  readonly commands: readonly ConnectorPathCommand[];
  readonly closed: boolean;
  readonly fill: DrawPaint | null;
  readonly stroke: DrawPaint | null;
  readonly strokeWidth: number;
  readonly dash: readonly number[];
  readonly dashOffset: number;
  readonly lineJoin: 'miter' | 'round';
  readonly shadow: DrawShadow | null;
  /** A fill that runs from `fill` to this colour across the node's own box (local units). */
  readonly gradient?: DrawGradient;
}

export interface DrawGradient {
  readonly color: string;
  readonly direction: GradientDirection;
  readonly width: number;
  readonly height: number;
}

export interface DrawTextOp extends DrawOpBase {
  readonly kind: 'text';
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly fontWeight: string | number;
  readonly fontStyle: 'normal' | 'italic';
  /** Pixels; the exporter emits `letterSpacing × fontSize`. */
  readonly letterSpacing: number;
  readonly align: 'start' | 'center' | 'end';
  readonly baseline: 'hanging' | 'middle' | 'alphabetic';
  readonly color: string;
  /** Rule under or through the text, in local coordinates. */
  readonly decoration: { readonly y: number; readonly thickness: number } | null;
}

/** Any visible node the canvas renderer does not cover; the frame goes to SVG. */
interface DrawFallbackOp {
  readonly kind: 'fallback';
}

export type DrawOp = DrawRectOp | DrawPathOp | DrawTextOp | DrawFallbackOp;

const IDENTITY: Matrix2d = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

// Same backdrops as canonicalSvg's SVG_BACKGROUND: dark is the app's dark canvas.
const BACKGROUNDS: Readonly<Record<DrawTheme, string>> = {
  light: '#ffffff', dark: '#191b19', print: '#ffffff',
};
const CONNECTOR_STROKES: Readonly<Record<DrawTheme, string>> = {
  light: '#475569', dark: '#cbd5e1', print: '#475569',
};

/** Mirrors `canonicalSvg.safeColor`: user JSON can hold any string, and a bad
 *  one silently poisons a canvas style for every later op. */
function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^(?:#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(value)
    ? value
    : fallback;
}

function paint(color: string, alpha = 1): DrawPaint {
  return { color, alpha };
}

/** `M`/`L` per subpath, the same path data `openPathData`/`pathData` build. */
function subpathCommands(subpaths: readonly (readonly Point2d[])[]): readonly ConnectorPathCommand[] {
  return subpaths.flatMap((points) => points.map((point, index) => ({
    kind: index === 0 ? ('move' as const) : ('line' as const),
    point,
  })));
}

function popAbout(center: Point2d, scale: number): Matrix2d {
  return { a: scale, b: 0, c: 0, d: scale, tx: center.x * (1 - scale), ty: center.y * (1 - scale) };
}

/** The `text-decoration` rule, offset from the alphabetic baseline the chosen
 *  baseline implies — canvas has no native decoration. */
function decorationOf(style: NodeStyle, baselineY: number): DrawTextOp['decoration'] {
  if (style.textDecoration === 'none') return null;
  return {
    y: style.textDecoration === 'underline'
      ? baselineY + style.fontSize * 0.1
      : baselineY - style.fontSize * 0.28,
    thickness: Math.max(1, style.fontSize / 14),
  };
}

/**
 * A rich label as text ops, one a run, at the shared layout's places, and dividers as rects.
 * ponytail: each run sits at the estimated width of the runs before it, so a line of runs in another font can gap or
 * touch — upgrade by measuring with the painter's own context before placing.
 */
function richLabelOps(
  transform: Matrix2d, style: NodeStyle, box: Bounds2d, blocks: readonly RichBlock[], wraps: boolean,
  opacity: number, clip: readonly Point2d[] | null,
): DrawOp[] {
  const layout = layoutRichLabel(blocks, richBaseOf(style), wraps ? Math.max(1, box.width - style.textPadding * 2) : null, { keepWords: style.keepWords, box: Math.max(0, box.width - style.textPadding * 2) });
  const origin = richOrigin(style, box, layout, wraps);
  const [left, top] = [box.x + origin.x, box.y + origin.y];
  const ops: DrawOp[] = layout.bands.map((band) => ({
    kind: 'rect', transform, opacity, clip, x: left + band.x, y: top + band.y, width: band.width, height: band.height,
    radius: 0, fill: paint(richBand(band.color, style)), stroke: null, strokeWidth: 0,
  }));
  for (const line of layout.lines) {
    const baseline = top + line.y + line.baseline;
    for (const piece of line.pieces) {
      if (!piece.text.trim()) continue;
      ops.push({
        kind: 'text', transform, opacity, clip, text: piece.text, x: left + piece.x, y: baseline, baseline: 'alphabetic',
        fontSize: piece.size, fontFamily: FONT_STACKS[style.fontFamily], fontWeight: piece.weight, fontStyle: piece.italic ? 'italic' : 'normal',
        letterSpacing: 0, align: 'start', color: richInk(piece, style),
        decoration: piece.underline ? { y: baseline + piece.size * 0.1, thickness: Math.max(1, piece.size / 14) }
          : piece.strike ? { y: baseline - piece.size * 0.28, thickness: Math.max(1, piece.size / 14) } : null,
      });
    }
  }
  for (const rule of layout.rules) {
    ops.push({
      kind: 'rect', transform, opacity, clip, x: box.x + style.textPadding, y: top + rule.y - 0.5,
      width: Math.max(0, box.width - style.textPadding * 2), height: 1, radius: 0, fill: paint(style.textColor), stroke: null, strokeWidth: 0,
    });
  }
  return ops;
}

/** One label line, placed exactly as `labelElement` places it. */
function labelOp(
  transform: Matrix2d, style: NodeStyle, box: Bounds2d,
  text: string, opacity: number, clip: readonly Point2d[] | null,
): DrawTextOp {
  const x = style.textAlign === 'start' ? box.x + style.textPadding
    : style.textAlign === 'end' ? box.x + box.width - style.textPadding
      : box.x + box.width / 2;
  const baseline: DrawTextOp['baseline'] = style.textVerticalAlign === 'top' ? 'hanging'
    : style.textVerticalAlign === 'bottom' ? 'alphabetic'
      : 'middle';
  const y = style.textVerticalAlign === 'top' ? box.y + style.textPadding
    : style.textVerticalAlign === 'bottom' ? box.y + box.height - style.textPadding
      : box.y + box.height / 2;
  const baselineY = baseline === 'alphabetic' ? y
    : baseline === 'hanging' ? y + style.fontSize * 0.8
      : y + style.fontSize * 0.3;
  return {
    kind: 'text', transform, opacity, clip,
    text: text.replace(/\s+/g, ' ').trim(),
    x, y, baseline,
    fontSize: style.fontSize,
    fontFamily: FONT_STACKS[style.fontFamily],
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    letterSpacing: style.letterSpacing * style.fontSize,
    align: style.textAlign === 'start' ? 'start' : style.textAlign === 'end' ? 'end' : 'center',
    color: style.textColor,
    decoration: decorationOf(style, baselineY),
  };
}

function shapeNodeOps(
  node: SceneNode, matrix: Matrix2d, state: ElementFrameState | undefined, theme: DrawTheme,
): readonly DrawOp[] {
  const style = resolveNodeStyle(node, BACKGROUNDS[theme]);
  const transform = state?.scale === undefined || state.scale === 1
    ? matrix
    : multiplyMatrices(matrix, popAbout({ x: node.size.width / 2, y: node.size.height / 2 }, state.scale));
  const opacity = (state?.opacity ?? 1) * style.opacity;
  const basic = resolveBasicNodePresentation(node);
  const outline = nodeOutline(node);
  const ops: DrawOp[] = [{
    kind: 'path', transform, opacity, clip: null,
    commands: subpathCommands([outline]), closed: true,
    fill: style.fill === 'transparent' ? null : paint(style.fill),
    stroke: style.strokeWidth > 0 ? paint(style.stroke) : null,
    strokeWidth: style.strokeWidth,
    dash: style.dash, dashOffset: 0, lineJoin: 'miter',
    shadow: style.shadow ? {
      color: style.shadow.color, alpha: style.shadow.opacity, blur: style.shadow.blur * 2,
      offsetX: style.shadow.offsetX, offsetY: style.shadow.offsetY,
    } : null,
    ...(style.gradient ? { gradient: { ...style.gradient, width: node.size.width, height: node.size.height } } : {}),
  }];
  if (basic && style.strokeWidth > 0 && style.stroke !== 'transparent') {
    for (const decoration of basicNodeDecorations(basic.shape, node.size)) {
      ops.push({
        kind: 'path', transform, opacity, clip: null,
        commands: subpathCommands([decoration]), closed: false,
        fill: null, stroke: paint(style.stroke), strokeWidth: style.strokeWidth,
        dash: style.dash, dashOffset: 0, lineJoin: 'miter', shadow: null,
      });
    }
  }
  const label = typeof node.content.label === 'string' ? node.content.label : node.id;
  const sizing = resolveLabelSizing(node, style);
  const clip = sizing.clipContent ? outline : null;
  const labelBox = nodeLabelBounds(node);
  const rich = label ? richLabelOf(node.content) : null;
  if (rich) return [...ops, ...richLabelOps(transform, style, labelBox, rich, sizing.overflow !== 'visible', opacity, clip)];
  // A wrapping node (sizing policy) draws its label in the lines the canvas wraps it to, centred as a block.
  const lines = sizing.overflow === 'visible' ? [label] : measurePortableText(label, {
    fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.fontSize * style.lineHeight,
    maxWidth: Math.max(1, node.size.width - style.textPadding * 2), maxLines: sizing.maxLines, overflow: sizing.overflow,
    keepWords: style.keepWords,
  }).lines;
  const lineHeight = style.fontSize * style.lineHeight;
  lines.forEach((line, index) => {
    const op = labelOp(transform, style, labelBox, line, opacity, clip);
    ops.push({ ...op, y: op.y + (index - (lines.length - 1) / 2) * lineHeight, ...(lines.length > 1 ? { decoration: null } : {}) });
  });
  const subLabel = typeof node.content.subLabel === 'string' ? node.content.subLabel : '';
  if (subLabel) {
    const sub = labelOp(transform, style, labelBox, subLabel, opacity * 0.72, clip);
    ops.push({ ...sub, y: sub.y + style.fontSize * 1.5 + (lines.length - 1) / 2 * lineHeight, decoration: null });
  }
  return ops;
}

// Hollow glyphs (circle, open triangle/diamond) fill with the page, as the canvas and the SVG fill them.
function markerOps(connector: ProjectedConnector, opacity: number, color: string, surface: string): readonly DrawOp[] {
  const { samples, presentation } = connector;
  if (samples.length < 2) return [];
  const { width } = presentation.stroke;
  const stroke = paint(color, presentation.stroke.opacity);
  const shapeOp = (shape: MarkerShape): DrawOp => shape.kind === 'circle'
    ? {
      kind: 'rect', transform: IDENTITY, opacity, clip: null,
      x: shape.center.x - shape.radius, y: shape.center.y - shape.radius,
      width: shape.radius * 2, height: shape.radius * 2, radius: shape.radius,
      fill: paint(surface), stroke, strokeWidth: width,
    }
    : {
      kind: 'path', transform: IDENTITY, opacity, clip: null,
      commands: subpathCommands(shape.subpaths), closed: shape.closed,
      fill: shape.filled ? stroke : shape.closed ? paint(surface) : null,
      stroke: shape.filled ? null : stroke,
      strokeWidth: width, dash: [], dashOffset: 0,
      lineJoin: shape.round ? 'round' : 'miter', shadow: null,
    };
  const glyphs = (
    values: readonly ConnectorMarkerGlyph[], endpoint: Point2d, outward: Point2d,
  ): readonly DrawOp[] => values.flatMap((glyph, index) =>
    connectorMarkerShapes(glyph, endpoint, outward, index * 9).map(shapeOp));
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  return [
    ...glyphs(presentation.sourceMarkers, first, markerOutward(samples, 'source')),
    ...glyphs(presentation.targetMarkers, last, markerOutward(samples, 'target')),
  ];
}

/** The dash the frame state needs: pulse's travelling light, or draw-on. */
function connectorDash(
  connector: ProjectedConnector, state: ElementFrameState | undefined,
): { readonly dash: readonly number[]; readonly dashOffset: number } {
  if (state?.pulsePhase !== undefined) return { dash: PULSE_DASH, dashOffset: -state.pulsePhase * PULSE_TRAVEL };
  const length = polylineLength(connector.samples);
  if (state && state.drawProgress < 1) {
    return { dash: [length, length], dashOffset: (1 - state.drawProgress) * length };
  }
  return { dash: connector.presentation.stroke.dash, dashOffset: 0 };
}

function connectorOps(
  connector: ProjectedConnector, state: ElementFrameState | undefined, theme: DrawTheme,
): readonly DrawOp[] {
  const { presentation } = connector;
  const opacity = state?.opacity ?? 1;
  const { dash, dashOffset } = connectorDash(connector, state);
  const color = safeColor(connectorStrokeOnCanvas(presentation.stroke, BACKGROUNDS[theme]).color, CONNECTOR_STROKES[theme]);
  const ops: DrawOp[] = [{
    kind: 'path', transform: IDENTITY, opacity, clip: null,
    commands: connector.commands, closed: false,
    fill: null,
    stroke: paint(color, presentation.stroke.opacity),
    strokeWidth: presentation.stroke.width,
    dash, dashOffset, lineJoin: 'miter', shadow: null,
  }, ...markerOps(connector, opacity, color, BACKGROUNDS[theme])];
  // Labels as `connectorLabelMarkup` draws them: text on a plate over the line.
  const style = connector.presentation.label;
  for (const label of connector.labels) {
    if (!label.text) continue;
    const plate = label.rich ? connectorRichPlate(label.rich, style, label.point) : connectorLabelPlate(label.text, style, label.point);
    ops.push({
      kind: 'rect', transform: IDENTITY, opacity, clip: null, ...plate, radius: style.cornerRadius,
      fill: style.fill === 'transparent' ? null : paint(style.fill),
      stroke: style.stroke === 'transparent' || style.strokeWidth <= 0 ? null : paint(style.stroke),
      strokeWidth: style.strokeWidth,
    }, ...(label.rich ? richLabelOps(IDENTITY, { ...style, textAlign: 'center', textVerticalAlign: 'middle' }, plate, label.rich, false, opacity, null) : []),
    ...(label.rich ? [] : connectorLabelLines(label.text, style).map((line, index, lines): DrawOp => ({
      kind: 'text', transform: IDENTITY, opacity, clip: null,
      text: line, x: label.point.x, y: label.point.y + (index - (lines.length - 1) / 2) * connectorLabelLineHeight(style),
      fontSize: style.fontSize, fontFamily: FONT_STACKS[style.fontFamily], fontWeight: String(style.fontWeight),
      fontStyle: style.fontStyle, letterSpacing: 0, align: 'center', baseline: 'middle',
      color: style.textColor, decoration: null,
    }))));
  }
  return ops;
}

/**
 * The canvas draws what the exporter's plain-node branch draws: basic shapes
 * (the shape library included) and containers. A text node is not drawable:
 * its font key resolves through the document's webfonts, which an
 * `<img>`-rendered SVG cannot see, so the canvas and the file would pick
 * different typefaces.
 *
 * ponytail: one text node sends the page back to the SVG raster with every
 * other exotic kind — upgrade = resolve font keys to a stack and emit that
 * stack from the exporter, so both sides read one font.
 */
function isCanvasDrawable(node: SceneNode): boolean {
  return isContainerNodeKind(node.kind) || resolveBasicNodePresentation(node) !== null;
}

function withCamera(op: DrawOp, camera: Matrix2d | null): DrawOp {
  if (op.kind === 'fallback' || !camera) return op;
  return { ...op, transform: multiplyMatrices(camera, op.transform) };
}

interface ProjectedPage {
  readonly nodes: readonly SceneNode[];
  readonly connectors: ReturnType<typeof projectPageConnectors>;
}

// Routing every connector around every node is the one expensive step in a
// frame, and it depends on the page alone — the frame only changes opacity,
// pop and dash. A page is immutable, so its identity is the cache key.
const projectionCache = new WeakMap<ScenePage, ProjectedPage>();

function projectPage(page: ScenePage): ProjectedPage {
  const cached = projectionCache.get(page);
  if (cached) return cached;
  const states = buildNodeStateMap(page);
  const nodes = page.nodes.filter((node) => states.get(node.id)?.visible === true);
  const visible = new Set(nodes.map((node) => node.id));
  const connectors = page.connectors.filter((connector) =>
    (connector.source.nodeId === null || visible.has(connector.source.nodeId))
    && (connector.target.nodeId === null || visible.has(connector.target.nodeId)));
  const projected = { nodes, connectors: projectPageConnectors({ ...page, connectors }) };
  projectionCache.set(page, projected);
  return projected;
}

/**
 * The frame's ops in paint order: background, containers, connectors, every
 * other node (zIndex then id within a layer — the exporter's own order). The walkthrough camera is folded into every
 * op's transform except the background's, exactly like the SVG's root camera
 * group, so strokes scale with the glide the way the file does.
 */
export function frameDrawList(
  page: ScenePage, frame: FrameState, theme: DrawTheme, viewBox: Bounds2d,
): readonly DrawOp[] {
  const { nodes, connectors } = projectPage(page);
  if (nodes.some((node) => !isCanvasDrawable(node))) return [{ kind: 'fallback' }];
  const camera = frame.camera ? cameraFitMatrix(frame.camera, viewBox) : null;
  const ops: DrawOp[] = [{
    kind: 'rect', transform: IDENTITY, opacity: 1, clip: null,
    x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height, radius: 0,
    fill: paint(BACKGROUNDS[theme]), stroke: null, strokeWidth: 0,
  }];
  const matrices = buildNodeWorldMatrices(page);
  const ordered = [...nodes].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  const paintNodes = (layer: readonly SceneNode[]) => {
    for (const node of layer) {
      const matrix = matrices.get(node.id);
      if (!matrix) continue;
      ops.push(...shapeNodeOps(node, matrix, frame.nodes[node.id], theme)
        .map((op) => withCamera(op, camera)));
    }
  };
  paintNodes(ordered.filter(isBackdropNode));
  for (const connector of connectors) {
    ops.push(...connectorOps(connector, frame.connectors[connector.id], theme)
      .map((op) => withCamera(op, camera)));
  }
  paintNodes(ordered.filter((node) => !isBackdropNode(node)));
  return ops;
}
