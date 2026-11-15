import { describe, expect, it } from 'vitest';
import { drawioPerimeter, intersection } from './drawioPerimeter';

// Where a line stops on a shape's outline, as draw.io's mxPerimeter works it out. One 100×60 box at the origin
// (centre 50, 30); `next` is where the line comes from.
const box = { x: 0, y: 0, width: 100, height: 60 };
const hit = (name: string, x: number, y: number, orthogonal = false, shape = {}) => {
  const point = drawioPerimeter(name)!(box, shape, { x, y }, orthogonal)!;
  return { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 };
};

describe('drawioPerimeter', () => {
  it('stops a line on a rectangle’s side, and squarely under the point for a right-angle line', () => {
    expect(hit('rectanglePerimeter', 200, 30)).toEqual({ x: 100, y: 30 });
    // Towards (150, 100) the line leaves by the bottom: 30 down the centre is 30 × 100/70 across.
    expect(hit('rectanglePerimeter', 150, 100)).toEqual({ x: 92.86, y: 60 });
    expect(hit('rectanglePerimeter', 30, 200, true)).toEqual({ x: 30, y: 60 });
    expect(hit('rectanglePerimeter', 150, 100, true)).toEqual({ x: 100, y: 60 });
  });

  it('stops on an ellipse and a rhombus where the line to the centre crosses them', () => {
    expect(hit('ellipsePerimeter', 200, 30)).toEqual({ x: 100, y: 30 });
    expect(hit('ellipsePerimeter', 150, 100)).toEqual({ x: 82.54, y: 52.78 });
    expect(hit('rhombusPerimeter', 50, -100)).toEqual({ x: 50, y: 0 });
    expect(hit('rhombusPerimeter', 150, 100)).toEqual({ x: 73.08, y: 46.15 });
  });

  it('follows a triangle’s point: east unless `direction` turns it', () => {
    expect(hit('trianglePerimeter', 200, 30)).toEqual({ x: 100, y: 30 });
    // Pointing north, the right-hand slope runs from (50, 0) to (100, 60): met at 75 half-way down.
    expect(hit('trianglePerimeter', 200, 30, false, { direction: 'north' })).toEqual({ x: 75, y: 30 });
    expect(hit('trianglePerimeter', 200, 30, false, { direction: 'west' })).toEqual({ x: 100, y: 30 });
  });

  it('stops on a hexagon’s slanted corner, on a backbone’s bar, and at a centre perimeter’s middle', () => {
    expect(hit('hexagonPerimeter', 150, 100)).toEqual({ x: 81.58, y: 52.11 });
    expect(hit('hexagonPerimeter', 50, -100)).toEqual({ x: 50, y: 0 });
    expect(hit('backbonePerimeter', 30, 200)).toEqual({ x: 30, y: 29.5 });
    expect(hit('centerPerimeter', 200, 30)).toEqual({ x: 50, y: 30 });
    expect(hit('orthogonalPerimeter', 150, 100)).toEqual({ x: 100, y: 60 });
  });

  it('meets the box of a slanted shape it has no outline for yet', () => {
    // ponytail: parallelogram, trapezoid, step, callout and hexagonPerimeter2 stop at their box.
    expect(hit('parallelogramPerimeter', 150, 100)).toEqual(hit('rectanglePerimeter', 150, 100));
    expect(hit('hexagonPerimeter2', 200, 30)).toEqual({ x: 100, y: 30 });
  });

  it('has no outline for `none`, a missing name, an unknown one, or a word every object has', () => {
    for (const name of ['none', undefined, 'nopePerimeter', 'constructor', '__proto__']) expect(drawioPerimeter(name)).toBeNull();
  });

  it('gives a finite point for a box of no size and a line from its own centre', () => {
    const empty = drawioPerimeter('rectanglePerimeter')!({ x: 5, y: 5, width: 0, height: 0 }, {}, { x: 5, y: 5 }, false)!;
    expect([empty.x, empty.y].every(Number.isFinite)).toBe(true);
  });
});

describe('intersection', () => {
  it('finds where two segments cross', () => {
    expect(intersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toEqual({ x: 5, y: 5 });
  });

  it('is null for parallel segments and for ones that stop short of each other', () => {
    expect(intersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBeNull();
    expect(intersection({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 0 }, { x: 5, y: 10 })).toBeNull();
  });
});
