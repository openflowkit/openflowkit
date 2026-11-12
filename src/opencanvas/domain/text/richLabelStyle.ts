import { invertForDark } from '../color/adaptiveColor';
import type { NodeStyle } from '../nodes/nodeStyle';
import type { RichBase, RichPiece } from './richLabel';

/** What a node's rich label is set in where its runs don't say: the node's own resolved type and ink. */
export function richBaseOf(style: NodeStyle): RichBase {
  return {
    fontSize: style.fontSize, fontWeight: style.fontWeight, italic: style.fontStyle === 'italic',
    underline: style.textDecoration === 'underline', strike: style.textDecoration === 'line-through',
    color: style.textColor, lineHeight: style.lineHeight, align: style.textAlign,
  };
}

/** A piece's ink: a colour the run sets is flipped with the node's own in draw.io's dark mode; the node's ink already is. */
export function richInk(piece: RichPiece, style: NodeStyle): string {
  return style.invertColors && piece.color !== style.textColor ? invertForDark(piece.color) : piece.color;
}

/** Where a rich label's block sits in its node: the padded box, its top moved for the vertical alignment. */
export function richOrigin(style: NodeStyle, size: { readonly width: number; readonly height: number }, layout: { readonly width: number; readonly height: number }, wraps: boolean): { readonly x: number; readonly y: number } {
  const pad = style.textPadding;
  const room = { width: Math.max(0, size.width - pad * 2), height: Math.max(0, size.height - pad * 2) };
  const x = pad + (wraps ? 0 : style.textAlign === 'center' ? (room.width - layout.width) / 2 : style.textAlign === 'end' ? room.width - layout.width : 0);
  const y = pad + (style.textVerticalAlign === 'top' ? 0 : style.textVerticalAlign === 'bottom' ? room.height - layout.height : (room.height - layout.height) / 2);
  return { x, y };
}
