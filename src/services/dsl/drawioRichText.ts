import type { RichAlign, RichBlock, RichCell, RichRun } from '../../opencanvas/domain/text/richLabel';
import { withoutClosingBreaks, withoutCode } from './drawioStyle';
import { decodeEntities } from './xmlReader';
import { cssColorName } from './cssColorNames';

// draw.io's `html=1` labels as our rich labels: paragraphs (`p`, `div`, headings) with their alignment, indent,
// margins, padding and background, tables as rows of cells in columns, `hr` dividers, `br` breaks, and words made bold, italic, underlined, struck, coloured or resized by tags
// (`b`, `i`, `u`, `font`, …) or inline CSS. Margins follow a browser's defaults, as draw.io's labels are set by one.
// No DOM: the importer runs off the main thread.

/** `<font size>` 1–7 in px, as a browser sets it. */
const FONT_SIZES = [10, 13, 16, 18, 24, 32, 48];
/** Blocks: each starts and ends a paragraph. */
const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote', 'pre', 'table', 'tbody', 'thead', 'tr', 'center']);
/** A heading's size and its margin above and below, in ems of its own size, as a browser's stylesheet has them. */
const HEADINGS: Readonly<Record<string, readonly [number, number]>> = { h1: [2, 0.67], h2: [1.5, 0.83], h3: [1.17, 1], h4: [1, 1.33], h5: [0.83, 1.67], h6: [0.67, 2.33] };
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'col', 'area', 'source']);

type Inline = Omit<RichRun, 'text'>;
interface Settings { readonly align?: RichAlign; readonly indent: number; readonly before: number; readonly after: number; readonly background?: string; readonly padding: number }
interface Frame { readonly tag: string; readonly inline: Inline; readonly block: boolean; readonly settings?: Settings }

function css(style: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (style ?? '').split(';')) {
    const at = part.indexOf(':');
    if (at > 0) out.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim().toLowerCase());
  }
  return out;
}

/** A CSS length in px (`px`, `pt`, `em` of `em`, or a bare number); NaN when it isn't one. */
function px(value: string | undefined, em: number): number {
  const match = /^(-?[\d.]+)\s*(px|pt|em|rem|%)?$/.exec(value?.trim() ?? '');
  if (!match) return Number.NaN;
  const amount = Number(match[1]);
  return match[2] === 'pt' ? (amount * 4) / 3 : match[2] === 'em' || match[2] === 'rem' ? amount * em : match[2] === '%' ? (amount / 100) * em : amount;
}

