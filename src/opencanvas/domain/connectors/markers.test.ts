import { describe, expect, it } from 'vitest';
import { connectorMarkerShapes, markerOutward } from './markers';

const endpoint = { x: 100, y: 100 };
const outward = { x: 0, y: -1 };

describe('connector marker geometry', () => {
  it('draws the open arrow as a chevron from the second point through the tip', () => {
    const [shape] = connectorMarkerShapes('arrow', endpoint, outward, 0);
    expect(shape).toEqual({
      kind: 'polygon', closed: false, filled: false, round: true,
      subpaths: [[{ x: 104.5, y: 109 }, endpoint, { x: 95.5, y: 109 }]],
    });
  });

  it('offsets stacked glyphs further back along the line', () => {
    const [first] = connectorMarkerShapes('bar', endpoint, outward, 0);
    const [second] = connectorMarkerShapes('bar', endpoint, outward, 9);
    expect(first).toMatchObject({ subpaths: [[{ x: 105, y: 103 }, { x: 95, y: 103 }]] });
    expect(second).toMatchObject({ subpaths: [[{ x: 105, y: 112 }, { x: 95, y: 112 }]] });
  });

  it('fills closed glyphs and leaves open ones stroked', () => {
    expect(connectorMarkerShapes('triangle-filled', endpoint, outward, 0)[0]).toMatchObject({ closed: true, filled: true });
    expect(connectorMarkerShapes('triangle-open', endpoint, outward, 0)[0]).toMatchObject({ closed: true, filled: false });
    expect(connectorMarkerShapes('diamond-filled', endpoint, outward, 0)[0]).toMatchObject({ closed: true, filled: true });
  });

  it('draws a circle as its centre and radius', () => {
    expect(connectorMarkerShapes('circle', endpoint, outward, 0)).toEqual([
      { kind: 'circle', center: { x: 100, y: 105 }, radius: 4, filled: false },
    ]);
  });

  it('draws a cross as two subpaths of one glyph', () => {
    const [shape] = connectorMarkerShapes('cross', endpoint, outward, 0);
    expect(shape).toMatchObject({ kind: 'polygon', closed: false, filled: false });
    if (shape?.kind !== 'polygon') throw new Error('expected a polygon');
    expect(shape.subpaths).toHaveLength(2);
    expect(shape.subpaths[0]).toHaveLength(2);
  });

  // Found 2026-10-11 (U2-10): `o{` exported as a lone circle, so "zero or many" read as "zero or one".
  it("draws a crow's foot as three prongs from a root on the line out to the endpoint", () => {
    const root = { x: 100, y: 109 };
    expect(connectorMarkerShapes('crow-foot', endpoint, outward, 0)).toEqual([{
      kind: 'polygon', closed: false, filled: false, round: false,
      subpaths: [[root, { x: 105, y: 100 }], [root, endpoint], [root, { x: 95, y: 100 }]],
    }]);
  });
});

// Found 2026-10-11 (U4-08): a route ending in a 1-3px jog turned the head along the jog: one sideways wing.
describe('markerOutward', () => {
  it('points along the line, skipping micro-segments at the end', () => {
    const jog = [{ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 3, y: 200 }, { x: 3, y: 202 }];
    const target = markerOutward(jog, 'target');
    expect(target.y).toBeGreaterThan(0.99);
    expect(markerOutward([...jog].reverse(), 'source').y).toBeGreaterThan(0.99);
    expect(markerOutward([{ x: 0, y: 0 }, { x: 0, y: 0 }], 'target')).toEqual({ x: 1, y: 0 });
  });
  it('keeps a real short stub: a 6px final segment still sets the direction', () => {
    expect(markerOutward([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 6 }], 'target')).toEqual({ x: 0, y: 1 });
    expect(markerOutward([{ x: 0, y: 0 }, { x: 0, y: 50 }], 'source')).toEqual({ x: 0, y: -1 });
  });
  it('a route shorter than the cut-off uses its whole chord', () => {
    expect(markerOutward([{ x: 0, y: 0 }, { x: 2, y: 0 }], 'target')).toEqual({ x: 1, y: 0 });
  });
});
