import { describe, expect, it } from 'vitest';
import type { DrawioLabelBox } from './drawioLabelBox';
import { centreOf, labelLayout, labelNode, placeBox } from './drawioLabelNode';

// draw.io's boxes as our transforms: draw.io turns a shape about its centre and never turns its children with
// it; ours turn about their top-left corner and carry their children.
const box = { x: 10, y: 20, width: 100, height: 50 };
const label = (extra: Partial<DrawioLabelBox> = {}): DrawioLabelBox =>
  ({ ...box, align: 'center', verticalAlign: 'middle', wrap: false, anchor: { x: 60, y: 45 }, rotation: 0, ...extra });

describe('placeBox', () => {
  it('puts an unturned box at its own corner on the page', () => {
    const placed = placeBox(null, box, 0, centreOf(box));
    expect(placed.transform).toEqual({ translation: { x: 10, y: 20 }, rotationRadians: 0, scale: { x: 1, y: 1 } });
    expect(placed.matrix).toMatchObject({ tx: 10, ty: 20 });
  });

  it('moves the corner round the centre for a turned box', () => {
    // (10, 20) is 50 left of and 25 above the centre (60, 45): a quarter turn puts it 25 right and 50 above.
    const { transform } = placeBox(null, box, 90, centreOf(box));
    expect(transform.translation.x).toBeCloseTo(85);
    expect(transform.translation.y).toBeCloseTo(-5);
    expect(transform.rotationRadians).toBeCloseTo(Math.PI / 2);
  });

  it('places a box inside its parent’s own coordinates, taking the parent’s turn back out', () => {
    const parent = placeBox(null, { x: 100, y: 100, width: 200, height: 200 }, 90, { x: 200, y: 200 });
    const child = placeBox(parent.matrix, box, 0, centreOf(box));
    // The child is upright on the page, so inside a parent turned a quarter it is turned a quarter back.
    expect(child.transform.rotationRadians).toBeCloseTo(-Math.PI / 2);
    expect(child.matrix.tx).toBeCloseTo(10);
    expect(child.matrix.ty).toBeCloseTo(20);
    expect(child.matrix.a).toBeCloseTo(1);
    expect(child.matrix.b).toBeCloseTo(0);
  });

  it('falls back to the page for a parent squashed flat, which has no inside to place in', () => {
    const flat = { a: 0, b: 0, c: 0, d: 0, tx: 5, ty: 5 };
    expect(placeBox(flat, box, 0, centreOf(box)).transform.translation).toEqual({ x: 10, y: 20 });
  });
});

describe('labelLayout and labelNode', () => {
  it('reads draw.io’s sides as ours, and wraps only when the cell does', () => {
    expect(labelLayout(label({ align: 'left', verticalAlign: 'top', wrap: true }), 4)).toMatchObject({
      appearance: { textAlign: 'start', textVerticalAlign: 'top', textPadding: 4 }, sizingPolicy: { overflow: 'wrap', maxLines: 100 },
    });
    expect(labelLayout(label({ align: 'right', verticalAlign: 'bottom' }), 0)).toMatchObject({
      appearance: { textAlign: 'end', textVerticalAlign: 'bottom', textPadding: 0 }, sizingPolicy: { overflow: 'visible' },
    });
  });

  it('keeps words whole in a wrapping label, and says nothing for one that does not wrap', () => {
    expect(labelLayout(label({ wrap: true }), 0).appearance.keepWords).toBe(true);
    expect(labelLayout(label({ wrap: false }), 0).appearance).not.toHaveProperty('keepWords');
  });

  it('makes a bare box of words at the label box, in the cell’s type, with no fill or line', () => {
    const node = labelNode({
      id: 'a:label', box: label(), label: 'Hello', paint: { fontSize: 14, textColor: '#ff0000' },
      placement: placeBox(null, box, 0, centreOf(box)), base: { parentId: 'a', layerId: 'default', zIndex: 0 },
    });
    expect(node).toMatchObject({
      id: 'a:label', parentId: 'a', size: { width: 100, height: 50 }, transform: { translation: { x: 10, y: 20 } },
      content: { label: 'Hello', shape: 'rectangle' },
      appearance: { fill: 'transparent', stroke: 'transparent', fontSize: 14, textColor: '#ff0000', textAlign: 'center', textPadding: 0 },
    });
  });

  it('gives a label box of no size a 1px box, so the node is still valid', () => {
    const empty = label({ width: 0, height: 0 });
    const node = labelNode({ id: 'x', box: empty, label: 'x', paint: {}, placement: placeBox(null, empty, 0, centreOf(empty)), base: { parentId: null, layerId: 'default', zIndex: 0 } });
    expect(node.size).toEqual({ width: 1, height: 1 });
  });
});
