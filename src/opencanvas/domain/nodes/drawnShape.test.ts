import { afterEach, describe, expect, it } from 'vitest';
import { drawnFillIsHatched, drawnPaint, drawnPathData, drawnShapeParts, flattenDrawnPath, provideDrawnShapes, type DrawnPart } from './drawnShape';

const fold: DrawnPart = {
  path: [{ kind: 'move', x: 90, y: 0 }, { kind: 'line', x: 90, y: 30 }, { kind: 'line', x: 120, y: 30 }],
  fill: null, stroke: 'stroke', strokeWidth: 1, dash: [], fillOpacity: 1, strokeOpacity: 1,
};
const node = (width: number, height: number) => ({
  size: { width, height },
  content: { drawio: { shape: 'note' }, drawioParts: [fold] as unknown as never, drawioSize: { width: 120, height: 80 } },
});

afterEach(() => provideDrawnShapes(null));

describe('a shape drawn by draw.io’s code', () => {
  it('is no drawn shape without a draw.io style', () => {
    expect(drawnShapeParts({ size: { width: 10, height: 10 }, content: {} })).toBeNull();
  });

  it('scales the parts saved at import when draw.io’s code isn’t there', () => {
    expect(drawnShapeParts(node(120, 80))![0]!.path[1]).toEqual({ kind: 'line', x: 90, y: 30 });
    expect(drawnShapeParts(node(240, 160))![0]!.path[1]).toEqual({ kind: 'line', x: 180, y: 60 });
  });

  it('is redrawn at its own size by draw.io’s code once that is there', () => {
    provideDrawnShapes((style, width) => (style.shape === 'note' ? [{ ...fold, path: [{ kind: 'move', x: width - 30, y: 0 }] }] : null));
    expect(drawnShapeParts(node(400, 80))![0]!.path[0]).toEqual({ kind: 'move', x: 370, y: 0 });
  });

  it('paints the node’s own colours where the part asks for them', () => {
    const own = { fill: '#fff000', stroke: '#000fff' };
    expect([drawnPaint('fill', own), drawnPaint('stroke', own), drawnPaint('#123456', own), drawnPaint(null, own)]).toEqual(['#fff000', '#000fff', '#123456', null]);
  });

  it('writes a path as SVG with its curves, and flattens it for a painter without them', () => {
    const path = [{ kind: 'move', x: 0, y: 0 }, { kind: 'cubic', x1: 0, y1: 10, x2: 10, y2: 10, x: 10, y: 0 }, { kind: 'close' }] as const;
    expect(drawnPathData(path)).toBe('M0 0C0 10 10 10 10 0Z');
    const [run] = flattenDrawnPath(path, 4);
    expect(run!.closed).toBe(true);
    expect(run!.points).toHaveLength(5);
    expect(run!.points[4]).toEqual({ x: 10, y: 0 });
  });
});

describe('drawnFillIsHatched', () => {
  const part = (fill: string | null, stroke: string | null): DrawnPart => ({ path: [], fill, stroke, strokeWidth: 1, dash: [], fillOpacity: 1, strokeOpacity: 1 });
  const node = (parts?: DrawnPart[]) => ({ content: parts ? { drawioParts: parts as never } : {} });
  it('sees a fill drawn only as lines (a sketch’s hatching), not one painted as an area or a shape with no drawing', () => {
    expect(drawnFillIsHatched(node([part(null, 'fill'), part(null, 'stroke')]))).toBe(true);
    expect(drawnFillIsHatched(node([part('fill', 'stroke')]))).toBe(false);
    expect(drawnFillIsHatched(node([part('fill', null), part(null, 'fill')]))).toBe(false);
    expect(drawnFillIsHatched(node())).toBe(false);
  });
});
