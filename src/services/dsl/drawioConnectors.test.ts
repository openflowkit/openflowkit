import { describe, expect, it } from 'vitest';
import { drawioConnector, type EndNode } from './drawioConnectors';
import { resolveDrawioStyle } from './drawioStyle';
import type { EdgeState } from './drawioView';

// draw.io's line as our connector: ends pinned where draw.io put them, the points between kept as fixed bends.
const state = (points: { x: number; y: number }[], sourceId: string | null = 'a', targetId: string | null = 'b'): EdgeState =>
  ({ kind: 'edge', cell: { id: 'e' }, origin: { x: 0, y: 0 }, line: { points, segments: [], length: 0 }, labelAt: { x: 0, y: 0 }, sourceId, targetId, terminal: {} }) as unknown as EdgeState;
const at = (x: number, y: number): EndNode => ({ matrix: { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y }, size: { width: 100, height: 60 } });
const nodes: Record<string, EndNode> = { a: at(0, 0), b: at(300, 0) };
const endNode = (id: string) => nodes[id] ?? null;
const style = (text = '') => resolveDrawioStyle(text, 'edge');

describe('drawioConnector', () => {
  it('pins each end to its shape by where the point sits in it, and draws a two-point line direct', () => {
    const connector = drawioConnector(state([{ x: 100, y: 15 }, { x: 350, y: 60 }]), style(), endNode, []);
    expect(connector.source).toEqual({ nodeId: 'a', portId: null, anchor: { kind: 'normalized', x: 1, y: 0.25 }, point: null });
    expect(connector.target.anchor).toEqual({ kind: 'normalized', x: 0.5, y: 1 });
    expect(connector.route).toEqual({ kind: 'direct', ownership: 'imported-fixed' });
    expect(connector.waypoints).toEqual([]);
  });

  it('keeps the points between the ends as fixed bends', () => {
    const connector = drawioConnector(state([{ x: 100, y: 30 }, { x: 200, y: 30 }, { x: 200, y: 230 }, { x: 300, y: 230 }]), style(), endNode, []);
    expect(connector.route).toEqual({ kind: 'polyline', ownership: 'imported-fixed' });
    expect(connector.waypoints).toEqual([{ x: 200, y: 30 }, { x: 200, y: 230 }]);
  });

  it('leaves an end on no shape, or on a shape that was not drawn, as a free point', () => {
    const connector = drawioConnector(state([{ x: 10, y: 10 }, { x: 90, y: 10 }], null, 'gone'), style(), endNode, []);
    expect(connector.source).toEqual({ nodeId: null, portId: null, anchor: null, point: { x: 10, y: 10 } });
    expect(connector.target).toEqual({ nodeId: null, portId: null, anchor: null, point: { x: 90, y: 10 } });
  });

  it('draws one curved bend as our bezier: its two handles two thirds of the way to the bend', () => {
    const connector = drawioConnector(state([{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 90 }], null, null), style('curved=1;'), endNode, []);
    expect(connector.route.kind).toBe('bezier');
    expect(connector.waypoints).toEqual([{ x: 60, y: 0 }, { x: 90, y: 30 }]);
  });

  it('draws a curve through several bends as the short runs it passes through, with no rounding of its own', () => {
    const connector = drawioConnector(state([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }], null, null), style('curved=1;'), endNode, []);
    expect(connector.route.kind).toBe('polyline');
    expect(connector.waypoints.length).toBeGreaterThan(8);
    expect(connector.appearance.cornerRadius).toBe(0);
    // The curve sets off along the first run and never strays outside the bends' box.
    expect(connector.waypoints[0]!.y).toBeLessThan(2);
    expect(connector.waypoints.every((point) => point.x >= 0 && point.x <= 200 && point.y >= 0 && point.y <= 100)).toBe(true);
  });

  it('carries a label by its share of the line and how far draw.io set it from there', () => {
    const connector = drawioConnector(state([{ x: 0, y: 0 }, { x: 100, y: 0 }], null, null), style(), endNode,
      [{ id: 'e:label', text: 'yes', at: { x: 50, y: -20 }, along: 0 }, { id: 'far', text: 'far', at: { x: 100, y: 5 }, along: 9 }]);
    expect(connector.labels[0]).toEqual({ id: 'e:label', text: 'yes', pathRatio: 0.5, offset: { x: 0, y: -20 }, metadata: {} });
    // A share past the end is held at the end.
    expect(connector.labels[1]).toMatchObject({ pathRatio: 1, offset: { x: 0, y: 5 } });
  });

  it('pins to the middle of a shape squashed flat, which has no inside to measure in', () => {
    const flat: EndNode = { matrix: { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 }, size: { width: 100, height: 60 } };
    const connector = drawioConnector(state([{ x: 0, y: 0 }, { x: 90, y: 10 }]), style(), (id) => (id === 'a' ? flat : null), []);
    expect(connector.source.anchor).toEqual({ kind: 'normalized', x: 0.5, y: 0.5 });
  });
});
