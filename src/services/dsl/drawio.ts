import { DEFAULT_SCENE_LAYER_ID, UNTITLED_DOCUMENT_NAME } from '../../opencanvas/domain/document/defaults';
import type { JsonObject } from '../../opencanvas/domain/document/json';
import {
  SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION,
  type ConnectorEndpoint, type ConnectorLabel, type SceneConnector, type SceneDocumentV1, type SceneLayer, type SceneNode, type ScenePage,
} from '../../opencanvas/domain/document/types';
import type { Point2d } from '../../opencanvas/domain/geometry/types';
import { createImageNode } from '../../opencanvas/domain/nodes/imageNode';
import { createShapeNode } from '../../opencanvas/domain/nodes/shapeNode';
import { measurePortableText } from '../../opencanvas/domain/text/measurement';
import { CONTAINER_TITLE_HEIGHT } from '../../opencanvas/domain/nodes/nodeLabelBounds';
import { DEFAULT_NODE_SIZING_POLICY } from '../../opencanvas/domain/node-sizing/model';
import { validateSceneDocumentV1 } from '../../opencanvas/domain/document/validation';
import {
  drawioColor, drawioConnectorAppearance, own, drawioErRelation, drawioImageUrl, drawioLabel, drawioNodeAppearance, drawioShape, drawioShapeName, type DrawioStyle,
} from './drawioStyle';
import { num, pageCells, pageModel, type Cell, type Geometry } from './drawioCells';
import { parseXml } from './xmlReader';

// A draw.io file (`.drawio`, or its `.xml` export) as an OpenFlowKit document.
// draw.io keeps exact positions, so this builds the scene directly instead of
// going through DSL and the layout. Each page of the file is a page here.
// What has no counterpart is listed in `losses`, never silently dropped.

export type DrawioImport =
  | { readonly document: SceneDocumentV1; readonly losses: readonly string[] }
  | { readonly error: string };

/** True when `text` is a draw.io file: an `<mxfile>` or a bare `<mxGraphModel>`. */
export function looksLikeDrawio(text: string): boolean {
  return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:mxfile|mxGraphModel)\b/.test(text);
}

/** The top-left corner that, turned by `radians` about it, puts the box's centre where draw.io had it. */
function turnedCorner(x: number, y: number, width: number, height: number, radians: number): Point2d {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const half = { x: width / 2, y: height / 2 };
  return { x: x + half.x - (half.x * cos - half.y * sin), y: y + half.y - (half.x * sin + half.y * cos) };
}

const { minSize, maxSize } = DEFAULT_NODE_SIZING_POLICY;
/** The app's default sizing policy, spelt out as JSON: a fixed box whose label is not wrapped. */
const SPILL: JsonObject = { ...DEFAULT_NODE_SIZING_POLICY, minSize: { ...minSize }, maxSize: { ...maxSize } };

interface Outside {
  readonly side: 'left' | 'right' | 'top' | 'bottom';
  /** The style key draw.io widens that gap with. */
  readonly spacing: string;
  /** How the words sit against the shape: away from it, centred along it. */
  readonly style: DrawioStyle;
}

/** draw.io's `labelPosition` (beside) and `verticalLabelPosition` (above, below; `v-` here) as where our text goes. */
const OUTSIDE: Readonly<Record<string, Outside>> = {
  right: { side: 'right', spacing: 'spacingLeft', style: { align: 'left', verticalAlign: 'middle' } },
  left: { side: 'left', spacing: 'spacingRight', style: { align: 'right', verticalAlign: 'middle' } },
  'v-bottom': { side: 'bottom', spacing: 'spacingTop', style: { align: 'center', verticalAlign: 'top' } },
  'v-top': { side: 'top', spacing: 'spacingBottom', style: { align: 'center', verticalAlign: 'bottom' } },
};

/** Degrees our north-pointing triangle turns to point where draw.io's `direction` says. */
const TRIANGLE_TURN: Readonly<Record<string, number>> = { north: 0, east: 90, south: 180, west: 270 };

