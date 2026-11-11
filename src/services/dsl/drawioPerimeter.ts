import type { Point2d } from '../../opencanvas/domain/geometry/types';

// Where a line aimed at a shape stops on its outline: a port of draw.io's mxPerimeter (and the three draw.io adds).
// `next` is the point the line comes from; `orthogonal` asks for a square hit (a right-angle line's end) where the
// shape's box allows one. Each returns null where draw.io's does, and the caller then takes the shape's centre.

export interface PerimeterBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface PerimeterShape { readonly direction?: string; readonly strokeWidth?: number; readonly backboneSize?: number }
export type Perimeter = (bounds: PerimeterBox, shape: PerimeterShape, next: Point2d, orthogonal: boolean) => Point2d | null;

/** Where the segment a→b crosses the segment c→d, as mxUtils.intersection. */
export function intersection(a: Point2d, b: Point2d, c: Point2d, d: Point2d): Point2d | null {
  const denominator = (d.y - c.y) * (b.x - a.x) - (d.x - c.x) * (b.y - a.y);
  const ua = ((d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x)) / denominator;
  const ub = ((b.x - a.x) * (a.y - c.y) - (b.y - a.y) * (a.x - c.x)) / denominator;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1 ? { x: a.x + ua * (b.x - a.x), y: a.y + ua * (b.y - a.y) } : null;
}

const rectangle: Perimeter = (bounds, _shape, next, orthogonal) => {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const alpha = Math.atan2(next.y - cy, next.x - cx);
  const beta = Math.PI / 2 - alpha;
  const corner = Math.atan2(bounds.height, bounds.width);
  const point = { x: 0, y: 0 };
  if (alpha < -Math.PI + corner || alpha > Math.PI - corner) { point.x = bounds.x; point.y = cy - (bounds.width * Math.tan(alpha)) / 2; }
  else if (alpha < -corner) { point.y = bounds.y; point.x = cx - (bounds.height * Math.tan(beta)) / 2; }
  else if (alpha < corner) { point.x = bounds.x + bounds.width; point.y = cy + (bounds.width * Math.tan(alpha)) / 2; }
  else { point.y = bounds.y + bounds.height; point.x = cx + (bounds.height * Math.tan(beta)) / 2; }
  if (orthogonal) {
    if (next.x >= bounds.x && next.x <= bounds.x + bounds.width) point.x = next.x;
    else if (next.y >= bounds.y && next.y <= bounds.y + bounds.height) point.y = next.y;
    if (next.x < bounds.x) point.x = bounds.x;
    else if (next.x > bounds.x + bounds.width) point.x = bounds.x + bounds.width;
    if (next.y < bounds.y) point.y = bounds.y;
    else if (next.y > bounds.y + bounds.height) point.y = bounds.y + bounds.height;
  }
  return point;
};

const ellipse: Perimeter = (bounds, _shape, next, orthogonal) => {
  const { x, y } = bounds;
  const a = bounds.width / 2;
  const b = bounds.height / 2;
  const cx = x + a;
  const cy = y + b;
  const px = next.x;
  const py = next.y;
  // draw.io truncates the offsets (parseInt), so a point within a pixel of the centre line counts as on it.
  const dx = Math.trunc(px - cx);
  const dy = Math.trunc(py - cy);
  if (dx === 0 && dy !== 0) return { x: cx, y: cy + (b * dy) / Math.abs(dy) };
  if (dx === 0 && dy === 0) return { x: px, y: py };
  if (orthogonal) {
    if (py >= y && py <= y + bounds.height) {
      const ty = py - cy;
      let tx = Math.sqrt(a * a * (1 - (ty * ty) / (b * b))) || 0;
      if (px <= x) tx = -tx;
      return { x: cx + tx, y: py };
    }
    if (px >= x && px <= x + bounds.width) {
      const tx = px - cx;
      let ty = Math.sqrt(b * b * (1 - (tx * tx) / (a * a))) || 0;
      if (py <= y) ty = -ty;
      return { x: px, y: cy + ty };
    }
  }
  // The line from the centre to the point, crossed with the ellipse: the nearer of the two crossings.
  const d = dy / dx;
  const h = cy - d * cx;
  const e = a * a * d * d + b * b;
  const f = -2 * cx * e;
  const g = a * a * d * d * cx * cx + b * b * cx * cx - a * a * b * b;
  const det = Math.sqrt(f * f - 4 * e * g);
  const xout1 = (-f + det) / (2 * e);
  const xout2 = (-f - det) / (2 * e);
  const yout1 = d * xout1 + h;
  const yout2 = d * xout2 + h;
  return Math.hypot(xout1 - px, yout1 - py) < Math.hypot(xout2 - px, yout2 - py) ? { x: xout1, y: yout1 } : { x: xout2, y: yout2 };
};

