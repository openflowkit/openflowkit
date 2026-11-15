import type { JsonObject, JsonValue } from '../document/json';
import type { SceneNode } from '../document/types';
import type { Point2d } from '../geometry/types';

// A shape drawn by draw.io's own code: the node keeps the draw.io style that names it (`content.drawio`) and the
// parts that code drew at import (`content.drawioParts`, at `content.drawioSize`). Where the app has draw.io's code
// (`provideDrawnShapes`), a node is redrawn at its own size, so fixed parts (a note's fold, a tab) keep their size;
// elsewhere (headless export, before the code loads) the saved parts are scaled to the node.

export type DrawnPathCommand =
  | { readonly kind: 'move'; readonly x: number; readonly y: number }
  | { readonly kind: 'line'; readonly x: number; readonly y: number }
  | { readonly kind: 'quad'; readonly x1: number; readonly y1: number; readonly x: number; readonly y: number }
  | { readonly kind: 'cubic'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly x: number; readonly y: number }
  | { readonly kind: 'close' };

/** 'fill' and 'stroke' are the node's own colours; anything else is a colour of the shape's own. */
export type DrawnPaint = 'fill' | 'stroke' | string;

export interface DrawnPart {
  readonly path: readonly DrawnPathCommand[];
  readonly fill: DrawnPaint | null;
  readonly stroke: DrawnPaint | null;
  readonly strokeWidth: number;
  readonly dash: readonly number[];
  readonly fillOpacity: number;
  readonly strokeOpacity: number;
}

export type DrawnShapeSource = (style: Readonly<Record<string, string>>, width: number, height: number) => readonly DrawnPart[] | null;

let source: DrawnShapeSource | null = null;
const cache = new Map<string, readonly DrawnPart[]>();

/** Hands drawing to draw.io's own code; parts are then drawn at each node's size. */
export function provideDrawnShapes(draw: DrawnShapeSource | null): void {
  source = draw;
  cache.clear();
}

const isString = (value: JsonValue | undefined): value is string => typeof value === 'string';

/** The draw.io style a node is drawn by, or null for an ordinary shape. */
export function drawnShapeStyle(node: Pick<SceneNode, 'content'>): Readonly<Record<string, string>> | null {
  const style = node.content.drawio;
  if (!style || typeof style !== 'object' || Array.isArray(style) || !isString((style as JsonObject).shape)) return null;
  return style as Readonly<Record<string, string>>;
}

const scaleCommand = (command: DrawnPathCommand, sx: number, sy: number): DrawnPathCommand => {
  switch (command.kind) {
    case 'close': return command;
    case 'quad': return { ...command, x1: command.x1 * sx, y1: command.y1 * sy, x: command.x * sx, y: command.y * sy };
    case 'cubic': return { ...command, x1: command.x1 * sx, y1: command.y1 * sy, x2: command.x2 * sx, y2: command.y2 * sy, x: command.x * sx, y: command.y * sy };
    default: return { ...command, x: command.x * sx, y: command.y * sy };
  }
};

function savedParts(node: Pick<SceneNode, 'content' | 'size'>): readonly DrawnPart[] | null {
  const parts = node.content.drawioParts;
  const saved = node.content.drawioSize as { width?: unknown; height?: unknown } | undefined;
  if (!Array.isArray(parts)) return null;
  const sx = typeof saved?.width === 'number' && saved.width > 0 ? node.size.width / saved.width : 1;
  const sy = typeof saved?.height === 'number' && saved.height > 0 ? node.size.height / saved.height : 1;
  const typed = parts as unknown as readonly DrawnPart[];
  return sx === 1 && sy === 1 ? typed : typed.map((part) => ({ ...part, path: part.path.map((command) => scaleCommand(command, sx, sy)) }));
}