const CONTAINER_KIND: Readonly<Record<string, string>> = { swimlane: 'swimlane', group: 'group', table: 'section' };

class PageBuilder {
  readonly cells = new Map<string, Cell>();
  readonly layers: SceneLayer[] = [];
  readonly nodes: SceneNode[] = [];
  readonly connectors: SceneConnector[] = [];
  private readonly nodeIds = new Set<string>();
  /** draw.io shape name → how many cells of it became a box, said once per name. */
  private readonly unknownShapes = new Map<string, number>();
  private rerouted = 0;
  /** Pictures from draw.io's own image library: only its servers have them. */
  private libraryImages = 0;

  constructor(cells: readonly Cell[], private readonly loss: (message: string) => void) {
    for (const cell of cells) {
      if (this.cells.has(cell.id)) { loss(`two cells share the id “${cell.id}”, so the later one was left out`); continue; }
      this.cells.set(cell.id, cell);
    }
  }

  build(): void {
    const root = [...this.cells.values()].find((cell) => cell.parent === null) ?? [...this.cells.values()].find((cell) => !this.cells.has(cell.parent ?? ''));
    // Only cells whose parent chain ends at the page's root are drawn; a loop or a missing parent never reaches it.
    const reachesRoot = (cell: Cell): boolean => {
      const seen = new Set<string>();
      for (let at: Cell | undefined = cell; at && !seen.has(at.id); ) {
        seen.add(at.id);
        if (at.parent === root?.id) return true;
        at = at.parent ? this.cells.get(at.parent) : undefined;
      }
      return false;
    };
    const stranded = [...this.cells.values()].filter((cell) => cell !== root && !reachesRoot(cell)).length;
    if (stranded) {
      this.loss(stranded === 1
        ? '1 shape or connector sits in a parent loop or under a missing parent, so it was left out'
        : `${stranded} shapes or connectors sit in a parent loop or under a missing parent, so they were left out`);
    }
    const layerCells = [...this.cells.values()].filter((cell) => cell !== root && cell.parent === root?.id && !cell.vertex && !cell.edge);
    // The first layer is the app's default one, so Diagram as code, AI and pastes land on a layer this page has.
    const layerIdOf = (index: number, cell: Cell) => (index === 0 ? DEFAULT_SCENE_LAYER_ID : `layer:${cell.id}`);
    for (const [index, cell] of layerCells.entries()) {
      this.layers.push({
        id: layerIdOf(index, cell), name: cell.value.trim() || (index === 0 ? 'Default' : `Layer ${index + 1}`),
        visible: cell.visible, locked: cell.style.locked === '1',
      });
    }
    if (!this.layers.length) this.layers.push({ id: DEFAULT_SCENE_LAYER_ID, name: 'Default', visible: true, locked: false });
    for (const [index, layer] of layerCells.entries()) this.addChildren(layer.id, null, layerIdOf(index, layer));
    for (const cell of this.cells.values()) if (cell.edge && reachesRoot(cell)) this.addConnector(cell);
    if (this.rerouted) this.loss(this.rerouted === 1 ? '1 right-angle connector is re-routed, so its bends may move' : `${this.rerouted} right-angle connectors are re-routed, so their bends may move`);
    if (this.libraryImages) {
      this.loss(`${this.libraryImages === 1 ? '1 picture comes' : `${this.libraryImages} pictures come`} from draw.io’s own image library, so ${this.libraryImages === 1 ? 'it is' : 'they are'} drawn as a box`);
    }
    for (const [name, count] of this.unknownShapes) {
      this.loss(`draw.io’s “${name}” shape is drawn as a box${count > 1 ? ` (${count} shapes)` : ''}`);
    }
  }

  private childrenOf(id: string): Cell[] {
    return [...this.cells.values()].filter((cell) => cell.parent === id);
  }

  private addChildren(parentCellId: string, parentNodeId: string | null, layerId: string): void {
    for (const cell of this.childrenOf(parentCellId)) {
      if (cell.vertex) this.addNode(cell, parentNodeId, layerId);
    }
  }

