import { FONT_STACKS, type NodeStyle } from '../../domain/nodes/nodeStyle';
import type { SceneNode } from '../../domain/document/types';
import type { Bounds2d, Point2d, Size2d } from '../../domain/geometry/types';
import { basicNodeDecorations } from '../../domain/nodes/basicNodeDecorations';
import type { BasicNodeShape } from '../../domain/nodes/basicNodePresentation';
import type { IconCardText } from '../../domain/nodes/iconCardLayout';
import { resolveLabelSizing } from '../../domain/node-sizing/labelWrap';
import { measurePortableText, SUBLABEL_FONT } from '../../domain/text/measurement';
import { layoutRichLabel, richLabelOf, type RichBlock } from '../../domain/text/richLabel';
import { richBaseOf, richInk, richOrigin } from '../../domain/text/richLabelStyle';
import { number, pathData, xml } from './svgMarkup';

const SUB_LABEL_SIZE = SUBLABEL_FONT.fontSize;

/** The font attributes of a node's label text, as the canvas styles it. */
function labelAttributes(style: NodeStyle): string {
  const common = `fill="${style.textColor}" font-family="${xml(FONT_STACKS[style.fontFamily])}" font-size="${number(style.fontSize)}" font-weight="${style.fontWeight}"`;
  const decoration = style.textDecoration === 'none' ? '' : ` text-decoration="${style.textDecoration}"`;
  const styleAttr = style.fontStyle === 'normal' ? common : `${common} font-style="italic"`;
  const spacing = style.letterSpacing === 0 ? '' : ` letter-spacing="${number(style.letterSpacing * style.fontSize)}"`;
  return `${styleAttr}${decoration}${spacing}`;
}

/** An icon card's caption, one `<tspan>` per line of the layout the canvas draws, so both break and align alike. */
export function iconCaptionMarkup(text: IconCardText | null, style: NodeStyle): string {
  if (!text) return '';
  const lines = (rows: readonly string[], top: number, height: number) => rows
    .map((line, index) => `<tspan x="${number(text.x)}" y="${number(top + (index + 0.5) * height)}">${xml(line)}</tspan>`).join('');
  return (text.lines.length ? `<text text-anchor="${text.anchor}" dominant-baseline="middle" ${labelAttributes(style)}>${lines(text.lines, text.top, text.lineHeight)}</text>` : '')
    + (text.subLines.length ? `<text text-anchor="${text.anchor}" dominant-baseline="middle" fill="${style.textColor}" font-family="${xml(FONT_STACKS[style.fontFamily])}" font-size="${SUB_LABEL_SIZE}" font-weight="400" opacity="0.72">${lines(text.subLines, text.subTop, text.subLineHeight)}</text>` : '');
}

// The label sits in `nodeLabelBounds`, the rect the Pixi renderers and the DOM
// editor use: a frame's title band, the canvas below an icon plate, a shape's inset.
export function labelElement(style: NodeStyle, box: Bounds2d, label: string, subLabel: string, clipId: string | null, node: SceneNode): string {
  const rich = label ? richLabelOf(node.content) : null;
  if (rich) return richLabelElement(style, box, rich, clipId, node);
  const padding = style.textPadding;
  const x = style.textAlign === 'start' ? box.x + padding
    : style.textAlign === 'end' ? box.x + box.width - padding : box.x + box.width / 2;
  const anchor = style.textAlign === 'start' ? 'start' : style.textAlign === 'end' ? 'end' : 'middle';
  const baseline = style.textVerticalAlign === 'top' ? 'hanging' : style.textVerticalAlign === 'bottom' ? 'auto' : 'middle';
  // Label and sub-label wrap like the canvas draws them (PixiNodeRenderer): the node's width less
  // padding, its sizing policy's line cap and overflow; the sub-label is 11px/400.
  const sizing = resolveLabelSizing(node, style);
  const wrapped = sizing.overflow !== 'visible';
  const wrap = !wrapped ? {}
    : { maxWidth: Math.max(1, node.size.width - padding * 2), maxLines: sizing.maxLines, overflow: sizing.overflow };
  const labelLines = !wrapped ? [label] : measurePortableText(label, {
    fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.fontSize * style.lineHeight, keepWords: style.keepWords, ...wrap,
  }).lines;
  const subLines = subLabel ? measurePortableText(subLabel, {
    ...SUBLABEL_FONT, lineHeight: SUB_LABEL_SIZE * 1.2,
    ...wrap,
  }).lines : [];
  // Label and sub-label stack as one block, 4px apart, like `layoutNodeContent`.
  const lineHeight = style.fontSize * style.lineHeight;
  const stacked = subLines.length > 0 || labelLines.length > 1;
  const labelHeight = labelLines.length * lineHeight;
  const blockHeight = stacked ? labelHeight + (subLines.length ? 4 + subLines.length * SUB_LABEL_SIZE * 1.2 : 0) : 0;
  const blockTop = style.textVerticalAlign === 'top' ? box.y + padding
    : style.textVerticalAlign === 'bottom' ? box.y + box.height - padding - blockHeight
      : box.y + (box.height - blockHeight) / 2;
  const y = stacked ? blockTop + lineHeight / 2
    : style.textVerticalAlign === 'top' ? box.y + padding
      : style.textVerticalAlign === 'bottom' ? box.y + box.height - padding
        : box.y + box.height / 2;
  const subY = (line: number) => blockTop + labelHeight + 4 + (line + 0.5) * SUB_LABEL_SIZE * 1.2;
  const stretch = clipId ? ` clip-path="url(#${clipId})"` : '';
  return `<g${stretch}>`
    + `<text x="${number(x)}" y="${number(y)}" text-anchor="${anchor}" dominant-baseline="${stacked ? 'middle' : baseline}" ${labelAttributes(style)}>${labelLines.length > 1
      ? labelLines.map((line, index) => `<tspan x="${number(x)}" y="${number(y + index * lineHeight)}">${xml(line)}</tspan>`).join('') : xml(label)}</text>`
    + (subLines.length ? `<text text-anchor="${anchor}" dominant-baseline="middle" fill="${style.textColor}" font-family="${xml(FONT_STACKS[style.fontFamily])}" font-size="${SUB_LABEL_SIZE}" font-weight="400" opacity="0.72">${subLines.map((line, index) => `<tspan x="${number(x)}" y="${number(subY(index))}">${xml(line)}</tspan>`).join('')}</text>` : '')
    + '</g>';
}

