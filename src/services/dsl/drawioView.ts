import type { Point2d } from '../../opencanvas/domain/geometry/types';
import type { Cell } from './drawioCells';
import { drawioEdgeLine, edgeLabelPoint, pointOnLine, type EdgeLine, type EdgeTerminal } from './drawioEdgeView';
import { drawioLabelBox, type DrawioBox, type DrawioLabelBox } from './drawioLabelBox';
import { drawioLayoutBox, drawioShapeName, type DrawioStyle } from './drawioStyle';

// draw.io's view of a page without a browser: one state per cell, worked out from the file's numbers alone as
// mxGraphView does it (parents and ends first). A shape's state is its box on the page, its turn and its label box;
// a connector's is its line and where its label sits. Nothing here knows OpenFlowKit: the importer only reads it.

export interface VertexState {
  readonly kind: 'vertex';
  readonly cell: Cell;
  /** The shape's box on the page, before its own turn. */
  readonly box: DrawioBox;
  /** Where the cell's own coordinates start: its children are placed from here. */
  readonly origin: Point2d;
  /** Degrees, about the box's centre. A parent's turn doesn't turn its children. */
  readonly rotation: number;
  readonly shape: string;
  readonly label: DrawioLabelBox;
  readonly terminal: EdgeTerminal;
}

export interface EdgeState {
  readonly kind: 'edge';
  readonly cell: Cell;
  readonly origin: Point2d;
  readonly line: EdgeLine;
  /** The point the connector's own label is set against: along the line, moved by the label's spacing. */
  readonly labelAt: Point2d;
  /** The cells the line ends at once hidden ones give way to what holds them; null for a free end. */
  readonly sourceId: string | null;
  readonly targetId: string | null;
  readonly terminal: EdgeTerminal;
}

interface LayerState { readonly kind: 'layer'; readonly origin: Point2d }
type State = VertexState | EdgeState | LayerState;

const ZERO: Point2d = { x: 0, y: 0 };
/** Connectors ending on connectors, or on labels of connectors, are followed this deep; past it the line is left out. */
const MAX_CHAIN = 32;

export class DrawioView {
  private readonly states = new Map<string, State | null>();

  /**
   * `styleOf` is the style a cell is drawn with (the importer resolves `fillColor=swimlane` and the like);
   * `childrenOf` its cells in file order.
   */
  constructor(
    private readonly cells: ReadonlyMap<string, Cell>,
    private readonly childrenOf: (id: string) => readonly Cell[],
    private readonly styleOf: (cell: Cell) => DrawioStyle = (cell) => cell.style,
  ) {}

  vertex(id: string): VertexState | null {
    const state = this.resolve(id, 0);
    return state?.kind === 'vertex' ? state : null;
  }

  edge(id: string): EdgeState | null {
    const state = this.resolve(id, 0);
    return state?.kind === 'edge' ? state : null;
  }

  /** A cell's state, its parents' first: found by walking up with a list, so deep nesting can't overflow the stack. */
  private resolve(id: string, depth: number): State | null {
    if (this.states.has(id)) return this.states.get(id)!;
    const chain: Cell[] = [];
    for (let at = this.cells.get(id); at && !this.states.has(at.id); at = at.parent === null ? undefined : this.cells.get(at.parent)) {
      // Marked while its parents are worked out, so a parent loop ends here with no state.
      this.states.set(at.id, null);
      chain.push(at);
    }
    for (let index = chain.length - 1; index >= 0; index -= 1) this.states.set(chain[index]!.id, this.build(chain[index]!, depth));
    return this.states.get(id) ?? null;
  }

  private build(cell: Cell, depth: number): State | null {
    const holder = cell.parent === null ? undefined : this.cells.get(cell.parent);
    const parent = holder ? this.states.get(holder.id) ?? null : null;
    if (!cell.vertex && !cell.edge) return { kind: 'layer', origin: ZERO };
    // A hidden cell has no state, and nor has anything inside it.
    if (!cell.visible || !cell.geometry || (holder && !parent)) return null;
    return cell.vertex ? this.buildVertex(cell, parent) : depth > MAX_CHAIN ? null : this.buildEdge(cell, parent, depth);
  }

  /** A container draw.io sizes on open (`drawioLayoutBox`), in its own coordinates. */
  private autoBox(cell: Cell): DrawioBox | null {
    const geometry = cell.geometry!;
    if (geometry.width || geometry.height) return null;
    const children = this.childrenOf(cell.id).filter((child) => child.vertex && child.geometry && !child.geometry.relative);
    return drawioLayoutBox(children.map((child) => child.geometry!), cell.style);
  }