/** The parts a drawn node shows at its own size, in its own box; null for an ordinary shape. */
export function drawnShapeParts(node: Pick<SceneNode, 'content' | 'size'>): readonly DrawnPart[] | null {
  const style = drawnShapeStyle(node);
  if (!style) return null;
  if (source) {
    const key = `${JSON.stringify(style)}|${node.size.width}|${node.size.height}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const drawn = source(style, node.size.width, node.size.height);
    if (drawn) {
      if (cache.size > 2048) cache.clear();
      cache.set(key, drawn);
      return drawn;
    }
  }
  return savedParts(node);
}

/**
 * Whether a drawn shape leaves its fill colour unpainted as an area (draw.io's sketch hatches it in lines): its words
 * then sit on the canvas, not on that colour. A node with no drawing keeps its fill behind its words.
 */
export function drawnFillIsHatched(node: Pick<SceneNode, 'content'>): boolean {
  const parts = node.content.drawioParts;
  if (!Array.isArray(parts) || parts.length === 0) return false;
  const typed = parts as unknown as readonly DrawnPart[];
  return typed.some((part) => part.stroke === 'fill') && !typed.some((part) => part.fill === 'fill');
}

/** The paint a part asks for, as a colour: the node's own for 'fill' and 'stroke'. */
export function drawnPaint(paint: DrawnPaint | null, own: { readonly fill: string; readonly stroke: string }): string | null {
  if (paint === null) return null;
  if (paint === 'fill') return own.fill;
  if (paint === 'stroke') return own.stroke;
  return paint;
}

/** A path as runs of points, curves flattened into `steps` pieces each: what a painter without curves draws. */
export function flattenDrawnPath(path: readonly DrawnPathCommand[], steps = 12): { readonly points: readonly Point2d[]; readonly closed: boolean }[] {
  const runs: { points: Point2d[]; closed: boolean }[] = [];
  let run: { points: Point2d[]; closed: boolean } | null = null;
  let at: Point2d = { x: 0, y: 0 };
  let start: Point2d = at;
  const open = () => { run = { points: [at], closed: false }; runs.push(run); return run; };
  for (const command of path) {
    if (command.kind === 'move') { at = { x: command.x, y: command.y }; start = at; open(); continue; }
    const current: { points: Point2d[]; closed: boolean } = run ?? open();
    if (command.kind === 'close') { current.closed = true; at = start; run = null; continue; }
    if (command.kind === 'line') at = { x: command.x, y: command.y };
    else {
      const from = at;
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps; const u = 1 - t;
        current.points.push(command.kind === 'quad'
          ? { x: u * u * from.x + 2 * u * t * command.x1 + t * t * command.x, y: u * u * from.y + 2 * u * t * command.y1 + t * t * command.y }
          : { x: u ** 3 * from.x + 3 * u * u * t * command.x1 + 3 * u * t * t * command.x2 + t ** 3 * command.x, y: u ** 3 * from.y + 3 * u * u * t * command.y1 + 3 * u * t * t * command.y2 + t ** 3 * command.y });
      }
      at = { x: command.x, y: command.y };
      continue;
    }
    current.points.push(at);
  }
  return runs.filter((entry) => entry.points.length > 1);
}

/** A path as SVG path data, curves kept. */
export function drawnPathData(path: readonly DrawnPathCommand[], at: (point: Point2d) => Point2d = (point) => point): string {
  const n = (value: number) => Number(value.toFixed(2));
  const p = (x: number, y: number) => { const point = at({ x, y }); return `${n(point.x)} ${n(point.y)}`; };
  return path.map((command) => {
    switch (command.kind) {
      case 'move': return `M${p(command.x, command.y)}`;
      case 'line': return `L${p(command.x, command.y)}`;
      case 'quad': return `Q${p(command.x1, command.y1)} ${p(command.x, command.y)}`;
      case 'cubic': return `C${p(command.x1, command.y1)} ${p(command.x2, command.y2)} ${p(command.x, command.y)}`;
      default: return 'Z';
    }
  }).join('');
}

