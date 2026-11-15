import type { Point2d } from '../../opencanvas/domain/geometry/types';

// draw.io's connector routers (mxEdgeStyle), ported one for one. A router reads the two shapes' boxes, the points
// already pinned at either end and the bends saved in the file (which are only hints to it), and adds the points
// between the ends to `result`. `result` starts holding the source end, null when that end is still to be found.

export interface RouteBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** An end's shape as a router sees it: its box, its style, and its `x` when it is placed by fractions of its parent. */
export interface RouteTerminal extends RouteBox {
  readonly style: Readonly<Record<string, string>>;
  readonly relativeX: number | null;
  readonly isEdge: boolean;
  /** The lifeline this end belongs to (itself, or the lifeline an activation bar sits on): a sequence self-call's test. */
  readonly lifeline?: string | null;
}

export interface RouteEdge {
  readonly style: Readonly<Record<string, string>>;
  /** The connector's parent's origin: saved bends are relative to it. */
  readonly origin: Point2d;
  /** The line so far: the pinned ends, null where an end floats. */
  readonly absolutePoints: readonly (Point2d | null)[];
}

export type Router = (edge: RouteEdge, source: RouteTerminal | null, target: RouteTerminal | null, hints: readonly Point2d[], result: (Point2d | null)[]) => void;

export const WEST = 1;
export const NORTH = 2;
export const SOUTH = 4;
export const EAST = 8;

/** A style value as draw.io reads it: unset and `none` are both "not there". */
export const styleOf = (style: Readonly<Record<string, string>> | undefined, key: string): string | undefined => {
  const value = style && Object.hasOwn(style, key) ? style[key] : undefined;
  return value === undefined || value === 'none' ? undefined : value;
};