  private buildVertex(cell: Cell, parent: State | null): VertexState {
    const geometry = cell.geometry!;
    const style = this.styleOf(cell);
    const base = parent?.origin ?? ZERO;
    // mxGraphView.updateCellState: a relative cell sits at fractions of its parent's size, or along its parent line.
    let origin: Point2d;
    let labelOffset = ZERO;
    if (geometry.relative && parent?.kind === 'edge') origin = pointOnLine(parent.line, geometry.x, geometry.y, geometry.offset);
    else if (geometry.relative && parent?.kind === 'vertex') origin = { x: parent.box.x + geometry.x * parent.box.width + geometry.offset.x, y: parent.box.y + geometry.y * parent.box.height + geometry.offset.y };
    else { origin = { x: base.x + geometry.x, y: base.y + geometry.y }; labelOffset = geometry.offset; }
    // A folded container opens unfolded; one saved with no size is sized round its children, as draw.io does on open.
    const auto = this.autoBox(cell);
    const open = cell.collapsed ? geometry.unfolded : null;
    const width = open?.width ?? auto?.width ?? geometry.width;
    const height = open?.height ?? auto?.height ?? geometry.height;
    let box: DrawioBox = { x: origin.x + (auto?.x ?? 0), y: origin.y + (auto?.y ?? 0), width, height };
    // updateVertexState: a relative cell goes round with its parent's turn.
    if (geometry.relative && parent?.kind === 'vertex' && parent.rotation !== 0) {
      const radians = (parent.rotation * Math.PI) / 180;
      const about = { x: parent.box.x + parent.box.width / 2, y: parent.box.y + parent.box.height / 2 };
      const [dx, dy] = [box.x + width / 2 - about.x, box.y + height / 2 - about.y];
      box = { ...box, x: dx * Math.cos(radians) - dy * Math.sin(radians) + about.x - width / 2, y: dy * Math.cos(radians) + dx * Math.sin(radians) + about.y - height / 2 };
    }
    const rotation = Number.parseFloat(style.rotation ?? '') || 0;
    const shape = drawioShapeName(style);
    // Graph.getSequenceLifeline: an activation bar on a lifeline belongs to that lifeline.
    const lifeline = shape !== 'umlLifeline' && parent?.kind === 'vertex' && parent.shape === 'umlLifeline' ? parent.cell.id : cell.id;
    const terminal: EdgeTerminal = {
      ...box, style, relativeX: geometry.relative ? geometry.x : null, isEdge: false, lifeline,
      centre: { x: box.x + width / 2, y: box.y + height / 2 },
    };
    return { kind: 'vertex', cell, box, origin, rotation, shape, label: drawioLabelBox(box, style, shape, labelOffset, rotation), terminal };
  }

  /** The cell a line's end is drawn to: the end itself, or the nearest thing shown that holds it (mxGraphView.getVisibleTerminal). */
  private visibleTerminal(id: string | null): Cell | null {
    let best = id === null ? undefined : this.cells.get(id);
    const seen = new Set<string>();
    for (let at = best; at && !seen.has(at.id); at = at.parent === null ? undefined : this.cells.get(at.parent)) {
      seen.add(at.id);
      if (best && !best.visible) best = at;
    }
    return best && (best.vertex || best.edge) ? best : null;
  }

  private buildEdge(cell: Cell, parent: State | null, depth: number): EdgeState | null {
    const geometry = cell.geometry!;
    const origin = parent?.origin ?? ZERO;
    const ends: (EdgeTerminal | null)[] = [];
    const ids: (string | null)[] = [];
    for (const [index, id] of [cell.source, cell.target].entries()) {
      const shown = this.visibleTerminal(id);
      const state = shown ? this.resolve(shown.id, depth + 1) : null;
      // An end that names a cell draw.io can't show leaves the whole line out.
      if (id !== null && this.cells.has(id) && (!state || state.kind === 'layer')) return null;
      // `sourcePort`/`targetPort` name another cell whose outline the end meets, the line still bound to its terminal
      // (mxGraphView.getTerminalPort).
      const portId = cell.style[index === 0 ? 'sourcePort' : 'targetPort'];
      const port = state && portId && this.cells.has(portId) ? this.resolve(portId, depth + 1) : null;
      ends.push(port && port.kind !== 'layer' ? port.terminal : state && state.kind !== 'layer' ? state.terminal : null);
      ids.push(state && state.kind !== 'layer' ? state.cell.id : null);
    }
    const style = cell.style;
    const line = drawioEdgeLine(style, geometry, origin, ends[0] ?? null, ends[1] ?? null);
    if (!line) return null;
    let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const point of line.points) { left = Math.min(left, point.x); top = Math.min(top, point.y); right = Math.max(right, point.x); bottom = Math.max(bottom, point.y); }
    const terminal: EdgeTerminal = {
      x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top), style, relativeX: null, isEdge: true,
      centre: pointOnLine(line, 0, 0, ZERO),
    };
    return { kind: 'edge', cell, origin, line, labelAt: edgeLabelPoint(line, geometry, style), sourceId: ids[0] ?? null, targetId: ids[1] ?? null, terminal };
  }
}