  /**
   * A cell's label as draw.io shows it: with `placeholders=1`, `%name%` is the `name` the cell's own data holds,
   * else its nearest container's (a kanban card's `%status%` is its column's `status`); one nobody holds stays.
   */
  private valueOf(cell: Cell): string {
    if (!cell.placeholders) return cell.value;
    return cell.value.replace(/%([A-Za-z_][\w.-]*)%/g, (written, name: string) => {
      const seen = new Set<string>();
      for (let at: Cell | undefined = cell; at && !seen.has(at.id); at = at.parent ? this.cells.get(at.parent) : undefined) {
        seen.add(at.id);
        if (name !== 'label' && name !== 'placeholders' && at.data[name] !== undefined) return at.data[name]!;
      }
      return written;
    });
  }

  /** `fillColor=swimlane` is draw.io for "my lane's colour": the nearest container's fill that names one. */
  private inherited(cell: Cell): DrawioStyle {
    if (cell.style.fillColor !== 'swimlane') return cell.style;
    const seen = new Set<string>([cell.id]);
    for (let at = cell.parent ? this.cells.get(cell.parent) : undefined; at && !seen.has(at.id); at = at.parent ? this.cells.get(at.parent) : undefined) {
      seen.add(at.id);
      const fill = at.style.fillColor;
      if (fill && fill !== 'swimlane') return { ...cell.style, fillColor: fill };
    }
    const { fillColor: _swimlane, ...rest } = cell.style;
    return rest;
  }

  private labelOf(cell: Cell): string {
    return drawioLabel(this.valueOf(cell), cell.style) || cell.id;
  }

