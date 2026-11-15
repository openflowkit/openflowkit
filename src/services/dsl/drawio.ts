import { DEFAULT_SCENE_LAYER_ID, UNTITLED_DOCUMENT_NAME } from '../../opencanvas/domain/document/defaults';
import type { JsonObject, JsonValue } from '../../opencanvas/domain/document/json';
import {
  SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION,
  type SceneConnector, type SceneDocumentV1, type SceneLayer, type SceneNode, type ScenePage,
} from '../../opencanvas/domain/document/types';
import type { Matrix2d, Point2d } from '../../opencanvas/domain/geometry/types';
import { createImageNode, STENCIL_FILL, STENCIL_STROKE } from '../../opencanvas/domain/nodes/imageNode';
import { createShapeNode } from '../../opencanvas/domain/nodes/shapeNode';
import { measurePortableText } from '../../opencanvas/domain/text/measurement';
import { validateSceneDocumentV1 } from '../../opencanvas/domain/document/validation';
import { drawioCornerRadius, drawioHtmlValue, drawioLabelPlate, drawioStyleLosses, own, drawioColor, drawioImageUrl, drawioLabel, drawioLine, drawioNodeAppearance, drawioShape, drawioShapeName, drawioStandIn, type DrawioStyle } from './drawioStyle';
import { pageCells, pageModel, type Cell } from './drawioCells';
import { drawioConnector, type EndNode, type LabelAt } from './drawioConnectors';
import { drawioRoutes } from './drawioEdgeView';
import { drawnAsLabel, drawnContent, shapedLine, drawnLine, installDrawioCode, stencilNames, usesDrawioCode } from './drawioCode';
import type { DrawioShapes } from './drawioShapes';
import { DrawioView, type EdgeState } from './drawioView';
import { drawioFreehands, freehandContent } from './drawioStencil';
import { applyAdaptiveColors } from './drawioDarkMode';
import { standInLosses } from './drawioLosses';
import { drawioRichLabel } from './drawioRichText';
import { drawioLabelFit, type DrawioLabelBox } from './drawioLabelBox';
import { centreOf, labelLayout, labelNode, placeBox } from './drawioLabelNode';
import { parseXml, type XmlElement } from './xmlReader';
import { loadStencils, siteStencils, type StencilSource } from './drawioStencilLibrary';
import { stencilSvg } from './drawioStencilSvg';
import { stackUnderLines, treeRanks } from './drawioStacking';
import { drawioLaneLine, drawioTableLines, TABLE_LINES } from './drawioTable';

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

const CONTAINER_KIND: Readonly<Record<string, string>> = { swimlane: 'swimlane', group: 'group', table: 'section' };

const counted = (count: number, one: string, many: string): string => (count === 1 ? `1 ${one}` : `${count} ${many}`);

class PageBuilder {
  readonly cells = new Map<string, Cell>();
  /** Parent id → its cells in file order, built once so nothing rescans the page. */
  private readonly children = new Map<string, Cell[]>();
  readonly layers: SceneLayer[] = [];
  readonly nodes: SceneNode[] = [];
  readonly connectors: SceneConnector[] = [];
  /** Cell id → the node drawn for it: where its own coordinates sit on the page, and its size. */
  private readonly placed = new Map<string, EndNode>();
  /** draw.io shape name → how many cells of it became a box, said once per name. */
  private readonly unknownShapes = new Map<string, number>();
  /** A style we don't draw → how many shapes and connectors asked for it, said once per style. */
  private readonly styleLosses = new Map<string, number>();
  /** Shapes and connectors draw.io hides (`visible="0"`, or inside something hidden). */
  private hidden = 0;
  /** Each drawn line's points on the page, for what it paints over. */
  private readonly lines: { id: string; points: readonly Point2d[] }[] = [];
  /** Pictures from draw.io's own image library: only its servers have them. */
  private libraryImages = 0;
  private readonly view: DrawioView;

