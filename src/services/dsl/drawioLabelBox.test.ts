import { describe, expect, it } from 'vitest';
import { drawioLabelBox, drawioLabelFit } from './drawioLabelBox';
import { resolveDrawioStyle } from './drawioStyle';

// The box draw.io lays a label out in (mxCellRenderer.getLabelBounds, rotateLabelBounds, mxText.getSpacing).
const cell = { x: 100, y: 50, width: 120, height: 60 };
const box = (style: string) => drawioLabelBox(cell, resolveDrawioStyle(style, 'vertex'));

describe('drawioLabelBox', () => {
  it('insets a centred label by draw.io’s 2px on every side', () => {
    expect(box('')).toEqual({ x: 102, y: 52, width: 116, height: 56, align: 'center', verticalAlign: 'middle', wrap: false });
  });

  it('sets text against the side it is aligned to, inset by that side’s spacing', () => {
    expect(box('text;spacingLeft=10;')).toEqual({ x: 112, y: 52, width: 106, height: 56, align: 'left', verticalAlign: 'top', wrap: false });
    expect(box('align=right;verticalAlign=bottom;spacingRight=8;spacingBottom=4;')).toMatchObject({ x: 102, y: 52, width: 108, height: 52 });
  });

  it('moves a label by a negative spacing, as the blog wireframe’s spacingTop=-5 does', () => {
    expect(box('text;spacingTop=-5;')).toMatchObject({ x: 102, y: 47, width: 116, height: 61 });
  });

  it('wraps only with whiteSpace=wrap', () => {
    expect(box('whiteSpace=wrap;').wrap).toBe(true);
    expect(box('text;').wrap).toBe(false);
  });

  it('puts an image’s label below it, its own height tall, never shrunk from top or bottom', () => {
    // draw.io’s `image` style: verticalLabelPosition=bottom, verticalAlign=top.
    expect(box('image;')).toEqual({ x: 102, y: 112, width: 116, height: 60, align: 'center', verticalAlign: 'top', wrap: false });
  });

  it('puts a label beside its shape, the box its shape’s width wide and not shrunk from the sides', () => {
    expect(box('labelPosition=right;align=left;')).toMatchObject({ x: 222, y: 52, width: 120, height: 56, align: 'left' });
    expect(box('labelPosition=left;align=right;')).toMatchObject({ x: -22, width: 120, align: 'right' });
    expect(box('verticalLabelPosition=top;verticalAlign=bottom;')).toMatchObject({ y: -12, height: 60, verticalAlign: 'bottom' });
  });

  it('takes labelWidth for the box’s width, centred over the shape', () => {
    expect(box('labelWidth=200;')).toMatchObject({ x: 60, width: 200 });
  });
});

describe('drawioLabelFit', () => {
  it('keeps the shape’s box when the label sits evenly inside it, and names the inset', () => {
    expect(drawioLabelFit(cell, box(''))).toEqual({ inside: true, padding: 2 });
    expect(drawioLabelFit(cell, box('spacing=6;'))).toEqual({ inside: true, padding: 6 });
  });

  it('needs a box of the label’s own when it sits outside or unevenly', () => {
    expect(drawioLabelFit(cell, box('text;spacingTop=-5;'))).toEqual({ inside: false, padding: 0 });
    expect(drawioLabelFit(cell, box('image;'))).toEqual({ inside: false, padding: 0 });
  });
});
