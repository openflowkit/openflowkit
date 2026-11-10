import { DEFAULT_SCENE_LAYER_ID, UNTITLED_DOCUMENT_NAME } from '../../opencanvas/domain/document/defaults';
import type { JsonObject } from '../../opencanvas/domain/document/json';
import {
  SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION,
  type ConnectorEndpoint, type ConnectorLabel, type SceneConnector, type SceneDocumentV1, type SceneLayer, type SceneNode, type ScenePage,
} from '../../opencanvas/domain/document/types';
import type { Point2d } from '../../opencanvas/domain/geometry/types';
import { createImageNode } from '../../opencanvas/domain/nodes/imageNode';
import { createShapeNode } from '../../opencanvas/domain/nodes/shapeNode';
import { CONTAINER_TITLE_HEIGHT } from '../../opencanvas/domain/nodes/nodeLabelBounds';
import { validateSceneDocumentV1 } from '../../opencanvas/domain/document/validation';
import {
  drawioAnchor, drawioConnectorAppearance, drawioLayoutBox, type Box, drawioStyleLosses, own, drawioErRelation, drawioImageUrl, drawioLabel, drawioNodeAppearance, drawioShape, drawioShapeName, drawioStandIn, type DrawioStyle,
} from './drawioStyle';
import { num, pageCells, pageModel, type Cell, type Geometry } from './drawioCells';
import { inkForEitherTheme } from './drawioInk';
import { drawioFreehands, freehandContent } from './drawioStencil';
import { richText, standInLosses } from './drawioLosses';
import { besideLine } from './drawioEdgeLabel';
import { drawioLabelBox, drawioLabelFit, type DrawioLabelBox } from './drawioLabelBox';
import { labelLayout, labelNode } from './drawioLabelNode';
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

/** Degrees our north-pointing triangle turns to point where draw.io's `direction` says. */
const TRIANGLE_TURN: Readonly<Record<string, number>> = { north: 0, east: 90, south: 180, west: 270 };

const CONTAINER_KIND: Readonly<Record<string, string>> = { swimlane: 'swimlane', group: 'group', table: 'section' };

class PageBuilder {
  readonly cells = new Map<string, Cell>();
  /** Parent id → its cells in file order, built once so nothing rescans the page. */
  private readonly children = new Map<string, Cell[]>();
  readonly layers: SceneLayer[] = [];
  readonly nodes: SceneNode[] = [];
  readonly connectors: SceneConnector[] = [];
  private readonly nodeIds = new Set<string>();
  /** draw.io shape name → how many cells of it became a box, said once per name. */
  private readonly unknownShapes = new Map<string, number>();
  /** A style we don't draw → how many shapes and connectors asked for it, said once per style. */
  private readonly styleLosses = new Map<string, number>();
  private rerouted = 0;
  /** Cells draw.io hides (`visible="0"`), with everything inside them and every line to them. */
  private readonly hidden = new Set<string>();
  private readonly autoBoxes = new Map<string, Box | null>();
  /** Pictures from draw.io's own image library: only its servers have them. */
  private libraryImages = 0;

  /** `freehand`: each freehand line's points as fractions of its cell's box (`drawioFreehands`). */
  constructor(cells: readonly Cell[], private readonly loss: (message: string) => void, private readonly freehand: ReadonlyMap<string, readonly (readonly Point2d[])[]> = new Map()) {
    for (const cell of cells) {
      if (this.cells.has(cell.id)) { loss(`two cells share the id “${cell.id}”, so the later one was left out`); continue; }
      this.cells.set(cell.id, cell);
      if (cell.parent !== null) {
        const siblings = this.children.get(cell.parent);
        if (siblings) siblings.push(cell);
        else this.children.set(cell.parent, [cell]);
      }
    }
  }