  /** `freehand`: each freehand line's points as fractions of its cell's box (`drawioFreehands`). */
  /** `stencils`: the draw.io library shapes this file names, by full name in lower case (`loadStencils`). */
  constructor(
    cells: readonly Cell[], private readonly loss: (message: string) => void,
    private readonly freehand: ReadonlyMap<string, readonly (readonly Point2d[])[]> = new Map(),
    private readonly stencils: ReadonlyMap<string, XmlElement> = new Map(),
    /** draw.io's own shape code, when the page has shapes it draws (`loadDrawioShapes`). */
    private readonly code: DrawioShapes | null = null,
  ) {
    for (const cell of cells) {
      if (this.cells.has(cell.id)) { loss(`two cells share the id “${cell.id}”, so the later one was left out`); continue; }
      this.cells.set(cell.id, cell);
      if (cell.parent !== null) {
        const siblings = this.children.get(cell.parent);
        if (siblings) siblings.push(cell);
        else this.children.set(cell.parent, [cell]);
      }
    }
    this.view = new DrawioView(this.cells, (id) => this.childrenOf(id), (cell) => this.inherited(cell));
  }

  build(): void {
    const root = [...this.cells.values()].find((cell) => cell.parent === null) ?? [...this.cells.values()].find((cell) => !this.cells.has(cell.parent ?? ''));
    // Only cells whose parent chain ends at the page's root are drawn; a loop or a missing parent never reaches it.
    // One walk down from the root finds them all, with a list for a stack so deep nesting can't overflow. A cell
    // draw.io hides takes everything inside it along.
    const attached = new Set<string>();
    const shown = new Set<string>();
    for (const queue = root ? [{ id: root.id, visible: true }] : []; queue.length; ) {
      const { id, visible } = queue.pop()!;
      for (const child of this.childrenOf(id)) {
        if (attached.has(child.id)) continue;
        attached.add(child.id);
        // A hidden layer keeps its shapes: our layer is hidden with them in it.
        const seen = visible && (child.visible || (!child.vertex && !child.edge));
        if (seen) shown.add(child.id);
        else if (child.vertex || child.edge) this.hidden += 1;
        queue.push({ id: child.id, visible: seen });
      }
    }
    const stranded = this.cells.size - (root ? 1 : 0) - attached.size;
    if (stranded) this.loss(`${counted(stranded, 'shape or connector sits', 'shapes or connectors sit')} in a parent loop or under a missing parent, so ${stranded === 1 ? 'it was' : 'they were'} left out`);
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
    const layerOf = new Map(layerCells.map((cell, index) => [cell.id, layerIdOf(index, cell)]));
    for (const layer of layerCells) this.addTree(layer.id, null, layerOf.get(layer.id)!);
    // Shapes that ride on a connector are placed along its line, so they come after every shape a line can end on.
    const edges = [...this.cells.values()].filter((cell) => cell.edge && shown.has(cell.id));
    for (const cell of edges) {
      const holder = this.placed.has(cell.parent ?? '') ? cell.parent : null;
      if (this.view.edge(cell.id)) this.addTree(cell.id, holder, this.layerOf(cell, layerOf), (child) => !ridesLine(child));
    }
    for (const cell of edges) {
      const state = this.view.edge(cell.id);
      if (state) { this.addConnector(cell, state, this.layerOf(cell, layerOf)); continue; }
      // An end inside something hidden, with nothing shown to stand in for it, hides the line too.
      const lost = [cell.source, cell.target].some((id) => id !== null && this.cells.has(id) && !shown.has(id));
      if (lost) this.hidden += 1;
      else this.loss(`${this.connectorName(cell)}: it has a loose end, so it was left out`);
    }
    if (this.hidden) this.loss(`${counted(this.hidden, 'shape or connector', 'shapes or connectors')} hidden in draw.io ${this.hidden === 1 ? 'was' : 'were'} left out`);
    if (this.libraryImages) {
      this.loss(`${counted(this.libraryImages, 'picture comes', 'pictures come')} from draw.io’s own image library, so ${this.libraryImages === 1 ? 'it is' : 'they are'} drawn as a box`);
    }
    for (const message of standInLosses(this.unknownShapes)) this.loss(message);
    for (const [message, count] of this.styleLosses) this.loss(count > 1 ? `${message} (${count} places)` : message);
    if (root && this.lines.length) stackUnderLines(this.nodes, this.lines, treeRanks(root.id, (id) => this.childrenOf(id)), this.placed);
  }


