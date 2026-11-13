import { buildNodeStateMap, connectorVisible } from '../../domain/scene/nodeState';
import { Container, Graphics, Text } from 'pixi.js';
import { pixiPaintColor } from './pixiColor';
import { decoratePixiText, pixiTextStyle } from './pixiText';
import type { NodeStyle } from '../../domain/nodes/nodeStyle';
import type { ScenePage } from '../../domain/document/types';
import { roundPolylineCorners } from '../../domain/geometry/polyline';
import { distanceBetweenPoints } from '../../domain/geometry/point';
import type { Point2d } from '../../domain/geometry/types';
import { isDarkCanvas } from '../../domain/color/adaptiveColor';
import { LABEL_WRAP_WIDTH, connectorLabelOnCanvas, connectorRichPlate } from '../../domain/connectors/labelStyle';
import { createMatrix2d } from '../../domain/geometry/matrix';
import type { RichBlock } from '../../domain/text/richLabel';
import { drawPixiRichLabel } from './pixiRichLabel';
import { PixiTextPool } from './pixiTextPool';
import { projectConnectors } from '../../domain/connectors/routeProjection';
import { connectorStrokeOnCanvas } from '../../domain/connectors/presentation';
import { connectorMarkerShapes, markerOutward } from '../../domain/connectors/markers';
import type {
  ConnectorMarkerGlyph,
  ConnectorStrokePresentation,
} from '../../domain/connectors/types';
import { buildNodeWorldMatrices, nodeWorldCenter } from '../../domain/scene/worldGeometry';
import { labelReadable } from './viewportProjection';

const LEGACY_STROKE = 0x94a3b8;

function normalizedDirection(from: Point2d, to: Point2d): Point2d {
  const distance = distanceBetweenPoints(from, to);
  return distance > 1e-9
    ? { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance }
    : { x: 1, y: 0 };
}

function offsetPoint(point: Point2d, direction: Point2d, distance: number): Point2d {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
}

function perpendicular(direction: Point2d): Point2d {
  return { x: -direction.y, y: direction.x };
}

function drawOpenPolygon(
  graphics: Graphics,
  points: readonly Point2d[],
  color: string,
  width: number,
  surface: number
): void {
  graphics
    .poly(points.flatMap((point) => [point.x, point.y]))
    .fill({ color: surface })
    .stroke({ color, width });
}

