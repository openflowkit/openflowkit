import type { RichAlign, RichBlock, RichRun } from '../../opencanvas/domain/text/richLabel';
import { withoutClosingBreaks, withoutCode } from './drawioStyle';
import { decodeEntities } from './xmlReader';

// draw.io's `html=1` labels as our rich labels: paragraphs (`p`, `div`, headings) with their alignment, indent and
// margins, `hr` dividers, `br` breaks, and words made bold, italic, underlined, struck, coloured or resized by tags
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
interface Settings { readonly align?: RichAlign; readonly indent: number; readonly before: number; readonly after: number }
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
  return undefined;
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
  if (size > 0) next.size = size;
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
  const textAlign = style.get('text-align') ?? (tag === 'center' ? 'center' : undefined);
  const align = textAlign === 'center' ? 'center' : textAlign === 'right' || textAlign === 'end' ? 'end' : textAlign === 'left' || textAlign === 'start' || textAlign === 'justify' ? 'start' : undefined;
  return { ...(align ? { align } : {}), indent, before: Math.max(0, pick('margin-top', top, fallback)), after: Math.max(0, pick('margin-bottom', bottom, fallback)) };
}

const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/**
 * draw.io's HTML label as rich blocks, `base` its cell's font size; null when nothing in it is formatted (plain
 * words and line breaks), so the plain label says it all. `tables` counts the tables set as plain lines.
 */
export function drawioRichLabel(value: string, base: number): { readonly blocks: readonly RichBlock[]; readonly tables: number } | null {
  const html = withoutClosingBreaks(withoutCode(value));
  const blocks: RichBlock[] = [];
  const stack: Frame[] = [];
  let tables = 0;
  /** The paragraph being filled: its runs, and the block settings it opened with. */
  let runs: RichRun[] = [];
  let open: { align?: RichAlign; indent: number; before: number } = { indent: 0, before: 0 };
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
    return { ...(align ? { align } : {}), indent };
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
      });
      pendingBefore = 0;
    }
    runs = [];
    open = { ...blockSettings(), before: 0 };
  };
  const closeBlock = (after: number) => {
    flush();
    const last = blocks.at(-1);
    if (last && after > 0) blocks[blocks.length - 1] = { ...last, spaceAfter: Math.max(last.spaceAfter ?? 0, after) };
    else if (!last) pendingAfter = Math.max(pendingAfter, after);
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
    const name = match[2]!.toLowerCase();
    const closing = match[1] === '/';
    if (closing) {
      const at = stack.map((frame) => frame.tag).lastIndexOf(name);
      if (at === -1) continue;
      const closed = stack.splice(at);
      const block = closed.find((frame) => frame.block);
      if (block) closeBlock(block.settings?.after ?? 0);
      continue;
    }
    const attrs = new Map<string, string>();
    for (const attr of match[3]!.matchAll(ATTRIBUTE)) attrs.set(attr[1]!.toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? '');
    if (name === 'br') { write('\n'); continue; }
    if (name === 'hr') {
      const em = inline().size ?? base;
      closeBlock(0);
      blocks.push({ kind: 'rule', spaceBefore: Math.max(pendingAfter, em / 2), spaceAfter: em / 2 });
      pendingAfter = 0;
      continue;
    }
    if (name === 'td' || name === 'th') {
      // A table's cells are set one after another on its row's line.
      if (runs.length) write(' ');
      if (!VOID.has(name)) stack.push({ tag: name, inline: inlineOf(name, attrs, inline(), base), block: false });
      continue;
    }
    if (name === 'table') tables += 1;
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
  flush();
  const formatted = blocks.some((block) => block.kind === 'rule' || block.align !== undefined || (block.indent ?? 0) > 0
    || block.runs.some((run) => Object.keys(run).length > 1));
  return formatted ? { blocks, tables } : null;
}