const rhombus: Perimeter = (bounds, _shape, next, orthogonal) => {
  const { x, y, width: w, height: h } = bounds;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const px = next.x;
  const py = next.y;
  if (cx === px) return cy > py ? { x: cx, y } : { x: cx, y: y + h };
  if (cy === py) return cx > px ? { x, y: cy } : { x: x + w, y: cy };
  let tx = cx;
  let ty = cy;
  if (orthogonal) {
    if (px >= x && px <= x + w) tx = px;
    else if (py >= y && py <= y + h) ty = py;
  }
  const from = { x: px, y: py };
  const to = { x: tx, y: ty };
  if (px < cx) return py < cy ? intersection(from, to, { x: cx, y }, { x, y: cy }) : intersection(from, to, { x: cx, y: y + h }, { x, y: cy });
  return py < cy ? intersection(from, to, { x: cx, y }, { x: x + w, y: cy }) : intersection(from, to, { x: cx, y: y + h }, { x: x + w, y: cy });
};

const triangle: Perimeter = (bounds, shape, next, orthogonal) => {
  const direction = shape.direction;
  const vertical = direction === 'north' || direction === 'south';
  const { x, y, width: w, height: h } = bounds;
  let cx = x + w / 2;
  let cy = y + h / 2;
  let start = { x, y };
  let corner = { x: x + w, y: cy };
  let end = { x, y: y + h };
  if (direction === 'north') { start = end; corner = { x: cx, y }; end = { x: x + w, y: y + h }; }
  else if (direction === 'south') { corner = { x: cx, y: y + h }; end = { x: x + w, y }; }
  else if (direction === 'west') { start = { x: x + w, y }; corner = { x, y: cy }; end = { x: x + w, y: y + h }; }
  const dx = next.x - cx;
  const dy = next.y - cy;
  const alpha = vertical ? Math.atan2(dx, dy) : Math.atan2(dy, dx);
  const t = vertical ? Math.atan2(w, h) : Math.atan2(h, w);
  const base = direction === 'north' || direction === 'west' ? alpha > -t && alpha < t : alpha < -Math.PI + t || alpha > Math.PI - t;
  let result: Point2d | null;
  if (base) {
    if (orthogonal && ((vertical && next.x >= start.x && next.x <= end.x) || (!vertical && next.y >= start.y && next.y <= end.y))) {
      result = vertical ? { x: next.x, y: start.y } : { x: start.x, y: next.y };
    } else if (direction === 'north') result = { x: x + w / 2 + (h * Math.tan(alpha)) / 2, y: y + h };
    else if (direction === 'south') result = { x: x + w / 2 - (h * Math.tan(alpha)) / 2, y };
    else if (direction === 'west') result = { x: x + w, y: y + h / 2 + (w * Math.tan(alpha)) / 2 };
    else result = { x, y: y + h / 2 - (w * Math.tan(alpha)) / 2 };
  } else {
    if (orthogonal) {
      const point = { x: cx, y: cy };
      if (next.y >= y && next.y <= y + h) { point.x = vertical ? cx : direction === 'west' ? x + w : x; point.y = next.y; }
      else if (next.x >= x && next.x <= x + w) { point.x = next.x; point.y = !vertical ? cy : direction === 'north' ? y + h : y; }
      cx = point.x;
      cy = point.y;
    }
    result = (vertical && next.x <= x + w / 2) || (!vertical && next.y <= y + h / 2)
      ? intersection(next, { x: cx, y: cy }, start, corner)
      : intersection(next, { x: cx, y: cy }, corner, end);
  }
  return result ?? { x: cx, y: cy };
};