function drawMarker(
  graphics: Graphics,
  glyph: ConnectorMarkerGlyph,
  endpoint: Point2d,
  outward: Point2d,
  offset: number,
  stroke: ConnectorStrokePresentation,
  /** Hollow glyphs (circle, open triangle/diamond) fill with the canvas, as the export fills them with its page. */
  surface: number
): void {
  const tip = offsetPoint(endpoint, outward, -offset);
  const back = offsetPoint(tip, outward, -9);
  const normal = perpendicular(outward);
  const left = offsetPoint(back, normal, 4.5);
  const right = offsetPoint(back, normal, -4.5);
  switch (glyph) {
    case 'arrow':
      graphics
        .moveTo(left.x, left.y)
        .lineTo(tip.x, tip.y)
        .lineTo(right.x, right.y)
        .stroke({ color: stroke.color, alpha: stroke.opacity, width: stroke.width });
      break;
    case 'triangle-open':
      drawOpenPolygon(graphics, [tip, left, right], stroke.color, stroke.width, surface);
      break;
    case 'triangle-filled':
      graphics.poly([tip.x, tip.y, left.x, left.y, right.x, right.y]).fill({
        color: stroke.color,
        alpha: stroke.opacity,
      });
      break;
    case 'diamond-open':
    case 'diamond-filled': {
      const far = offsetPoint(tip, outward, -14);
      const middle = offsetPoint(tip, outward, -7);
      const diamondLeft = offsetPoint(middle, normal, 4.5);
      const diamondRight = offsetPoint(middle, normal, -4.5);
      const points = [tip, diamondLeft, far, diamondRight];
      if (glyph === 'diamond-open') {
        drawOpenPolygon(graphics, points, stroke.color, stroke.width, surface);
      } else {
        graphics.poly(points.flatMap((point) => [point.x, point.y])).fill({ color: stroke.color });
      }
      break;
    }
    case 'circle': {
      const center = offsetPoint(tip, outward, -5);
      graphics
        .circle(center.x, center.y, 4)
        .fill({ color: surface })
        .stroke({ color: stroke.color, width: stroke.width });
      break;
    }
    case 'bar': {
      const center = offsetPoint(tip, outward, -3);
      const barStart = offsetPoint(center, normal, 5);
      const barEnd = offsetPoint(center, normal, -5);
      graphics
        .moveTo(barStart.x, barStart.y)
        .lineTo(barEnd.x, barEnd.y)
        .stroke({ color: stroke.color, width: stroke.width });
      break;
    }
    case 'cross': {
      const center = offsetPoint(tip, outward, -5);
      const a = offsetPoint(offsetPoint(center, normal, 4.5), outward, 4.5);
      const b = offsetPoint(offsetPoint(center, normal, -4.5), outward, -4.5);
      const c = offsetPoint(offsetPoint(center, normal, 4.5), outward, -4.5);
      const d = offsetPoint(offsetPoint(center, normal, -4.5), outward, 4.5);
      graphics.moveTo(a.x, a.y).lineTo(b.x, b.y).moveTo(c.x, c.y).lineTo(d.x, d.y)
        .stroke({ color: stroke.color, alpha: stroke.opacity, width: stroke.width });
      break;
    }
    case 'crow-foot': {
      // The export's geometry, so a fork on screen is the fork in the file.
      for (const shape of connectorMarkerShapes(glyph, endpoint, outward, offset)) {
        if (shape.kind !== 'polygon') continue;
        for (const [from, to] of shape.subpaths) graphics.moveTo(from!.x, from!.y).lineTo(to!.x, to!.y);
      }
      graphics.stroke({ color: stroke.color, alpha: stroke.opacity, width: stroke.width });
      break;
    }
  }
}

function drawSolidPath(
  graphics: Graphics,
  samples: readonly Point2d[],
  stroke: ConnectorStrokePresentation
): void {
  const first = samples[0];
  if (!first) return;
  graphics.moveTo(first.x, first.y);
  for (const point of samples.slice(1)) graphics.lineTo(point.x, point.y);
  graphics.stroke({ color: stroke.color, alpha: stroke.opacity, width: stroke.width });
}

export function drawDashedPath(
  graphics: Graphics,
  samples: readonly Point2d[],
  stroke: ConnectorStrokePresentation
): void {
  let patternIndex = 0;
  let remaining = stroke.dash[0];
  let drawing = true;
  for (let index = 1; index < samples.length; index += 1) {
    let start = samples[index - 1];
    const end = samples[index];
    let segmentLength = distanceBetweenPoints(start, end);
    const direction = normalizedDirection(start, end);
    while (segmentLength > 1e-9) {
      const step = Math.min(segmentLength, remaining);
      const next = offsetPoint(start, direction, step);
      if (drawing) {
        graphics
          .moveTo(start.x, start.y)
          .lineTo(next.x, next.y)
          .stroke({ color: stroke.color, alpha: stroke.opacity, width: stroke.width });
      }
      start = next;
      segmentLength -= step;
      remaining -= step;
      if (remaining <= 1e-9) {
        patternIndex = (patternIndex + 1) % stroke.dash.length;
        remaining = stroke.dash[patternIndex];
        drawing = !drawing;
      }
    }
  }
}

/** The page with the connectors that draw: not hidden, and both ends visible. One definition for the renderer and the focus overlay's dashes. */
export function visibleConnectorPage(page: ScenePage): ScenePage {
  const nodeStates = buildNodeStateMap(page);
  return { ...page, connectors: page.connectors.filter((connector) => connectorVisible(connector, nodeStates)) };
}

