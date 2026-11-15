import { describe, expect, it } from 'vitest';
import type { Cell } from './drawioCells';
import { drawioLaneLine, drawioTableLines } from './drawioTable';

const at = (id: string, x: number, y: number, width: number, height: number, style: Record<string, string> = {}): Cell =>
  ({ id, vertex: true, visible: true, style, geometry: { x, y, width, height } }) as unknown as Cell;

describe('drawioTableLines', () => {
  const table = at('t', 0, 0, 200, 90);
  const children: Record<string, Cell[]> = {
    t: [at('r1', 0, 30, 200, 30), at('r2', 0, 60, 200, 30)],
    r1: [at('a', 0, 0, 40, 30), at('b', 40, 0, 160, 30)],
    r2: [at('c', 0, 0, 40, 30), at('d', 40, 0, 160, 30)],
  };
  const rowsOf = (id: string) => children[id] ?? [];

  it('draws a line under every row but the last, and right of every cell but a row\'s last', () => {
    const part = drawioTableLines(table, rowsOf, 1)!;
    expect(part.path).toEqual([
      { kind: 'move', x: 0, y: 60 }, { kind: 'line', x: 200, y: 60 },
      { kind: 'move', x: 40, y: 30 }, { kind: 'line', x: 40, y: 60 },
      { kind: 'move', x: 40, y: 60 }, { kind: 'line', x: 40, y: 90 },
    ]);
    expect(part).toMatchObject({ stroke: 'stroke', fill: null, strokeWidth: 1 });
  });

  it('leaves out the lines the table turns off', () => {
    expect(drawioTableLines(at('t', 0, 0, 200, 90, { rowLines: '0' }), rowsOf, 1)!.path).toHaveLength(4);
    expect(drawioTableLines(at('t', 0, 0, 200, 90, { rowLines: '0', columnLines: '0' }), rowsOf, 1)).toBeNull();
  });
});

describe('drawioLaneLine', () => {
  it('draws the line under a lane\'s title band, across or down as the lane runs', () => {
    expect(drawioLaneLine(at('l', 0, 0, 100, 200), 100, 200, 20, 1)!.path).toEqual([{ kind: 'move', x: 0, y: 20 }, { kind: 'line', x: 100, y: 20 }]);
    expect(drawioLaneLine(at('l', 0, 0, 100, 200, { horizontal: '0' }), 100, 200, 20, 1)!.path).toEqual([{ kind: 'move', x: 20, y: 0 }, { kind: 'line', x: 20, y: 200 }]);
  });

  it('draws none when the lane turns it off or has no band', () => {
    expect(drawioLaneLine(at('l', 0, 0, 100, 200, { swimlaneLine: '0' }), 100, 200, 20, 1)).toBeNull();
    expect(drawioLaneLine(at('l', 0, 0, 100, 200), 100, 200, 0, 1)).toBeNull();
  });
});
