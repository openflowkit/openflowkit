import { pixiPaintColor } from './pixiColor';
import { resolveNodeStyle, type NodeStyle } from '../../domain/nodes/nodeStyle';
import { basicNodeOutlinePoints } from '../../domain/nodes/basicNodeOutline';
import { basicNodeDecorations } from '../../domain/nodes/basicNodeDecorations';
import { drawDashedPath } from './PixiConnectorRenderer';
import { buildNodeStateMap } from '../../domain/scene/nodeState';
import { Container, Graphics, Text } from 'pixi.js';
import { applyMatrixToPoint, transformBounds } from '../../domain/geometry/matrix';
import { createBounds2d, unionBounds } from '../../domain/geometry/bounds';
import type { ScenePage } from '../../domain/document/types';
import type { SceneIndex } from '../../domain/scene/types';
import { layoutNodeContent, resolveNodeContentLayout } from '../../domain/node-layout/model';
import type { Bounds2d, Matrix2d, Size2d } from '../../domain/geometry/types';
import { projectBasicNodeVisual } from './basicNodeVisual';
import { PixiArchitectureNodeRenderer } from './PixiArchitectureNodeRenderer';
import { PixiClassEntityNodeRenderer } from './PixiClassEntityNodeRenderer';
import { PixiFreeformNodeRenderer } from './PixiFreeformNodeRenderer';
import { PixiJourneyNodeRenderer } from './PixiJourneyNodeRenderer';
import { PixiMindmapNodeRenderer } from './PixiMindmapNodeRenderer';
import { PixiSequenceNodeRenderer } from './PixiSequenceNodeRenderer';
import { PixiWireframeNodeRenderer } from './PixiWireframeNodeRenderer';
import { PixiWidgetNodeRenderer } from './PixiWidgetNodeRenderer';
import { PixiChartNodeRenderer } from './PixiChartNodeRenderer';
import { drawPixiNodeOutline } from './pixiNodeOutline';
import type { PixiNodeDebugRecord } from './pixiNodeDebug';
import { isBackdropNode, isContainerNodeKind } from '../../domain/nodes/containerNodePresentation';
import { isSequenceParticipant } from './sequenceNodeVisual';
import { resolveLabelSizing } from '../../domain/node-sizing/labelWrap';
import { measurePortableText, SUBLABEL_FONT } from '../../domain/text/measurement';
import { decoratePixiText, isTitle, markTitle, stripFont } from './pixiText';
import { PixiTextPool } from './pixiTextPool';
import { labelReadable, MIN_TITLE_SCREEN_PX, type SemanticDetailLevel } from './viewportProjection';
import { numericColorToHex } from '../../domain/color/adaptiveColor';
import { OverlapGrid } from './overlapGrid';
import { pixiTextExtent } from './pixiTextExtent';

const NODE_FILL = 0xffffff;
const NODE_STROKE = 0xcbd5e1;
const ICON_FILL = 0xfef4f0;
const ICON_STROKE = 0xe95420;
const DETAILED_OUTLINE_NODE_LIMIT = 1_000;
// ponytail: family renderers (architecture, class, sequence…) draw their own text; their smallest, 12 px, stands for all of it.
const FAMILY_LABEL_FONT = 12;

export type { PixiNodeDebugRecord } from './pixiNodeDebug';

function textPosition(bounds: Bounds2d, alignment: 'start' | 'center' | 'end'): number {
  if (alignment === 'start') return bounds.x;
  if (alignment === 'end') return bounds.x + bounds.width;
  return bounds.x + bounds.width / 2;
}

function textAnchor(alignment: 'start' | 'center' | 'end'): number {
  if (alignment === 'start') return 0;
  if (alignment === 'end') return 1;
  return 0.5;
}

/** A label's world box, from its anchor and measured size: text that overflows reaches past its node. */
function textBox(matrix: Matrix2d, bounds: Bounds2d, alignment: 'start' | 'center' | 'end', size: Size2d): Bounds2d {
  const x = textPosition(bounds, alignment) - textAnchor(alignment) * size.width;
  return transformBounds(matrix, createBounds2d(x, bounds.y, Math.max(0, size.width), Math.max(0, size.height)));
}

