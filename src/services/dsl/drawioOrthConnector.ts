import { EAST, NORTH, SOUTH, WEST, numberOf, portConstraints, reversePortConstraints, segment, styleOf, toPage, type RouteBox, type Router } from './drawioEdgeStyles';

// draw.io's default right-angle router (mxEdgeStyle.OrthConnector), ported one for one: it picks the side each end
// leaves by from where the two shapes sit, then walks one of sixteen fixed patterns between them. The tables and
// bit masks are draw.io's own; they are kept as they are so the two can be read side by side.

const SIDE_MASK = 480;
const CENTER_MASK = 512;
const SOURCE_MASK = 1024;
const TARGET_MASK = 2048;
const BUFFER = 10;
const DIR_VECTORS: readonly (readonly [number, number])[] = [[-1, 0], [0, -1], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 0]];
const ROUTE_PATTERNS: readonly (readonly (readonly number[])[])[] = [
  [[513, 2308, 2081, 2562], [513, 1090, 514, 2184, 2114, 2561], [513, 1090, 514, 2564, 2184, 2562], [513, 2308, 2561, 1090, 514, 2568, 2308]],
  [[514, 1057, 513, 2308, 2081, 2562], [514, 2184, 2114, 2561], [514, 2184, 2562, 1057, 513, 2564, 2184], [514, 1057, 513, 2568, 2308, 2561]],
  [[1090, 514, 1057, 513, 2308, 2081, 2562], [2114, 2561], [1090, 2562, 1057, 513, 2564, 2184], [1090, 514, 1057, 513, 2308, 2561, 2568]],
  [[2081, 2562], [1057, 513, 1090, 514, 2184, 2114, 2561], [1057, 513, 1090, 514, 2184, 2562, 2564], [1057, 2561, 1090, 514, 2568, 2308]],
];

/** How far a line runs straight out of a shape before it may turn: `jettySize`, or by the arrow head's size on `auto`. */
function jettySize(style: Readonly<Record<string, string>>, source: boolean): number {
  const value = styleOf(style, source ? 'sourceJettySize' : 'targetJettySize') ?? styleOf(style, 'jettySize');
  if (value === undefined) return BUFFER;
  if (value !== 'auto') { const size = Number.parseFloat(value); return Number.isFinite(size) ? size : BUFFER; }
  if (styleOf(style, source ? 'startArrow' : 'endArrow') === undefined) return 2 * BUFFER;
  const head = numberOf(style, source ? 'startSize' : 'endSize', 6);
  return Math.max(2, Math.ceil((head + BUFFER) / BUFFER)) * BUFFER;
}