/**
 * A rich label: one `<text>` a line, its runs as `<tspan>`s flowing in the viewer's own font from the side the line is
 * aligned to, so they meet as the canvas sets them; where lines break is the shared layout's. Dividers are lines.
 */
function richLabelElement(style: NodeStyle, box: Bounds2d, blocks: readonly RichBlock[], clipId: string | null, node: SceneNode): string {
  const wraps = resolveLabelSizing(node, style).overflow !== 'visible';
  const layout = layoutRichLabel(blocks, richBaseOf(style), wraps ? Math.max(1, box.width - style.textPadding * 2) : null, { keepWords: style.keepWords, box: Math.max(0, box.width - style.textPadding * 2) });
  const origin = richOrigin(style, box, layout, wraps);
  const [left, top] = [box.x + origin.x, box.y + origin.y];
  const family = xml(FONT_STACKS[style.fontFamily]);
  const lines = layout.lines.filter((line) => line.pieces.length).map((line) => {
    const anchor = line.align === 'center' ? 'middle' : line.align === 'end' ? 'end' : 'start';
    const x = left + (line.align === 'center' ? (line.left + line.right) / 2 : line.align === 'end' ? line.right : line.left);
    const spans = line.pieces.map((piece) => {
      const decoration = [piece.underline ? 'underline' : '', piece.strike ? 'line-through' : ''].filter(Boolean).join(' ');
      return `<tspan fill="${richInk(piece, style)}" font-size="${number(piece.size)}" font-weight="${piece.weight}"${piece.italic ? ' font-style="italic"' : ''}${decoration ? ` text-decoration="${decoration}"` : ''}>${xml(piece.text)}</tspan>`;
    }).join('');
    return `<text x="${number(x)}" y="${number(top + line.y + line.baseline)}" text-anchor="${anchor}" font-family="${family}" xml:space="preserve">${spans}</text>`;
  }).join('');
  const rules = layout.rules.map((rule) => `<line x1="${number(box.x + style.textPadding)}" x2="${number(box.x + box.width - style.textPadding)}" y1="${number(top + rule.y)}" y2="${number(top + rule.y)}" stroke="${style.textColor}" stroke-width="1"/>`).join('');
  return `<g${clipId ? ` clip-path="url(#${clipId})"` : ''}>${lines}${rules}</g>`;
}

export function outlineMarkup(
  outline: readonly Point2d[],
  style: NodeStyle,
  filter: string
): string {
  const fill = style.fill;
  const stroke = style.strokeWidth > 0 ? style.stroke : 'none';
  const dash = style.dash.length ? ` stroke-dasharray="${style.dash.map(number).join(' ')}"` : '';
  const rect = outline.length === 4 ? plainRect(outline) : null;
  const shape = rect
    ? `<rect x="${number(rect.x)}" y="${number(rect.y)}" width="${number(rect.width)}" height="${number(rect.height)}"${style.cornerRadius > 0 ? ` rx="${number(style.cornerRadius)}"` : ''} fill="${fill}" stroke="${stroke}" stroke-width="${number(style.strokeWidth)}"${dash}${filter}/>`
    : `<path d="${pathData(outline)}" fill="${fill}" stroke="${stroke}" stroke-width="${number(style.strokeWidth)}"${dash}${filter}/>`;
  return shape;
}

/** Axis-aligned rectangle when the outline is one, so `rx` can round it. */
function plainRect(outline: readonly Point2d[]): { x: number; y: number; width: number; height: number } | null {
  const xs = [...new Set(outline.map(({ x }) => Math.round(x * 1000) / 1000))].sort((a, b) => a - b);
  const ys = [...new Set(outline.map(({ y }) => Math.round(y * 1000) / 1000))].sort((a, b) => a - b);
  if (xs.length !== 2 || ys.length !== 2) return null;
  return { x: xs[0]!, y: ys[0]!, width: xs[1]! - xs[0]!, height: ys[1]! - ys[0]! };
}

/** Inner lines (venn lens, target rings, note fold) in the node's stroke. */
export function decorationMarkup(shape: BasicNodeShape, size: Size2d, style: NodeStyle): string {
  if (style.strokeWidth <= 0) return '';
  const stroke = style.stroke === 'transparent' || !style.stroke ? 'none' : style.stroke;
  if (stroke === 'none') return '';
  const dash = style.dash.length ? ` stroke-dasharray="${style.dash.map(number).join(' ')}"` : '';
  // Node space: the enclosing <g> already carries the node's transform.
  return basicNodeDecorations(shape, size).map((line) => {
    const [first, ...rest] = line;
    if (!first) return '';
    return `<path d="M ${number(first.x)} ${number(first.y)}`
      + rest.map((point) => ` L ${number(point.x)} ${number(point.y)}`).join('')
      + `" fill="none" stroke="${stroke}" stroke-width="${number(style.strokeWidth)}"${dash}/>`;
  }).join('');
}