  /** The layer a cell sits in: the layer cell at the top of its parent chain. */
  private layerOf(cell: Cell, layers: ReadonlyMap<string, string>): string {
    const seen = new Set<string>();
    for (let at: Cell | undefined = cell; at && !seen.has(at.id); at = at.parent === null ? undefined : this.cells.get(at.parent)) {
      seen.add(at.id);
      const layer = layers.get(at.id);
      if (layer) return layer;
    }
    return DEFAULT_SCENE_LAYER_ID;
  }

  private connectorName(cell: Cell): string {
    const label = drawioLabel(this.valueOf(cell), cell.style);
    return label ? `connector “${label}”` : `connector ${[...this.cells.values()].filter((each) => each.edge).indexOf(cell) + 1}`;
  }

  private noteStyle(style: DrawioStyle, of: 'shape' | 'connector'): void {
    for (const message of drawioStyleLosses(style, of, this.code !== null)) this.styleLosses.set(message, (this.styleLosses.get(message) ?? 0) + 1);
  }

  private fontSize(style: DrawioStyle): number {
    const size = Number(style.fontSize);
    return Number.isFinite(size) && size > 0 ? size : 12;
  }

  /** The node with draw.io's formatting of its words (an `html=1` label's paragraphs, dividers and styled words), if any. */
  private formatted(node: SceneNode, cell: Cell, style: DrawioStyle): SceneNode {
    if (style.html !== '1' || typeof node.content.label !== 'string' || !node.content.label) return node;
    const rich = drawioRichLabel(drawioHtmlValue(this.valueOf(cell), style), this.fontSize(style), style.align);
    return rich ? { ...node, content: { ...node.content, richLabel: rich.blocks as unknown as JsonValue } } : node;
  }

  /** A label's formatting, as the blocks a node's `richLabel` holds. */
  private richOf(cell: Cell, style: DrawioStyle): JsonValue | undefined {
    if (style.html !== '1') return undefined;
    return drawioRichLabel(drawioHtmlValue(this.valueOf(cell), style), this.fontSize(style), style.align)?.blocks as unknown as JsonValue | undefined;
  }

  private childrenOf(id: string): readonly Cell[] {
    return this.children.get(id) ?? [];
  }

