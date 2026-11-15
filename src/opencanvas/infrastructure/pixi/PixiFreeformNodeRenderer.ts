import { Container, Graphics, Text } from 'pixi.js';
import { createBounds2d } from '../../domain/geometry/bounds';
import { applyMatrixToPoint } from '../../domain/geometry/matrix';
import type { SceneNode } from '../../domain/document/types';
import type { Matrix2d, Size2d } from '../../domain/geometry/types';
import { pressureTiltSegmentWidth } from '../../domain/nodes/strokeInput';
import { smoothStroke } from '../../domain/nodes/strokeGeometry';
import { projectFreeformNodeVisual, type PixiFreeformNodeVisual } from './freeformNodeVisual';
import { drawPixiNodeOutline } from './pixiNodeOutline';
import type { PixiNodeDebugRecord } from './pixiNodeDebug';
import { PixiMediaLayer, type PixiMediaSlot } from './PixiMediaLayer';
import { applyPixiNodeMatrix } from './pixiNodeTransform';
import { createPixiText, decoratePixiText, pixiTextStyle } from './pixiText';
import { resolveNodeStyle } from '../../domain/nodes/nodeStyle';
import { pixiPaintColor } from './pixiColor';

interface PixiFreeformNodeDrawResult {
  readonly label: Container;
  readonly debug: PixiNodeDebugRecord;
}

function drawChrome(
  graphics: Graphics,
  visual: PixiFreeformNodeVisual,
  size: Size2d,
  matrix: Matrix2d
): void {
  if (visual.kind === 'pen' || visual.kind === 'highlighter'
    || visual.kind === 'line' || visual.kind === 'arrow') return;
  if (visual.kind === 'text') {
    if (!visual.hasBackground) return;
    drawPixiNodeOutline(graphics, 'rounded', size, matrix);
    graphics.fill({ color: visual.fill }).stroke({ color: visual.stroke, width: 1 });
    return;
  }
  // A picture is its own look; the plate is a stand-in for one that is missing, not a frame behind a transparent one.
  if (visual.kind === 'image' && (visual.presentation.sourceUrl || visual.presentation.assetId)) return;
  drawPixiNodeOutline(graphics, 'rounded', size, matrix);
  graphics.fill({ color: visual.fill }).stroke({ color: visual.stroke, width: 1.5 });
  if (visual.kind !== 'annotation' && visual.kind !== 'sticky' && visual.kind !== 'callout') return;
  const foldSize = Math.min(28, size.width / 4, size.height / 3);
  const fold = [
    { x: size.width - foldSize, y: size.height },
    { x: size.width, y: size.height - foldSize },
    { x: size.width, y: size.height },
  ].map((point) => applyMatrixToPoint(matrix, point));
  graphics
    .poly(fold.flatMap((point) => [point.x, point.y]))
    .fill({ color: visual.foldFill })
    .stroke({ color: visual.foldStroke, width: 1 });
}

// Text nodes read the shared node style (fill/stroke/typography) so the
// style bar, the label editor and this draw agree on every property.
function drawTextNode(
  node: SceneNode, matrix: Matrix2d, graphics: Graphics, visual: PixiFreeformNodeVisual, canvasColor: string
): PixiFreeformNodeDrawResult {
  const style = resolveNodeStyle(node, canvasColor);
  const fill = pixiPaintColor(style.fill, 0xffffff);
  const stroke = pixiPaintColor(style.stroke, 0x94a3b8);
  if (fill.alpha > 0 || (stroke.alpha > 0 && style.strokeWidth > 0)) {
    drawPixiNodeOutline(graphics, 'rectangle', node.size, matrix, undefined, style.cornerRadius);
    graphics.fill({ color: fill.color, alpha: fill.alpha * style.opacity });
    if (style.strokeWidth > 0) graphics.stroke({ color: stroke.color, width: style.strokeWidth, alpha: stroke.alpha * style.opacity });
  }
  const label = new Container();
  label.alpha = style.opacity;
  const pad = style.textPadding;
  const wrap = Math.max(1, node.size.width - pad * 2);
  const color = pixiPaintColor(style.textColor, visual.text).color;
  const text = new Text({ text: typeof node.content.label === 'string' ? node.content.label : 'Text',
    style: { ...pixiTextStyle(style, color, wrap), align: style.textAlign === 'start' ? 'left' : style.textAlign === 'end' ? 'right' : 'center' } });
  const anchorX = style.textAlign === 'start' ? 0 : style.textAlign === 'end' ? 1 : 0.5;
  const anchorY = style.textVerticalAlign === 'top' ? 0 : style.textVerticalAlign === 'bottom' ? 1 : 0.5;
  text.anchor.set(anchorX, anchorY);
  text.position.set(pad + anchorX * wrap, pad + anchorY * Math.max(1, node.size.height - pad * 2));
  label.addChild(text);
  decoratePixiText(label, text, style, color);
  applyPixiNodeMatrix(label, matrix);
  return { label, debug: { id: node.id, kind: 'text', shape: 'text', fill: fill.color,
    stroke: stroke.color, textColor: color, mediaState: 'none' } };
}

export class PixiFreeformNodeRenderer {
  private readonly mediaLayer: PixiMediaLayer;

  constructor(
    onMediaReady: (nodeId: string) => void,
    private readonly resolveAsset?: (assetId: string) => Promise<string | null>,
    mediaSlot?: PixiMediaSlot
  ) {
    this.mediaLayer = new PixiMediaLayer(onMediaReady, mediaSlot);
  }

  get media(): Container {
    return this.mediaLayer.container;
  }

  beginDraw(): number {
    return this.mediaLayer.beginDraw();
  }