/** Where one shape paints: its fill and lines, its images, its text. */
interface PaintLayer {
  readonly graphics: Graphics;
  readonly media: Container;
  readonly labels: Container;
}

/** Sub-labels use the node's family/colour at a fixed smaller size. */
function subLabelStyle(style: NodeStyle): NodeStyle {
  return { ...style, ...SUBLABEL_FONT, textDecoration: 'none' };
}

export class PixiNodeRenderer {
  /** Under the connectors, as the SVG export paints them: a sequence's fragment bands, then its participants. */
  readonly backdrop = new Graphics();
  readonly graphics = new Graphics();
  readonly media = new Container();
  /**
   * The text, then any overlap layers. A shape that crosses a lower shape's box paints in a layer of its own here
   * (fill, images, text) so it covers that shape's text and images too, as it does in the export. Every owner adds
   * `graphics`, `media`, `labels` in that order, so the overlap layers need no wiring of their own.
   */
  readonly labels = new Container();
  private readonly ownLabels = new Container();
  private overlapLayers: (PaintLayer & { readonly root: Container })[] = [];
  /** Per node, the media container its images go in and their paint order there (images load in any order). */
  private readonly mediaSlots = new Map<string, { container: Container; order: number }>();
  private readonly labelByNodeId = new Map<string, Container>();
  /** Font size per label, for the on-screen readability check. */
  private readonly labelFontByNodeId = new Map<string, number>();
  /** A node whose label names it (a title Text): the whole label stays to the title floor, its other Texts to the body floor. */
  private readonly secondaryByNodeId = new Map<string, readonly { view: Container; font: number }[]>();
  // Label Text objects rasterize to a texture on creation (~0.5–1 ms each), so
  // a redraw reuses last draw's instances with the same text and style
  // instead of destroying and re-creating every label.
  private readonly texts = new PixiTextPool();
  private readonly freeformRenderer: PixiFreeformNodeRenderer;
  private readonly architectureRenderer: PixiArchitectureNodeRenderer;
  private readonly classEntityRenderer = new PixiClassEntityNodeRenderer();
  private readonly mindmapRenderer = new PixiMindmapNodeRenderer();
  private readonly journeyRenderer = new PixiJourneyNodeRenderer();
  private readonly sequenceRenderer = new PixiSequenceNodeRenderer();
  private readonly wireframeRenderer: PixiWireframeNodeRenderer;
  private readonly chartRenderer: PixiChartNodeRenderer;
  private readonly widgetRenderer = new PixiWidgetNodeRenderer((text, style, fill) => this.texts.styled(text, style, fill, null));
  private debugRecords: readonly PixiNodeDebugRecord[] = [];
  private editingNodeId: string | null = null;

  constructor(
    onMediaReady: () => void = () => undefined,
    private readonly resolveAsset?: (assetId: string) => Promise<string | null>
  ) {
    const mediaSlot = (nodeId: string) => this.mediaSlots.get(nodeId) ?? { container: this.media, order: 0 };
    this.media.sortableChildren = true;
    this.labels.addChild(this.ownLabels);
    this.freeformRenderer = new PixiFreeformNodeRenderer((nodeId) => {
      this.debugRecords = this.debugRecords.map((record) =>
        record.id === nodeId ? { ...record, mediaState: 'loaded' } : record
      );
      const label = this.labelByNodeId.get(nodeId);
      if (label) label.visible = false;
      onMediaReady();
    }, resolveAsset, mediaSlot);
    this.architectureRenderer = new PixiArchitectureNodeRenderer(this.texts, (nodeId) => {
      this.debugRecords = this.debugRecords.map((record) =>
        record.id === nodeId ? { ...record, mediaState: 'loaded' } : record
      );
      onMediaReady();
    }, mediaSlot);
    this.chartRenderer = new PixiChartNodeRenderer();
    this.wireframeRenderer = new PixiWireframeNodeRenderer((nodeId) => {
      this.debugRecords = this.debugRecords.map((record) =>
        record.id === nodeId ? { ...record, mediaState: 'loaded' } : record
      );
      onMediaReady();
    }, mediaSlot);
  }