export class PixiConnectorRenderer {
  readonly container = new Container();
  private readonly paths = new Graphics();
  private readonly labelPlates = new Graphics();
  private readonly labels = new Container();
  private debugSnapshot = { connectors: 0, labels: 0, markers: 0, widestLabel: 0 };
  private widestLabel = 0;
  // ponytail: connector labels share one plate layer, so they show together, once the smallest one drawn is readable.
  private smallestLabelFont = Number.POSITIVE_INFINITY;
  private zoom = 1;
  private editingConnectorId: string | null = null;
  private readonly texts = new PixiTextPool();

  constructor() {
    this.container.addChild(this.paths, this.labelPlates, this.labels);
  }

  /**
   * Draws the page's connectors, or only `renderedConnectorIds`. Lanes shared with an arrow that is not drawn still come from the whole page
   * (the projection context reads every connector), so a subset sits where the page draws it. `placeLabelsAmongAll` also places the subset's
   * labels among every visible arrow's, for a copy that must land exactly on the page's own labels (the focus overlay); the base draw never pays for it.
   */
  draw(
    page: ScenePage,
    advanced: boolean,
    renderedConnectorIds: ReadonlySet<string> | null = null,
    canvasColor?: string,
    placeLabelsAmongAll = false
  ): void {
    this.paths.clear();
    this.labelPlates.clear();
    this.labels.removeChildren().forEach((child) => child.destroy());
    if (renderedConnectorIds?.size === 0) {
      this.debugSnapshot = { connectors: 0, labels: 0, markers: 0, widestLabel: 0 };
      return;
    }
    const visiblePage = visibleConnectorPage(page);
    const wanted = (connector: { readonly id: string }): boolean => !renderedConnectorIds || renderedConnectorIds.has(connector.id);
    if (!advanced) {
      const drawn = visiblePage.connectors.filter(wanted);
      this.drawLegacy({ ...visiblePage, connectors: drawn });
      this.debugSnapshot = { connectors: drawn.length, labels: 0, markers: 0, widestLabel: 0 };
      return;
    }
    const connectors = placeLabelsAmongAll
      ? projectConnectors(visiblePage, visiblePage.connectors).filter(wanted)
      : projectConnectors(visiblePage, visiblePage.connectors.filter(wanted));
    const onDark = isDarkCanvas(canvasColor);
    const surface = pixiPaintColor(canvasColor ?? '#ffffff', 0xffffff).color;
    let labelCount = 0;
    let markerCount = 0;
    this.widestLabel = 0;
    this.smallestLabelFont = Number.POSITIVE_INFINITY;
    for (const connector of connectors) {
      const hasCurve = connector.commands.some((command) => command.kind === 'cubic');
      // Beziers sample their own curve; everything else gets arc-sampled
      // corners so solid and dashed walkers share one path.
      const samples = hasCurve
        ? connector.samples
        : roundPolylineCorners(connector.samples, connector.presentation.cornerRadius);
      const { presentation } = connector;
      const stroke = connectorStrokeOnCanvas(presentation.stroke, canvasColor);
      if (stroke.dash.length > 0) {
        drawDashedPath(this.paths, samples, stroke);
      } else {
        drawSolidPath(this.paths, samples, stroke);
      }
      const first = samples[0];
      const last = samples.at(-1);
      if (first && samples[1]) {
        const outward = markerOutward(samples, 'source');
        connector.presentation.sourceMarkers.forEach((glyph, index) =>
          drawMarker(this.paths, glyph, first, outward, index * 9, stroke, surface)
        );
        markerCount += connector.presentation.sourceMarkers.length;
      }
      if (last && samples.at(-2)) {
        const outward = markerOutward(samples, 'target');
        connector.presentation.targetMarkers.forEach((glyph, index) =>
          drawMarker(this.paths, glyph, last, outward, index * 9, stroke, surface)
        );
        markerCount += connector.presentation.targetMarkers.length;
      }
      if (connector.id !== this.editingConnectorId) {
        for (const labelGeometry of connector.labels) this.drawLabel(labelGeometry, onDark ? connectorLabelOnCanvas(presentation.label, canvasColor) : presentation.label);
        labelCount += connector.labels.length;
      }
    }
    this.debugSnapshot = {
      connectors: connectors.length,
      labels: labelCount,
      markers: markerCount,
      widestLabel: Math.round(this.widestLabel),
    };
    this.showReadableLabels();
  }

