import { CanvasTextMetrics, Container, Graphics, TextStyle } from 'pixi.js';
import { applyMatrixToPoint } from '../../domain/geometry/matrix';
import type { Matrix2d } from '../../domain/geometry/types';
import { FONT_STACKS, type NodeStyle } from '../../domain/nodes/nodeStyle';
import { layoutRichLabel, type MeasureText, type RichBlock } from '../../domain/text/richLabel';
import { richBaseOf, richBoxColor, richInk, richOrigin } from '../../domain/text/richLabelStyle';
import { pixiPaintColor } from './pixiColor';
import { markTitle } from './pixiText';
import type { PixiTextPool } from './pixiTextPool';

// A rich label on the canvas: each run of words is its own Text, measured in the real font so the runs on a line
// meet, with underlines, strike lines and dividers ruled under them. The block is placed and turned as its node is.

const styles = new Map<string, TextStyle>();
function styleOf(family: string, size: number, weight: number, italic: boolean): TextStyle {
  const key = `${family}|${size}|${weight}|${italic}`;
  let style = styles.get(key);
  if (!style) styles.set(key, style = new TextStyle({ fontFamily: family, fontSize: size, fontWeight: String(weight) as '400', fontStyle: italic ? 'italic' : 'normal' }));
  return style;
}
const measurer = (family: string): MeasureText => (text, size, weight, italic) => CanvasTextMetrics.measureText(text, styleOf(family, size, weight, italic)).width;

/** Draws `blocks` into `parent` for a node of `size` placed by `matrix`; `wraps` when its words break at its width. */
export function drawPixiRichLabel(
  parent: Container, texts: PixiTextPool, blocks: readonly RichBlock[], style: NodeStyle,
  size: { readonly width: number; readonly height: number }, matrix: Matrix2d, wraps: boolean,
): void {
  const family = FONT_STACKS[style.fontFamily];
  const width = wraps ? Math.max(1, size.width - style.textPadding * 2) : null;
  const layout = layoutRichLabel(blocks, richBaseOf(style), width, { keepWords: style.keepWords, measure: measurer(family), box: Math.max(0, size.width - style.textPadding * 2), height: Math.max(0, size.height - style.textPadding * 2) });
  const origin = richOrigin(style, size, layout, wraps);
  const block = new Container();
  const placed = applyMatrixToPoint(matrix, origin);
  block.position.set(placed.x, placed.y);
  block.rotation = Math.atan2(matrix.b, matrix.a);
  // Paragraph backgrounds sit under the words.
  const bands = new Graphics();
  for (const band of layout.bands) bands.rect(band.x, band.y, band.width, band.height).fill({ color: pixiPaintColor(richBoxColor(band, style), 0xe4e4e4).color });
  // Lines around table cells, over their fills.
  for (const edge of layout.borders) bands.rect(edge.x + 0.5, edge.y + 0.5, Math.max(0, edge.width - 1), Math.max(0, edge.height - 1)).stroke({ width: 1, color: pixiPaintColor(richBoxColor(edge, style), 0x808080).color });
  block.addChild(bands);
  const rules = new Graphics();
  for (const line of layout.lines) {
    for (const piece of line.pieces) {
      if (!piece.text.trim()) continue;
      const ink = pixiPaintColor(richInk(piece, style), 0x1e293b).color;
      const text = markTitle(texts.plain(piece.text, { size: piece.size, weight: String(piece.weight), fill: ink, family, style: piece.italic ? 'italic' : 'normal' }));
      // A Text is drawn from its top; its letters sit `ascent` below it, on the line's baseline.
      const { ascent } = CanvasTextMetrics.measureText(piece.text, styleOf(family, piece.size, piece.weight, piece.italic)).fontProperties;
      text.anchor.set(0, 0);
      text.position.set(piece.x, line.y + line.baseline - ascent);
      block.addChild(text);
      const thickness = Math.max(1, piece.size / 14);
      if (piece.underline) rules.rect(piece.x, line.y + line.baseline + piece.size * 0.12, piece.width, thickness).fill({ color: ink });
      if (piece.strike) rules.rect(piece.x, line.y + line.baseline - piece.size * 0.3, piece.width, thickness).fill({ color: ink });
    }
  }
  // A divider runs the label box's width, in the words' ink, as a browser rules draw.io's `<hr>`.
  const divider = pixiPaintColor(style.textColor, 0x1e293b).color;
  for (const rule of layout.rules) rules.rect(style.textPadding - origin.x, rule.y - 0.5, Math.max(0, size.width - style.textPadding * 2), 1).fill({ color: divider });
  block.addChild(rules);
  parent.addChild(block);
}
