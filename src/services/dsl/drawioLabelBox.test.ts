import { describe, expect, it } from 'vitest';
import { drawioLabelBox, drawioLabelFit } from './drawioLabelBox';
import { resolveDrawioStyle } from './drawioStyle';

// The box draw.io lays a label out in (mxCellRenderer.getLabelBounds, rotateLabelBounds, mxText.getSpacing).
const cell = { x: 100, y: 50, width: 120, height: 60 };
const box = (style: string) => drawioLabelBox(cell, resolveDrawioStyle(style, 'vertex'));

describe('drawioLabelBox', () => {
  it('insets a centred label by draw.io’s 2px on every side', () => {
    expect(box('')).toEqual({ x: 102, y: 52, width: 116, height: 56, align: 'center', verticalAlign: 'middle', wrap: false, anchor: { x: 160, y: 80 }, rotation: 0 });
  });

  it('sets text against the side it is aligned to, inset by that side’s spacing, top-set words 5px lower as mxText does', () => {
    expect(box('text;spacingLeft=10;')).toEqual({ x: 112, y: 57, width: 106, height: 56, align: 'left', verticalAlign: 'top', wrap: false, anchor: { x: 112, y: 57 }, rotation: 0 });
    expect(box('align=right;verticalAlign=bottom;spacingRight=8;spacingBottom=4;')).toMatchObject({ x: 102, y: 51, width: 108, height: 52 });
  });

  it('fills the shape with an overflow=fill label: no spacing, wrapped, set from the top (mxSvgCanvas2D’s block is the box’s height)', () => {
    expect(box('overflow=fill;')).toMatchObject({ x: 100, y: 50, width: 120, height: 60, verticalAlign: 'top', wrap: true });
  });

  it('moves a label by a negative spacing, as the blog wireframe’s spacingTop=-5 does', () => {
    expect(box('text;spacingTop=-5;')).toMatchObject({ x: 102, y: 52, width: 116, height: 61 });
  });

  it('wraps only with whiteSpace=wrap', () => {
    expect(box('whiteSpace=wrap;').wrap).toBe(true);
    expect(box('text;').wrap).toBe(false);
  });

  it('puts an image’s label below it, its own height tall, never shrunk from top or bottom', () => {
    // draw.io’s `image` style: verticalLabelPosition=bottom, verticalAlign=top.
    expect(box('image;')).toEqual({ x: 102, y: 117, width: 116, height: 60, align: 'center', verticalAlign: 'top', wrap: false, anchor: { x: 160, y: 117 }, rotation: 0 });
  });

  it('puts a label beside its shape, the box its shape’s width wide and not shrunk from the sides', () => {
    expect(box('labelPosition=right;align=left;')).toMatchObject({ x: 222, y: 52, width: 120, height: 56, align: 'left' });
    expect(box('labelPosition=left;align=right;')).toMatchObject({ x: -22, width: 120, align: 'right' });
    expect(box('verticalLabelPosition=top;verticalAlign=bottom;')).toMatchObject({ y: -13, height: 60, verticalAlign: 'bottom' });
  });

  it('takes labelWidth for the box’s width, centred over the shape', () => {
    expect(box('labelWidth=200;')).toMatchObject({ x: 60, width: 200 });
  });

  it('turns the anchor with the shape, and a quarter back for words running up it', () => {
    const turned = drawioLabelBox(cell, resolveDrawioStyle('align=left;', 'vertex'), '', { x: 0, y: 0 }, 90);
    expect(turned.rotation).toBe(90);
    expect(turned.anchor.x).toBeCloseTo(160);
    expect(turned.anchor.y).toBeCloseTo(22);
    expect(box('horizontal=0;')).toMatchObject({ rotation: -90, width: 56, height: 116 });
  });

  it('survives a box of no size and spacing that is not a number', () => {
    const empty = drawioLabelBox({ x: 0, y: 0, width: 0, height: 0 }, resolveDrawioStyle('spacing=abc;spacingTop=NaN;', 'vertex'));
    expect([empty.x, empty.y, empty.width, empty.height].every(Number.isFinite)).toBe(true);
  });
});

describe('drawioLabelFit', () => {
  it('keeps the shape’s box when the label sits evenly inside it, and names the inset', () => {
    expect(drawioLabelFit(cell, box(''))).toEqual({ inside: true, padding: 2 });
    expect(drawioLabelFit(cell, box('spacing=6;'))).toEqual({ inside: true, padding: 6 });
  });

  it('needs a box of the label’s own when it sits outside or unevenly', () => {
    expect(drawioLabelFit(cell, box('text;spacingLeft=10;'))).toEqual({ inside: false, padding: 0 });
    // spacingTop=-5 undoes mxText’s 5px, so the words sit 2px in from both sides: one inset carries them.
    expect(drawioLabelFit(cell, box('text;spacingTop=-5;'))).toEqual({ inside: true, padding: 2 });
    expect(drawioLabelFit(cell, box('image;'))).toEqual({ inside: false, padding: 0 });
  });
});
