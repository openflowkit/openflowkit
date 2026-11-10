import type { Point2d } from '../../opencanvas/domain/geometry/types';

/**
 * Where draw.io sets a connector's label off its line: its geometry `y` is a distance square to the line (to the
 * left of the way it runs, so above a line running right), then its `offset` point moves it in page units.
 * ponytail: the square is taken to the line from end to end; draw.io takes it to the segment the label is on —
 * walk the route's segments once routes are draw.io's own.
 */
export function besideLine(y: number, from: Point2d, to: Point2d, offset: Point2d): Point2d {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!y || !length) return { x: offset.x, y: offset.y };
  const [dx, dy] = [(to.x - from.x) / length, (to.y - from.y) / length];
  // `+ 0` turns a -0 into 0.
  return { x: Math.round((offset.x + y * dy) * 100) / 100 + 0, y: Math.round((offset.y - y * dx) * 100) / 100 + 0 };
}