export const numberOf = (style: Readonly<Record<string, string>> | undefined, key: string, fallback: number): number => {
  const parsed = Number.parseFloat(styleOf(style, key) ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const contains = (box: RouteBox, x: number, y: number): boolean => box.x <= x && box.x + box.width >= x && box.y <= y && box.y + box.height >= y;
/** Where a router aims inside a shape: its centre, moved by `routingCenterX/Y` (fractions of its size). */
export const routingCenterX = (box: RouteTerminal): number => box.x + box.width / 2 + numberOf(box.style, 'routingCenterX', 0) * box.width;
export const routingCenterY = (box: RouteTerminal): number => box.y + box.height / 2 + numberOf(box.style, 'routingCenterY', 0) * box.height;
export const toPage = (edge: RouteEdge, point: Point2d): Point2d => ({ x: point.x + edge.origin.x, y: point.y + edge.origin.y });
/** A pinned end standing in for its shape: a box of no size at the point. */
export const pointBox = (point: Point2d): RouteTerminal => ({ x: point.x, y: point.y, width: 0, height: 0, style: {}, relativeX: null, isEdge: false });

/** The sides a line may use at a shape (`portConstraint` on the shape, else the connector's own), as a mask. */
export function portConstraints(terminal: RouteTerminal, edge: RouteEdge, source: boolean, fallback: number): number {
  const value = styleOf(terminal.style, 'portConstraint') ?? styleOf(edge.style, source ? 'sourcePortConstraint' : 'targetPortConstraint');
  if (value === undefined) return fallback;
  const rotation = styleOf(terminal.style, 'portConstraintRotation') === '1' ? numberOf(terminal.style, 'rotation', 0) : 0;
  const quarter = rotation > 45 ? (rotation >= 135 ? 2 : 1) : rotation < -45 ? (rotation <= -135 ? 2 : 3) : 0;
  const turned = (sides: readonly [number, number, number, number]) => sides[quarter]!;
  let mask = 0;
  if (value.includes('north')) mask |= turned([NORTH, EAST, SOUTH, WEST]);
  if (value.includes('west')) mask |= turned([WEST, NORTH, EAST, SOUTH]);
  if (value.includes('south')) mask |= turned([SOUTH, WEST, NORTH, EAST]);
  if (value.includes('east')) mask |= turned([EAST, SOUTH, WEST, NORTH]);
  return mask;
}

export const reversePortConstraints = (mask: number): number => ((mask & WEST) << 3) | ((mask & NORTH) << 1) | ((mask & SOUTH) >> 1) | ((mask & EAST) >> 3);

/** Entity-relation lines: out of each table's side by `segment` (30), joined by one vertical run. */
const entityRelation: Router = (edge, sourceShape, targetShape, _hints, result) => {
  const segment = numberOf(edge.style, 'segment', 30);
  const p0 = edge.absolutePoints[0] ?? null;
  const pe = edge.absolutePoints.at(-1) ?? null;
  let source = sourceShape;
  let target = targetShape;
  let sourceLeft = false;
  if (source) {
    if (source.relativeX !== null) sourceLeft = source.relativeX <= 0.5;
    else if (target) sourceLeft = (pe ? pe.x : target.x + target.width) < (p0 ? p0.x : source.x);
  }
  if (p0) source = pointBox(p0);
  else if (source) {
    const sides = portConstraints(source, edge, true, 0);
    if (sides !== 0 && sides !== WEST + EAST) sourceLeft = sides === WEST;
  } else return;
  let targetLeft = true;
  if (target) {
    if (target.relativeX !== null) targetLeft = target.relativeX <= 0.5;
    else if (source) targetLeft = (p0 ? p0.x : source.x + source.width) < (pe ? pe.x : target.x);
  }
  if (pe) target = pointBox(pe);
  else if (target) {
    const sides = portConstraints(target, edge, false, 0);
    if (sides !== 0 && sides !== WEST + EAST) targetLeft = sides === WEST;
  }
  if (!source || !target) return;
  const x0 = sourceLeft ? source.x : source.x + source.width;
  const y0 = routingCenterY(source);
  const xe = targetLeft ? target.x : target.x + target.width;
  const ye = routingCenterY(target);
  const departure = { x: x0 + (sourceLeft ? -segment : segment), y: y0 };
  const arrival = { x: xe + (targetLeft ? -segment : segment), y: ye };
  if (sourceLeft === targetLeft) {
    const x = sourceLeft ? Math.min(x0, xe) - segment : Math.max(x0, xe) + segment;
    result.push({ x, y: y0 }, { x, y: ye });
  } else if (departure.x < arrival.x === sourceLeft) {
    const middle = y0 + (ye - y0) / 2;
    result.push(departure, { x: departure.x, y: middle }, { x: arrival.x, y: middle }, arrival);
  } else {
    result.push(departure, arrival);
  }
};

/** A line from a shape back to itself: a bump out of one side (`direction`, west unless set) by `segment` (10). */
const loop: Router = (edge, source, _target, hints, result) => {
  const points = edge.absolutePoints;
  if (points[0] && points.at(-1)) {
    for (const hint of hints) result.push(toPage(edge, hint));
    return;
  }
  if (!source) return;
  let hint = hints.length ? toPage(edge, hints[0]!) : null;
  if (hint && contains(source, hint.x, hint.y)) hint = null;
  let [x, dx, y, dy] = [0, 0, 0, 0];
  const segment = numberOf(edge.style, 'segment', 10);
  const direction = styleOf(edge.style, 'direction') ?? 'west';
  if (direction === 'north' || direction === 'south') { x = routingCenterX(source); dx = segment; }
  else { y = routingCenterY(source); dy = segment; }
  if (!hint || hint.x < source.x || hint.x > source.x + source.width) {
    if (hint) { x = hint.x; dy = Math.max(Math.abs(y - hint.y), dy); }
    else if (direction === 'north') y = source.y - 2 * dx;
    else if (direction === 'south') y = source.y + source.height + 2 * dx;
    else if (direction === 'east') x = source.x - 2 * dy;
    else x = source.x + source.width + 2 * dy;
  } else {
    x = routingCenterX(source);
    dx = Math.max(Math.abs(x - hint.x), dy);
    y = hint.y;
    dy = 0;
  }
  result.push({ x: x - dx, y: y - dy }, { x: x + dx, y: y + dy });
};

/** One vertical run between two shapes side by side, at the saved bend's x or halfway between them. */
const sideToSide: Router = (edge, sourceShape, targetShape, hints, result) => {
  const hint = hints.length ? toPage(edge, hints[0]!) : null;
  const p0 = edge.absolutePoints[0] ?? null;
  const pe = edge.absolutePoints.at(-1) ?? null;
  const source = p0 ? pointBox(p0) : sourceShape;
  const target = pe ? pointBox(pe) : targetShape;
  if (!source || !target) return;
  const left = Math.max(source.x, target.x);
  const right = Math.min(source.x + source.width, target.x + target.width);
  const x = hint ? hint.x : Math.round(right + (left - right) / 2);
  let y1 = routingCenterY(source);
  let y2 = routingCenterY(target);
  if (hint) {
    if (hint.y >= source.y && hint.y <= source.y + source.height) y1 = hint.y;
    if (hint.y >= target.y && hint.y <= target.y + target.height) y2 = hint.y;
  }
  const clear = (px: number, py: number) => !contains(target, px, py) && !contains(source, px, py);
  if (clear(x, y1)) result.push({ x, y: y1 });
  if (clear(x, y2)) result.push({ x, y: y2 });
  if (result.length !== 1) return;
  if (hint) {
    if (clear(x, hint.y)) result.push({ x, y: hint.y });
  } else {
    const top = Math.max(source.y, target.y);
    const bottom = Math.min(source.y + source.height, target.y + target.height);
    result.push({ x, y: top + (bottom - top) / 2 });
  }
};

/** One horizontal run between two shapes one above the other, at the saved bend's y or halfway between them. */
const topToBottom: Router = (edge, sourceShape, targetShape, hints, result) => {
  const hint = hints.length ? toPage(edge, hints[0]!) : null;
  const p0 = edge.absolutePoints[0] ?? null;
  const pe = edge.absolutePoints.at(-1) ?? null;
  const source = p0 ? pointBox(p0) : sourceShape;
  const target = pe ? pointBox(pe) : targetShape;
  if (!source || !target) return;
  const top = Math.max(source.y, target.y);
  const bottom = Math.min(source.y + source.height, target.y + target.height);
  let x = routingCenterX(source);
  if (hint && hint.x >= source.x && hint.x <= source.x + source.width) x = hint.x;
  const y = hint ? hint.y : Math.round(bottom + (top - bottom) / 2);
  const clear = (px: number, py: number) => !contains(target, px, py) && !contains(source, px, py);
  if (clear(x, y)) result.push({ x, y });
  x = hint && hint.x >= target.x && hint.x <= target.x + target.width ? hint.x : routingCenterX(target);
  if (clear(x, y)) result.push({ x, y });
  if (result.length !== 1) return;
  if (hint) {
    if (clear(hint.x, y)) result.push({ x: hint.x, y });
  } else {
    const left = Math.max(source.x, target.x);
    const right = Math.min(source.x + source.width, target.x + target.width);
    result.push({ x: left + (right - left) / 2, y });
  }
};

/** An elbow: sideways when the shapes sit side by side (or `elbow` isn't `vertical`), else down and across. */
const elbow: Router = (edge, source, target, hints, result) => {
  let hint = hints.length ? hints[0]! : null;
  let vertical = false;
  let horizontal = false;
  if (source && target) {
    if (hint) {
      const left = Math.min(source.x, target.x);
      const right = Math.max(source.x + source.width, target.x + target.width);
      const top = Math.min(source.y, target.y);
      const bottom = Math.max(source.y + source.height, target.y + target.height);
      hint = toPage(edge, hint);
      vertical = hint.y < top || hint.y > bottom;
      horizontal = hint.x < left || hint.x > right;
    } else {
      const left = Math.max(source.x, target.x);
      const right = Math.min(source.x + source.width, target.x + target.width);
      vertical = left === right;
      if (!vertical) {
        const top = Math.max(source.y, target.y);
        const bottom = Math.min(source.y + source.height, target.y + target.height);
        horizontal = top === bottom;
      }
    }
  }
  if (!horizontal && (vertical || styleOf(edge.style, 'elbow') === 'vertical')) topToBottom(edge, source, target, hints, result);
  else sideToSide(edge, source, target, hints, result);
};

const tenth = (value: number): number => Math.round(value * 10) / 10;
const tenthBox = <T extends RouteBox>(box: T | null): T | null => (box ? { ...box, x: tenth(box.x), y: tenth(box.y), width: tenth(box.width), height: tenth(box.height) } : null);

/** Right-angle runs through each saved bend in turn, starting flat or upright as the first bend allows. */
export const segment: Router = (edge, sourceShape, targetShape, hintsAsSaved, result) => {
  const pts = edge.absolutePoints.map((point) => (point ? { x: tenth(point.x), y: tenth(point.y) } : null));
  const source = tenthBox(sourceShape);
  const target = tenthBox(targetShape);
  const tmp: Point2d[] = [];
  let lastPushed = result.length > 0 ? result[0]! : null;
  let horizontal = true;
  let hint: { x: number; y: number } | null = null;
  const first = pts[0] ?? null;
  let pt: { x: number; y: number } | null = first ? { ...first } : source ? { x: routingCenterX(source), y: routingCenterY(source) } : null;
  const lastIndex = pts.length - 1;
  const last = pts[lastIndex] ?? null;
  let pe: Point2d | null = null;
  if (hintsAsSaved.length > 0) {
    let hints = hintsAsSaved.map((point) => ({ ...toPage(edge, point) }));
    if (pt) {
      if (Math.abs(hints[0]!.x - pt.x) < 1) hints[0]!.x = pt.x;
      if (Math.abs(hints[0]!.y - pt.y) < 1) hints[0]!.y = pt.y;
    }
    pe = last;
    if (pe) {
      const end = hints.at(-1)!;
      if (Math.abs(end.x - pe.x) < 1) end.x = pe.x;
      if (Math.abs(end.y - pe.y) < 1) end.y = pe.y;
    }
    hint = hints[0]!;
    let currentTerm = first ? null : source;
    let currentPt = first;
    let currentHint = hint;
    for (let i = 0; i < 2; i += 1) {
      const fixedVertAlign = currentPt !== null && currentPt.x === currentHint.x;
      const fixedHozAlign = currentPt !== null && currentPt.y === currentHint.y;
      const inHozChan = currentTerm !== null && currentHint.y >= currentTerm.y && currentHint.y <= currentTerm.y + currentTerm.height;
      const inVertChan = currentTerm !== null && currentHint.x >= currentTerm.x && currentHint.x <= currentTerm.x + currentTerm.width;
      const hozChan = fixedHozAlign || (currentPt === null && inHozChan);
      const vertChan = fixedVertAlign || (currentPt === null && inVertChan);
      if (i !== 0 || !((hozChan && vertChan) || (fixedVertAlign && fixedHozAlign))) {
        if (currentPt !== null && !fixedHozAlign && !fixedVertAlign && (inHozChan || inVertChan)) { horizontal = !inHozChan; break; }
        if (vertChan || hozChan) {
          horizontal = hozChan;
          if (i === 1) horizontal = hints.length % 2 === 0 ? hozChan : vertChan;
          break;
        }
      }
      currentPt = last;
      currentTerm = last ? null : target;
      currentHint = hints.at(-1)!;
      if (fixedVertAlign && fixedHozAlign) hints = hints.slice(1);
    }
    if (pt) {
      if (horizontal && ((first && first.y !== hint.y) || (!first && source && (hint.y < source.y || hint.y > source.y + source.height)))) tmp.push({ x: pt.x, y: hint.y });
      else if (!horizontal && ((first && first.x !== hint.x) || (!first && source && (hint.x < source.x || hint.x > source.x + source.width)))) tmp.push({ x: hint.x, y: pt.y });
      if (horizontal) pt.y = hint.y;
      else pt.x = hint.x;
      for (const next of hints) {
        horizontal = !horizontal;
        hint = next;
        if (horizontal) pt.y = hint.y;
        else pt.x = hint.x;
        tmp.push({ ...pt });
      }
    }
  } else {
    hint = pt;
    horizontal = true;
  }
  pt = last ?? (target ? { x: routingCenterX(target), y: routingCenterY(target) } : null);
  if (pt && hint) {
    if (horizontal && ((last && last.y !== hint.y) || (!last && target && (hint.y < target.y || hint.y > target.y + target.height)))) tmp.push({ x: pt.x, y: hint.y });
    else if (!horizontal && ((last && last.x !== hint.x) || (!last && target && (hint.x < target.x || hint.x > target.x + target.width)))) tmp.push({ x: hint.x, y: pt.y });
  }
  if (!first && source) while (tmp.length > 0 && contains(source, tmp[0]!.x, tmp[0]!.y)) tmp.shift();
  if (!last && target) while (tmp.length > 0 && contains(target, tmp.at(-1)!.x, tmp.at(-1)!.y)) tmp.pop();
  for (const raw of tmp) {
    const point = { x: tenth(raw.x), y: tenth(raw.y) };
    if (!lastPushed || Math.abs(lastPushed.x - point.x) >= 1 || Math.abs(lastPushed.y - point.y) >= 1) { result.push(point); lastPushed = point; }
  }
  const tail = result.at(-1);
  if (pe && tail && Math.abs(pe.x - tail.x) <= 1 && Math.abs(pe.y - tail.y) <= 1) {
    result.pop();
    const before = result.at(-1);
    if (before) result[result.length - 1] = { x: Math.abs(before.x - pe.x) < 1 ? pe.x : before.x, y: Math.abs(before.y - pe.y) < 1 ? pe.y : before.y };
  }
};

/** The routers by the `edgeStyle` name draw.io registers them under; `orthogonalEdgeStyle` is in drawioOrthConnector. */
export const loopRouter: Router = loop;

export const SIMPLE_ROUTERS: Readonly<Record<string, Router>> = {
  elbowEdgeStyle: elbow,
  entityRelationEdgeStyle: entityRelation,
  loopEdgeStyle: loop,
  sideToSideEdgeStyle: sideToSide,
  topToBottomEdgeStyle: topToBottom,
  segmentEdgeStyle: segment,
};