  getDebugSnapshot(): {
    readonly connectors: number;
    readonly labels: number;
    readonly markers: number;
    /** Width in world px of the widest label drawn: long labels wrap at LABEL_WRAP_WIDTH. */
    readonly widestLabel: number;
  } {
    return this.debugSnapshot;
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.showReadableLabels();
  }

  private showReadableLabels(): void {
    const visible = labelReadable(this.zoom, this.smallestLabelFont);
    this.labels.visible = visible;
    this.labelPlates.visible = visible;
  }

  private drawLegacy(page: ScenePage): void {
    const matrices = buildNodeWorldMatrices(page);
    const nodes = new Map(page.nodes.map((node) => [node.id, node]));
    for (const connector of page.connectors) {
      const source = nodes.get(connector.source.nodeId);
      const target = nodes.get(connector.target.nodeId);
      const sourceMatrix = source && matrices.get(source.id);
      const targetMatrix = target && matrices.get(target.id);
      if (!source || !target || !sourceMatrix || !targetMatrix) continue;
      const start = nodeWorldCenter(source, sourceMatrix);
      const end = nodeWorldCenter(target, targetMatrix);
      this.paths
        .moveTo(start.x, start.y)
        .lineTo(end.x, end.y)
        .stroke({ color: LEGACY_STROKE, width: 1.5 });
    }
  }

  /** While the DOM editor sits on a label the Pixi copy is not drawn. */
  setEditingConnector(connectorId: string | null): void {
    this.editingConnectorId = connectorId;
  }

  private drawLabel(label: { readonly text: string; readonly point: Point2d; readonly rich?: readonly RichBlock[] | null }, style: NodeStyle): void {
    if (label.rich) { this.drawRichLabel(label.rich, label.point, style); return; }
    const color = pixiPaintColor(style.textColor, 0x334155).color;
    const text = new Text({ text: label.text, style: { ...pixiTextStyle(style, color, LABEL_WRAP_WIDTH), align: 'center' } });
    this.widestLabel = Math.max(this.widestLabel, text.width);
    this.smallestLabelFont = Math.min(this.smallestLabelFont, style.fontSize);
    text.anchor.set(0.5);
    text.position.set(label.point.x, label.point.y);
    const plate = pixiPaintColor(style.fill, 0xffffff);
    const border = pixiPaintColor(style.stroke, 0xe2e8f0);
    const pad = style.textPadding;
    if (plate.alpha > 0 || border.alpha > 0) {
      this.labelPlates
        .roundRect(label.point.x - text.width / 2 - pad, label.point.y - text.height / 2 - pad / 2,
          text.width + pad * 2, text.height + pad, style.cornerRadius)
        .fill({ color: plate.color, alpha: plate.alpha * 0.96 })
        .stroke({ color: border.color, alpha: border.alpha, width: style.strokeWidth });
    }
    decoratePixiText(this.labels, text, style, color);
    this.labels.addChild(text);
  }

  /** Formatted words, on their plate, centred on their point. */
  private drawRichLabel(blocks: readonly RichBlock[], point: Point2d, style: NodeStyle): void {
    const box = connectorRichPlate(blocks, style, point);
    this.widestLabel = Math.max(this.widestLabel, box.width);
    this.smallestLabelFont = Math.min(this.smallestLabelFont, style.fontSize);
    const plate = pixiPaintColor(style.fill, 0xffffff);
    const border = pixiPaintColor(style.stroke, 0xe2e8f0);
    if (plate.alpha > 0 || border.alpha > 0) {
      this.labelPlates.roundRect(box.x, box.y, box.width, box.height, style.cornerRadius)
        .fill({ color: plate.color, alpha: plate.alpha * 0.96 })
        .stroke({ color: border.color, alpha: border.alpha, width: style.strokeWidth });
    }
    drawPixiRichLabel(this.labels, this.texts, blocks, { ...style, textAlign: 'center', textVerticalAlign: 'middle' }, box, createMatrix2d(1, 0, 0, 1, box.x, box.y), false);
  }
}
