import type { Point2d } from '../../opencanvas/domain/geometry/types';
import { shapeLabelBounds } from './drawioShapeLabel';
import type { DrawioStyle } from './drawioStyle';

// Where draw.io lays out a shape's words: a port of mxGraphView.updateVertexLabelOffset, mxCellRenderer.getLabelBounds
// and rotateLabelBounds, and mxText.getSpacing. Nothing is measured: the box comes from the cell's box and its style
// alone, and the words are set against its `align` / `verticalAlign` point, spilling out past it when they don't fit.

export interface DrawioBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface DrawioLabelBox extends DrawioBox {
  readonly align: 'left' | 'center' | 'right';
  readonly verticalAlign: 'top' | 'middle' | 'bottom';
  /** `whiteSpace=wrap`: lines break at the box's width. Otherwise each line runs on past it. */
  readonly wrap: boolean;
  /** The point the words are set against, on the page (after any turn). */
  readonly anchor: Point2d;
  /** Degrees the words turn about the shape's centre: the shape's own turn, and a quarter back for `horizontal=0`. */
  readonly rotation: number;
}

/** draw.io reads spacing with parseInt; an unset side is 0, and every side gets `spacing` (2) on top. */
const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** draw.io sets top-aligned words 5px lower and bottom-aligned ones 1px higher than their spacing says (mxText.baseSpacing). */
const BASE_TOP = 5;
const BASE_BOTTOM = 1;

/**
 * The label box for a shape drawn at `cell` (page units, unturned) and turned by `rotation` degrees. `offset` is
 * the geometry's own label offset. The box is in the shape's unturned frame; `anchor` is where it lands on the page.
 */
export function drawioLabelBox(cell: DrawioBox, style: DrawioStyle, shape = '', offset: Point2d = { x: 0, y: 0 }, rotation = 0): DrawioLabelBox {
  const align = style.align === 'left' || style.align === 'right' ? style.align : 'center';
  const verticalAlign = style.verticalAlign === 'top' || style.verticalAlign === 'bottom' ? style.verticalAlign : 'middle';
  const beside = style.labelPosition === 'left' || style.labelPosition === 'right' ? style.labelPosition : 'center';
  const over = style.verticalLabelPosition === 'top' || style.verticalLabelPosition === 'bottom' ? style.verticalLabelPosition : 'middle';
  const labelWidth = Number.parseFloat(style.labelWidth ?? '');
  const fixedWidth = Number.isFinite(labelWidth) ? labelWidth : null;
  const horizontal = style.horizontal !== '0';
  const along = { left: 0, center: 0.5, right: 1 }[align];
  const down = { top: 0, middle: 0.5, bottom: 1 }[verticalAlign];
  // updateVertexLabelOffset: a label beside or over its shape moves a whole box over.
  let [ox, oy] = [offset.x, offset.y];
  if (beside === 'left') ox -= fixedWidth ?? cell.width;
  else if (beside === 'right') ox += cell.width;
  else if (fixedWidth !== null) ox -= (fixedWidth - cell.width) * along;
  if (over === 'top') oy -= cell.height;
  else if (over === 'bottom') oy += cell.height;
  // getLabelBounds: words running up the shape (`horizontal=0`) are laid out in its box turned a quarter.
  if (!horizontal) [ox, oy] = [oy, ox];
  let box: DrawioBox = { x: cell.x + ox, y: cell.y + oy, width: Math.max(1, cell.width), height: Math.max(1, cell.height) };
  if (!horizontal) {
    const shift = (cell.width - cell.height) / 2;
    box = { x: box.x + shift, y: box.y - shift, width: box.height, height: box.width };
  }
  if (beside === 'center' && over === 'middle') box = shapeLabelBounds(box, style, shape, horizontal);
  if (fixedWidth !== null) box = { ...box, width: fixedWidth };
  // rotateLabelBounds: from the box to the point the words are set against, moved in by the spacing on its side.
  let x = box.x + along * box.width;
  let y = box.y + down * box.height;
  let { width, height } = box;
  const overflow = style.overflow ?? 'visible';
  if (overflow !== 'fill' && overflow !== 'width' && (overflow !== 'block' || style.blockSpacing === '1')) {
    const spacing = int(style.spacing, 2);
    const [top, right, bottom, left] = ['spacingTop', 'spacingRight', 'spacingBottom', 'spacingLeft'].map((key) => int(style[key], 0) + spacing) as [number, number, number, number];
    const base = style.blockSpacing === '1' ? 0 : 1;
    x += { left, center: (left - right) / 2, right: -right }[align];
    y += { top: top + BASE_TOP * base, middle: (top - bottom) / 2, bottom: -bottom - BASE_BOTTOM * base }[verticalAlign];
    // The box shrinks by the spacing only where the label sits on the shape.
    width = Math.max(0, width - (beside === 'center' && fixedWidth === null ? left + right : 0));
    height = Math.max(0, height - (over === 'middle' ? top + bottom : 0));
  }
  const turn = rotation + (horizontal ? 0 : -90);
  let anchor = { x, y };
  if (turn !== 0) {
    const radians = (turn * Math.PI) / 180;
    const [cx, cy] = [cell.x + cell.width / 2, cell.y + cell.height / 2];
    const [dx, dy] = [x - cx, y - cy];
    anchor = { x: dx * Math.cos(radians) - dy * Math.sin(radians) + cx, y: dy * Math.cos(radians) + dx * Math.sin(radians) + cy };
  }
  // An overflow=fill label's block is the box's own height (mxSvgCanvas2D), so its words run from the top, wrapped.
  const fill = overflow === 'fill';
  return { x: x - along * width, y: y - down * height, width, height, align, verticalAlign: fill ? 'top' : verticalAlign, wrap: fill || style.whiteSpace === 'wrap', anchor, rotation: turn };
}

