import type { Point2d } from '../../opencanvas/domain/geometry/types';
import type { Geometry } from './drawioCells';
import { SIMPLE_ROUTERS, loopRouter, numberOf, segment, styleOf, type RouteEdge, type RouteTerminal, type Router } from './drawioEdgeStyles';
import { isometric, orthConnector } from './drawioOrthConnector';
import { drawioPerimeter } from './drawioPerimeter';

// A connector's line as draw.io works it out (mxGraphView.updateEdgeState): ends pinned by `exitX/entryX` first,
// then the router's points between them, then ends that float, each aimed at the point next to it and stopped at
// its shape's outline. Everything is page units; nothing here knows OpenFlowKit.

/** An end's shape, with what the outline functions need on top of a router's view of it. */
export interface EdgeTerminal extends RouteTerminal {
  /** Where a line to this end stops when it has no outline: a shape's centre, a connector's midpoint. */
  readonly centre: Point2d;
}

export interface EdgeLine {
  readonly points: readonly Point2d[];
  /** The length of each run between two points, and their sum. */
  readonly segments: readonly number[];
  readonly length: number;
}

const ROUTERS: Readonly<Record<string, Router>> = { ...SIMPLE_ROUTERS, orthogonalEdgeStyle: orthConnector, isometricEdgeStyle: isometric };
const SQUARE = new Set<Router>([SIMPLE_ROUTERS.segmentEdgeStyle!, SIMPLE_ROUTERS.elbowEdgeStyle!, SIMPLE_ROUTERS.sideToSideEdgeStyle!, SIMPLE_ROUTERS.topToBottomEdgeStyle!, SIMPLE_ROUTERS.entityRelationEdgeStyle!, orthConnector, segment]);

/** draw.io's truthiness for a style flag: set, and not 0. */
const on = (style: Readonly<Record<string, string>>, key: string): boolean => {
  const value = styleOf(style, key);
  return value !== undefined && value !== '' && Number(value) !== 0;
};

const turn = (point: Point2d, cos: number, sin: number, about: Point2d): Point2d => {
  const [dx, dy] = [point.x - about.x, point.y - about.y];
  return { x: dx * cos - dy * sin + about.x, y: dy * cos + dx * sin + about.y };
};

const grown = (box: RouteTerminal, by: number) => ({ x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by });

