import { describe, expect, it } from 'vitest';
import type { Geometry } from './drawioCells';
import { drawioEdgeLine, drawioRoutes, edgeLabelPoint, perimeterPoint, pointOnLine, type EdgeTerminal } from './drawioEdgeView';
import { resolveDrawioStyle } from './drawioStyle';

// A connector's line as draw.io draws it (mxGraphView.updateEdgeState). Boxes are 100×60: `a` at the origin,
// `b` level with it 300 to the right, `c` 300 right and 200 down.
const shape = (x: number, y: number, style = ''): EdgeTerminal =>
  ({ x, y, width: 100, height: 60, style: resolveDrawioStyle(style, 'vertex'), relativeX: null, isEdge: false, centre: { x: x + 50, y: y + 30 } });
const [a, b, c] = [shape(0, 0), shape(300, 0), shape(300, 200)];
const geometry = (extra: Partial<Geometry> = {}): Geometry =>
  ({ x: 0, y: 0, width: 0, height: 0, points: [], sourcePoint: null, targetPoint: null, relative: true, offset: { x: 0, y: 0 }, unfolded: null, ...extra });
const round = (point: { x: number; y: number }) => ({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 });
const line = (style: string, source: EdgeTerminal | null, target: EdgeTerminal | null, extra: Partial<Geometry> = {}) =>
  drawioEdgeLine(resolveDrawioStyle(style, 'edge'), geometry(extra), { x: 0, y: 0 }, source, target)?.points.map(round) ?? null;

describe('drawioEdgeLine', () => {
  it('runs a floating line between the outlines, each end aimed at the other shape', () => {
    expect(line('', a, b)).toEqual([{ x: 100, y: 30 }, { x: 300, y: 30 }]);
    expect(line('', a, c)).toEqual([{ x: 95, y: 60 }, { x: 305, y: 200 }]);
    expect(line('', shape(0, 0, 'ellipse;'), c)).toEqual([{ x: 83.38, y: 52.34 }, { x: 305, y: 200 }]);
  });

  it('pins an end where exit and entry say, moved by their Dx/Dy and brought to the outline', () => {
    expect(line('exitX=1;exitY=0.25;entryX=0.5;entryY=1;', a, b)).toEqual([{ x: 100, y: 15 }, { x: 350, y: 60 }]);
    expect(line('exitX=1;exitY=0.5;exitDx=5;exitDy=-3;', a, b)![0]).toEqual({ x: 100, y: 27.27 });
    // A pin inside the shape is carried out to its outline unless exitPerimeter=0 keeps it.
    expect(line('exitX=0.3;exitY=0.6;', a, b)![0]).toEqual({ x: 0, y: 45 });
    expect(line('exitX=0.3;exitY=0.6;exitPerimeter=0;', a, b)![0]).toEqual({ x: 30, y: 36 });
  });

  it('keeps a pinned end’s perimeter spacing only where fixedPointSpacing=1 says, moved along the line', () => {
    expect(line('exitX=1;exitY=0.5;entryX=0;entryY=0.5;sourcePerimeterSpacing=10;', a, b)![0]).toEqual({ x: 100, y: 30 });
    expect(line('exitX=1;exitY=0.5;entryX=0;entryY=0.5;sourcePerimeterSpacing=10;fixedPointSpacing=1;', a, b)![0]).toEqual({ x: 110, y: 30 });
  });

  it('stops short of the outline by each end’s perimeter spacing', () => {
    expect(line('sourcePerimeterSpacing=10;targetPerimeterSpacing=7;', a, b)).toEqual([{ x: 110, y: 30 }, { x: 293, y: 30 }]);
  });

  it('goes through its saved bends, each end aimed at the bend next to it', () => {
    expect(line('', a, c, { points: [{ x: 200, y: 30 }] })).toEqual([{ x: 100, y: 30 }, { x: 200, y: 30 }, { x: 327.5, y: 200 }]);
  });

  it('uses the saved points of an end that is on no shape', () => {
    expect(line('', null, null, { sourcePoint: { x: 10, y: 10 }, targetPoint: { x: 90, y: 10 } })).toEqual([{ x: 10, y: 10 }, { x: 90, y: 10 }]);
    expect(line('', a, null, { targetPoint: { x: 200, y: 30 } })).toEqual([{ x: 100, y: 30 }, { x: 200, y: 30 }]);
  });

  it('has no line when an end is on no shape and has no point', () => {
    expect(line('', a, null)).toBeNull();
    expect(line('', null, null)).toBeNull();
  });

  it('routes right-angle lines as draw.io’s orthogonal router does', () => {
    expect(line('edgeStyle=orthogonalEdgeStyle;', a, b)).toEqual([{ x: 100, y: 30 }, { x: 300, y: 30 }]);
    expect(line('edgeStyle=orthogonalEdgeStyle;', a, c)).toEqual([{ x: 100, y: 30 }, { x: 350, y: 30 }, { x: 350, y: 200 }]);
    expect(line('edgeStyle=orthogonalEdgeStyle;exitX=0.5;exitY=1;entryX=0;entryY=0.5;', a, c)).toEqual([{ x: 50, y: 60 }, { x: 50, y: 230 }, { x: 300, y: 230 }]);
    expect(line('edgeStyle=orthogonalEdgeStyle;', a, c, { points: [{ x: 220, y: 100 }] }))
      .toEqual([{ x: 50, y: 60 }, { x: 50, y: 100 }, { x: 220, y: 100 }, { x: 220, y: 230 }, { x: 300, y: 230 }]);
  });

  it('loops a line from a shape back to itself out of its right side', () => {
    expect(line('', a, a)).toEqual([{ x: 100, y: 22.86 }, { x: 120, y: 20 }, { x: 120, y: 40 }, { x: 100, y: 37.14 }]);
    expect(line('edgeStyle=orthogonalEdgeStyle;', a, a)).toEqual([{ x: 100, y: 20 }, { x: 120, y: 20 }, { x: 120, y: 40 }, { x: 100, y: 40 }]);
    // `loopStyle` picks the loop's own router (draw.io's key; `loop` is not one).
    expect(line('loopStyle=elbowEdgeStyle;', a, a)).not.toEqual(line('', a, a));
    expect(line('loop=elbowEdgeStyle;', a, a)).toEqual(line('', a, a));
  });

  it('draws a router it doesn’t know straight through the saved bends', () => {
    expect(line('edgeStyle=madeUpStyle;', a, c)).toEqual(line('', a, c));
    expect(drawioRoutes('madeUpStyle')).toBe(false);
    expect(drawioRoutes('constructor')).toBe(false);
    expect(drawioRoutes('orthogonalEdgeStyle')).toBe(true);
  });
});

