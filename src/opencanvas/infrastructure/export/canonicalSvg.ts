import { gradientAxis, resolveNodeStyle } from '../../domain/nodes/nodeStyle';
import type { SceneDocumentV1, SceneNode, ScenePage } from '../../domain/document/types';
import { boundsFromPoints, boundsCorners } from '../../domain/geometry/bounds';
import type { Bounds2d, Matrix2d, Point2d } from '../../domain/geometry/types';
import { resolveBasicNodePresentation } from '../../domain/nodes/basicNodePresentation';
import { resolveWidgetInks } from '../../domain/nodes/widgetNodePresentation';
import { frameChromePrimitives, framePresetOf } from '../../domain/nodes/framePreset';
import { isBackdropNode, isContainerNodeKind, resolveContainerNodePresentation } from '../../domain/nodes/containerNodePresentation';
import { nodeLabelBounds, nodeOutline } from '../../domain/nodes/nodeLabelBounds';
import { connectorLabelOnCanvas, ownLabelStyle } from '../../domain/connectors/labelStyle';
import { connectorStrokeOnCanvas } from '../../domain/connectors/presentation';
import { resolveArchitectureNodePresentation } from '../../domain/nodes/architectureNodePresentation';
import { iconCardLayout } from '../../domain/nodes/iconCardLayout';
import { FONT_STACKS } from '../../domain/nodes/nodeStyle';
import { resolveFreeformNodePresentation } from '../../domain/nodes/freeformNodePresentation';
import { projectPageConnectors } from '../../domain/connectors/routeProjection';
import { roundedConnectorCommands } from '../../domain/connectors/routePaths';
import { buildNodeWorldMatrices, nodeWorldBounds } from '../../domain/scene/worldGeometry';
import { buildNodeStateMap } from '../../domain/scene/nodeState';
import { descendantIds } from '../../domain/scene/queries';
import { resolveLabelSizing } from '../../domain/node-sizing/labelWrap';
import { isSequenceParticipant } from '../pixi/sequenceNodeVisual';
import { cameraFitMatrix } from '../../domain/animation/camera';
import type { ElementFrameState, FrameState } from '../../domain/animation/types';
import {
  ANIMATED_CLASS, cssAnimation, connectorPathDash, elementFrameStyle, matrixAttribute, matrixCss, nodeGroup, number, pathData, safeColor,
  SVG_BACKGROUND, textElement, xml, type CssAnimation, type ElementAnimations,
} from './svgMarkup';
import { iconDefs, iconMarkup, type IconSheet } from './svgIcons';
import { exportAnnotationNode, exportImageNode, exportStrokeNode, exportTextNode } from './svgFreeformNodes';
import { exportChartNode, exportWidgetNode, widgetPrimitivesMarkup } from './svgChartWidgetNodes';
import { exportArchitectureCard, exportClassEntityNode, exportSequenceNode } from './svgDiagramNodes';
import { invertForDark } from '../../domain/color/adaptiveColor';
import { decorationMarkup, drawnShapeMarkup, iconCaptionMarkup, labelElement, outlineMarkup } from './svgNodeText';
import { drawnShapeParts, drawnShapeStyle } from '../../domain/nodes/drawnShape';
import { connectorLabelMarkup, connectorPathData, markerMarkup } from './svgConnectors';

export { collectIconArt, iconArtKey } from './svgIcons';
export { ANIMATED_CLASS, matrixCss, scaleAbout, SVG_BACKGROUND, type CssAnimation, type ElementAnimations } from './svgMarkup';

export interface CanonicalSvgExportOptions {
  readonly pageId?: string;
  /** Export these nodes and everything inside them; absent exports the page. */
  readonly selectedNodeIds?: readonly string[];
  /** Connectors drawn without requiring either endpoint to be selected. */
  readonly selectedConnectorIds?: readonly string[];
  readonly theme?: 'light' | 'dark' | 'print';
  readonly padding?: number;
  readonly pixelRatio?: number;
  /** Omit the background rectangle (transparent PNG / SVG). */
  readonly transparent?: boolean;
  /** Pause the export at one timeline frame; absent keeps the static output. */
  readonly frame?: FrameState;
  /** Per-element CSS animations, for the animated export. */
  readonly animations?: (kind: 'node' | 'connector', id: string) => ElementAnimations | undefined;
  /** Camera glide on the root group, for the animated walkthrough. */
  readonly cameraAnimation?: CssAnimation;
  /** Extra CSS inserted as the first child, before any artwork. */
  readonly styleSheet?: string;
  /**
   * Icon art as data URLs, keyed `packId:shapeId` (see `iconArtKey`). The
   * exporter is synchronous and has no catalog, so the host loads the art;
   * an icon missing here exports as its plate alone.
   */
  readonly iconArt?: Readonly<Record<string, string>>;
}

