import { describe, expect, it } from 'vitest';
import type { Point2d } from '../../opencanvas/domain/geometry/types';
import { EAST, NORTH, SIMPLE_ROUTERS, SOUTH, WEST, contains, numberOf, pointBox, portConstraints, reversePortConstraints, routingCenterX, segment, styleOf, type RouteTerminal, type Router } from './drawioEdgeStyles';

// draw.io's simple routers (mxEdgeStyle): each adds the bends between a line's two ends. Boxes are 100×60: `a`
// at the origin, `c` 300 right and 200 down.
const shape = (x: number, y: number, style: Record<string, string> = {}): RouteTerminal => ({ x, y, width: 100, height: 60, style, relativeX: null, isEdge: false });
const [a, c] = [shape(0, 0), shape(300, 200)];
const bends = (router: Router, style: Record<string, string>, source: RouteTerminal | null, target: RouteTerminal | null, hints: Point2d[] = [], ends: (Point2d | null)[] = [null, null]) => {
  const result: (Point2d | null)[] = [ends[0]!];
  router({ style, origin: { x: 0, y: 0 }, absolutePoints: ends }, source, target, hints, result);
  return result.slice(1);
};
const named = (name: string) => SIMPLE_ROUTERS[name]!;

describe('draw.io’s simple routers', () => {
  it('entity relation: a stub out of each shape’s facing side, 30 long unless `segment` says', () => {
    expect(bends(named('entityRelationEdgeStyle'), {}, a, c)).toEqual([{ x: 130, y: 30 }, { x: 270, y: 230 }]);
    expect(bends(named('entityRelationEdgeStyle'), { segment: '10' }, a, c)).toEqual([{ x: 110, y: 30 }, { x: 290, y: 230 }]);
  });

  it('elbow and side-to-side: one upright run half-way across; top-to-bottom and a vertical elbow: one level run half-way down', () => {
    expect(bends(named('elbowEdgeStyle'), {}, a, c)).toEqual([{ x: 200, y: 30 }, { x: 200, y: 230 }]);
    expect(bends(named('sideToSideEdgeStyle'), {}, a, c)).toEqual([{ x: 200, y: 30 }, { x: 200, y: 230 }]);
    expect(bends(named('topToBottomEdgeStyle'), {}, a, c)).toEqual([{ x: 50, y: 130 }, { x: 350, y: 130 }]);
    expect(bends(named('elbowEdgeStyle'), { elbow: 'vertical' }, a, c)).toEqual([{ x: 50, y: 130 }, { x: 350, y: 130 }]);
  });

  it('loop: out of the shape’s side and back, 20 away', () => {
    expect(bends(named('loopEdgeStyle'), {}, a, a)).toEqual([{ x: 120, y: 20 }, { x: 120, y: 40 }]);
  });

  it('segment: right-angle runs through each saved bend in turn', () => {
    expect(bends(segment, {}, a, c, [{ x: 200, y: 100 }])).toEqual([{ x: 50, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 230 }]);
  });

  it('adds nothing, and does not throw, when an end is missing', () => {
    for (const name of Object.keys(SIMPLE_ROUTERS)) {
      expect(() => bends(named(name), {}, null, null)).not.toThrow();
      expect(() => bends(named(name), {}, a, null)).not.toThrow();
    }
    expect(bends(named('entityRelationEdgeStyle'), {}, null, null)).toEqual([]);
  });

  it('knows only its own routers by name', () => {
    expect(Object.keys(SIMPLE_ROUTERS).sort()).toEqual(['elbowEdgeStyle', 'entityRelationEdgeStyle', 'loopEdgeStyle', 'segmentEdgeStyle', 'sideToSideEdgeStyle', 'topToBottomEdgeStyle']);
    expect(Object.hasOwn(SIMPLE_ROUTERS, 'constructor')).toBe(false);
  });
});

describe('port constraints and style reading', () => {
  const edge = { style: {}, origin: { x: 0, y: 0 }, absolutePoints: [null, null] };

  it('reads the sides a line may leave by, any side when the shape doesn’t say', () => {
    expect(portConstraints(shape(0, 0, { portConstraint: 'north' }), edge, true, 15)).toBe(NORTH);
    expect(portConstraints(shape(0, 0, { portConstraint: 'eastwest' }), edge, true, 15)).toBe(EAST | WEST);
    expect(portConstraints(a, edge, true, 15)).toBe(15);
  });

  it('swaps each side for the one opposite', () => {
    expect([WEST, NORTH, SOUTH, EAST, 15].map(reversePortConstraints)).toEqual([EAST, SOUTH, NORTH, WEST, 15]);
  });

  it('reads a style number, falling back for a missing key, words, and keys every object has', () => {
    expect(numberOf({ segment: '12' }, 'segment', 30)).toBe(12);
    expect(numberOf({ segment: 'wide' }, 'segment', 30)).toBe(30);
    expect(numberOf({}, 'constructor', 30)).toBe(30);
    expect(numberOf(undefined, 'segment', 30)).toBe(30);
    expect(styleOf({}, 'toString')).toBeUndefined();
  });

  it('measures a shape’s routing centre and whether a point is in its box', () => {
    expect(routingCenterX(shape(0, 0, { routingCenterX: '0.25' }))).toBe(75);
    expect(contains(a, 100, 60)).toBe(true);
    expect(contains(a, 100.1, 60)).toBe(false);
    expect(pointBox({ x: 3, y: 4 })).toMatchObject({ x: 3, y: 4, width: 0, height: 0 });
  });
});