  /** The shapes under a cell, each before its own children (so they draw on top), walked with a list for a stack. */
  private addTree(cellId: string, nodeId: string | null, layerId: string, only: (cell: Cell) => boolean = () => true): void {
    const pending = (parentCellId: string, parentNodeId: string | null) =>
      this.childrenOf(parentCellId).filter((cell) => cell.vertex).reverse().map((cell) => ({ cell, parentNodeId }));
    for (const stack = pending(cellId, nodeId).filter(({ cell }) => only(cell)); stack.length; ) {
      const { cell, parentNodeId } = stack.pop()!;
      if (cell.visible && this.addNode(cell, parentNodeId, layerId)) stack.push(...pending(cell.id, cell.id));
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

  private push(node: SceneNode, matrix: Matrix2d): void {
    this.nodes.push({ ...node, zIndex: this.nodes.length });
    if (!this.placed.has(node.id)) this.placed.set(node.id, { matrix, size: node.size });
  }

  /** Adds the cell's node, from draw.io's own box for it; true when its children belong inside it. */
  private addNode(cell: Cell, parentId: string | null, layerId: string): boolean {
    const state = this.view.vertex(cell.id);
    const style = this.inherited(cell);
    const label = drawioLabel(this.valueOf(cell), style);
    if (!state) { this.loss(`“${label || cell.id}”: a shape without a position was left out`); return false; }
    const name = state.shape;
    this.noteStyle(style, 'shape');
    if (cell.collapsed && cell.geometry?.unfolded) this.loss(`${label ? `“${label}”` : 'A container'} was folded in draw.io, so it opens unfolded`);
    const hasChildren = this.childrenOf(cell.id).some((child) => child.vertex);
    const inside = parentId ? this.placed.get(parentId)?.matrix ?? null : null;
    const base = { parentId, layerId, zIndex: 0 };
    const page: ScenePage = { id: '', name: '', diagramKind: 'flowchart', layers: this.layers, nodes: [], connectors: [], metadata: {}, extensions: {} };
    // A shape's `direction` is drawn by draw.io's own code (drawioShapes.ts); the box stays as draw.io has it.
    const centre = centreOf(state.box);
    const { width, height } = state.box;
    const size = { width: Math.max(1, width), height: Math.max(1, height) };
    const box = { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
    const placement = placeBox(inside, box, state.rotation, centre);
    const { transform } = placement;
    const strokes = this.freehand.get(cell.id);
    if (strokes && !hasChildren) {
      // One pen node a stroke: the first keeps the cell's id, so lines drawn to it still land.
      for (const [index, line] of strokes.entries()) {
        this.push({
          id: index ? `${cell.id}:stroke-${index + 1}` : cell.id, kind: 'pen', ...base, transform, size,
          content: freehandContent(line, style, size.width, size.height), appearance: {}, ports: [], metadata: {}, extensions: {},
        }, placement.matrix);
      }
      return false;
    }
    const wordsBelong = (to: string) => {
      if (!label) return;
      const words = labelNode({ id: `${cell.id}:label`, box: state.label, label, paint: textPaint(style), placement: placeBox(placement.matrix, state.label, state.label.rotation, centre), base: { ...base, parentId: to } });
      // The shape's words, set where draw.io has them: editing the shape or them changes both.
      this.push(this.formatted({ ...words, content: { ...words.content, labelOf: cell.id } }, cell, style), placement.matrix);
    };
    const imageUrl = drawioImageUrl(style);
    if ((name === 'image' || style.image) && !imageUrl) this.libraryImages += 1;
    const shape = drawioShape(style, width, height);
    // A shape with no width or no height shows nothing in draw.io: a line's end, or a point things hang off.
    const flat = width === 0 || height === 0 ? { fill: 'transparent', stroke: 'transparent' } : {};
    // Anything can hold other cells in draw.io. A lane, a group or a plain box that does is our container; any other
    // shape (an ellipse, a picture) keeps its own look, and its children are placed inside it all the same.
    const boxy = !imageUrl && (shape.kind === 'rectangle' || shape.kind === 'rounded' || shape.kind === 'text');
    // A box that paints nothing and holds shapes is an old-style group. A painted one holding shapes (an endpoint
    // with its port drawn on it) is a shape like any other in draw.io, its children riding on it: it stays one.
    const plain = drawioNodeAppearance(style);
    const invisible = plain.fill === 'transparent' && plain.stroke === 'transparent';
    if (own(CONTAINER_KIND, name) || (boxy && (style.container === '1' || (hasChildren && invisible)))) {
      // Our container draws its own title band; draw.io's words sit in its label box (a lane's `startSize` band, a
      // group's middle), so ours is hidden and the words are set where draw.io has them, inside the container.
      // draw.io paints a lane's `fillColor` on its title band alone; the body is `swimlaneFillColor`, or nothing.
      const lane = name === 'swimlane';
      const band = Math.max(0, Number.parseFloat(style.startSize ?? '') || 0);
      const paint = drawioNodeAppearance(lane ? { ...style, fillColor: style.swimlaneFillColor ?? 'none' } : style);
      // A container draw.io draws in code (a lifeline; a lane: its band, body, title line, footer) has that drawing behind its children.
      const backdrop = (lane || !own(CONTAINER_KIND, name)) && !flat.fill ? drawnContent(this.code, name, style, size) : null;
      this.push({
        id: cell.id, kind: own(CONTAINER_KIND, name) ?? 'section', ...base, transform, size,
        // Ours cycle colours by id when none is set; draw.io's are plain. Its own colours, if any, are the appearance's.
        content: { label, color: 'slate', showHeader: false },
        appearance: backdrop ? { ...paint, fill: 'transparent', stroke: 'transparent' } : { ...paint, ...flat, cornerRadius: drawioCornerRadius(style, width, height, lane ? band : undefined) },
        ports: [], metadata: {}, extensions: {},
      }, placement.matrix);
      const bandFill = drawioColor(style.fillColor);
      if (!backdrop && lane && band > 0 && bandFill && bandFill !== 'transparent' && !flat.fill) {
        const along = style.horizontal !== '0';
        const bandSize = along ? { width: size.width, height: Math.min(band, size.height) } : { width: Math.min(band, size.width), height: size.height };
        const { stroke, strokeWidth, strokeStyle } = paint;
        const node = createShapeNode(page, {
          kind: 'rectangle', id: `${cell.id}:band`, at: { x: 0, y: 0 }, size: bandSize, label: '',
          appearance: { fill: bandFill, ...(paint.darkColors === undefined ? {} : { darkColors: paint.darkColors }), ...(stroke === undefined ? {} : { stroke }), ...(strokeWidth === undefined ? {} : { strokeWidth }), ...(strokeStyle === undefined ? {} : { strokeStyle }) },
        });
        this.push({ ...node, ...base, parentId: cell.id }, placement.matrix);
      }
      // A table's grid and a lane's title line are drawn under its children, as draw.io paints them.
      const grid = name === 'table' ? drawioTableLines(cell, (id) => this.childrenOf(id), drawnLine(style))
        : lane && !backdrop ? drawioLaneLine(cell, width, height, band, drawnLine(style)) : null;
      for (const [suffix, drawn] of [['shape', backdrop], ['lines', grid && { drawio: { shape: TABLE_LINES }, drawioParts: [grid as unknown as JsonObject], drawioSize: { ...size } }]] as const) {
        if (!drawn) continue;
        const node = createShapeNode(page, { kind: 'rectangle', id: `${cell.id}:${suffix}`, at: { x: 0, y: 0 }, size, label: '', appearance: { ...plain, strokeWidth: drawnLine(style) } });
        this.push({ ...node, ...base, parentId: cell.id, content: { ...node.content, ...drawn } }, placement.matrix);
      }
      wordsBelong(cell.id);
      return true;
    }
    // A shape draw.io draws (in code or by its stencil, or code with a stencil inside) is drawn by draw.io's code.
    const code = shape.unknown && !imageUrl ? drawnContent(this.code, name, style, size) : null;
    if (code) {
      // A shape draw.io draws in code is drawn by that code: its parts, in the node's own colours, redrawn at any size.
      const fit = drawioLabelFit(state.box, state.label, state.rotation);
      const layout = labelLayout(state.label, fit.padding);
      const node = createShapeNode(page, {
        kind: shape.kind, id: cell.id, at: transform.translation, size, label: fit.inside ? label : '',
        appearance: { ...drawioNodeAppearance(style), strokeWidth: drawnLine(style), ...(fit.inside ? layout.appearance : {}) },
      });
      this.push(this.formatted({ ...node, ...base, transform, content: { ...node.content, ...code, sizingPolicy: layout.sizingPolicy } }, cell, style), placement.matrix);
      if (!fit.inside) wordsBelong(cell.id);
      return true;
    }
    const drawn = shape.unknown && !imageUrl ? this.stencilPicture(name, style, width, height) : null;
    if (drawn) {
      // A library shape is drawn by draw.io's stencil for it, as a picture the size of its box and its widest line.
      const grown = { x: box.x - drawn.margin, y: box.y - drawn.margin, width: width + 2 * drawn.margin, height: height + 2 * drawn.margin };
      const pictured = placeBox(inside, grown, state.rotation, centre);
      const picture = createImageNode(page, { id: cell.id, at: pictured.transform.translation, size: { width: grown.width, height: grown.height }, label: label || name, appearance: drawn.paint });
      this.push({ ...picture, ...base, transform: pictured.transform, content: { ...picture.content, stencilSvg: drawn.svg } }, pictured.matrix);
      wordsBelong(cell.id);
      return true;
    }
    if (shape.unknown && name !== 'image' && !imageUrl) {
      // AWS's resource icons are one shape; the icon is named in `resIcon`.
      const unknown = style.resIcon?.startsWith('mxgraph.') ? style.resIcon : shape.unknown;
      this.unknownShapes.set(unknown, (this.unknownShapes.get(unknown) ?? 0) + 1);
    }
    // draw.io's label card (its default shape) draws its picture inside its box, where its own code places it.
    const card = imageUrl && drawnAsLabel(style) ? this.code?.draw({ ...style, shape: 'label' }, width, height)?.images[0] ?? null : null;
    if (imageUrl && !card) {
      // Our image node draws no words, so a picture's are always a box of their own.
      this.push({ ...createImageNode(page, { id: cell.id, at: transform.translation, size, label: label || 'Image', url: imageUrl, stretch: style.imageAspect === '0' }), ...base, transform }, placement.matrix);
      wordsBelong(cell.id);
      return true;
    }
    const fit = drawioLabelFit(state.box, state.label, state.rotation);
    const appearance = shape.unknown ? drawioStandIn(style) : drawioNodeAppearance(style);
    const unpainted = !shape.unknown && appearance.fill === 'transparent' && appearance.stroke === 'transparent';
    if (unpainted && label && !fit.inside) {
      // A cell with no fill or line is only its words: one box, where draw.io lays them out.
      const words = placeBox(inside, state.label, state.label.rotation, centre);
      this.push(this.formatted(labelNode({ id: cell.id, box: state.label, label, paint: appearance, placement: words, base }), cell, style), words.matrix);
      return true;
    }
    // Words the shape's own label can hold are its label; the rest get a box of their own inside it.
    const layout = labelLayout(state.label, fit.padding);
    const node = createShapeNode(page, {
      kind: shape.kind === 'text' ? 'rectangle' : shape.kind, id: cell.id, at: transform.translation, size, label: fit.inside ? label : '',
      appearance: { ...appearance, ...(fit.inside ? layout.appearance : {}), ...flat },
    });
    this.push(this.formatted({ ...node, ...base, transform, content: { ...node.content, sizingPolicy: layout.sizingPolicy } }, cell, style), placement.matrix);
    if (card) this.push({ ...createImageNode(page, { id: `${cell.id}:image`, at: { x: card.x, y: card.y }, size: { width: card.width, height: card.height }, label: 'Image', url: imageUrl! }), ...base, parentId: cell.id }, placement.matrix);
    if (!fit.inside) wordsBelong(cell.id);
    return true;
  }

  /**
   * The cell drawn by its draw.io stencil, or null when its shape isn't one we have. Its fill and line are left as
   * stand-ins the node's own colours fill in (`stencilPictureUrl`), so it recolours as a draw.io stencil does.
   */
  private stencilPicture(name: string, style: DrawioStyle, width: number, height: number): { svg: string; margin: number; paint: JsonObject } | null {
    if (width <= 0 || height <= 0) return null;
    const lookup = (key: string) => this.stencils.get(key) ?? null;
    const stencil = lookup(name.toLowerCase());
    const icon = name === 'mxgraph.aws4.resourceIcon' && style.resIcon ? lookup(style.resIcon.toLowerCase()) : null;
    if (!stencil && !icon) return null;
    const standIns = { ...style, ...(style.fillColor === 'none' ? {} : { fillColor: STENCIL_FILL }), ...(style.strokeColor === 'none' ? {} : { strokeColor: STENCIL_STROKE }) };
    const { svg, margin } = icon ? stencilSvg(icon, standIns, width, height, lookup, { stencil: icon, kind: 'resource' }) : stencilSvg(stencil!, standIns, width, height, lookup);
    // draw.io's own defaults where the cell sets none: a white fill and a black line, flipped in its dark mode.
    const colour = (value: string | undefined, fallback: string) => (value === 'none' ? 'transparent' : drawioColor(value) ?? fallback);
    return { svg, margin, paint: { fill: colour(style.fillColor, '#ffffff'), stroke: colour(style.strokeColor, '#000000'), darkColors: 'invert' } };
  }

  private addConnector(cell: Cell, state: EdgeState, layerId: string): void {
    const style = cell.style;
    this.noteStyle(style, 'connector');
    const router = style.edgeStyle;
    if (router && router !== 'none' && !drawioRoutes(router)) this.styleLosses.set(`draw.io’s “${router}” routing is drawn straight through its saved bends`, (this.styleLosses.get(`draw.io’s “${router}” routing is drawn straight through its saved bends`) ?? 0) + 1);
    const labels: LabelAt[] = [];
    const label = drawioLabel(this.valueOf(cell), style);
    if (label) labels.push({ id: `${cell.id}:label`, text: label, at: centred(state.labelAt, label, style), along: cell.geometry?.relative ? cell.geometry.x : 0, rich: this.richOf(cell, style) });
    // A label dragged along a line is a cell of its own on it; draw.io centres its words on its point.
    for (const child of this.childrenOf(cell.id)) {
      const text = drawioLabel(this.valueOf(child), child.style);
      const at = ridesLine(child) && child.visible ? this.view.vertex(child.id) : null;
      if (at && text) labels.push({ id: `${child.id}:label`, text, at: centred(at.label.anchor, text, child.style), along: child.geometry?.relative ? child.geometry.x : 0, rich: this.richOf(child, child.style), background: drawioLabelPlate(child.style) });
    }
    // A block arrow (`arrow`, `flexArrow`) is painted by its fill: with no line colour, ours is drawn in that.
    const filled = ['arrow', 'flexArrow'].includes(drawioShapeName(style)) ? drawioColor(style.fillColor) : undefined;
    const unlined = drawioLine(style.strokeColor) === 'transparent';
    if (unlined && (!filled || filled === 'transparent')) {
      // draw.io paints no line and no heads for `strokeColor=none`: only the words on it are left, where they sat.
      const parentId = this.placed.has(cell.parent ?? '') ? cell.parent : null;
      const inside = parentId ? this.placed.get(parentId)!.matrix : null;
      for (const { id, text, at } of labels) {
        const point: DrawioLabelBox = { x: at.x - 0.5, y: at.y - 0.5, width: 1, height: 1, align: 'center', verticalAlign: 'middle', wrap: false, anchor: at, rotation: 0 };
        const placement = placeBox(inside, point, 0, at);
        this.push(labelNode({ id, box: point, label: text, paint: textPaint(style), placement, base: { parentId, layerId, zIndex: 0 } }), placement.matrix);
      }
      return;
    }
    this.lines.push({ id: cell.id, points: state.line.points });
    const connector = drawioConnector(state, unlined ? { ...style, strokeColor: filled! } : style, (id) => this.placed.get(id) ?? null, labels);
    const shaped = shapedLine(this.code, connector, style, state.line.points);
    if (shaped.lost) this.styleLosses.set(shaped.lost, (this.styleLosses.get(shaped.lost) ?? 0) + 1);
    this.connectors.push(shaped.connector);
  }
}

/**
 * Our connector label is centred on its point; draw.io sets the words against theirs. Words aligned to a side
 * start or end there, so the centre moves by half their size: draw.io's 1.2 em a line, and the width we draw them at.
 */
function centred(anchor: Point2d, text: string, style: DrawioStyle): Point2d {
  const fontSize = Number.parseFloat(style.fontSize ?? '') || 12;
  const { width, height } = measurePortableText(text, { fontSize, fontWeight: Number(style.fontStyle ?? 0) & 1 ? 700 : 400, lineHeight: fontSize * 1.2 });
  return {
    x: anchor.x + (style.align === 'left' ? width / 2 : style.align === 'right' ? -width / 2 : 0),
    y: anchor.y + (style.verticalAlign === 'top' ? height / 2 : style.verticalAlign === 'bottom' ? -height / 2 : 0),
  };
}

/** A cell on a connector that is only words (draw.io's `edgeLabel`, or one with no size): it becomes the line's label. */
function isLineLabel(cell: Cell): boolean {
  return cell.vertex && (Object.hasOwn(cell.style, 'edgeLabel') || !cell.geometry || (cell.geometry.width <= 1 && cell.geometry.height <= 1));
}

/** A line label our connector can carry: ours are never turned, so words turned along their line stay a shape of their own. */
function ridesLine(cell: Cell): boolean {
  return isLineLabel(cell) && !(Number.parseFloat(cell.style.rotation ?? '') % 360);
}

/** The type and ink a label carries when its words get a box of their own: the cell's font, none of its paint. */
function textPaint(style: DrawioStyle): JsonObject {
  const { textColor, fontSize, fontWeight, fontStyle, textDecoration, darkColors } = drawioNodeAppearance(style);
  return Object.fromEntries(Object.entries({ textColor, fontSize, fontWeight, fontStyle, textDecoration, darkColors }).filter(([, value]) => value !== undefined)) as JsonObject;
}

function summarize(losses: readonly string[]): string[] {
  return [...new Set(losses)];
}

/** Every page of a draw.io file as one OpenFlowKit document under `id`; library shapes come from `stencils`. */
export async function drawioToDocument(text: string, id: string, now = new Date().toISOString(), stencils: StencilSource = siteStencils()): Promise<DrawioImport> {
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
    const code = usesDrawioCode(cells) ? await installDrawioCode() : null;
    const library = await loadStencils(stencilNames(cells), stencils); code?.addStencils(library);
    const builder = new PageBuilder(cells, (message) => losses.push(diagrams.length > 1 ? `${pageName}: ${message}` : message), await drawioFreehands(cells), library, code);
    builder.build();
    applyAdaptiveColors(builder.nodes, builder.connectors, model.attributes.adaptiveColors);
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
