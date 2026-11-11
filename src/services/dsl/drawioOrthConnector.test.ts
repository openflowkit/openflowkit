import { describe, expect, it } from 'vitest';
import type { Point2d } from '../../opencanvas/domain/geometry/types';
import type { RouteTerminal } from './drawioEdgeStyles';
import { isometric, orthConnector } from './drawioOrthConnector';

// draw.io's right-angle router (mxEdgeStyle.OrthConnector). Boxes are 100×60: `a` at the origin, `b` level with it
// 300 to the right, `c` 300 right and 200 down.
const shape = (x: number, y: number, style: Record<string, string> = {}): RouteTerminal => ({ x, y, width: 100, height: 60, style, relativeX: null, isEdge: false });
const [a, b, c] = [shape(0, 0), shape(300, 0), shape(300, 200)];
const route = (router: typeof orthConnector, style: Record<string, string>, source: RouteTerminal | null, target: RouteTerminal | null, hints: Point2d[] = [], ends: (Point2d | null)[] = [null, null]) => {
  const result: (Point2d | null)[] = [ends[0]!];
  router({ style, origin: { x: 0, y: 0 }, absolutePoints: ends }, source, target, hints, result);
  return result.slice(1).map((point) => point && { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 });
};

describe('orthConnector', () => {
  it('adds no bend between two shapes that face each other level', () => {
    const bends = route(orthConnector, {}, a, b);
    expect(bends.every((point) => point!.y === 30)).toBe(true);
  });

  it('turns once to reach a shape below and to the right: along, then down into its top', () => {
    expect(route(orthConnector, {}, a, c)).toContainEqual({ x: 350, y: 30 });
  });

  it('leaves and enters by the pinned sides, stepping clear of each shape first', () => {
    const bends = route(orthConnector, { exitX: '0.5', exitY: '1', entryX: '0', entryY: '0.5' }, a, c, [], [{ x: 50, y: 60 }, { x: 300, y: 230 }]);
    expect(bends).toContainEqual({ x: 50, y: 230 });
    // Every run is level or upright.
    const line = [{ x: 50, y: 60 }, ...bends.map((point) => point!), { x: 300, y: 230 }];
    for (let index = 1; index < line.length; index += 1) expect(line[index]!.x === line[index - 1]!.x || line[index]!.y === line[index - 1]!.y).toBe(true);
  });

  it('gives only finite points for shapes on top of each other, of no size, or missing', () => {
    for (const [source, target] of [[a, a], [a, shape(10, 10)], [{ ...a, width: 0, height: 0 }, c], [null, c], [a, null], [null, null]] as const) {
      const bends = route(orthConnector, {}, source, target, [], [source ? null : { x: 0, y: 0 }, target ? null : { x: 500, y: 500 }]);
      expect(bends.every((point) => point === null || (Number.isFinite(point.x) && Number.isFinite(point.y)))).toBe(true);
    }
  });
});

describe('isometric', () => {
  it('runs along the two 30° axes between its ends', () => {
    // ponytail: draw.io's isometric router is approximated — the runs lean at 30°, the checker holds it to its corpus.
    const bends = route(isometric, {}, a, c).map((point) => point!);
    expect(bends.length).toBeGreaterThan(0);
    const line = [{ x: 0, y: 58.87 }, ...bends];
    for (let index = 1; index < line.length; index += 1) {
      const slope = Math.abs((line[index]!.y - line[index - 1]!.y) / (line[index]!.x - line[index - 1]!.x));
      expect(slope).toBeCloseTo(Math.tan(Math.PI / 6), 1);
    }
  });

  it('adds nothing it cannot work out when an end is missing', () => {
    expect(() => route(isometric, {}, null, null)).not.toThrow();
  });
});