/** The box around a box turned by `degrees` about its centre. */
function turnedBounds(box: RouteBox, degrees: number): RouteBox {
  const radians = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]] as const) {
    const [dx, dy] = [x - cx, y - cy];
    const [px, py] = [dx * cos - dy * sin + cx, dy * cos + dx * sin + cy];
    left = Math.min(left, px); top = Math.min(top, py); right = Math.max(right, px); bottom = Math.max(bottom, py);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const tenth = (value: number): number => Math.round(value * 10) / 10;
const tenthBox = <T extends RouteBox>(box: T | null): T | null => (box ? { ...box, x: tenth(box.x), y: tenth(box.y), width: tenth(box.width), height: tenth(box.height) } : null);

export const orthConnector: Router = (edge, sourceShape, targetShape, hints, result) => {
  const pts = edge.absolutePoints.map((point) => (point ? { x: tenth(point.x), y: tenth(point.y) } : null));
  const source = tenthBox(sourceShape);
  const target = tenthBox(targetShape);
  const p0 = pts[0] ?? null;
  const pe = pts.at(-1) ?? null;
  if ((!source && !p0) || (!target && !pe)) return;
  let sourceBox: RouteBox = source ?? { x: p0!.x, y: p0!.y, width: 1, height: 1 };
  let targetBox: RouteBox = target ?? { x: pe!.x, y: pe!.y, width: 1, height: 1 };
  let sourceBuffer = jettySize(edge.style, true);
  let targetBuffer = jettySize(edge.style, false);
  if (sourceShape && targetShape === sourceShape) { sourceBuffer = Math.max(sourceBuffer, targetBuffer); targetBuffer = sourceBuffer; }
  const totalBuffer = targetBuffer + sourceBuffer;
  const tooShort = p0 !== null && pe !== null && (pe.x - p0.x) ** 2 + (pe.y - p0.y) ** 2 < totalBuffer * totalBuffer;
  // Saved bends, or two pinned ends closer than the straight runs need, fall back to plain right-angle segments.
  if (tooShort || hints.length > 0) { segment(edge, sourceShape, targetShape, hints, result); return; }
  const portConstraint = [15, 15];
  if (source) {
    portConstraint[0] = portConstraints(source, edge, true, 15);
    const rotation = numberOf(source.style, 'rotation', 0);
    if (rotation !== 0) sourceBox = turnedBounds(sourceBox, rotation);
  }
  if (target) {
    portConstraint[1] = portConstraints(target, edge, false, 15);
    const rotation = numberOf(target.style, 'rotation', 0);
    if (rotation !== 0) targetBox = turnedBounds(targetBox, rotation);
  }
  if (sourceBox.width === 0 || sourceBox.height === 0 || targetBox.width === 0 || targetBox.height === 0) return;
  const dir = [0, 0];
  const geo = [[sourceBox.x, sourceBox.y, sourceBox.width, sourceBox.height], [targetBox.x, targetBox.y, targetBox.width, targetBox.height]] as const;
  const buffer = [sourceBuffer, targetBuffer];
  const limits: number[][] = [[], []];
  for (let i = 0; i < 2; i += 1) {
    limits[i]![1] = geo[i]![0] - buffer[i]!;
    limits[i]![2] = geo[i]![1] - buffer[i]!;
    limits[i]![4] = geo[i]![0] + geo[i]![2] + buffer[i]!;
    limits[i]![8] = geo[i]![1] + geo[i]![3] + buffer[i]!;
  }
  const dx = geo[0][0] + geo[0][2] / 2 - (geo[1][0] + geo[1][2] / 2);
  const dy = geo[0][1] + geo[0][3] / 2 - (geo[1][1] + geo[1][3] / 2);
  let quad = 0;
  if (dx < 0) quad = dy < 0 ? 2 : 1;
  else if (dy <= 0) quad = dx === 0 ? 2 : 3;
  // Where a pinned end sits on its shape, as fractions; an end on a side fixes the side it leaves by.
  const constraint = [[0.5, 0.5], [0.5, 0.5]];
  let currentTerm = source ? p0 : null;
  for (let i = 0; i < 2; i += 1) {
    if (currentTerm) {
      constraint[i]![0] = (currentTerm.x - geo[i]![0]) / geo[i]![2];
      if (Math.abs(currentTerm.x - geo[i]![0]) <= 1) dir[i] = WEST;
      else if (Math.abs(currentTerm.x - geo[i]![0] - geo[i]![2]) <= 1) dir[i] = EAST;
      constraint[i]![1] = (currentTerm.y - geo[i]![1]) / geo[i]![3];
      if (Math.abs(currentTerm.y - geo[i]![1]) <= 1) dir[i] = NORTH;
      else if (Math.abs(currentTerm.y - geo[i]![1] - geo[i]![3]) <= 1) dir[i] = SOUTH;
    }
    currentTerm = target ? pe : null;
  }
  const sourceTopDist = geo[0][1] - (geo[1][1] + geo[1][3]);
  const sourceLeftDist = geo[0][0] - (geo[1][0] + geo[1][2]);
  const sourceBottomDist = geo[1][1] - (geo[0][1] + geo[0][3]);
  const sourceRightDist = geo[1][0] - (geo[0][0] + geo[0][2]);
  const separations: number[] = [];
  separations[1] = Math.max(sourceLeftDist - totalBuffer, 0);
  separations[2] = Math.max(sourceTopDist - totalBuffer, 0);
  separations[4] = Math.max(sourceBottomDist - totalBuffer, 0);
  separations[3] = Math.max(sourceRightDist - totalBuffer, 0);
  const dirPref: number[] = [];
  const horPref: number[] = [];
  const vertPref: number[] = [];
  horPref[0] = sourceLeftDist >= sourceRightDist ? WEST : EAST;
  vertPref[0] = sourceTopDist >= sourceBottomDist ? NORTH : SOUTH;
  horPref[1] = reversePortConstraints(horPref[0]);
  vertPref[1] = reversePortConstraints(vertPref[0]);
  const preferredHorizDist = sourceLeftDist >= sourceRightDist ? sourceLeftDist : sourceRightDist;
  const preferredVertDist = sourceTopDist >= sourceBottomDist ? sourceTopDist : sourceBottomDist;
  const prefOrdering = [[0, 0], [0, 0]];
  let preferredOrderSet = false;
  for (let i = 0; i < 2; i += 1) {
    if (dir[i] !== 0) continue;
    if ((horPref[i]! & portConstraint[i]!) === 0) horPref[i] = reversePortConstraints(horPref[i]!);
    if ((vertPref[i]! & portConstraint[i]!) === 0) vertPref[i] = reversePortConstraints(vertPref[i]!);
    prefOrdering[i]![0] = vertPref[i]!;
    prefOrdering[i]![1] = horPref[i]!;
  }
  const order = (a0: number, a1: number, b0: number, b1: number) => { prefOrdering[0]![0] = a0; prefOrdering[0]![1] = a1; prefOrdering[1]![0] = b0; prefOrdering[1]![1] = b1; };
  if (preferredVertDist > 0 && preferredHorizDist > 0) {
    if ((horPref[0]! & portConstraint[0]!) > 0 && (vertPref[1]! & portConstraint[1]!) > 0) { order(horPref[0]!, vertPref[0]!, vertPref[1]!, horPref[1]!); preferredOrderSet = true; }
    else if ((vertPref[0]! & portConstraint[0]!) > 0 && (horPref[1]! & portConstraint[1]!) > 0) { order(vertPref[0]!, horPref[0]!, horPref[1]!, vertPref[1]!); preferredOrderSet = true; }
  }
  if (preferredVertDist > 0 && !preferredOrderSet) { order(vertPref[0]!, horPref[0]!, vertPref[1]!, horPref[1]!); preferredOrderSet = true; }
  if (preferredHorizDist > 0 && !preferredOrderSet) order(horPref[0]!, vertPref[0]!, horPref[1]!, vertPref[1]!);
  for (let i = 0; i < 2; i += 1) {
    if (dir[i] !== 0) continue;
    if ((prefOrdering[i]![0]! & portConstraint[i]!) === 0) prefOrdering[i]![0] = prefOrdering[i]![1]!;
    dirPref[i] = prefOrdering[i]![0]! & portConstraint[i]!;
    dirPref[i]! |= (prefOrdering[i]![1]! & portConstraint[i]!) << 8;
    dirPref[i]! |= (prefOrdering[1 - i]![i]! & portConstraint[i]!) << 16;
    dirPref[i]! |= (prefOrdering[1 - i]![1 - i]! & portConstraint[i]!) << 24;
    if ((dirPref[i]! & 0xf) === 0) dirPref[i] = dirPref[i]! << 8;
    if ((dirPref[i]! & 0xf00) === 0) dirPref[i] = (dirPref[i]! & 0xf) | (dirPref[i]! >> 8);
    if ((dirPref[i]! & 0xf0000) === 0) dirPref[i] = (dirPref[i]! & 0xffff) | ((dirPref[i]! & 0xf000000) >> 8);
    dir[i] = dirPref[i]! & 0xf;
    const only = portConstraint[i]!;
    if (only === WEST || only === NORTH || only === EAST || only === SOUTH) dir[i] = only;
  }
  let sourceIndex = dir[0] === EAST ? 3 : dir[0]!;
  let targetIndex = dir[1] === EAST ? 3 : dir[1]!;
  sourceIndex -= quad;
  targetIndex -= quad;
  if (sourceIndex < 1) sourceIndex += 4;
  if (targetIndex < 1) targetIndex += 4;
  const pattern = ROUTE_PATTERNS[sourceIndex - 1]?.[targetIndex - 1];
  if (!pattern) return;
  const way: [number, number][] = [[geo[0][0], geo[0][1]]];
  switch (dir[0]) {
    case WEST: way[0]![0] -= sourceBuffer; way[0]![1] += constraint[0]![1]! * geo[0][3]; break;
    case SOUTH: way[0]![0] += constraint[0]![0]! * geo[0][2]; way[0]![1] += geo[0][3] + sourceBuffer; break;
    case EAST: way[0]![0] += geo[0][2] + sourceBuffer; way[0]![1] += constraint[0]![1]! * geo[0][3]; break;
    case NORTH: way[0]![0] += constraint[0]![0]! * geo[0][2]; way[0]![1] -= sourceBuffer; break;
    default:
  }
  let currentIndex = 0;
  let lastOrientation = (dir[0]! & (EAST | WEST)) > 0 ? 0 : 1;
  const initialOrientation = lastOrientation;
  for (const step of pattern) {
    const nextDirection = step & 0xf;
    let directionIndex = nextDirection === EAST ? 3 : nextDirection;
    directionIndex += quad;
    if (directionIndex > 4) directionIndex -= 4;
    const direction = DIR_VECTORS[directionIndex - 1]!;
    const currentOrientation = directionIndex % 2 > 0 ? 0 : 1;
    if (currentOrientation !== lastOrientation) {
      currentIndex += 1;
      way[currentIndex] = [way[currentIndex - 1]![0], way[currentIndex - 1]![1]];
    }
    const tar = (step & TARGET_MASK) > 0;
    const sou = (step & SOURCE_MASK) > 0;
    let side = (step & SIDE_MASK) >> 5;
    side <<= quad;
    if (side > 0xf) side >>= 4;
    const center = (step & CENTER_MASK) > 0;
    if ((sou || tar) && side < 9) {
      const index = sou ? 0 : 1;
      const limit = center && currentOrientation === 0 ? geo[index]![0] + constraint[index]![0]! * geo[index]![2]
        : center ? geo[index]![1] + constraint[index]![1]! * geo[index]![3] : limits[index]![side]!;
      const delta = (limit - way[currentIndex]![currentOrientation]!) * direction[currentOrientation]!;
      if (delta > 0) way[currentIndex]![currentOrientation]! += direction[currentOrientation]! * delta;
    } else if (center) {
      way[currentIndex]![0] += direction[0] * Math.abs(separations[directionIndex]! / 2);
      way[currentIndex]![1] += direction[1] * Math.abs(separations[directionIndex]! / 2);
    }
    if (currentIndex > 0 && way[currentIndex]![currentOrientation] === way[currentIndex - 1]![currentOrientation]) currentIndex -= 1;
    else lastOrientation = currentOrientation;
  }
  for (let i = 0; i <= currentIndex; i += 1) {
    if (i === currentIndex) {
      const targetOrientation = (dir[1]! & (EAST | WEST)) > 0 ? 0 : 1;
      const sameOrient = targetOrientation === initialOrientation ? 0 : 1;
      if (sameOrient !== (currentIndex + 1) % 2) break;
    }
    result.push({ x: tenth(way[i]![0]), y: tenth(way[i]![1]) });
  }
  for (let index = 1; index < result.length; ) {
    const [before, here] = [result[index - 1], result[index]];
    if (!before || !here || before.x !== here.x || before.y !== here.y) index += 1;
    else result.splice(index, 1);
  }
};

const ISO_RIGHT = { x: Math.cos(-Math.PI / 6), y: Math.sin(-Math.PI / 6) };
const ISO_LEFT = { x: Math.cos((-5 * Math.PI) / 6), y: Math.sin((-5 * Math.PI) / 6) };

/** draw.io's isometric router: runs along the two 30° axes, through the saved bend or the ends' midpoint. */
export const isometric: Router = (edge, source, target, hints, result) => {
  const centre = (box: RouteBox) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const p0 = edge.absolutePoints[0] ?? (source ? centre(source) : null);
  const pe = edge.absolutePoints.at(-1) ?? (target ? centre(target) : null);
  if (!p0 || !pe) return;
  const flat = (styleOf(edge.style, 'elbow') ?? 'horizontal') === 'horizontal';
  let last = p0;
  const lineTo = (x: number, y: number, both: boolean) => {
    const [dx, dy] = [x - last.x, y - last.y];
    const right = (ISO_LEFT.y * dx - ISO_LEFT.x * dy) / (ISO_RIGHT.x * ISO_LEFT.y - ISO_RIGHT.y * ISO_LEFT.x);
    const left = (ISO_RIGHT.y * dx - ISO_RIGHT.x * dy) / (ISO_RIGHT.y * ISO_LEFT.x - ISO_RIGHT.x * ISO_LEFT.y);
    const [first, second] = flat ? [[ISO_RIGHT, right], [ISO_LEFT, left]] as const : [[ISO_LEFT, left], [ISO_RIGHT, right]] as const;
    if (both) { last = { x: last.x + first[0].x * first[1], y: last.y + first[0].y * first[1] }; result.push(last); }
    last = { x: last.x + second[0].x * second[1], y: last.y + second[0].y * second[1] };
    result.push(last);
  };
  const through = hints.length ? toPage(edge, hints[0]!) : { x: p0.x + (pe.x - p0.x) / 2, y: p0.y + (pe.y - p0.y) / 2 };
  lineTo(through.x, through.y, true);
  lineTo(pe.x, pe.y, false);
};
