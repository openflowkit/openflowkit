import { describe, expect, it } from 'vitest';
import { pageCells } from './drawioCells';
import { DrawioView } from './drawioView';
import { parseXml } from './xmlReader';

// draw.io's view of a page: one state per cell, parents and ends first (mxGraphView.updateCellState).
function view(cells: string): DrawioView {
  const parsed = parseXml(`<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`);
  if ('error' in parsed) throw new Error(parsed.error);
  const all = pageCells(parsed.root);
  return new DrawioView(new Map(all.map((cell) => [cell.id, cell])), (id) => all.filter((cell) => cell.parent === id));
}
const vertex = (id: string, parent: string, geometry: string, more = '') => `<mxCell id="${id}" vertex="1" parent="${parent}" ${more}><mxGeometry ${geometry} as="geometry"/></mxCell>`;
const edge = (id: string, source: string, target: string) => `<mxCell id="${id}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
const round = (point: { x: number; y: number }) => ({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 });

describe('DrawioView vertices', () => {
  const page = view(vertex('g', '1', 'x="100" y="100" width="200" height="100"', 'style="rotation=90;"')
    + vertex('k', 'g', 'x="10" y="20" width="40" height="30"')
    + '<mxCell id="rel" vertex="1" parent="g"><mxGeometry x="1" y="0.5" width="20" height="10" relative="1" as="geometry"><mxPoint x="-5" y="-5" as="offset"/></mxGeometry></mxCell>'
    + vertex('hid', '1', 'x="500" y="0" width="50" height="50"', 'visible="0"') + vertex('in', 'hid', 'x="5" y="5" width="10" height="10"')
    + '<mxCell id="auto" vertex="1" parent="1" style="swimlane;childLayout=stackLayout;"><mxGeometry as="geometry"/></mxCell>' + vertex('ac', 'auto', 'x="700" y="400" width="50" height="50"')
    + '<mxCell id="fold" vertex="1" parent="1" collapsed="1"><mxGeometry x="0" y="500" width="30" height="20" as="geometry"><mxRectangle x="0" y="500" width="300" height="200" as="alternateBounds"/></mxGeometry></mxCell>');

  it('places a child from its parent’s corner, and never turns it with its parent', () => {
    expect(page.vertex('g')).toMatchObject({ box: { x: 100, y: 100, width: 200, height: 100 }, rotation: 90, origin: { x: 100, y: 100 } });
    expect(page.vertex('k')).toMatchObject({ box: { x: 110, y: 120, width: 40, height: 30 }, rotation: 0 });
  });

  it('carries a cell placed by fractions of its parent round with its parent’s turn', () => {
    // x 1, y 0.5 and the offset put its centre at (305, 150): a quarter turn about (200, 150) takes that to (200, 255).
    const box = page.vertex('rel')!.box;
    expect(round(box)).toEqual({ x: 190, y: 250 });
  });

  it('has no state for a hidden cell or anything inside one', () => {
    expect(page.vertex('hid')).toBeNull();
    expect(page.vertex('in')).toBeNull();
  });

  it('sizes a layout container saved with no size around its children, and opens a folded one', () => {
    expect(page.vertex('auto')!.box).toEqual({ x: 680, y: 357, width: 90, height: 113 });
    expect(page.vertex('ac')!.box).toEqual({ x: 700, y: 400, width: 50, height: 50 });
    expect(page.vertex('fold')!.box).toEqual({ x: 0, y: 500, width: 300, height: 200 });
  });

  it('answers null for an id that is not there, and for a cell of the other kind', () => {
    expect(page.vertex('nope')).toBeNull();
    expect(page.edge('nope')).toBeNull();
    expect(page.edge('k')).toBeNull();
  });
});

describe('DrawioView edges', () => {
  const page = view(vertex('k', '1', 'x="110" y="120" width="40" height="30"') + vertex('far', '1', 'x="600" y="100" width="100" height="60"')
    + vertex('hid', '1', 'x="500" y="300" width="50" height="50"', 'visible="0"') + vertex('in', 'hid', 'x="5" y="5" width="10" height="10"')
    + vertex('box', '1', 'x="0" y="400" width="100" height="100"') + vertex('folded', 'box', 'x="10" y="10" width="20" height="20"', 'visible="0"')
    + '<mxCell id="e" value="e" edge="1" parent="1" source="k" target="far"><mxGeometry relative="1" as="geometry"/></mxCell>'
    + '<mxCell id="on" value="on" vertex="1" connectable="0" parent="e" style="edgeLabel;align=center;verticalAlign=middle;"><mxGeometry x="-0.5" relative="1" as="geometry"><mxPoint y="-10" as="offset"/></mxGeometry></mxCell>'
    + edge('toHidden', 'far', 'in') + edge('toFolded', 'far', 'folded') + edge('toEdge', 'far', 'e') + edge('l1', 'l2', 'far') + edge('l2', 'l1', 'far') + edge('dangling', 'far', 'nowhere'));

  it('draws a line between its two shapes and says which cells it ends on', () => {
    const state = page.edge('e')!;
    expect(state.line.points.map(round)).toEqual([{ x: 150, y: 134.81 }, { x: 600, y: 130.48 }]);
    expect([state.sourceId, state.targetId]).toEqual(['k', 'far']);
    expect(round(state.labelAt)).toEqual({ x: 374.99, y: 132.64 });
  });

  it('meets the outline of the cell its targetPort names, still ending on its own terminal', () => {
    const ported = view(vertex('k', '1', 'x="0" y="0" width="40" height="40"') + vertex('t', '1', 'x="200" y="0" width="100" height="100"')
      + vertex('p', 't', 'x="0" y="60" width="20" height="20"')
      + '<mxCell id="e" edge="1" parent="1" source="k" target="t" style="targetPort=p;"><mxGeometry relative="1" as="geometry"/></mxCell>');
    const state = ported.edge('e')!;
    // The port's own outline, 200..220 across and 60..80 down: the line meets it on its left side.
    expect(state.line.points.at(-1)!.x).toBeCloseTo(200);
    expect(state.line.points.at(-1)!.y).toBeGreaterThan(20);
    expect(state.targetId).toBe('t');
  });

  it('places a label that rides the line a quarter of the way along, moved by its offset', () => {
    const riding = page.vertex('on')!;
    expect(round(riding.box)).toEqual({ x: 262.99, y: 123.72 });
    expect(riding.box).toMatchObject({ width: 0, height: 0 });
  });

  it('ends a line on another line at that line’s middle', () => {
    expect(page.edge('toEdge')!.line.points.map(round)).toEqual([{ x: 600, y: 130.48 }, { x: 374.99, y: 132.64 }]);
  });

  it('ends a line whose shape is hidden on the nearest thing shown that holds it, and leaves it out when nothing is', () => {
    expect(page.edge('toFolded')!.targetId).toBe('box');
    expect(page.edge('toHidden')).toBeNull();
  });

  it('leaves out lines that end on each other in a loop, without hanging', () => {
    expect(page.edge('l1')).toBeNull();
    expect(page.edge('l2')).toBeNull();
  });

  it('has no line for an end that names no cell and has no point', () => {
    expect(page.edge('dangling')).toBeNull();
  });
});

describe('DrawioView on broken nesting', () => {
  it('gives no state to cells whose parents loop, and does not overflow on 5,000 nested groups', () => {
    const looped = view(vertex('a', 'b', 'width="10" height="10"') + vertex('b', 'a', 'width="10" height="10"'));
    expect(looped.vertex('a')).toBeNull();
    let cells = vertex('n0', '1', 'x="1" y="1" width="10" height="10"');
    for (let depth = 1; depth < 5_000; depth += 1) cells += vertex(`n${depth}`, `n${depth - 1}`, 'x="1" y="1" width="10" height="10"');
    expect(view(cells).vertex('n4999')!.box).toMatchObject({ x: 5000, y: 5000 });
  });
});