  private addNode(cell: Cell, parentId: string | null, layerId: string): void {
    const geometry = cell.geometry;
    if (!geometry) { this.loss(`“${this.labelOf(cell)}”: a shape without a position was left out`); return; }
    const style = this.inherited(cell);
    const name = drawioShapeName(style);
    const label = drawioLabel(this.valueOf(cell), style);
    const { x, y } = this.placed(cell, geometry);
    let width = Math.max(1, geometry.width || 120);
    let height = Math.max(1, geometry.height || 60);
    const hasChildren = this.childrenOf(cell.id).some((child) => child.vertex);
    const page: ScenePage = { id: '', name: '', diagramKind: 'flowchart', layers: this.layers, nodes: this.nodes, connectors: [], metadata: {}, extensions: {} };
    const base = { parentId, layerId, zIndex: this.nodes.length };
    // draw.io turns a shape about its centre; ours turn about the top-left corner, so the corner moves.
    // draw.io's triangle points east unless `direction` says otherwise; ours points north. Turning it east or
    // west turns its box too, so the box is drawn upright with the sides swapped.
    const turn = name === 'triangle' ? own(TRIANGLE_TURN, style.direction ?? 'east') ?? 90 : 0;
    if (turn % 180 !== 0) [width, height] = [height, width];
    const at = turn % 180 !== 0 ? { x: x + (height - width) / 2, y: y + (width - height) / 2 } : { x, y };
    const rotation = ((num(style.rotation) + turn) * Math.PI) / 180;
    const translation = rotation ? turnedCorner(at.x, at.y, width, height, rotation) : at;
    const transform = { translation, rotationRadians: rotation, scale: { x: 1, y: 1 } };
    const imageUrl = drawioImageUrl(style);
    if ((name === 'image' || style.image) && !imageUrl) this.libraryImages += 1;
    if (own(CONTAINER_KIND, name) || style.container === '1' || hasChildren) {
      // Our container draws a 40px title band over its top. A draw.io lane's own band (`startSize`, 23 unless
      // set) is often thinner — an entity table's 22px header over its first row, a kanban column's hairline —
      // so then ours is hidden and the title set in draw.io's band, or just above the lane when it is a hairline.
      const band = num(style.startSize, 23);
      const thin = name === 'swimlane' && band < CONTAINER_TITLE_HEIGHT;
      this.nodes.push({
        id: cell.id, kind: own(CONTAINER_KIND, name) ?? 'section', ...base,
        transform,
        size: { width, height },
        content: { label, ...(thin || !label ? { showHeader: false } : {}) },
        appearance: drawioNodeAppearance(style),
        ports: [], metadata: {}, extensions: {},
      });
      if (thin && label) {
        const title = band < 12
          ? { geometry: { ...geometry, x, y: y - num(style.spacing, 2) - 1, width, height: 1, relative: false }, verticalAlign: 'bottom' }
          : { geometry: { ...geometry, x, y, width, height: band, relative: false }, verticalAlign: 'middle' };
        this.addText({ ...cell, id: `${cell.id}:label`, geometry: title.geometry, style: { ...style, verticalAlign: title.verticalAlign, whiteSpace: '' } }, label, { ...base, zIndex: this.nodes.length }, 0);
      }
    } else {
      const shape = drawioShape(style, width, height);
      if (shape.unknown && name !== 'image' && !imageUrl) this.unknownShapes.set(shape.unknown, (this.unknownShapes.get(shape.unknown) ?? 0) + 1);
      if (shape.kind === 'text' && !imageUrl) {
        // draw.io's `text` style sets its words top-left unless the cell says otherwise.
        this.addText({ ...cell, style: { align: 'left', verticalAlign: 'top', ...style } }, label, base, rotation);
        return;
      }
      // A label set outside its shape (a checkbox's beside it, an icon's below) becomes its own text there;
      // a picture's always does, since our image node draws no label.
      const outside = own(OUTSIDE, style.labelPosition ?? '') ?? own(OUTSIDE, `v-${style.verticalLabelPosition ?? ''}`)
        ?? (imageUrl && label ? OUTSIDE['v-bottom']! : null);
      if (imageUrl) {
        this.nodes.push({ ...createImageNode(page, { id: cell.id, at, size: { width, height }, label: label || 'Image', url: imageUrl }), ...base, transform });
      } else {
        const node = createShapeNode(page, { kind: shape.kind, id: cell.id, at, size: { width, height }, label: outside ? '' : label, appearance: drawioNodeAppearance(style) });
        // Without `whiteSpace=wrap` draw.io lets a label run past its box; the fixed policy draws it the same way.
        const content = style.whiteSpace === 'wrap' ? node.content : { ...node.content, sizingPolicy: SPILL };
        this.nodes.push({ ...node, ...base, transform, content });
      }
      if (outside && label) {
        const gap = num(style.spacing, 2) + num(style[outside.spacing]);
        const box = { ...geometry, x, y, width, height, relative: false };
        const anchor = {
          right: { ...box, x: x + width + gap, width: 1 },
          left: { ...box, x: x - gap - 1, width: 1 },
          bottom: { ...box, y: y + height + gap, height: 1 },
          top: { ...box, y: y - gap - 1, height: 1 },
        }[outside.side];
        this.addText({ ...cell, id: `${cell.id}:label`, geometry: anchor, style: { ...style, ...outside.style, whiteSpace: '' } }, label, { ...base, zIndex: this.nodes.length }, 0);
      }
    }
    this.nodeIds.add(cell.id);
    this.addChildren(cell.id, cell.id, layerId);
  }