  /** Containers are drawn by PixiContainerRenderer; everything else lands here. */
  draw(
    page: ScenePage,
    index: SceneIndex,
    renderedNodeIds: ReadonlySet<string> | null = null,
    detailLevel: SemanticDetailLevel = 'full',
    canvasColor = 0xf7f7f5,
    textWidths?: ReadonlyMap<string, number>
  ): void {
    this.graphics.clear();
    this.backdrop.clear();
    for (const content of this.ownLabels.removeChildren()) this.texts.recycle(content);
    for (const layer of this.overlapLayers) {
      for (const content of layer.labels.removeChildren()) this.texts.recycle(content);
      layer.root.destroy({ children: true });
    }
    this.overlapLayers = [];
    for (const child of this.media.removeChildren()) child.destroy({ children: true });
    this.mediaSlots.clear();
    const freeformMediaGeneration = this.freeformRenderer.beginDraw();
    const architectureMediaGeneration = this.architectureRenderer.beginDraw();
    const wireframeMediaGeneration = this.wireframeRenderer.beginDraw();
    this.mindmapRenderer.beginDraw(page.nodes);
    this.labelByNodeId.clear();
    this.labelFontByNodeId.clear();
    this.secondaryByNodeId.clear();
    const debugRecords: PixiNodeDebugRecord[] = [];
    const nodeStates = buildNodeStateMap(page);
    // Paint order is zIndex (as hit-testing and export use), not array order: Reorder only changes zIndex.
    const byZ = [...page.nodes].sort((left, right) => left.zIndex - right.zIndex);
    const bands = byZ.filter((node) => !isContainerNodeKind(node.kind) && isBackdropNode(node));
    const participants = byZ.filter(isSequenceParticipant);
    const ordered = bands.length + participants.length === 0 ? byZ
      : [...bands, ...participants, ...byZ.filter((node) => !isBackdropNode(node) && !isSequenceParticipant(node))];
    // Boxes already in the top layer: a shape that crosses one opens a new layer, so it paints over that one's text and
    // images as well as its fill. Shapes side by side share a layer, so a page without overlaps draws in one.
    const painted = new OverlapGrid();
    let layer: PaintLayer = { graphics: this.graphics, media: this.media, labels: this.ownLabels };
    let order = 0;
    for (const node of ordered) {
      if (!nodeStates.get(node.id)?.visible) continue;
      if (renderedNodeIds && !renderedNodeIds.has(node.id)) continue;
      if (isContainerNodeKind(node.kind)) continue;
      const matrix = index.worldMatricesByNodeId.get(node.id);
      if (!matrix) continue;
      const canvasHex = numericColorToHex(canvasColor);
      // The backdrop (sequence bands, participants) is under every shape, the arrows too: it never stacks with them.
      const backdrop = isBackdropNode(node) || isSequenceParticipant(node);
      const box = backdrop ? null
        : transformBounds(matrix, createBounds2d(0, 0, Math.max(0, node.size.width), Math.max(0, node.size.height)));
      if (box && painted.hits(box)) {
        layer = this.openOverlapLayer();
        painted.clear();
      }
      const paint = backdrop ? { graphics: this.backdrop, media: this.media, labels: this.ownLabels } : layer;
      this.mediaSlots.set(node.id, { container: paint.media, order: order++ });
      const target = paint.graphics;
      // Family renderers take the node in order; the first one that claims it wins.
      const family = detailLevel === 'overview' ? null
        : this.chartRenderer.drawNode(node, matrix, target, canvasHex)
          ?? this.widgetRenderer.drawNode(node, matrix, target, canvasHex, (id) => index.nodesById.get(id))
          ?? this.architectureRenderer.drawNode(node, matrix, target, architectureMediaGeneration, canvasHex, textWidths?.get(node.id))
          ?? this.classEntityRenderer.drawNode(node, matrix, target)
          ?? this.mindmapRenderer.drawNode(node, matrix, target)
          ?? this.journeyRenderer.drawNode(node, matrix, target)
          ?? this.sequenceRenderer.drawNode(node, matrix, target, canvasHex)
          ?? this.wireframeRenderer.drawNode(node, matrix, target, wireframeMediaGeneration)
          ?? this.freeformRenderer.drawNode(node, matrix, target, freeformMediaGeneration, canvasHex);
      if (family) {
        paint.labels.addChild(family.label);
        // Only text and images paint over later fills: ink and bare boxes leave nothing for a shape above to cover.
        // A sticky's body wraps to its width, not its height, so its text can reach past the box.
        if (box && (family.label.children.length > 0 || family.debug.mediaState !== 'none')) {
          const text = pixiTextExtent(family.label);
          painted.add(text ? unionBounds(box, text) : box);
        }
        this.labelByNodeId.set(node.id, family.label);
        this.trackTitle(node.id, family.label);
        debugRecords.push(family.debug);
        continue;
      }
      const visual = projectBasicNodeVisual(node);
      const shape = visual?.shape ?? 'rectangle';
      const renderedShape =
        page.nodes.length > DETAILED_OUTLINE_NODE_LIMIT && shape === 'rounded'
          ? 'rectangle'
          : shape;
      const style = resolveNodeStyle(node, numericColorToHex(canvasColor));
      const fillPaint = pixiPaintColor(style.fill, visual?.fill ?? NODE_FILL);
      const strokePaint = pixiPaintColor(style.stroke, visual?.stroke ?? NODE_STROKE);
      const fill = fillPaint.color;
      const stroke = strokePaint.color;
      const textColor = pixiPaintColor(style.textColor, visual?.text ?? 0x1e293b).color;
      // ponytail: opacity honoured for basic shapes only; family renderers
      // draw into the shared graphics and would each need an alpha argument.
      const alpha = style.opacity;
      const customPath = typeof node.content.customSvgPath === 'string' ? node.content.customSvgPath : undefined;
      if (style.shadow && fillPaint.alpha > 0) {
        drawPixiNodeOutline(target, renderedShape, node.size,
          { ...matrix, tx: matrix.tx + 2, ty: matrix.ty + 4 }, customPath, style.cornerRadius);
        target.fill({ color: 0x0f172a, alpha: 0.12 * alpha });
      }
      drawPixiNodeOutline(target, renderedShape, node.size, matrix, customPath, style.cornerRadius);
      target.fill({ color: fill, alpha: alpha * fillPaint.alpha });
      if (style.strokeWidth > 0 && style.dash.length) {
        const outline = basicNodeOutlinePoints(renderedShape, node.size, customPath, style.cornerRadius)
          .map((point) => applyMatrixToPoint(matrix, point));
        drawDashedPath(target, [...outline, outline[0]], {
          color: `#${stroke.toString(16).padStart(6, '0')}`, width: style.strokeWidth,
          opacity: alpha * strokePaint.alpha, dash: style.dash,
        });
      } else if (style.strokeWidth > 0) {
        target.stroke({ color: stroke, width: style.strokeWidth, alpha: alpha * strokePaint.alpha });
      }
      // Inner lines (venn lens, target rings, note fold) ride the same stroke.
      if (detailLevel !== 'overview' && style.strokeWidth > 0) {
        for (const decoration of basicNodeDecorations(renderedShape, node.size)) {
          // Open polylines, like the SVG export: a closed shape repeats its first point.
          const points = decoration.map((point) => applyMatrixToPoint(matrix, point));
          target.poly(points.flatMap((point) => [point.x, point.y]), false);
          target.stroke({ color: stroke, width: style.strokeWidth, alpha: alpha * strokePaint.alpha });
        }
      }
      debugRecords.push({
        id: node.id,
        kind: visual?.kind ?? node.kind,
        shape,
        fill,
        stroke,
        textColor,
        mediaState: 'none',
      });
      if (detailLevel === 'overview') continue;
      const labelText = typeof node.content.label === 'string' ? node.content.label : node.id;
      const sizing = resolveLabelSizing(node, style);
      const baseLayout = resolveNodeContentLayout(node.content);
      // Style keys win over the stored content layout: one place to set alignment.
      const pad = style.textPadding;
      const layout = {
        ...baseLayout,
        horizontal: style.textAlign,
        vertical: style.textVerticalAlign === 'top' ? 'start' as const
          : style.textVerticalAlign === 'bottom' ? 'end' as const : 'center' as const,
        labelAlignment: style.textAlign,
        padding: { top: pad, right: pad, bottom: pad, left: pad },
      };
      // A move (Map mode) wraps each label to the width its box ends with, so the text pool keeps hitting while the box resizes.
      const availableTextWidth = Math.max(1, (textWidths?.get(node.id) ?? node.size.width) - pad * 2);
      const wrap = sizing.overflow === 'visible' ? null : availableTextWidth;
      const labelMeasurement = measurePortableText(labelText, {
        fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.fontSize * style.lineHeight,
        ...(wrap === null ? {} : { maxWidth: wrap, maxLines: sizing.maxLines, overflow: sizing.overflow }),
      });
      const label = markTitle(this.texts.styled(labelMeasurement.displayText, style, textColor, wrap));
      const subStyle = subLabelStyle(style);
      const subLabel =
        typeof node.content.subLabel === 'string' && node.content.subLabel.length > 0
          ? this.texts.styled(
              measurePortableText(node.content.subLabel, {
                ...SUBLABEL_FONT,
                ...(wrap === null ? {} : { maxWidth: wrap, maxLines: sizing.maxLines, overflow: sizing.overflow }),
              }).displayText,
              subStyle, style.subTextColor ? pixiPaintColor(style.subTextColor, 0).color : visual?.subText ?? 0x64748b, wrap
            )
          : null;
      const hasIcon =
        (typeof node.content.icon === 'string' && node.content.icon !== 'none') ||
        typeof node.content.archIconShapeId === 'string';
      const geometry = layoutNodeContent(
        layout,
        {
          nodeSize: node.size,
          iconSize: hasIcon ? { width: 28, height: 28 } : null,
          labelSize: labelMeasurement,
          subLabelSize: subLabel ? measurePortableText(subLabel.text, {
            ...SUBLABEL_FONT,
          }) : null,
        }
      );
      if (geometry.iconBounds) {
        const iconCorners = [
          { x: geometry.iconBounds.x, y: geometry.iconBounds.y },
          { x: geometry.iconBounds.x + geometry.iconBounds.width, y: geometry.iconBounds.y },
          {
            x: geometry.iconBounds.x + geometry.iconBounds.width,
            y: geometry.iconBounds.y + geometry.iconBounds.height,
          },
          { x: geometry.iconBounds.x, y: geometry.iconBounds.y + geometry.iconBounds.height },
        ].map((point) => applyMatrixToPoint(matrix, point));
        target
          .poly(iconCorners.flatMap((point) => [point.x, point.y]))
          .fill({ color: visual?.iconFill ?? ICON_FILL })
          .stroke({ color: visual?.iconStroke ?? ICON_STROKE, width: 1 });
      }
      const labelPoint = applyMatrixToPoint(matrix, {
        x: textPosition(geometry.labelBounds, geometry.labelAlignment),
        y: geometry.labelBounds.y,
      });
      label.anchor.set(textAnchor(geometry.labelAlignment), 0);
      label.position.set(labelPoint.x, labelPoint.y);
      const content = new Container();
      content.alpha = alpha;
      content.addChild(label);
      decoratePixiText(content, label, style, textColor);
      if (subLabel && geometry.subLabelBounds) {
        const subLabelPoint = applyMatrixToPoint(matrix, {
          x: textPosition(geometry.subLabelBounds, geometry.labelAlignment),
          y: geometry.subLabelBounds.y,
        });
        subLabel.anchor.set(textAnchor(geometry.labelAlignment), 0);
        subLabel.position.set(subLabelPoint.x, subLabelPoint.y);
        content.addChild(subLabel);
      }
      if (sizing.clipContent) {
        const corners = [
          { x: geometry.contentBounds.x, y: geometry.contentBounds.y },
          { x: geometry.contentBounds.x + geometry.contentBounds.width, y: geometry.contentBounds.y },
          { x: geometry.contentBounds.x + geometry.contentBounds.width,
            y: geometry.contentBounds.y + geometry.contentBounds.height },
          { x: geometry.contentBounds.x, y: geometry.contentBounds.y + geometry.contentBounds.height },
        ].map((point) => applyMatrixToPoint(matrix, point));
        const mask = new Graphics().poly(corners.flatMap((point) => [point.x, point.y])).fill(0xffffff);
        content.addChild(mask);
        content.mask = mask;
      }
      paint.labels.addChild(content);
      if (box && (labelMeasurement.displayText.length > 0 || subLabel)) {
        const sub = subLabel && geometry.subLabelBounds
          ? textBox(matrix, geometry.subLabelBounds, geometry.labelAlignment, geometry.subLabelBounds) : null;
        const text = unionBounds(box, textBox(matrix, geometry.labelBounds, geometry.labelAlignment, labelMeasurement));
        painted.add(sub ? unionBounds(text, sub) : text);
      }
      this.labelByNodeId.set(node.id, content);
      this.trackTitle(node.id, content);
    }
    this.texts.flush();
    this.debugRecords = debugRecords;
  }