function hex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (rgb && (rgb[4] === undefined || Number(rgb[4]) > 0)) return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`;
  return cssColorName(value);
}

interface Paint { readonly background?: string; readonly border?: string; readonly keep?: readonly ('background' | 'border')[] }

/**
 * A table part's own fill and the colour of its lines. Colours set in CSS flip in draw.io's dark mode; those set by
 * HTML attributes (`bgcolor`, `bordercolor`) are kept, as draw.io rewrites only CSS colours.
 */
function paintOf(attrs: Map<string, string>): Paint {
  const style = css(attrs.get('style'));
  const styled = hex(style.get('background-color') ?? style.get('background'));
  const background = styled ?? hex(attrs.get('bgcolor'));
  const line = hex(style.get('border-color') ?? (style.get('border') ?? '').split(/\s+(?![^(]*\))/).find((part) => hex(part)));
  const border = line ?? hex(attrs.get('bordercolor'));
  const keep = [...(background && !styled ? ['background' as const] : []), ...(border && !line ? ['border' as const] : [])];
  return { ...(background ? { background } : {}), ...(border ? { border } : {}), ...(keep.length ? { keep } : {}) };
}

/** What a tag and its inline CSS set on the words inside it, over `outer`. */
function inlineOf(tag: string, attrs: Map<string, string>, outer: Inline, base: number): Inline {
  const next: { -readonly [K in keyof Inline]: Inline[K] } = { ...outer };
  const em = outer.size ?? base;
  if (tag === 'b' || tag === 'strong' || tag === 'th') next.bold = true;
  if (tag === 'i' || tag === 'em') next.italic = true;
  if (tag === 'u' || tag === 'ins') next.underline = true;
  if (tag === 's' || tag === 'strike' || tag === 'del') next.strike = true;
  if (HEADINGS[tag]) { next.bold = true; next.size = HEADINGS[tag]![0] * em; }
  if (tag === 'font') {
    const color = hex(attrs.get('color'));
    if (color) next.color = color;
    const size = Number(attrs.get('size'));
    if (Number.isInteger(size) && size >= 1 && size <= 7) next.size = FONT_SIZES[size - 1];
  }
  const style = css(attrs.get('style'));
  const size = px(style.get('font-size'), em);
  // A size the words already have (`font-size: 1em`) sets nothing.
  if (size > 0 && size !== em) next.size = size;
  const color = hex(style.get('color'));
  if (color) next.color = color;
  const weight = style.get('font-weight');
  if (weight) next.bold = weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
  const fontStyle = style.get('font-style');
  if (fontStyle) next.italic = fontStyle === 'italic' || fontStyle === 'oblique';
  const decoration = style.get('text-decoration') ?? style.get('text-decoration-line');
  if (decoration) {
    if (decoration.includes('underline')) next.underline = true;
    if (decoration.includes('line-through')) next.strike = true;
    if (decoration === 'none') { next.underline = false; next.strike = false; }
  }
  return next;
}

/** A block's own margins, indent and alignment: its CSS over a browser's defaults for the tag. */
function blockOf(tag: string, attrs: Map<string, string>, size: number): Settings {
  const style = css(attrs.get('style'));
  const heading = HEADINGS[tag];
  const fallback = tag === 'p' ? size : heading ? heading[1] * size : tag === 'ul' || tag === 'ol' || tag === 'blockquote' ? size : 0;
  const box = (style.get('margin') ?? '').split(/\s+/).filter(Boolean).map((part) => px(part, size));
  // CSS's shorthand: one value for all sides, two for top-bottom and left-right, three for top, sides, bottom.
  const [top, , bottom, left] = box.length === 1 ? [box[0], box[0], box[0], box[0]] : box.length === 2 ? [box[0], box[1], box[0], box[1]] : box.length === 3 ? [box[0], box[1], box[2], box[1]] : box;
  const pick = (own: string, shorthand: number | undefined, otherwise: number) => {
    const value = px(style.get(own), size);
    if (Number.isFinite(value)) return value;
    return shorthand !== undefined && Number.isFinite(shorthand) ? shorthand : otherwise;
  };
  const listIndent = tag === 'ul' || tag === 'ol' ? 40 : tag === 'blockquote' ? 40 : 0;
  const pad = px(style.get('padding-left'), size);
  const indent = Math.max(0, pick('margin-left', left, listIndent) + (Number.isFinite(pad) ? pad : 0));
  // `padding: 2px` pads the paragraph inside its background; a side's own padding moves only its words in.
  const padding = Math.max(0, px((style.get('padding') ?? '').split(/\s+/)[0], size) || 0);
  const background = hex(style.get('background-color') ?? style.get('background'));
  const textAlign = style.get('text-align') ?? (tag === 'center' ? 'center' : undefined);
  const align = textAlign === 'center' ? 'center' : textAlign === 'right' || textAlign === 'end' ? 'end' : textAlign === 'left' || textAlign === 'start' || textAlign === 'justify' ? 'start' : undefined;
  return { ...(align ? { align } : {}), ...(background ? { background } : {}), padding, indent, before: Math.max(0, pick('margin-top', top, fallback)), after: Math.max(0, pick('margin-bottom', bottom, fallback)) };
}

const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const TABLE_PARTS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);

/**
 * draw.io's HTML label as rich blocks, `base` its cell's font size; null when nothing in it is formatted (plain
 * words and line breaks), so the plain label says it all. `align` is the cell's: a header cell (`th`) centres its
 * words only under a centred label (`labelAlign`), as a browser's `th` does under its parent's left or right alignment.
 */
export function drawioRichLabel(value: string, base: number, labelAlign = 'center'): { readonly blocks: readonly RichBlock[] } | null {
  const html = withoutClosingBreaks(withoutCode(value));
  const blocks: RichBlock[] = [];
  const stack: Frame[] = [];
  /**
   * The open table (`cellpadding` its cells' padding, a browser's 1 when unset; `border` the colour of the lines
   * around its cells), its row's cells and own colours, and the cell filling.
   */
  let table: { readonly id: number; readonly padding: number; readonly full: boolean; readonly fill: boolean; readonly border?: string; readonly keepBorder?: boolean } | null = null;
  let tables = 0;
  /** How deep inside a cell's own tables the words are (0: in the outer table, or none). */
  let nested = 0;
  let row: RichCell[] | null = null;
  let rowPaint: Paint = {};
  let cell: Omit<RichCell, 'runs'> | null = null;
  /** The paragraph being filled: its runs, and the block settings it opened with. */
  let runs: RichRun[] = [];
  let open: { align?: RichAlign; indent: number; before: number; background?: string; padding: number } = { indent: 0, before: 0, padding: 0 };
  let pendingAfter = 0;
  let pendingBefore = 0;
  const inline = (): Inline => stack.at(-1)?.inline ?? {};
  const blockSettings = () => {
    // The innermost block's alignment wins; indents add up, as nested margins do.
    let align: RichAlign | undefined;
    let indent = 0;
    for (const frame of stack) {
      const own = frame.settings;
      if (!own) continue;
      if (own.align) align = own.align;
      indent += own.indent;
    }
    // Only the innermost paragraph's own background and padding are its; ponytail: an outer one's band is not drawn.
    const inner = stack.findLast((frame) => frame.settings)?.settings;
    return { ...(align ? { align } : {}), indent, padding: inner?.padding ?? 0, ...(inner?.background ? { background: inner.background } : {}) };
  };
  const flush = () => {
    const words = runs.some((run) => run.text.trim() !== '' || run.text.includes('\n'));
    if (words) {
      // Spaces at a paragraph's start and end are not set, as a browser collapses them.
      const first = runs[0]!;
      runs[0] = { ...first, text: first.text.replace(/^ +/, '') };
      const last = runs.at(-1)!;
      runs[runs.length - 1] = { ...last, text: last.text.replace(/ +$/, '') };
      blocks.push({
        kind: 'text', runs: runs.filter((run) => run.text !== ''),
        ...(open.align ? { align: open.align } : {}), ...(open.indent > 0 ? { indent: open.indent } : {}),
        ...(pendingBefore > 0 ? { spaceBefore: pendingBefore } : {}),
        ...(open.background ? { background: open.background } : {}), ...(open.padding > 0 ? { padding: open.padding } : {}),
      });
      pendingBefore = 0;
    }
    runs = [];
    open = { ...blockSettings(), before: 0 };
  };
  /** A cell's words, trimmed and on one line, as its row sets them. */
  const endCell = () => {
    if (!cell || !row) return;
    // Its breaks are its lines; spaces at a line's ends, and breaks at the cell's, take no room.
    const words = runs.map((run) => ({ ...run, text: run.text.replace(/ *\n */g, '\n') }));
    if (words[0]) words[0] = { ...words[0], text: words[0].text.replace(/^[ \n]+/, '') };
    if (words.at(-1)) words[words.length - 1] = { ...words.at(-1)!, text: words.at(-1)!.text.replace(/[ \n]+$/, '') };
    row.push({ ...cell, runs: words.filter((run) => run.text !== '') });
    runs = [];
    cell = null;
  };
  const endRow = () => {
    endCell();
    if (row && table) {
      blocks.push({
        kind: 'row', table: table.id, cells: row, ...(table.padding > 0 ? { padding: table.padding } : {}),
        ...(table.full ? { full: true } : {}), ...(table.fill ? { fill: true } : {}),
      });
    }
    row = null;
  };
  const closeBlock = (after: number) => {
    flush();
    const last = blocks.at(-1);
    if (last && last.kind !== 'row' && after > 0) blocks[blocks.length - 1] = { ...last, spaceAfter: Math.max(last.spaceAfter ?? 0, after) };
    else if (!last) pendingAfter = Math.max(pendingAfter, after);
  };
  /** A new line in the cell, unless it is empty so far or its line just ended. */
  const breakCellLine = () => {
    const sofar = runs.map((run) => run.text).join('');
    if (sofar.trim() && !/\n *$/.test(sofar)) write('\n');
  };
  const write = (text: string) => {
    if (!text) return;
    const style = inline();
    const last = runs.at(-1);
    const same = last && JSON.stringify({ ...last, text: '' }) === JSON.stringify({ ...style, text: '' });
    // Whitespace collapses across runs, as HTML sets it.
    const previous = runs.map((run) => run.text).join('');
    const collapsed = /[ \n]$/.test(previous) || previous === '' ? text.replace(/^ /, '') : text;
    if (!collapsed) return;
    if (same) runs[runs.length - 1] = { ...last!, text: last!.text + collapsed };
    else runs.push({ ...style, text: collapsed });
  };
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>|([^<]+)|(<)/g;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    if (match[4] !== undefined || match[5] !== undefined) {
      write(decodeEntities((match[4] ?? match[5]!).replace(/\s+/g, ' ')).replace(/\u00a0/g, ' '));
      continue;
    }
    const raw = match[2]!.toLowerCase();
    // A table inside a cell is set as its words, its rows on lines of their own: its parts are none of the outer table's.
    const name = nested > 0 && TABLE_PARTS.has(raw) ? `nested:${raw}` : raw;
    const closing = match[1] === '/';
    if (closing) {
      const at = stack.map((frame) => frame.tag).lastIndexOf(name);
      if (at === -1) continue;
      const closed = stack.splice(at);
      nested -= closed.filter((frame) => frame.tag === 'nested:table').length;
      if (closed.some((frame) => frame.tag === 'td' || frame.tag === 'th')) endCell();
      if (closed.some((frame) => frame.tag === 'tr')) endRow();
      if (closed.some((frame) => frame.tag === 'table')) { endRow(); table = null; open = { ...blockSettings(), before: 0 }; continue; }
      // A paragraph closing in a cell ends its line there.
      if (table) { if (closed.some((frame) => BLOCKS.has(frame.tag) && !TABLE_PARTS.has(frame.tag))) breakCellLine(); continue; }
      const block = closed.find((frame) => frame.block);
      if (block) closeBlock(block.settings?.after ?? 0);
      continue;
    }
    const attrs = new Map<string, string>();
    for (const attr of match[3]!.matchAll(ATTRIBUTE)) attrs.set(attr[1]!.toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? '');
    if (name === 'br') { write('\n'); continue; }
    // ponytail: a table inside a table's cell is set as its words — upgrade by laying tables out as nested boxes.
    if (table && (name.startsWith('nested:') || name === 'table')) {
      if (raw === 'table') nested += 1;
      if (raw === 'table' || raw === 'tr') breakCellLine();
      else if (raw === 'td' || raw === 'th') write(' ');
      stack.push({ tag: nested > 0 && raw === 'table' ? 'nested:table' : name, inline: inlineOf(raw, attrs, inline(), base), block: false });
      continue;
    }
    if (TABLE_PARTS.has(name) && (name === 'table' || table)) {
      const own = inlineOf(name, attrs, inline(), base);
      if (name === 'table') {
        closeBlock(0);
        const padding = Number(attrs.get('cellpadding'));
        const style = css(attrs.get('style'));
        const width = style.get('width') ?? attrs.get('width');
        const height = style.get('height') ?? attrs.get('height');
        // `border="1"` outlines every cell, in a browser's grey unless the table's CSS gives a colour.
        const lines = paintOf(attrs);
        const border = lines.border ?? (Number(attrs.get('border')) > 0 ? '#808080' : undefined);
        // A browser's own grey is no CSS colour draw.io rewrites: dark mode keeps it.
        const kept = lines.border ? lines.keep?.includes('border') === true : border !== undefined;
        table = { id: tables++, padding: Number.isFinite(padding) && padding >= 0 ? padding : 1, full: width === '100%', fill: height === '100%', ...(border ? { border, keepBorder: kept } : {}) };
      }
      if (name === 'tr') { endRow(); rowPaint = paintOf(attrs); }
      if (name === 'tr' || ((name === 'td' || name === 'th') && !row)) row = [];
      if (name === 'td' || name === 'th') {
        endCell();
        const align = blockOf(name, attrs, base).align ?? (attrs.get('align') === 'center' ? 'center' : attrs.get('align') === 'right' ? 'end' : name === 'th' && labelAlign === 'center' ? 'center' : undefined);
        const paint = paintOf(attrs);
        // A cell's own colours over its row's; its lines over the table's.
        const fromBackground = paint.background ? paint : rowPaint;
        const fromBorder = paint.border ? paint : rowPaint.border ? rowPaint : null;
        const background = fromBackground.background;
        const border = fromBorder?.border ?? table?.border;
        const keep = [
          ...(background && fromBackground.keep?.includes('background') ? ['background' as const] : []),
          ...(border && (fromBorder ? fromBorder.keep?.includes('border') : table?.keepBorder) ? ['border' as const] : []),
        ];
        const share = /^([\d.]+)%$/.exec((css(attrs.get('style')).get('width') ?? attrs.get('width') ?? '').trim());
        const width = share ? Number(share[1]) / 100 : 0;
        cell = { ...(align ? { align } : {}), ...(width > 0 && width <= 1 ? { width } : {}), ...(background ? { background } : {}), ...(border ? { border } : {}), ...(keep.length ? { keep } : {}) };
        runs = [];
      }
      stack.push({ tag: name, inline: own, block: false });
      continue;
    }
    // Inside a table, a paragraph is part of its cell, on a line of its own.
    if (table && BLOCKS.has(name)) {
      breakCellLine();
      stack.push({ tag: name, inline: inlineOf(name, attrs, inline(), base), block: false });
      continue;
    }
    if (name === 'hr') {
      const em = inline().size ?? base;
      closeBlock(0);
      blocks.push({ kind: 'rule', spaceBefore: Math.max(pendingAfter, em / 2), spaceAfter: em / 2 });
      pendingAfter = 0;
      continue;
    }
    if (VOID.has(name) || match[0].endsWith('/>')) continue;
    if (BLOCKS.has(name)) {
      const em = inline().size ?? base;
      const own = inlineOf(name, attrs, inline(), base);
      const settings = blockOf(name, attrs, own.size ?? em);
      closeBlock(0);
      stack.push({ tag: name, inline: own, block: true, settings });
      open = { ...blockSettings(), before: 0 };
      pendingBefore = Math.max(pendingBefore, pendingAfter, settings.before);
      pendingAfter = 0;
      continue;
    }
    stack.push({ tag: name, inline: inlineOf(name, attrs, inline(), base), block: false });
  }
  if (table) endRow();
  else flush();
  // A paragraph's margins (a `<p>`'s 1em) are formatting too: they part its lines as a break alone doesn't.
  const formatted = blocks.some((block) => block.kind !== 'text' || block.align !== undefined || (block.indent ?? 0) > 0
    || (block.spaceBefore ?? 0) > 0 || (block.spaceAfter ?? 0) > 0
    || block.background !== undefined || block.runs.some((run) => Object.keys(run).length > 1));
  return formatted ? { blocks } : null;
}