/** Where a line from `next` stops on a shape's outline, `border` px off it; the shape's centre when it has none. */
export function perimeterPoint(terminal: EdgeTerminal, next: Point2d | null, orthogonal: boolean, border = 0): Point2d {
  const perimeter = drawioPerimeter(terminal.style.perimeter);
  let point: Point2d | null = null;
  if (perimeter && next) {
    const bounds = grown(terminal, border + numberOf(terminal.style, 'perimeterSpacing', 0));
    if (bounds.width > 0 || bounds.height > 0) {
      const flipH = !terminal.isEdge && terminal.style.flipH === '1';
      const flipV = !terminal.isEdge && terminal.style.flipV === '1';
      const [cx, cy] = [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
      const mirror = (at: Point2d): Point2d => ({ x: flipH ? 2 * cx - at.x : at.x, y: flipV ? 2 * cy - at.y : at.y });
      const shape = { style: terminal.style, direction: styleOf(terminal.style, 'direction'), strokeWidth: numberOf(terminal.style, 'strokeWidth', 1), backboneSize: terminal.style.backboneSize === undefined ? undefined : numberOf(terminal.style, 'backboneSize', 0) };
      const hit = perimeter(bounds, shape, mirror(next), orthogonal);
      point = hit ? mirror(hit) : null;
    }
  }
  return point ?? terminal.centre;
}

/** Where `exitX/exitY` or `entryX/entryY` pin an end on its shape (mxGraph.getConnectionPoint); null when the end floats. */
function pinnedPoint(edgeStyle: Readonly<Record<string, string>>, terminal: EdgeTerminal, source: boolean): Point2d | null {
  const fx = Number.parseFloat(edgeStyle[source ? 'exitX' : 'entryX'] ?? '');
  const fy = Number.parseFloat(edgeStyle[source ? 'exitY' : 'entryY'] ?? '');
  // draw.io's own rule: a point shape (`centerPerimeter`) takes every line at its centre.
  if (terminal.style.perimeter === 'centerPerimeter') return terminal.centre;
  if (Number.isNaN(fx) || Number.isNaN(fy)) return null;
  const onOutline = (edgeStyle[source ? 'exitPerimeter' : 'entryPerimeter'] ?? '1') !== '0';
  const dx = numberOf(edgeStyle, source ? 'exitDx' : 'entryDx', 0);
  const dy = numberOf(edgeStyle, source ? 'exitDy' : 'entryDy', 0);
  let bounds = grown(terminal, numberOf(terminal.style, 'perimeterSpacing', 0));
  const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const direction = styleOf(terminal.style, 'direction');
  let quarter = 0;
  if (direction !== undefined && (terminal.style.anchorPointDirection ?? '1') !== '0') {
    quarter = direction === 'north' ? 270 : direction === 'west' ? 180 : direction === 'south' ? 90 : 0;
    if (direction === 'north' || direction === 'south') {
      const shift = (bounds.width - bounds.height) / 2;
      bounds = { x: bounds.x + shift, y: bounds.y - shift, width: bounds.height, height: bounds.width };
    }
  }
  let point: Point2d = { x: bounds.x + fx * bounds.width + dx, y: bounds.y + fy * bounds.height + dy };
  let rotation = numberOf(terminal.style, 'rotation', 0);
  if (onOutline) {
    if (quarter !== 0) point = turn(point, quarter === 180 ? -1 : 0, quarter === 90 ? 1 : quarter === 270 ? -1 : 0, centre);
    point = perimeterPoint(terminal, point, false);
  } else {
    rotation += quarter;
    if (!terminal.isEdge) {
      let [flipH, flipV] = [terminal.style.flipH === '1', terminal.style.flipV === '1'];
      if (direction === 'north' || direction === 'south') [flipH, flipV] = [flipV, flipH];
      if (flipH) point = { x: 2 * centre.x - point.x, y: point.y };
      if (flipV) point = { x: point.x, y: 2 * centre.y - point.y };
    }
  }
  if (rotation !== 0) {
    const radians = (rotation * Math.PI) / 180;
    point = turn(point, Math.cos(radians), Math.sin(radians), centre);
  }
  return point;
}

/** Routings not ported here, drawn by draw.io's own code once loaded (`installDrawioRouters`). */
export const DRAWIO_CODE_ROUTERS: ReadonlySet<string> = new Set(['sequenceEdgeStyle']);
const fromDrawio = new Map<string, Router>();
/** Hands the routings in DRAWIO_CODE_ROUTERS to draw.io's own code (src/services/dsl/drawioShapes.ts). */
export function installDrawioRouters(lookup: (name: string) => Router | null): void {
  for (const name of DRAWIO_CODE_ROUTERS) { const router = lookup(name); if (router) fromDrawio.set(name, router); }
}

function routerOf(style: Readonly<Record<string, string>>): Router | null {
  if (on(style, 'noEdgeStyle')) return null;
  const name = styleOf(style, 'edgeStyle');
  if (name === undefined) return null;
  return Object.hasOwn(ROUTERS, name) ? ROUTERS[name]! : (fromDrawio.get(name) ?? null);
}

/** Whether an `edgeStyle` names a router this port has. */
export const drawioRoutes = (name: string): boolean => Object.hasOwn(ROUTERS, name) || fromDrawio.has(name);

/** The point along a line at `x` (-1 source end, 0 middle, 1 target end), set off square to its run by `y`, then by `offset` (mxGraphView.getPoint). */
export function pointOnLine(line: EdgeLine, x: number, y: number, offset: Point2d): Point2d {
  const { points, segments } = line;
  const distance = Math.round((x / 2 + 0.5) * line.length);
  let run = segments[0] ?? 0;
  let travelled = 0;
  let index = 1;
  while (distance >= Math.round(travelled + run) && index < points.length - 1) { travelled += run; run = segments[index] ?? 0; index += 1; }
  const factor = run === 0 ? 0 : (distance - travelled) / run;
  const [from, to] = [points[index - 1]!, points[index]!];
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  const [nx, ny] = run === 0 ? [0, 0] : [dy / run, dx / run];
  return { x: from.x + dx * factor + nx * y + offset.x, y: from.y + dy * factor - (ny * y - offset.y) };
}

/**
 * A connector's line between `source` and `target` (null for an end at a free point). Null when an end can't be
 * found, where draw.io draws nothing. `origin` is the connector's parent's origin.
 */
export function drawioEdgeLine(style: Readonly<Record<string, string>>, geometry: Geometry, origin: Point2d, source: EdgeTerminal | null, target: EdgeTerminal | null): EdgeLine | null {
  const free = (point: Point2d | null): Point2d | null => (point ? { x: point.x + origin.x, y: point.y + origin.y } : null);
  const start = source ? pinnedPoint(style, source, true) : free(geometry.sourcePoint);
  const end = target ? pinnedPoint(style, target, false) : free(geometry.targetPoint);
  if ((!source && !start) || (!target && !end)) return null;
  const hints = geometry.points;
  // A line from a shape to itself loops, unless its bends are saved or it is a right-angle loop with a pinned end.
  const looped = !(hints.length >= 2) && !(on(style, 'orthogonalLoop') && (start !== null || end !== null)) && source !== null && source === target;
  const router = looped ? (Object.hasOwn(ROUTERS, style.loopStyle ?? '') ? ROUTERS[style.loopStyle!]! : loopRouter) : routerOf(style);
  const edge: RouteEdge = { style, origin, absolutePoints: [start, end] };
  const points: (Point2d | null)[] = [start];
  if (router) router(edge, source, target, hints, points);
  else for (const hint of hints) points.push({ x: hint.x + origin.x, y: hint.y + origin.y });
  points.push(end);
  // Floating ends, the target first: each aims at the point next to it on the line, else at the other shape's centre.
  const orthogonal = styleOf(style, 'orthogonal') !== undefined ? on(style, 'orthogonal') : SQUARE.has(routerOf(style) as Router);
  const float = (terminal: EdgeTerminal, opposite: EdgeTerminal | null, atSource: boolean): Point2d => {
    const count = points.length;
    let next = points[atSource ? Math.min(1, count - 1) : Math.max(0, count - 2)] ?? opposite?.centre ?? null;
    const radians = (numberOf(terminal.style, 'rotation', 0) * Math.PI) / 180;
    const border = numberOf(style, 'perimeterSpacing', 0) + numberOf(style, atSource ? 'sourcePerimeterSpacing' : 'targetPerimeterSpacing', 0);
    if (radians !== 0 && next) next = turn(next, Math.cos(-radians), Math.sin(-radians), terminal.centre);
    const hit = perimeterPoint(terminal, next, radians === 0 && orthogonal, border);
    return radians !== 0 ? turn(hit, Math.cos(radians), Math.sin(radians), terminal.centre) : hit;
  };
  if (!points.at(-1) && target) points[points.length - 1] = float(target, source, false);
  if (!points[0] && source) points[0] = float(source, target, true);
  // `fixedPointSpacing=1`: an end pinned to a fixed point keeps the line's perimeter spacing too, moved that far
  // towards its neighbour on the route, never past it.
  if (on(style, 'fixedPointSpacing')) {
    for (const [atSource, pinned] of [[true, start], [false, end]] as const) {
      const spacing = numberOf(style, 'perimeterSpacing', 0) + numberOf(style, atSource ? 'sourcePerimeterSpacing' : 'targetPerimeterSpacing', 0);
      const at = atSource ? 0 : points.length - 1;
      const next = points[atSource ? 1 : points.length - 2];
      if (!pinned || !next || spacing === 0 || !points[at]) continue;
      const [dx, dy] = [next.x - points[at]!.x, next.y - points[at]!.y];
      const run = Math.hypot(dx, dy);
      const step = run === 0 ? 0 : Math.min(spacing, run) / run;
      points[at] = { x: points[at]!.x + dx * step, y: points[at]!.y + dy * step };
    }
  }
  const line = points.filter((point): point is Point2d => point !== null);
  if (!points[0] || !points.at(-1) || line.length < 2) return null;
  const segments: number[] = [];
  let length = 0;
  for (let index = 1; index < line.length; index += 1) {
    const run = Math.hypot(line[index]!.x - line[index - 1]!.x, line[index]!.y - line[index - 1]!.y);
    segments.push(run);
    length += run;
  }
  return { points: line, segments, length };
}

/**
 * The point a connector's own label is set against: along the line by the geometry's x, y and offset when relative,
 * else off the ends' midpoint; then moved by the label's spacing on the side it is aligned to (mxText.getSpacing).
 */
export function edgeLabelPoint(line: EdgeLine, geometry: Geometry, style: Readonly<Record<string, string>> = {}): Point2d {
  const [from, to] = [line.points[0]!, line.points.at(-1)!];
  const at = geometry.relative ? pointOnLine(line, geometry.x, geometry.y, geometry.offset)
    : { x: from.x + (to.x - from.x) / 2 + geometry.offset.x, y: from.y + (to.y - from.y) / 2 + geometry.offset.y };
  const int = (key: string) => { const parsed = Number.parseInt(style[key] ?? '', 10); return Number.isFinite(parsed) ? parsed : 0; };
  const spacing = Number.isFinite(Number.parseInt(style.spacing ?? '', 10)) ? Number.parseInt(style.spacing!, 10) : 2;
  const [top, right, bottom, left] = [int('spacingTop') + spacing, int('spacingRight') + spacing, int('spacingBottom') + spacing, int('spacingLeft') + spacing];
  const dx = style.align === 'left' ? left : style.align === 'right' ? -right : (left - right) / 2;
  const dy = style.verticalAlign === 'top' ? top + 5 : style.verticalAlign === 'bottom' ? -bottom - 1 : (top - bottom) / 2;
  return { x: at.x + dx, y: at.y + dy };
}