  /**
   * A text cell. Ours carry font and colour in `content`, and wrap inside their box. draw.io text cells are
   * often drawn tiny ("Desired functionality" in 30×20) with the words spilling out, so the box grows to the
   * measured words around draw.io's anchor: centred unless aligned left/right or top/bottom.
   */
  private addText(cell: Cell, label: string, base: Pick<SceneNode, 'parentId' | 'layerId' | 'zIndex'>, rotation: number): void {
    const { style, geometry } = cell;
    const fontSize = num(style.fontSize, 12);
    const fontWeight = (num(style.fontStyle) & 1) ? 700 : 500;
    const measure = (text: string) => measurePortableText(text, { fontSize, fontWeight, overflow: 'visible' });
    const measured = measure(label);
    const box = { ...geometry!, ...this.placed(cell, geometry!) };
    // Wrapped text still never splits a word in draw.io: the box is at least its longest word wide.
    const widest = style.whiteSpace === 'wrap' ? Math.max(...label.split(/\s+/).map((word) => measure(word).width)) : measured.width;
    // A text node wraps 8px inside each side. ponytail: the portable measure runs a few percent under the
    // canvas font, hence the 5% — measure with the canvas font if labels still break.
    const fit = (measuredWidth: number) => Math.ceil(measuredWidth * 1.05) + 20;
    // Our text node centres its words, so text set against a side hugs them instead of filling draw.io's box;
    // wrapped text that won't fit one line keeps the box's width.
    const side = style.align === 'left' || style.align === 'right';
    const width = Math.max(1, side
      ? (style.whiteSpace === 'wrap' ? Math.max(fit(widest), Math.min(box.width, fit(measured.width))) : fit(measured.width))
      : Math.max(box.width, fit(widest)));
    const hug = style.verticalAlign === 'top' || style.verticalAlign === 'bottom';
    const height = hug ? Math.ceil(measured.height) + 4 : Math.max(box.height, Math.ceil(measured.height) + 4);
    const x = style.align === 'left' ? box.x : style.align === 'right' ? box.x + box.width - width : box.x + (box.width - width) / 2;
    const y = style.verticalAlign === 'top' ? box.y : style.verticalAlign === 'bottom' ? box.y + box.height - height : box.y + (box.height - height) / 2;
    const color = drawioColor(style.fontColor);
    this.nodes.push({
      id: cell.id, kind: 'text', ...base,
      transform: { translation: rotation ? turnedCorner(x, y, width, height, rotation) : { x, y }, rotationRadians: rotation, scale: { x: 1, y: 1 } },
      size: { width, height },
      content: {
        label, fontSize, fontWeight: String(fontWeight),
        ...(num(style.fontStyle) & 2 ? { fontStyle: 'italic' } : {}),
        ...(color && color !== 'transparent' ? { customColor: color } : {}),
      },
      appearance: {}, ports: [], metadata: {}, extensions: {},
    });
    this.nodeIds.add(cell.id);
  }

  /** A vertex's top-left in its parent's space: relative ones are fractions of the parent's size plus an offset. */
  private placed(cell: Cell, geometry: Geometry): Point2d {
    if (!geometry.relative) return { x: geometry.x, y: geometry.y };
    const parent = cell.parent ? this.cells.get(cell.parent)?.geometry : undefined;
    return {
      x: geometry.x * (parent?.width ?? 0) + geometry.offset.x,
      y: geometry.y * (parent?.height ?? 0) + geometry.offset.y,
    };
  }