  build(): void {
    const root = [...this.cells.values()].find((cell) => cell.parent === null) ?? [...this.cells.values()].find((cell) => !this.cells.has(cell.parent ?? ''));
    // Only cells whose parent chain ends at the page's root are drawn; a loop or a missing parent never reaches it.
    // One walk down from the root finds them all, with a list for a stack so deep nesting can't overflow.
    const attached = new Set<string>();
    for (const queue = root ? [root.id] : []; queue.length; ) {
      for (const child of this.childrenOf(queue.pop()!)) if (!attached.has(child.id)) { attached.add(child.id); queue.push(child.id); }
    }
    const stranded = this.cells.size - (root ? 1 : 0) - attached.size;
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
    for (const [index, layer] of layerCells.entries()) this.addTree(layer.id, layerIdOf(index, layer));
    for (const cell of this.cells.values()) {
      if (!cell.edge || !attached.has(cell.id) || this.hidden.has(cell.id)) continue;
      if (!cell.visible || this.hidden.has(cell.source ?? '') || this.hidden.has(cell.target ?? '')) this.hidden.add(cell.id);
      else this.addConnector(cell);
    }
    if (this.hidden.size) this.loss(this.hidden.size === 1 ? '1 shape or connector hidden in draw.io was left out' : `${this.hidden.size} shapes or connectors hidden in draw.io were left out`);
    if (this.rerouted) this.loss(this.rerouted === 1 ? '1 right-angle connector is re-routed, so its bends may move' : `${this.rerouted} right-angle connectors are re-routed, so their bends may move`);
    if (this.libraryImages) {
      this.loss(`${this.libraryImages === 1 ? '1 picture comes' : `${this.libraryImages} pictures come`} from draw.io’s own image library, so ${this.libraryImages === 1 ? 'it is' : 'they are'} drawn as a box`);
    }
    for (const message of standInLosses(this.unknownShapes)) this.loss(message);
    for (const [message, count] of this.styleLosses) this.loss(count > 1 ? `${message} (${count} places)` : message);
    inkForEitherTheme(this.nodes, this.loss);
  }

  private noteStyle(style: DrawioStyle, of: 'shape' | 'connector', value: string): void {
    const rich = style.html === '1' && richText(value) ? ['bold, colour and size set on words inside a label are drawn plain'] : [];
    for (const message of [...drawioStyleLosses(style, of), ...rich]) this.styleLosses.set(message, (this.styleLosses.get(message) ?? 0) + 1);
  }

  /** A hidden cell and everything inside it. */
  private hide(id: string): void {
    for (const queue = [id]; queue.length; ) {
      const next = queue.pop()!;
      if (this.hidden.has(next)) continue;
      this.hidden.add(next);
      queue.push(...this.childrenOf(next).map((child) => child.id));
    }
  }

  private childrenOf(id: string): readonly Cell[] {
    return this.children.get(id) ?? [];
  }