const hexagon: Perimeter = (bounds, shape, next, orthogonalAsked) => {
  const { x, y, width: w, height: h } = bounds;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const px = next.x;
  const py = next.y;
  const alpha = -Math.atan2(py - cy, px - cx);
  const pi = Math.PI;
  const pi2 = Math.PI / 2;
  const vertical = shape.direction === 'north' || shape.direction === 'south';
  let a: Point2d = { x: 0, y: 0 };
  let b: Point2d = { x: 0, y: 0 };
  const floor = Math.floor;
  // Only a point straight across from the box can be met square on.
  const orthogonal = orthogonalAsked && !((px < x && py < y) || (px < x && py > y + h) || (px > x + w && py < y) || (px > x + w && py > y + h));
  let result: Point2d | null;
  if (orthogonal) {
    if (vertical) {
      if (px === cx) { if (py <= y) return { x: cx, y }; if (py >= y + h) return { x: cx, y: y + h }; }
      else if (px < x) { if (py === y + h / 4) return { x, y: y + h / 4 }; if (py === y + (3 * h) / 4) return { x, y: y + (3 * h) / 4 }; }
      else if (px > x + w) { if (py === y + h / 4) return { x: x + w, y: y + h / 4 }; if (py === y + (3 * h) / 4) return { x: x + w, y: y + (3 * h) / 4 }; }
      else if (px === x) { if (py < cy) return { x, y: y + h / 4 }; if (py > cy) return { x, y: y + (3 * h) / 4 }; }
      else if (px === x + w) { if (py < cy) return { x: x + w, y: y + h / 4 }; if (py > cy) return { x: x + w, y: y + (3 * h) / 4 }; }
      if (py === y) return { x: cx, y };
      if (py === y + h) return { x: cx, y: y + h };
      if (px < cx) {
        if (py > y + h / 4 && py < y + (3 * h) / 4) { a = { x, y }; b = { x, y: y + h }; }
        else if (py < y + h / 4) { a = { x: x - floor(0.5 * w), y: y + floor(0.5 * h) }; b = { x: x + w, y: y - floor(0.25 * h) }; }
        else if (py > y + (3 * h) / 4) { a = { x: x - floor(0.5 * w), y: y + floor(0.5 * h) }; b = { x: x + w, y: y + floor(1.25 * h) }; }
      } else if (px > cx) {
        if (py > y + h / 4 && py < y + (3 * h) / 4) { a = { x: x + w, y }; b = { x: x + w, y: y + h }; }
        else if (py < y + h / 4) { a = { x, y: y - floor(0.25 * h) }; b = { x: x + floor(1.5 * w), y: y + floor(0.5 * h) }; }
        else if (py > y + (3 * h) / 4) { a = { x: x + floor(1.5 * w), y: y + floor(0.5 * h) }; b = { x, y: y + floor(1.25 * h) }; }
      }
    } else {
      if (py === cy) { if (px <= x) return { x, y: y + h / 2 }; if (px >= x + w) return { x: x + w, y: y + h / 2 }; }
      else if (py < y) { if (px === x + w / 4) return { x: x + w / 4, y }; if (px === x + (3 * w) / 4) return { x: x + (3 * w) / 4, y }; }
      else if (py > y + h) { if (px === x + w / 4) return { x: x + w / 4, y: y + h }; if (px === x + (3 * w) / 4) return { x: x + (3 * w) / 4, y: y + h }; }
      else if (py === y) { if (px < cx) return { x: x + w / 4, y }; if (px > cx) return { x: x + (3 * w) / 4, y }; }
      else if (py === y + h) { if (px < cx) return { x: x + w / 4, y: y + h }; if (py > cy) return { x: x + (3 * w) / 4, y: y + h }; }
      if (px === x) return { x, y: cy };
      if (px === x + w) return { x: x + w, y: cy };
      if (py < cy) {
        if (px > x + w / 4 && px < x + (3 * w) / 4) { a = { x, y }; b = { x: x + w, y }; }
        else if (px < x + w / 4) { a = { x: x - floor(0.25 * w), y: y + h }; b = { x: x + floor(0.5 * w), y: y - floor(0.5 * h) }; }
        else if (px > x + (3 * w) / 4) { a = { x: x + floor(0.5 * w), y: y - floor(0.5 * h) }; b = { x: x + floor(1.25 * w), y: y + h }; }
      } else if (py > cy) {
        if (px > x + w / 4 && px < x + (3 * w) / 4) { a = { x, y: y + h }; b = { x: x + w, y: y + h }; }
        else if (px < x + w / 4) { a = { x: x - floor(0.25 * w), y }; b = { x: x + floor(0.5 * w), y: y + floor(1.5 * h) }; }
        else if (px > x + (3 * w) / 4) { a = { x: x + floor(0.5 * w), y: y + floor(1.5 * h) }; b = { x: x + floor(1.25 * w), y }; }
      }
    }
    let tx = cx;
    let ty = cy;
    if (px >= x && px <= x + w) { tx = px; ty = py < cy ? y + h : y; }
    else if (py >= y && py <= y + h) { ty = py; tx = px < cx ? x + w : x; }
    result = intersection({ x: tx, y: ty }, next, a, b);
  } else {
    if (vertical) {
      const beta = Math.atan2(h / 4, w / 2);
      if (alpha === beta) return { x: x + w, y: y + floor(0.25 * h) };
      if (alpha === pi2) return { x: x + floor(0.5 * w), y };
      if (alpha === pi - beta) return { x, y: y + floor(0.25 * h) };
      if (alpha === -beta) return { x: x + w, y: y + floor(0.75 * h) };
      if (alpha === -pi2) return { x: x + floor(0.5 * w), y: y + h };
      if (alpha === -pi + beta) return { x, y: y + floor(0.75 * h) };
      if (alpha < beta && alpha > -beta) { a = { x: x + w, y }; b = { x: x + w, y: y + h }; }
      else if (alpha > beta && alpha < pi2) { a = { x, y: y - floor(0.25 * h) }; b = { x: x + floor(1.5 * w), y: y + floor(0.5 * h) }; }
      else if (alpha > pi2 && alpha < pi - beta) { a = { x: x - floor(0.5 * w), y: y + floor(0.5 * h) }; b = { x: x + w, y: y - floor(0.25 * h) }; }
      else if ((alpha > pi - beta && alpha <= pi) || (alpha < -pi + beta && alpha >= -pi)) { a = { x, y }; b = { x, y: y + h }; }
      else if (alpha < -beta && alpha > -pi2) { a = { x: x + floor(1.5 * w), y: y + floor(0.5 * h) }; b = { x, y: y + floor(1.25 * h) }; }
      else if (alpha < -pi2 && alpha > -pi + beta) { a = { x: x - floor(0.5 * w), y: y + floor(0.5 * h) }; b = { x: x + w, y: y + floor(1.25 * h) }; }
    } else {
      const beta = Math.atan2(h / 2, w / 4);
      if (alpha === beta) return { x: x + floor(0.75 * w), y };
      if (alpha === pi - beta) return { x: x + floor(0.25 * w), y };
      if (alpha === pi || alpha === -pi) return { x, y: y + floor(0.5 * h) };
      if (alpha === 0) return { x: x + w, y: y + floor(0.5 * h) };
      if (alpha === -beta) return { x: x + floor(0.75 * w), y: y + h };
      if (alpha === -pi + beta) return { x: x + floor(0.25 * w), y: y + h };
      if (alpha > 0 && alpha < beta) { a = { x: x + floor(0.5 * w), y: y - floor(0.5 * h) }; b = { x: x + floor(1.25 * w), y: y + h }; }
      else if (alpha > beta && alpha < pi - beta) { a = { x, y }; b = { x: x + w, y }; }
      else if (alpha > pi - beta && alpha < pi) { a = { x: x - floor(0.25 * w), y: y + h }; b = { x: x + floor(0.5 * w), y: y - floor(0.5 * h) }; }
      else if (alpha < 0 && alpha > -beta) { a = { x: x + floor(0.5 * w), y: y + floor(1.5 * h) }; b = { x: x + floor(1.25 * w), y }; }
      else if (alpha < -beta && alpha > -pi + beta) { a = { x, y: y + h }; b = { x: x + w, y: y + h }; }
      else if (alpha < -pi + beta && alpha > -pi) { a = { x: x - floor(0.25 * w), y }; b = { x: x + floor(0.5 * w), y: y + floor(1.5 * h) }; }
    }
    result = intersection({ x: cx, y: cy }, next, a, b);
  }
  return result ?? { x: cx, y: cy };
};