  /** Where a cell's own coordinates start on the page: the sum of its container vertices' positions. */
  private originOf(cellId: string | null): Point2d {
    let x = 0;
    let y = 0;
    let id = cellId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const cell = this.cells.get(id);
      if (!cell?.vertex || !cell.geometry) break;
      const at = this.placed(cell, cell.geometry);
      x += at.x;
      y += at.y;
      id = cell.parent;
    }
    return { x, y };
  }

  private addConnector(cell: Cell): void {
    const number = this.connectors.length + 1;
    const origin = this.originOf(cell.parent);
    const toPage = (point: Point2d): Point2d => ({ x: point.x + origin.x, y: point.y + origin.y });
    const endpoint = (nodeId: string | null, point: Point2d | null | undefined): ConnectorEndpoint | null => {
      if (nodeId && this.nodeIds.has(nodeId)) return { nodeId, portId: null, anchor: null, point: null };
      return point ? { nodeId: null, portId: null, anchor: null, point: toPage(point) } : null;
    };
    const source = endpoint(cell.source, cell.geometry?.sourcePoint);
    const target = endpoint(cell.target, cell.geometry?.targetPoint);
    const label = drawioLabel(this.valueOf(cell), cell.style);
    if (!source || !target) {
      this.loss(`${label ? `connector “${label}”` : `connector ${number}`}: it has a loose end, so it was left out`);
      return;
    }
    const style = cell.style;
    const orthogonal = /orthogonal|elbow|isometric|entityRelation/i.test(style.edgeStyle ?? '');
    const points = (cell.geometry?.points ?? []).map(toPage);
    if (orthogonal && points.length) this.rerouted += 1;
    const waypoints = orthogonal ? [] : points;
    const labels: ConnectorLabel[] = label ? [{ id: `${cell.id}:label`, text: label, pathRatio: 0.5, offset: { x: 0, y: 0 }, metadata: {} }] : [];
    // A label dragged along an edge is its own vertex, parented to the edge; x runs -1 (source) to 1 (target).
    for (const child of this.childrenOf(cell.id)) {
      const text = drawioLabel(this.valueOf(child), child.style);
      if (!child.vertex || !text) continue;
      const ratio = Math.min(1, Math.max(0, ((child.geometry?.x ?? 0) + 1) / 2));
      labels.push({ id: `${child.id}:label`, text, pathRatio: ratio, offset: { x: 0, y: 0 }, metadata: {} });
    }
    this.connectors.push({
      id: cell.id, source, target,
      route: {
        kind: orthogonal ? 'orthogonal' : style.curved === '1' ? 'bezier' : waypoints.length ? 'polyline' : 'direct',
        ownership: waypoints.length ? 'imported-fixed' : 'automatic',
      },
      waypoints, labels,
      appearance: drawioConnectorAppearance(style),
      semantics: drawioErRelation(style) ? { erRelation: drawioErRelation(style)! } : {}, metadata: {}, extensions: {},
    });
  }
}

function summarize(losses: readonly string[]): string[] {
  return [...new Set(losses)];
}

/** Every page of a draw.io file as one OpenFlowKit document under `id`. */
export async function drawioToDocument(text: string, id: string, now = new Date().toISOString()): Promise<DrawioImport> {
  const parsed = parseXml(text);
  if ('error' in parsed) return { error: `It isn’t a readable draw.io file (${parsed.error}).` };
  const { root } = parsed;
  const diagrams = root.name === 'mxfile' ? root.children.filter((child) => child.name === 'diagram') : root.name === 'mxGraphModel' ? [root] : [];
  if (!diagrams.length) return { error: 'It has no draw.io pages in it.' };
  const losses: string[] = [];
  const pages: ScenePage[] = [];
  for (const [index, diagram] of diagrams.entries()) {
    const model = diagram.name === 'mxGraphModel' ? diagram : await pageModel(diagram);
    const pageName = diagram.attributes.name?.trim() || `Page ${index + 1}`;
    if ('error' in model) { losses.push(`“${pageName}”: ${model.error}, so it was left out`); continue; }
    const builder = new PageBuilder(pageCells(model), (message) => losses.push(diagrams.length > 1 ? `${pageName}: ${message}` : message));
    builder.build();
    pages.push({
      id: `${id}:page-${index + 1}`, name: pageName, diagramKind: 'flowchart',
      layers: builder.layers, nodes: builder.nodes, connectors: builder.connectors, metadata: {}, extensions: {},
    });
  }
  if (!pages.length) return { error: `None of its pages could be read: ${losses.join('; ')}` };
  if (pages.every((page) => page.nodes.length === 0 && page.connectors.length === 0)) return { error: 'It has no shapes or connectors in it.' };
  const metadata: JsonObject = { importedFrom: 'drawio' };
  const document: SceneDocumentV1 = {
    format: SCENE_DOCUMENT_FORMAT, schemaVersion: SCENE_DOCUMENT_VERSION, id, name: UNTITLED_DOCUMENT_NAME,
    createdAt: now, updatedAt: now, pages, metadata, extensions: {},
  };
  const validated = validateSceneDocumentV1(document);
  if (validated.success !== true) return { error: `It couldn’t be turned into a diagram: ${validated.issues[0]?.message ?? 'unknown issue'}` };
  return { document: validated.document, losses: summarize(losses) };
}