function exportNode(
  node: SceneNode,
  matrix: Matrix2d,
  theme: 'light' | 'dark' | 'print',
  frame: ElementFrameState | undefined,
  animations: CanonicalSvgExportOptions['animations'],
  icons: IconSheet,
  parentOf: (id: string) => SceneNode | undefined,
): string {
  const wrapper = elementFrameStyle('node', node.id, frame, node.size, animations);
  const chart = exportChartNode(node, matrix, theme, wrapper) ?? exportWidgetNode(node, matrix, theme, wrapper, parentOf)
    ?? exportSequenceNode(node, matrix, theme, wrapper) ?? exportClassEntityNode(node, matrix, wrapper);
  if (chart) return chart;
  const freeform = resolveFreeformNodePresentation(node, theme === 'dark' ? SVG_BACKGROUND.dark : undefined);
  if (freeform && (freeform.kind === 'pen' || freeform.kind === 'highlighter'
    || freeform.kind === 'line' || freeform.kind === 'arrow')) {
    return exportStrokeNode(node, matrix, freeform, wrapper, theme);
  }
  if (freeform?.kind === 'text') return exportTextNode(node, matrix, freeform, theme, wrapper);
  if (freeform?.kind === 'image') return exportImageNode(node, matrix, freeform, theme, wrapper);
  if (freeform && (freeform.kind === 'annotation' || freeform.kind === 'sticky'
    || freeform.kind === 'callout')) return exportAnnotationNode(node, matrix, freeform, theme, wrapper);
  const background = theme === 'dark' ? SVG_BACKGROUND.dark : SVG_BACKGROUND.light;
  // One resolver for every node kind: the renderer, the label editor and the
  // exporter cannot drift. Legacy content keys are its fallbacks, not ours.
  const style = resolveNodeStyle(node, background);
  const architecture = exportArchitectureCard(node, matrix, style, wrapper, icons);
  if (architecture) return architecture;
  const basic = resolveBasicNodePresentation(node);
  const preset = framePresetOf(node);
  const outline = nodeOutline(node);
  // A draw.io shape is drawn by its parts, as draw.io's own code drew it.
  const drawn = drawnShapeParts(node);
  const label = typeof node.content.label === 'string' ? node.content.label : node.id;
  const subLabel = typeof node.content.subLabel === 'string' ? node.content.subLabel : '';
  const clip = resolveLabelSizing(node, style).clipContent
    ? `clip-${node.id.replace(/[^A-Za-z0-9_-]/g, '-')}`
    : null;
  const shadowId = `shadow-${node.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const gradientId = `gradient-${node.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const filter = style.shadow ? ` filter="url(#${shadowId})"` : '';
  const { shadow, gradient } = style;
  const axis = gradient ? gradientAxis(gradient.direction) : null;
  const stops = gradient ? `<stop offset="0" stop-color="${style.fill}"/><stop offset="1" stop-color="${gradient.color}"/>` : '';
  const defs = (shadow
    ? `<filter id="${shadowId}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="${number(shadow.offsetX)}" dy="${number(shadow.offsetY)}" stdDeviation="${number(shadow.blur)}" flood-color="${shadow.color}" flood-opacity="${number(shadow.opacity)}"/></filter>`
    : '')
    + (gradient
      ? axis
        ? `<linearGradient id="${gradientId}" x1="${axis.from.x}" y1="${axis.from.y}" x2="${axis.to.x}" y2="${axis.to.y}">${stops}</linearGradient>`
        : `<radialGradient id="${gradientId}">${stops}</radialGradient>`
      : '')
    + (clip ? `<clipPath id="${clip}"><path d="${pathData(outline)}"/></clipPath>` : '');
  return nodeGroup(
    `data-node-id="${xml(node.id)}" transform="${matrixAttribute(matrix)}"${style.opacity < 1 ? ` opacity="${number(style.opacity)}"` : ''}`,
    (defs ? `<defs>${defs}</defs>` : '')
      + (drawn
        ? drawnShapeMarkup(drawn, style, style.strokeWidth / (Number.parseFloat(drawnShapeStyle(node)?.strokeWidth ?? '') || 1), filter)
        : outlineMarkup(outline, gradient ? { ...style, fill: `url(#${gradientId})` } : style, filter)
          + (basic ? decorationMarkup(basic.shape, node.size, style) : ''))
      + (preset ? widgetPrimitivesMarkup(frameChromePrimitives(preset, node.size), resolveWidgetInks(node, style, background), style) : '')
      + (resolveArchitectureNodePresentation(node)?.display === 'provider-icon'
        ? iconCaptionMarkup(iconCardLayout(node, style).text, style)
        // A container whose header is off shows no title, on the canvas and here alike.
        : labelElement(style, nodeLabelBounds(node), isContainerNodeKind(node.kind) && resolveContainerNodePresentation(node)?.header === false ? '' : label,
          isContainerNodeKind(node.kind) ? '' : subLabel, clip, node))
      + (isContainerNodeKind(node.kind) && subLabel ? textElement(subLabel, 12, node.size.height - 22, `fill="${style.textColor}" font-family="${xml(FONT_STACKS[style.fontFamily])}" font-size="10" font-weight="500" dominant-baseline="hanging"`, 12) : '')
      + iconMarkup(node, icons, style, background),
    wrapper
  );
}

/**
 * The page an export draws: the selected nodes plus everything inside them, an
 * explicitly selected connector (which needs neither endpoint), and the
 * connectors whose endpoints both survive. Hidden nodes never draw.
 */
function selectedPage(
  page: ScenePage,
  selectedNodeIds?: readonly string[],
  selectedConnectorIds?: readonly string[]
): ScenePage {
  const states = buildNodeStateMap(page);
  const selected = selectedNodeIds ? new Set([...selectedNodeIds, ...descendantIds(page, selectedNodeIds)]) : null;
  const selectedConnectors = selectedConnectorIds?.length ? new Set(selectedConnectorIds) : null;
  const nodes = page.nodes.filter((node) => states.get(node.id)?.visible && (!selected || selected.has(node.id)));
  const ids = new Set(nodes.map(({ id }) => id));
  return { ...page, nodes, connectors: page.connectors.filter(({ id, source, target }) =>
    (selectedConnectors?.has(id) ?? false)
    || ((source.nodeId === null ? !selected : ids.has(source.nodeId))
      && (target.nodeId === null ? !selected : ids.has(target.nodeId)))) };
}

interface PageExport {
  readonly source: ScenePage;
  readonly page: ScenePage;
  readonly matrices: ReadonlyMap<string, Matrix2d>;
  readonly connectors: ReturnType<typeof projectPageConnectors>;
  readonly viewBox: Bounds2d;
}

/** Everything an SVG export reads off a page, viewBox included. */
function pageExport(document: SceneDocumentV1, options: CanonicalSvgExportOptions): PageExport {
  const source = options.pageId
    ? document.pages.find(({ id }) => id === options.pageId)
    : document.pages[0];
  if (!source) throw new RangeError('SVG export page was not found.');
  const page = selectedPage(source, options.selectedNodeIds, options.selectedConnectorIds);
  const matrices = buildNodeWorldMatrices(source);
  const connectors = projectPageConnectors({ ...source, connectors: page.connectors });
  if (page.nodes.length === 0 && connectors.length === 0) throw new TypeError('SVG export requires at least one visible node or connector.');
  const points: Point2d[] = [];
  for (const node of page.nodes) {
    const matrix = matrices.get(node.id)!;
    points.push(...boundsCorners(nodeWorldBounds(node, matrix)));
  }
  for (const connector of connectors) points.push(...connector.samples);
  const bounds = boundsFromPoints(points)!;
  const padding = Math.max(0, options.padding ?? 24);
  return {
    source, page, matrices, connectors,
    viewBox: {
      x: bounds.x - padding, y: bounds.y - padding,
      width: bounds.width + padding * 2, height: bounds.height + padding * 2,
    },
  };
}

/** The viewBox `exportCanonicalSvg` frames; the animated export fits cameras to it. */
export function svgViewBox(document: SceneDocumentV1, options: CanonicalSvgExportOptions = {}): Bounds2d {
  return pageExport(document, options).viewBox;
}

export function exportCanonicalSvg(
  document: SceneDocumentV1, options: CanonicalSvgExportOptions = {}
): string {
  const { source, page, matrices, connectors, viewBox } = pageExport(document, options);
  const byId = new Map(source.nodes.map((node) => [node.id, node]));
  const { x, y, width, height } = viewBox;
  const pixelRatio = Math.min(4, Math.max(1, options.pixelRatio ?? 1));
  const theme = options.theme ?? 'light';
  const background = theme === 'dark' ? SVG_BACKGROUND.dark : SVG_BACKGROUND.light;
  const icons: IconSheet = { art: options.iconArt, ids: new Map() };
  const connectorMarkup = connectors.map((connector) => {
    const stroke = safeColor(connectorStrokeOnCanvas(connector.presentation.stroke, theme === 'dark' ? background : undefined).color, theme === 'dark' ? '#cbd5e1' : '#475569');
    const state = options.frame?.connectors[connector.id];
    const animation = options.animations?.('connector', connector.id);
    const pathAnimation = animation?.path ? ` class="${ANIMATED_CLASS}" style="${cssAnimation(animation.path)}"` : '';
    const dash = animation?.path
      ? `${animation.path.unitLength ? ' pathLength="1"' : ''} stroke-dasharray="${animation.path.dash}"`
      : connectorPathDash(state);
    const group = elementFrameStyle('connector', connector.id, state, undefined, options.animations);
    // A line draw.io draws with a shape of its own is its parts (ends included), unless an animation draws the line.
    const drawn = connector.drawn && !animation?.path ? connector.drawn : null;
    const flip = theme === 'dark' && connector.presentation.stroke.invertOnDark === true;
    const line = drawn
      ? `<g opacity="${number(connector.presentation.stroke.opacity)}">${drawnShapeMarkup(drawn.parts, { fill: flip ? invertForDark(drawn.fill) : drawn.fill, stroke, invertColors: flip }, 1)}</g>`
      : `<path d="${connectorPathData(roundedConnectorCommands(connector))}"${pathAnimation} fill="none" stroke="${stroke}" stroke-width="${number(connector.presentation.stroke.width)}" opacity="${number(connector.presentation.stroke.opacity)}"${dash}${connector.presentation.stroke.dash.length && !dash ? ` stroke-dasharray="${connector.presentation.stroke.dash.map(number).join(' ')}"` : ''}/>`;
    return `<g data-connector-id="${xml(connector.id)}"${group?.className ?? ''}${group?.style ?? ''}>${line}`
      + connector.labels.map((label) => connectorLabelMarkup(label.text, label.point, ownLabelStyle(connectorLabelOnCanvas(connector.presentation.label, theme === 'dark' ? background : undefined), label), label.rich ?? null)).join('')
      + (drawn ? '' : markerMarkup(connector, stroke, background))
      + '</g>';
  }).join('');
  // The canvas's layers: containers (and a sequence's fragment bands) under the connectors, every
  // other node over them, so a frame never hides its edges and a band never hides its messages.
  // A participant goes between the two (over its bands): its lifeline must not cross the message labels.
  const markupOf = (nodes: readonly SceneNode[]) => [...nodes].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
    .map((node) => exportNode(node, matrices.get(node.id)!, theme, options.frame?.nodes[node.id], options.animations, icons, (id) => byId.get(id))).join('');
  const nodeMarkup = markupOf(page.nodes.filter((node) => !isBackdropNode(node) && !isSequenceParticipant(node)));
  const backdropMarkup = markupOf(page.nodes.filter(isBackdropNode)) + markupOf(page.nodes.filter(isSequenceParticipant));
  // Camera glide lives on a root group: CSS cannot animate `viewBox` inside an
  // `<img>`. The still path applies the same matrix, so both stay in step.
  const cameraMatrix = options.frame?.camera ? cameraFitMatrix(options.frame.camera, viewBox) : null;
  const cameraStyle = [
    'transform-box:view-box',
    'transform-origin:0 0',
    ...(options.cameraAnimation ? [cssAnimation(options.cameraAnimation)] : []),
    ...(cameraMatrix ? [`transform:${matrixCss(cameraMatrix)}`] : []),
  ].join(';');
  const content = options.cameraAnimation || cameraMatrix
    ? `<g${options.cameraAnimation ? ` class="${ANIMATED_CLASS}"` : ''} style="${cameraStyle}">${backdropMarkup}${connectorMarkup}${nodeMarkup}</g>`
    : `${backdropMarkup}${connectorMarkup}${nodeMarkup}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${number(x)} ${number(y)} ${number(width)} ${number(height)}" width="${number(width * pixelRatio)}" height="${number(height * pixelRatio)}" data-openflowkit-document="${xml(document.id)}" data-page="${xml(page.id)}" data-theme="${theme}" data-pixel-ratio="${number(pixelRatio)}">${options.styleSheet ? `<style>${options.styleSheet}</style>` : ''}${options.transparent ? '' : `<rect x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}" fill="${background}"/>`}${iconDefs(icons)}${content}</svg>`;
}