/** How far our wrap width may differ from draw.io's before the words get a box of their own. */
const WRAP_SLACK = 12;

/**
 * Whether the shape's own label can carry the words. Ours has one inset for every side (`textPadding`, 0–32) and
 * sets the words against the side or middle they are aligned to, so it can when one inset puts that point where
 * draw.io has it: a centred axis needs the point on the shape's middle, an aligned one fixes the inset. Otherwise
 * (beside or above the shape, turned against it, pulled two ways) the words need a box of their own.
 */
export function drawioLabelFit(cell: DrawioBox, label: DrawioLabelBox, rotation = 0): { readonly inside: boolean; readonly padding: number } {
  const outside = { inside: false, padding: 0 };
  if (label.rotation !== rotation) return outside;
  const x = label.x + { left: 0, center: 0.5, right: 1 }[label.align] * label.width;
  const y = label.y + { top: 0, middle: 0.5, bottom: 1 }[label.verticalAlign] * label.height;
  const insets: number[] = [];
  if (label.align === 'center') { if (Math.abs(x - (cell.x + cell.width / 2)) > 0.5) return outside; }
  else insets.push(label.align === 'left' ? x - cell.x : cell.x + cell.width - x);
  if (label.verticalAlign === 'middle') { if (Math.abs(y - (cell.y + cell.height / 2)) > 0.5) return outside; }
  else insets.push(label.verticalAlign === 'top' ? y - cell.y : cell.y + cell.height - y);
  if (insets.length === 2 && Math.abs(insets[0]! - insets[1]!) > 0.5) return outside;
  const padding = insets[0] ?? Math.min(32, Math.max(0, (cell.width - label.width) / 2));
  // Ours insets every side alike, so the inset has to leave room in the shape: words beside it are not inside it.
  if (padding < 0 || padding > 32 || padding * 2 > Math.min(cell.width, cell.height)) return outside;
  if (label.wrap && Math.abs(cell.width - 2 * padding - label.width) > WRAP_SLACK) return outside;
  return { inside: true, padding };
}
