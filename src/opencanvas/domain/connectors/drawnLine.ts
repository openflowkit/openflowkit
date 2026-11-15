import type { JsonObject } from '../document/json';
import type { SceneConnector } from '../document/types';
import type { Point2d } from '../geometry/types';
import type { DrawnPart, DrawnPathCommand } from '../nodes/drawnShape';

// A line draw.io draws with a shape of its own (a block arrow, a lightning link, a pipe): the connector keeps the
// draw.io style that names it and the parts that code drew along its points at import (`extensions.drawioLine`).
// Where the app has draw.io's code (`provideDrawnLines`) the line is redrawn along its route as it is now; elsewhere
// the saved parts are drawn while the route keeps its shape (moved whole, they move with it), and a line whose route
// changed is drawn plain.

export interface DrawnLine {
  /** The draw.io style the line is drawn by. */
  readonly style: Readonly<Record<string, string>>;
  /** The colour a part's 'fill' is: the line's own fill in draw.io (ours has none). */
  readonly fill: string;
  readonly points: readonly Point2d[];
  readonly parts: readonly DrawnPart[];
  /**
   * How an ordinary line (draw.io's connector, drawn for its exact ends) looked when imported. Once its width, dash or
   * ends are changed here it is no longer draw.io's line, and is drawn as ours. A shaped line (a block arrow) has none.
   */
  readonly look?: DrawnLineLook;
}

export interface DrawnLineLook {
  readonly width: number;
  readonly dash: readonly number[];
  readonly start: readonly string[];
  readonly end: readonly string[];
}

const same = (a: readonly (number | string)[], b: readonly (number | string)[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Whether a line still looks as it did when imported: unset (a shaped line) always does. */
export function keepsLook(look: DrawnLineLook | undefined, now: DrawnLineLook): boolean {
  return !look || (look.width === now.width && same(look.dash, now.dash) && same(look.start, now.start) && same(look.end, now.end));
}

export type DrawnLineSource = (style: Readonly<Record<string, string>>, points: readonly Point2d[]) => readonly DrawnPart[] | null;

let source: DrawnLineSource | null = null;
const cache = new Map<string, readonly DrawnPart[]>();

/** Hands drawing lines to draw.io's own code; their parts are then drawn along each line's route. */
export function provideDrawnLines(draw: DrawnLineSource | null): void {
  source = draw;
  cache.clear();
}

/** The draw.io line a connector is drawn as, or null for an ordinary line. */
export function drawnLineOf(connector: Pick<SceneConnector, 'extensions'>): DrawnLine | null {
  const line = connector.extensions.drawioLine as JsonObject | undefined;
  if (!line || typeof line !== 'object' || Array.isArray(line)) return null;
  const { style, fill, points, parts, look } = line as unknown as Partial<DrawnLine>;
  if (!style || typeof style !== 'object' || typeof fill !== 'string' || !Array.isArray(points) || !Array.isArray(parts)) return null;
  return { style, fill, points, parts, ...(look && typeof look === 'object' ? { look } : {}) };
}

const shift = (command: DrawnPathCommand, dx: number, dy: number): DrawnPathCommand => {
  switch (command.kind) {
    case 'close': return command;
    case 'quad': return { ...command, x1: command.x1 + dx, y1: command.y1 + dy, x: command.x + dx, y: command.y + dy };
    case 'cubic': return { ...command, x1: command.x1 + dx, y1: command.y1 + dy, x2: command.x2 + dx, y2: command.y2 + dy, x: command.x + dx, y: command.y + dy };
    default: return { ...command, x: command.x + dx, y: command.y + dy };
  }
};

/** The saved parts, when the route is the saved one moved whole; null once its shape changed, or when none were saved. */
function savedParts(line: DrawnLine, points: readonly Point2d[]): readonly DrawnPart[] | null {
  if (points.length !== line.points.length || points.length === 0 || line.parts.length === 0) return null;
  const dx = points[0]!.x - line.points[0]!.x;
  const dy = points[0]!.y - line.points[0]!.y;
  const moved = points.every((point, index) => Math.abs(point.x - line.points[index]!.x - dx) < 0.01 && Math.abs(point.y - line.points[index]!.y - dy) < 0.01);
  if (!moved) return null;
  return dx === 0 && dy === 0 ? line.parts : line.parts.map((part) => ({ ...part, path: part.path.map((command) => shift(command, dx, dy)) }));
}

/** The parts a draw.io line shows along `points` (its route now, on the page), or null to draw it as a plain line. */
export function drawnLineParts(line: DrawnLine, points: readonly Point2d[]): readonly DrawnPart[] | null {
  if (source && points.length > 1) {
    const key = `${JSON.stringify(line.style)}|${points.map((point) => `${point.x},${point.y}`).join(' ')}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const drawn = source(line.style, points);
    if (drawn) {
      if (cache.size > 2048) cache.clear();
      cache.set(key, drawn);
      return drawn;
    }
  }
  return savedParts(line, points);
}