describe('pointOnLine and edgeLabelPoint', () => {
  const bent = drawioEdgeLine(resolveDrawioStyle('', 'edge'), geometry({ points: [{ x: 200, y: 30 }] }), { x: 0, y: 0 }, a, c)!;
  const zero = { x: 0, y: 0 };

  it('measures the line: 100 along, then 212.5 down to the far shape', () => {
    expect(bent.segments).toEqual([100, 212.5]);
    expect(bent.length).toBe(312.5);
  });

  it('finds a point by its share of the line (-1 the start, 0 the middle, 1 the end), on whole pixels as draw.io does', () => {
    expect(round(pointOnLine(bent, -1, 0, zero))).toEqual({ x: 100, y: 30 });
    // Half of 312.5 rounds to 156: 56 down the second run, which leans 0.6 across and 0.8 down.
    expect(round(pointOnLine(bent, 0, 0, zero))).toEqual({ x: 233.6, y: 74.8 });
    expect(round(pointOnLine(bent, -0.5, 10, { x: 3, y: 4 }))).toEqual({ x: 181, y: 24 });
  });

  it('runs on along the last stretch for a share past the end, as draw.io does, and stays finite', () => {
    const past = pointOnLine(bent, 5, 0, zero);
    expect([past.x, past.y].every(Number.isFinite)).toBe(true);
    expect(past.y).toBeGreaterThan(200);
  });

  it('sets a label on its point, moved by its spacing on the side it is aligned to', () => {
    expect(round(edgeLabelPoint(bent, geometry(), {}))).toEqual({ x: 233.6, y: 74.8 });
    // Left and top: draw.io's 2px spacing across, and 2 + mxText's 5 down.
    expect(round(edgeLabelPoint(bent, geometry(), { align: 'left', verticalAlign: 'top' }))).toEqual({ x: 235.6, y: 81.8 });
    expect(round(edgeLabelPoint(bent, geometry({ x: -1 }), { align: 'right', verticalAlign: 'bottom', spacing: '4' }))).toEqual({ x: 96, y: 25 });
  });

  it('sets a label that is not placed along the line off the middle of its two ends', () => {
    expect(round(edgeLabelPoint(bent, geometry({ relative: false, offset: { x: 5, y: 5 } }), {}))).toEqual({ x: 218.75, y: 120 });
  });
});

describe('perimeterPoint', () => {
  it('stops on the outline, further out by the border asked for', () => {
    expect(perimeterPoint(a, { x: 200, y: 30 }, false)).toEqual({ x: 100, y: 30 });
    expect(perimeterPoint(a, { x: 200, y: 30 }, false, 10)).toEqual({ x: 110, y: 30 });
  });

  it('is the shape’s centre when there is nothing to aim from or the shape has no outline', () => {
    expect(perimeterPoint(a, null, false)).toEqual({ x: 50, y: 30 });
    expect(perimeterPoint(shape(0, 0, 'perimeter=none;'), { x: 200, y: 30 }, false)).toEqual({ x: 50, y: 30 });
  });
});
