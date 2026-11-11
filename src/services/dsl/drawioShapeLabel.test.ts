import { describe, expect, it } from 'vitest';
import { shapeLabelBounds } from './drawioShapeLabel';
import { resolveDrawioStyle } from './drawioStyle';

// The part of its box a draw.io shape gives its words (each shape's getLabelBounds / getLabelMargins), for a
// 200×100 cell at the origin.
const bounds = (style: string, shape: string, horizontal = true) =>
  shapeLabelBounds({ x: 0, y: 0, width: 200, height: 100 }, resolveDrawioStyle(style, 'vertex'), shape, horizontal);

describe('shapeLabelBounds', () => {
  it('gives a plain shape, and one it doesn’t know, the whole box', () => {
    expect(bounds('', '')).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(bounds('shape=whatever;', 'whatever')).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(bounds('rhombus;', 'rhombus')).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('gives a lane, a table and a lifeline their title band: startSize tall, 23 from draw.io’s swimlane style', () => {
    expect(bounds('swimlane;', 'swimlane')).toEqual({ x: 0, y: 0, width: 200, height: 23 });
    expect(bounds('swimlane;startSize=40;', 'swimlane')).toEqual({ x: 0, y: 0, width: 200, height: 40 });
    expect(bounds('shape=table;startSize=30;', 'table')).toEqual({ x: 0, y: 0, width: 200, height: 30 });
    expect(bounds('shape=umlLifeline;size=40;', 'umlLifeline')).toEqual({ x: 0, y: 0, width: 200, height: 40 });
  });

  it('gives a table row with no band its whole box', () => {
    expect(bounds('shape=tableRow;startSize=0;', 'tableRow')).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('keeps words between a process’s side bars, a tenth of its width unless `size` says', () => {
    expect(bounds('shape=process;', 'process')).toEqual({ x: 20, y: 0, width: 160, height: 100 });
    expect(bounds('shape=process;size=0.2;', 'process')).toEqual({ x: 40, y: 0, width: 120, height: 100 });
  });

  it('keeps words inside a doubled outline, and under the lid or head of a shape that has one', () => {
    expect(bounds('shape=ext;double=1;', 'ext')).toEqual({ x: 2, y: 2, width: 196, height: 96 });
    expect(bounds('ellipse;shape=doubleEllipse;', 'doubleEllipse')).toEqual({ x: 4, y: 4, width: 192, height: 92 });
    expect(bounds('shape=datastore;', 'datastore')).toEqual({ x: 0, y: 33, width: 200, height: 67 });
    expect(bounds('shape=umlControl;', 'umlControl')).toEqual({ x: 0, y: 12.5, width: 200, height: 87.5 });
    expect(bounds('shape=callout;', 'callout')).toEqual({ x: 0, y: 0, width: 200, height: 70 });
    expect(bounds('shape=umlFrame;', 'umlFrame')).toEqual({ x: 0, y: 0, width: 60, height: 30 });
  });

  it('stays finite and never negative for a size that is not a number or is bigger than the box', () => {
    for (const style of ['swimlane;startSize=abc;', 'swimlane;startSize=-50;', 'shape=process;size=9;', 'shape=callout;size=5000;']) {
      const box = bounds(style, style.includes('swimlane') ? 'swimlane' : style.includes('process') ? 'process' : 'callout');
      expect([box.x, box.y, box.width, box.height].every(Number.isFinite)).toBe(true);
      expect(box.width).toBeGreaterThanOrEqual(0);
      expect(box.height).toBeGreaterThanOrEqual(0);
    }
  });
});