/** A network backbone: lines stop on the bar through its middle, half its thickness off the centre line. */
const backbone: Perimeter = (bounds, shape, next) => {
  let half = (shape.strokeWidth ?? 1) / 2 - 1;
  if (shape.backboneSize !== undefined) half += shape.backboneSize / 2 - 1;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  if (shape.direction === 'south' || shape.direction === 'north') {
    if (next.x < cx) half = -1 * (half + 1);
    return { x: cx + half, y: Math.min(bounds.y + bounds.height, Math.max(bounds.y, next.y)) };
  }
  if (next.y < cy) half = -1 * (half + 1);
  return { x: Math.min(bounds.x + bounds.width, Math.max(bounds.x, next.x)), y: cy + half };
};

const PERIMETERS: Readonly<Record<string, Perimeter>> = {
  rectanglePerimeter: rectangle,
  ellipsePerimeter: ellipse,
  rhombusPerimeter: rhombus,
  trianglePerimeter: triangle,
  hexagonPerimeter: hexagon,
  orthogonalPerimeter: (bounds, shape, next) => rectangle(bounds, shape, next, true),
  centerPerimeter: (bounds) => ({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }),
  backbonePerimeter: backbone,
};

/** Outlines draw.io draws along a shape's slanted sides, not ported yet: they meet the shape's box. */
const BOXED = new Set(['parallelogramPerimeter', 'trapezoidPerimeter', 'stepPerimeter', 'calloutPerimeter', 'lifelinePerimeter', 'hexagonPerimeter2']);

/**
 * The outline function a style's `perimeter` names. Null for none or a name draw.io doesn't know: the line then
 * ends at the shape's centre, as draw.io's does.
 * ponytail: the six in BOXED meet the box — port each when the checker shows its files.
 */
export function drawioPerimeter(name: string | undefined): Perimeter | null {
  if (!name || name === 'none') return null;
  if (Object.hasOwn(PERIMETERS, name)) return PERIMETERS[name]!;
  return BOXED.has(name) ? rectangle : null;
}