  getDebugSnapshot(): readonly PixiNodeDebugRecord[] {
    return this.debugRecords;
  }

  /** Records a label's title font and its other Texts, once per draw, so a zoom tick only compares numbers. */
  private trackTitle(nodeId: string, label: Container): void {
    let titleFont = 0;
    const secondary: { view: Container; font: number }[] = [];
    const visit = (node: Container): void => {
      if (node instanceof Text) {
        if (isTitle(node)) titleFont = Math.max(titleFont, Number(node.style.fontSize));
        else secondary.push({ view: node, font: Number(node.style.fontSize) });
        return;
      }
      const strip = stripFont(node);
      if (strip !== null) {
        secondary.push({ view: node, font: strip });
        return;
      }
      for (const child of node.children) visit(child as Container);
    };
    visit(label);
    if (titleFont === 0) return;
    this.labelFontByNodeId.set(nodeId, titleFont);
    this.secondaryByNodeId.set(nodeId, secondary);
  }

  setLabelVisibility(visibleNodeIds: ReadonlySet<string> | null, zoom: number): void {
    this.ownLabels.visible = visibleNodeIds !== null;
    for (const layer of this.overlapLayers) layer.labels.visible = visibleNodeIds !== null;
    if (!visibleNodeIds) return;
    for (const [nodeId, label] of this.labelByNodeId) {
      const secondary = this.secondaryByNodeId.get(nodeId);
      // A titled node reads down to the title floor; the rest of its text (tech, description) keeps the body floor.
      label.visible = visibleNodeIds.has(nodeId) && nodeId !== this.editingNodeId
        && labelReadable(zoom, this.labelFontByNodeId.get(nodeId) ?? FAMILY_LABEL_FONT, secondary ? MIN_TITLE_SCREEN_PX : undefined)
        && !this.freeformRenderer.isMediaLoaded(nodeId);
      if (secondary && label.visible) for (const { view, font } of secondary) view.visible = labelReadable(zoom, font);
    }
  }

  private openOverlapLayer(): PaintLayer {
    const layer = { root: new Container(), graphics: new Graphics(), media: new Container(), labels: new Container() };
    layer.media.sortableChildren = true;
    layer.labels.visible = this.ownLabels.visible;
    layer.root.addChild(layer.graphics, layer.media, layer.labels);
    this.labels.addChild(layer.root);
    this.overlapLayers.push(layer);
    return layer;
  }

  /** The DOM editor replaces this node's label while it is open. */
  setEditingNode(nodeId: string | null): void {
    const previous = this.editingNodeId;
    this.editingNodeId = nodeId;
    if (previous) { const label = this.labelByNodeId.get(previous); if (label) label.visible = true; }
    if (nodeId) { const label = this.labelByNodeId.get(nodeId); if (label) label.visible = false; }
  }
}
