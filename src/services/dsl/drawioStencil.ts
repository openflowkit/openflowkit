import type { Point2d } from '../../opencanvas/domain/geometry/types';
import type { JsonObject } from '../../opencanvas/domain/document/json';
import { inflate, num, type Cell } from './drawioCells';
import { drawioLine, type DrawioStyle } from './drawioStyle';
import { parseXml, type XmlElement } from './xmlReader';

// draw.io keeps a freehand line as a stencil shape (`shape=stencil(...)` with `lineShape=1`): a path on the
// stencil's own grid (0–100 unless it says `w`/`h`), stretched over the cell. Read back, it is a pen stroke.

/**
 * Each stroke's points as fractions of its cell's box, or null when the stencil isn't freehand. draw.io marks a
 * freehand line `lineShape=1`; its older freehand wrote the same stencil unfilled and unmarked, never closed.
 */
export async function drawioFreehand(style: DrawioStyle): Promise<readonly (readonly Point2d[])[] | null> {
  const packed = /^stencil\((.*)\)$/s.exec(style.shape ?? '')?.[1];
  const marked = style.lineShape === '1';
  if (!packed || (!marked && style.fillColor !== 'none')) return null;
  let xml: string;
  try {
    xml = await inflate(packed);
  } catch {
    return null;
  }
  const parsed = parseXml(xml);
  if ('error' in parsed || parsed.root.name !== 'shape') return null;
  const width = num(parsed.root.attributes.w, 100) || 100;
  const height = num(parsed.root.attributes.h, 100) || 100;
  const paths = (parsed.root.children.find((child) => child.name === 'foreground')?.children ?? []).filter((child) => child.name === 'path');
  const lines: Point2d[][] = [];
  // ponytail: a curve keeps only its end point; draw.io's freehand writes lines only.
  for (const path of paths) {
    for (const step of path.children as readonly XmlElement[]) {
      if (step.name === 'close') { if (marked) continue; return null; }
      if (!['move', 'line', 'curve', 'quad'].includes(step.name)) return null;
      if (step.name === 'move' || !lines.length) lines.push([]);
      lines[lines.length - 1]!.push({ x: num(step.attributes.x) / width, y: num(step.attributes.y) / height });
    }
  }
  const strokes = lines.filter((line) => line.length >= 2);
  return strokes.length ? strokes : null;
}

/** Every freehand line on a page, read ahead since stencils inflate asynchronously: cell id → its strokes. */
export async function drawioFreehands(cells: readonly Cell[]): Promise<ReadonlyMap<string, readonly (readonly Point2d[])[]>> {
  const lines = new Map<string, readonly (readonly Point2d[])[]>();
  for (const cell of cells) {
    if (!cell.vertex || !cell.style.shape?.startsWith('stencil(')) continue;
    const line = await drawioFreehand(cell.style);
    if (line) lines.set(cell.id, line);
  }
  return lines;
}

/** A pen node's content for a line over a `width`×`height` box; draw.io's default black is left to the theme. */
export function freehandContent(line: readonly Point2d[], style: DrawioStyle, width: number, height: number): JsonObject {
  const ink = drawioLine(style.strokeColor);
  const points = line.map((point) => ({ x: point.x * width, y: point.y * height }));
  const middle = centreLine(points);
  return {
    points: (middle?.points ?? points).map(({ x, y }) => ({ x, y })),
    ...(ink && ink !== 'transparent' ? { strokeColor: ink } : {}),
    strokeWidth: middle?.width ?? num(style.strokeWidth, 1),
  };
}

const gap = (a: Point2d, b: Point2d) => Math.hypot(a.x - b.x, a.y - b.y);

/** The nearest point to `point` on the polyline `path`. */
function nearestOn(path: readonly Point2d[], point: Point2d): Point2d {
  let best = path[0]!;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]!;
    const b = path[index]!;
    const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = length ? Math.min(1, Math.max(0, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length)) : 0;
    const at = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    if (gap(at, point) < gap(best, point)) best = at;
  }
  return best;
}

/**
 * draw.io saves a pen stroke as its filled outline: out along one edge, round the far end, back along the other to
 * where it began. Its middle at the edges' distance apart is the stroke. Null when the path doesn't close.
 * ponytail: one width for the whole stroke; draw.io's pressure tapers it — keep per-point widths if that shows.
 */
function centreLine(points: readonly Point2d[]): { points: Point2d[]; width: number } | null {
  const ring = points.length > 1 && gap(points[0]!, points[points.length - 1]!) < 1e-6 ? points.slice(0, -1) : null;
  if (!ring || ring.length < 4) return null;
  let far = 0;
  ring.forEach((point, index) => { if (gap(point, ring[0]!) > gap(ring[far]!, ring[0]!)) far = index; });
  // The far end is a short cap from the outgoing edge to the returning one, on whichever side of `far` is nearer.
  const end = far > 0 && gap(ring[far - 1]!, ring[far]!) <= gap(ring[far]!, ring[(far + 1) % ring.length]!) ? far - 1 : far;
  const out = ring.slice(0, end + 1);
  const back = ring.slice(end + 1);
  if (out.length < 2 || back.length < 2) return null;
  const gaps: number[] = [];
  const middle = out.map((point) => {
    const across = nearestOn(back, point);
    gaps.push(gap(point, across));
    return { x: (point.x + across.x) / 2, y: (point.y + across.y) / 2 };
  });
  gaps.sort((a, b) => a - b);
  return { points: middle, width: Math.max(0.5, Math.round(gaps[Math.floor(gaps.length / 2)]! * 100) / 100) };
}
