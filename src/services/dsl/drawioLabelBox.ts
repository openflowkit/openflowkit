import type { DrawioStyle } from './drawioStyle';

// Where draw.io lays out a shape's words: a port of mxCellRenderer.getLabelBounds and rotateLabelBounds with
// mxText.getSpacing. Nothing is measured: the box comes from the cell's box and its style alone, and the words are
// set against its `align` / `verticalAlign` side, spilling out past it when they don't fit.

export interface DrawioBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface DrawioLabelBox extends DrawioBox {
  readonly align: 'left' | 'center' | 'right';
  readonly verticalAlign: 'top' | 'middle' | 'bottom';
  /** `whiteSpace=wrap`: lines break at the box's width. Otherwise each line runs on past it. */
  readonly wrap: boolean;
}

/** draw.io reads spacing with parseInt; an unset side is 0, and every side gets `spacing` (2) on top. */
const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** The label box for a shape drawn at `cell` (page units). ponytail: a turned label (`horizontal=0`) is left upright. */
export function drawioLabelBox(cell: DrawioBox, style: DrawioStyle): DrawioLabelBox {
  const align = style.align === 'left' || style.align === 'right' ? style.align : 'center';
  const verticalAlign = style.verticalAlign === 'top' || style.verticalAlign === 'bottom' ? style.verticalAlign : 'middle';
  const beside = style.labelPosition === 'left' || style.labelPosition === 'right' ? style.labelPosition : 'center';
  const over = style.verticalLabelPosition === 'top' || style.verticalLabelPosition === 'bottom' ? style.verticalLabelPosition : 'middle';
  const labelWidth = Number.parseFloat(style.labelWidth ?? '');
  const fixedWidth = Number.isFinite(labelWidth) ? labelWidth : null;
  const spacing = int(style.spacing, 2);
  const [top, right, bottom, left] = ['spacingTop', 'spacingRight', 'spacingBottom', 'spacingLeft'].map((key) => int(style[key], 0) + spacing) as [number, number, number, number];
  // updateVertexLabelOffset: a label beside or over its shape moves a whole box over.
  let x = cell.x;
  let y = cell.y;
  if (beside === 'left') x -= fixedWidth ?? cell.width;
  else if (beside === 'right') x += cell.width;
  else if (fixedWidth !== null) x -= (fixedWidth - cell.width) * (align === 'center' ? 0.5 : align === 'right' ? 1 : 0);
  if (over === 'top') y -= cell.height;
  else if (over === 'bottom') y += cell.height;
  // rotateLabelBounds: the box shrinks by the spacing only where the label sits on the shape.
  const width = Math.max(0, (fixedWidth ?? cell.width) - (beside === 'center' && fixedWidth === null ? left + right : 0));
  const height = Math.max(0, cell.height - (over === 'middle' ? top + bottom : 0));
  // The words' anchor (the box's left edge, middle or right edge) moves in by the spacing on its side.
  const startX = { left: x + left, center: x + (fixedWidth ?? cell.width) / 2 + (left - right) / 2, right: x + (fixedWidth ?? cell.width) - right }[align];
  const startY = { top: y + top, middle: y + cell.height / 2 + (top - bottom) / 2, bottom: y + cell.height - bottom }[verticalAlign];
  const along = { left: 0, center: 0.5, right: 1 }[align];
  const down = { top: 0, middle: 0.5, bottom: 1 }[verticalAlign];
  return { x: startX - along * width, y: startY - down * height, width, height, align, verticalAlign, wrap: style.whiteSpace === 'wrap' };
}

/**
 * Whether the shape's own label can carry the words: when the label box is the shape's box inset evenly, its inset
 * is our one `textPadding` (0–32). Otherwise the words need a box of their own.
 */
export function drawioLabelFit(cell: DrawioBox, label: DrawioBox): { readonly inside: boolean; readonly padding: number } {
  const inset = label.x - cell.x;
  const even = [label.y - cell.y, cell.x + cell.width - label.x - label.width, cell.y + cell.height - label.y - label.height]
    .every((side) => Math.abs(side - inset) < 1e-6);
  return even && inset >= 0 && inset <= 32 ? { inside: true, padding: inset } : { inside: false, padding: 0 };
}