  isMediaLoaded(nodeId: string): boolean {
    return this.mediaLayer.isLoaded(nodeId);
  }

  drawNode(
    node: SceneNode,
    matrix: Matrix2d,
    graphics: Graphics,
    generation: number,
    canvasColor = '#f7f7f5'
  ): PixiFreeformNodeDrawResult | null {
    const visual = projectFreeformNodeVisual(node, canvasColor);
    if (!visual) return null;
    if (visual.kind === 'text') return drawTextNode(node, matrix, graphics, visual, canvasColor);
    if (visual.kind === 'pen' || visual.kind === 'highlighter'
      || visual.kind === 'line' || visual.kind === 'arrow') {
      // Pressure strokes keep their sampled points (widths ride them); a
      // pointer stroke is smoothed so it reads as a curve, not chords.
      const raw = visual.presentation.points;
      const smoothed = visual.presentation.inputSamples ? raw
        : visual.kind === 'pen' || visual.kind === 'highlighter' ? smoothStroke(raw) : raw;
      const points = smoothed.map((point) => applyMatrixToPoint(matrix, point));
      const inputSamples = smoothed === raw ? visual.presentation.inputSamples : null;
      if (inputSamples) {
        for (let index = 1; index < points.length; index += 1) {
          const previous = points[index - 1];
          const point = points[index];
          graphics.moveTo(previous.x, previous.y).lineTo(point.x, point.y).stroke({
            color: visual.stroke,
            width: pressureTiltSegmentWidth(
              visual.presentation.width,
              inputSamples[index - 1],
              inputSamples[index]
            ),
            alpha: visual.presentation.opacity,
            cap: 'round',
          });
        }
      } else {
        graphics.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) graphics.lineTo(point.x, point.y);
        graphics.stroke({ color: visual.stroke, width: visual.presentation.width,
          alpha: visual.presentation.opacity, cap: 'round', join: 'round' });
      }
      if (visual.kind === 'arrow') {
        const end = points.at(-1)!; const previous = points.at(-2)!;
        const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
        const length = Math.max(8, visual.presentation.width * 3);
        graphics.moveTo(end.x, end.y)
          .lineTo(end.x - Math.cos(angle - Math.PI / 6) * length,
            end.y - Math.sin(angle - Math.PI / 6) * length)
          .moveTo(end.x, end.y)
          .lineTo(end.x - Math.cos(angle + Math.PI / 6) * length,
            end.y - Math.sin(angle + Math.PI / 6) * length)
          .stroke({ color: visual.stroke, width: visual.presentation.width,
            alpha: visual.presentation.opacity, cap: 'round' });
      }
    }
    drawChrome(graphics, visual, node.size, matrix);
    const label = this.createLabel(visual, node.size);
    applyPixiNodeMatrix(label, matrix);
    const imageUrl = visual.kind === 'image' ? visual.presentation.sourceUrl : null;
    const assetId = visual.kind === 'image' ? visual.presentation.assetId : null;
    if (visual.kind === 'image' && (imageUrl || assetId)) {
      this.mediaLayer.load({
        nodeId: node.id,
        generation,
        matrix,
        bounds: createBounds2d(0, 0, node.size.width, node.size.height),
        opacity: visual.presentation.opacity,
        stretch: visual.presentation.fit === 'stretch',
        resolveUrl: async () => imageUrl
          ?? (assetId && this.resolveAsset ? this.resolveAsset(assetId) : null),
      });
    }
    return {
      label,
      debug: {
        id: node.id,
        kind: visual.kind,
        shape: visual.kind,
        fill: visual.fill,
        stroke: visual.stroke,
        mediaState:
          visual.kind !== 'image' ? 'none' : visual.presentation.sourceUrl ? 'loading' : 'missing',
      },
    };
  }

  private createLabel(visual: PixiFreeformNodeVisual, size: Size2d): Container {
    const content = new Container();
    if (visual.kind === 'text') {
      const text = createPixiText(visual.presentation.label, {
        size: visual.presentation.fontSizePx,
        weight: visual.presentation.fontWeight,
        fill: visual.text,
        family: visual.presentation.fontFamily,
        style: visual.presentation.fontStyle,
        wrapWidth: Math.max(1, size.width - 16),
      });
      text.anchor.set(0.5);
      text.position.set(size.width / 2, size.height / 2);
      content.addChild(text);
      return content;
    }
    if (visual.kind === 'annotation' || visual.kind === 'sticky' || visual.kind === 'callout') {
      const title = visual.presentation.title
        ? createPixiText(visual.presentation.title, {
            size: 14,
            weight: '700',
            fill: visual.text,
            wrapWidth: Math.max(1, size.width - 24),
          })
        : null;
      const body = createPixiText(visual.presentation.body, {
        size: 12,
        weight: '500',
        fill: visual.subText,
        wrapWidth: Math.max(1, size.width - 24),
      });
      if (title) {
        title.position.set(12, 10);
        body.position.set(12, 34);
        content.addChild(title);
      } else {
        body.position.set(12, 12);
      }
      content.addChild(body);
      return content;
    }
    if (visual.kind === 'pen' || visual.kind === 'highlighter'
      || visual.kind === 'line' || visual.kind === 'arrow') return content;
    if (visual.kind !== 'image') return content;
    const placeholder = createPixiText(
      visual.presentation.sourceUrl ? 'Loading image…' : 'No Image',
      {
        size: 12,
        weight: '600',
        fill: visual.text,
      }
    );
    placeholder.anchor.set(0.5);
    placeholder.position.set(size.width / 2, size.height / 2);
    content.addChild(placeholder);
    return content;
  }
}