  /** A layer's shapes, each before its own children (so they draw on top), walked with a list for a stack. */
  private addTree(layerCellId: string, layerId: string): void {
    const pending = (parentCellId: string, parentNodeId: string | null) =>
      this.childrenOf(parentCellId).filter((cell) => cell.vertex).reverse().map((cell) => ({ cell, parentNodeId }));
    for (const stack = pending(layerCellId, null); stack.length; ) {
      const { cell, parentNodeId } = stack.pop()!;
      if (!cell.visible) { this.hide(cell.id); continue; }
      if (this.addNode(cell, parentNodeId, layerId)) stack.push(...pending(cell.id, cell.id));
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

  /** Adds the cell's node; true when its children belong inside it. */
  private addNode(cell: Cell, parentId: string | null, layerId: string): boolean {
    const geometry = cell.geometry;
    if (!geometry) { this.loss(`“${this.labelOf(cell)}”: a shape without a position was left out`); return false; }
    const style = this.inherited(cell);
    const name = drawioShapeName(style);
    this.noteStyle(style, 'shape', cell.value);
    const label = drawioLabel(this.valueOf(cell), style);
    const { x, y } = this.nodeAt(cell, geometry);
    // A folded container opens unfolded, so its children sit inside it rather than spilling out.
    const unfolded = cell.collapsed ? geometry.unfolded : null;
    if (unfolded) this.loss(`${label ? `“${label}”` : 'A container'} was folded in draw.io, so it opens unfolded`);
    const sizedOnOpen = this.autoBox(cell);
    let width = Math.max(1, unfolded?.width ?? sizedOnOpen?.width ?? (geometry.width || 120));
    let height = Math.max(1, unfolded?.height ?? sizedOnOpen?.height ?? (geometry.height || 60));
    const hasChildren = this.childrenOf(cell.id).some((child) => child.vertex);
    // The node factories scan `page.nodes` for the next z-index, which `base` sets anyway: an empty page keeps this one pass.
    const page: ScenePage = { id: '', name: '', diagramKind: 'flowchart', layers: this.layers, nodes: [], connectors: [], metadata: {}, extensions: {} };
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
    const strokes = this.freehand.get(cell.id);
    if (strokes && !hasChildren) {
      // One pen node a stroke: the first keeps the cell's id, so lines drawn to it still land.
      for (const [index, line] of strokes.entries()) {
        this.nodes.push({
          id: index ? `${cell.id}:stroke-${index + 1}` : cell.id, kind: 'pen', ...base, zIndex: this.nodes.length, transform, size: { width, height },
          content: freehandContent(line, style, width, height), appearance: {}, ports: [], metadata: {}, extensions: {},
        });
      }
      this.nodeIds.add(cell.id);
      return false;
    }
    if (own(CONTAINER_KIND, name) || style.container === '1' || hasChildren) {
      // Our container draws a 40px title band over its top. A draw.io lane's own band (`startSize`, 23 unless
      // set) is often thinner — an entity table's 22px header over its first row, a kanban column's hairline —
      // so then ours is hidden and the title set in draw.io's band, or just above the lane when it is a hairline.
      const band = num(style.startSize, 23);
      const sideways = name === 'swimlane' && style.horizontal === '0';
      const thin = name === 'swimlane' && (sideways || band < CONTAINER_TITLE_HEIGHT);
      this.nodes.push({
        id: cell.id, kind: own(CONTAINER_KIND, name) ?? 'section', ...base,
        transform,
        size: { width, height },
        // Ours cycle colours by id when none is set; draw.io's are plain. Its own colours, if any, are the appearance's.
        content: { label, color: 'slate', ...(thin || !label ? { showHeader: false } : {}) },
        appearance: drawioNodeAppearance(style),
        ports: [], metadata: {}, extensions: {},
      });
      if (sideways && label) {
        // A sideways lane's title reads up its left band: an upright box on the band's centre, turned a quarter.
        const centre = { x: x + band / 2, y: y + height / 2 };
        const upright = { x: centre.x - height / 2, y: centre.y - band / 2, width: height, height: band };
        this.nodes.push(labelNode({ id: `${cell.id}:label`, box: { ...upright, align: 'center', verticalAlign: 'middle', wrap: false }, label, paint: textPaint(style), about: upright, radians: -Math.PI / 2, base: { ...base, zIndex: this.nodes.length }, corner: turnedCorner }));
      } else if (thin && label) {
        const title = band < 12
          ? { geometry: { x, y: y - num(style.spacing, 2) - 1, width, height: 1 }, verticalAlign: 'bottom' as const }
          : { geometry: { x, y, width, height: band }, verticalAlign: 'middle' as const };
        const box: DrawioLabelBox = { ...title.geometry, align: style.align === 'left' || style.align === 'right' ? style.align : 'center', verticalAlign: title.verticalAlign, wrap: false };
        this.nodes.push(labelNode({ id: `${cell.id}:label`, box, label, paint: textPaint(style), about: box, radians: 0, base: { ...base, zIndex: this.nodes.length }, corner: turnedCorner }));
      }
    } else {
      const shape = drawioShape(style, width, height);
      if (shape.unknown && name !== 'image' && !imageUrl) {
        // AWS's resource icons are one shape; the icon is named in `resIcon`.
        const unknown = style.resIcon?.startsWith('mxgraph.') ? style.resIcon : shape.unknown;
        this.unknownShapes.set(unknown, (this.unknownShapes.get(unknown) ?? 0) + 1);
      }
      // draw.io lays the words out in its label box, from the cell's own (unturned) box and style alone.
      const drawn = turn % 180 !== 0 ? { x, y, width: height, height: width } : { x, y, width, height };
      const box = drawioLabelBox(drawn, style);
      const fit = drawioLabelFit(drawn, box);
      if (shape.kind === 'text' && !imageUrl) {
        // A text cell is a box with no fill or line round its words: the shape's box if they sit evenly in it.
        this.nodes.push(labelNode({ id: cell.id, box: fit.inside ? { ...box, ...drawn } : box, padding: fit.padding, label, paint: drawioNodeAppearance(style), about: drawn, radians: rotation, base, corner: turnedCorner }));
        this.nodeIds.add(cell.id);
        return false;
      }
      // Words set evenly in the shape are its label; beside, above, below or unevenly in it (and always a
      // picture's, as our image node draws none) they get a box of their own where draw.io puts them.
      const inside = fit.inside && !imageUrl;
      if (imageUrl) {
        this.nodes.push({ ...createImageNode(page, { id: cell.id, at, size: { width, height }, label: label || 'Image', url: imageUrl }), ...base, transform });
      } else {
        const layout = labelLayout(box, fit.padding);
        const appearance = { ...(shape.unknown ? drawioStandIn(style) : drawioNodeAppearance(style)), ...(inside ? layout.appearance : {}) };
        const node = createShapeNode(page, { kind: shape.kind, id: cell.id, at, size: { width, height }, label: inside ? label : '', appearance });
        this.nodes.push({ ...node, ...base, transform, content: { ...node.content, sizingPolicy: layout.sizingPolicy } });
      }
      if (!inside && label) {
        this.nodes.push(labelNode({ id: `${cell.id}:label`, box, label, paint: textPaint(style), about: drawn, radians: rotation, base: { ...base, zIndex: this.nodes.length }, corner: turnedCorner }));
      }
    }
    this.nodeIds.add(cell.id);
    return true;
  }

  /** Where a vertex's node sits in its parent node: draw.io's place, moved where a container is sized on open. */
  private nodeAt(cell: Cell, geometry: Geometry): Point2d {
    const at = this.placed(cell, geometry);
    const own = this.autoBox(cell);
    const up = this.autoBox(cell.parent ? this.cells.get(cell.parent) : undefined);
    if (!own && !up) return at;
    return { x: at.x + (own?.x ?? 0) - (up?.x ?? 0), y: at.y + (own?.y ?? 0) - (up?.y ?? 0) };
  }

  /** A container draw.io sizes on open (`drawioLayoutBox`), in its own coordinates; worked out once each. */
  private autoBox(cell: Cell | undefined): Box | null {
    if (!cell?.vertex || !cell.geometry || cell.geometry.width || cell.geometry.height) return null;
    if (!this.autoBoxes.has(cell.id)) {
      const children = this.childrenOf(cell.id).filter((child) => child.vertex && child.geometry && !child.geometry.relative);
      this.autoBoxes.set(cell.id, drawioLayoutBox(children.map((child) => child.geometry!), cell.style));
    }
    return this.autoBoxes.get(cell.id)!;
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

  /** A connector end on the page: its point, or draw.io's exit/entry fraction of its shape (else the middle). */
  private endAt(end: ConnectorEndpoint, style: DrawioStyle, side: 'exit' | 'entry'): Point2d {
    const [at, size] = [end.nodeId ? this.originOf(end.nodeId) : null, end.nodeId ? this.cells.get(end.nodeId)?.geometry : null];
    if (!at || end.point) return end.point ?? { x: 0, y: 0 };
    return { x: at.x + (size?.width ?? 0) * num(style[`${side}X`], 0.5), y: at.y + (size?.height ?? 0) * num(style[`${side}Y`], 0.5) };
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
    const endpoint = (nodeId: string | null, point: Point2d | null | undefined, end: 'exit' | 'entry'): ConnectorEndpoint | null => {
      if (nodeId && this.nodeIds.has(nodeId)) return { nodeId, portId: null, anchor: drawioAnchor(cell.style, end), point: null };
      return point ? { nodeId: null, portId: null, anchor: null, point: toPage(point) } : null;
    };
    const source = endpoint(cell.source, cell.geometry?.sourcePoint, 'exit');
    const target = endpoint(cell.target, cell.geometry?.targetPoint, 'entry');
    const label = drawioLabel(this.valueOf(cell), cell.style);
    if (!source || !target) {
      this.loss(`${label ? `connector “${label}”` : `connector ${number}`}: it has a loose end, so it was left out`);
      return;
    }
    const style = cell.style;
    this.noteStyle(style, 'connector', cell.value);
    const orthogonal = /orthogonal|elbow|isometric|entityRelation/i.test(style.edgeStyle ?? '');
    const points = (cell.geometry?.points ?? []).map(toPage);
    if (orthogonal && points.length) this.rerouted += 1;
    const waypoints = orthogonal ? [] : points;
    // The line's own label sits at geometry x along it (-1 source, 0 middle, 1 target), nudged by the offset point.
    const along = (x: number): number => Math.min(1, Math.max(0, (x + 1) / 2));
    const line = cell.geometry;
    const labels: ConnectorLabel[] = label
      ? [{ id: `${cell.id}:label`, text: label, pathRatio: along(line?.x ?? 0), offset: besideLine(line?.y ?? 0, this.endAt(source, style, 'exit'), this.endAt(target, style, 'entry'), line?.offset ?? { x: 0, y: 0 }), metadata: {} }]
      : [];
    // A label dragged along an edge is its own vertex, parented to the edge; x runs -1 (source) to 1 (target).
    for (const child of this.childrenOf(cell.id)) {
      const text = drawioLabel(this.valueOf(child), child.style);
      if (!child.vertex || !text) continue;
      const ratio = along(child.geometry?.x ?? 0);
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

/** The type and ink a label carries when its words get a box of their own: the cell's font, none of its paint. */
function textPaint(style: DrawioStyle): JsonObject {
  const { textColor, fontSize, fontWeight, fontStyle, textDecoration } = drawioNodeAppearance(style);
  return Object.fromEntries(Object.entries({ textColor, fontSize, fontWeight, fontStyle, textDecoration }).filter(([, value]) => value !== undefined)) as JsonObject;
}

function summarize(losses: readonly string[]): string[] {
  return [...new Set(losses)];
}

/** Every page of a draw.io file as one OpenFlowKit document under `id`. */
export async function drawioToDocument(text: string, id: string, now = new Date().toISOString()): Promise<DrawioImport> {
  if (!text.trim()) return { error: 'It’s empty.' };
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
    const cells = pageCells(model);
    const builder = new PageBuilder(cells, (message) => losses.push(diagrams.length > 1 ? `${pageName}: ${message}` : message), await drawioFreehands(cells));
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
