import { lineWidth } from './measurement';

// A label that holds styled paragraphs: words made bold, coloured or resized, paragraphs set apart, indented or
// aligned on their own, and divider lines between them (draw.io's HTML labels). `content.label` keeps the same words
// as plain text, for search, the editor and agents; `content.richLabel` says how they are set. Editing the words as
// plain text drops the formatting.

export type RichAlign = 'start' | 'center' | 'end';

/** Words in one style; a `\n` in `text` starts a new line in the same paragraph. Unset keys follow the node. */
export interface RichRun {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly color?: string;
  readonly size?: number;
}

/** A paragraph, or a divider line across the label. Spacing is in px; the space between two blocks is the larger of theirs. */
export type RichBlock =
  | { readonly kind: 'text'; readonly runs: readonly RichRun[]; readonly align?: RichAlign; readonly indent?: number; readonly spaceBefore?: number; readonly spaceAfter?: number }
  | { readonly kind: 'rule'; readonly spaceBefore?: number; readonly spaceAfter?: number };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finiteOr = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const HEX = /^#[0-9a-f]{6}$/i;

function readRun(value: unknown): RichRun | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null;
  const size = finiteOr(value.size);
  return {
    text: value.text,
    ...(value.bold === true ? { bold: true } : {}),
    ...(value.italic === true ? { italic: true } : {}),
    ...(value.underline === true ? { underline: true } : {}),
    ...(value.strike === true ? { strike: true } : {}),
    ...(typeof value.color === 'string' && HEX.test(value.color) ? { color: value.color.toLowerCase() } : {}),
    ...(size !== undefined && size > 0 ? { size: Math.min(size, 400) } : {}),
  };
}

function spacing(value: Record<string, unknown>): { spaceBefore?: number; spaceAfter?: number } {
  const before = finiteOr(value.spaceBefore);
  const after = finiteOr(value.spaceAfter);
  return { ...(before !== undefined && before > 0 ? { spaceBefore: before } : {}), ...(after !== undefined && after > 0 ? { spaceAfter: after } : {}) };
}

/** A node's rich label, read from its content: null when it has none, or none worth keeping. Anything malformed is dropped. */
export function richLabelOf(content: Readonly<Record<string, unknown>>): readonly RichBlock[] | null {
  const raw = content.richLabel;
  if (!Array.isArray(raw)) return null;
  const blocks: RichBlock[] = [];
  for (const value of raw) {
    if (!isRecord(value)) continue;
    if (value.kind === 'rule') { blocks.push({ kind: 'rule', ...spacing(value) }); continue; }
    if (value.kind !== 'text' || !Array.isArray(value.runs)) continue;
    const runs = value.runs.map(readRun).filter((run): run is RichRun => run !== null);
    const indent = finiteOr(value.indent);
    const align = value.align === 'start' || value.align === 'center' || value.align === 'end' ? value.align : undefined;
    blocks.push({ kind: 'text', runs, ...(align ? { align } : {}), ...(indent !== undefined && indent > 0 ? { indent } : {}), ...spacing(value) });
  }
  return blocks.length ? blocks : null;
}

/** The words of a rich label as plain text: one line per paragraph and per line break. */
export function richLabelText(blocks: readonly RichBlock[]): string {
  return blocks.filter((block) => block.kind === 'text').map((block) => block.runs.map((run) => run.text).join('')).join('\n');
}

/** What a rich label is set in where its runs don't say: the node's own type. */
export interface RichBase {
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly color: string;
  /** Multiplier of the font size. */
  readonly lineHeight: number;
  readonly align: RichAlign;
}

/** One piece of a line, in one style, at `x` from the label's left. */
export interface RichPiece {
  readonly x: number;
  readonly width: number;
  readonly text: string;
  readonly size: number;
  readonly weight: number;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly color: string;
}

export interface RichLine {
  /** Top of the line, from the label's top. */
  readonly y: number;
  readonly height: number;
  /** Where the letters sit, from the line's top: the tallest piece's size, centred in the line's height. */
  readonly baseline: number;
  readonly align: RichAlign;
  /** Where the line's words start and end, from the label's left. */
  readonly left: number;
  readonly right: number;
  readonly pieces: readonly RichPiece[];
}

export interface RichLayout {
  readonly lines: readonly RichLine[];
  /** Divider lines, each across the label at `y`, from `x` for `width`. */
  readonly rules: readonly { readonly x: number; readonly y: number; readonly width: number }[];
  readonly width: number;
  readonly height: number;
}

/** Measures one run of text: the shared estimate, unless a renderer that can measure real type passes its own. */
export type MeasureText = (text: string, size: number, weight: number, italic: boolean) => number;
const ESTIMATE: MeasureText = (text, size, weight) => lineWidth(text, size, weight);

type Styled = Omit<RichPiece, 'x' | 'width'>;

/**
 * Sets a rich label in lines: each paragraph wraps at `width` less its indent (null: never wraps), breaking only
 * between words; a word wider than the line breaks into letters unless `keepWords`. Lines sit on the side their
 * paragraph is aligned to, inside `width`; when it doesn't wrap, inside `box` or the widest line, whichever is wider.
 */
export function layoutRichLabel(
  blocks: readonly RichBlock[], base: RichBase, width: number | null,
  options: { readonly keepWords?: boolean; readonly measure?: MeasureText; readonly box?: number } = {},
): RichLayout {
  const measure = options.measure ?? ESTIMATE;
  type Pending = { readonly align: RichAlign; readonly indent: number; readonly pieces: (Styled & { width: number })[] };
  const set: { readonly y: number; readonly height: number; readonly baseline: number; readonly line: Pending }[] = [];
  const rules: number[] = [];
  let y = 0;
  let margin = 0;
  let first = true;
  const advance = (before: number) => {
    y += first ? before : Math.max(margin, before);
    first = false;
  };
  for (const block of blocks) {
    if (block.kind === 'rule') {
      advance(block.spaceBefore ?? 0);
      rules.push(y + 0.5);
      y += 1;
      margin = block.spaceAfter ?? 0;
      continue;
    }
    const indent = block.indent ?? 0;
    const room = width === null ? Number.POSITIVE_INFINITY : Math.max(1, width - indent);
    const lines: Pending[] = [];
    let line: Pending = { align: block.align ?? base.align, indent, pieces: [] };
    let used = 0;
    const end = () => {
      // Spaces at a line's end take no room, as a browser wraps.
      while (line.pieces.length && !line.pieces.at(-1)!.text.trim()) used -= line.pieces.pop()!.width;
      const last = line.pieces.at(-1);
      if (last && last.text !== last.text.trimEnd()) {
        const text = last.text.trimEnd();
        const trimmed = measure(text, last.size, last.weight, last.italic);
        line.pieces[line.pieces.length - 1] = { ...last, text, width: trimmed };
      }
      lines.push(line);
      line = { align: line.align, indent, pieces: [] };
      used = 0;
    };
    for (const run of block.runs) {
      const style: Styled = {
        text: '', size: run.size ?? base.fontSize, weight: run.bold ? 700 : base.fontWeight, italic: run.italic ?? base.italic,
        underline: run.underline ?? base.underline, strike: run.strike ?? base.strike, color: run.color ?? base.color,
      };
      run.text.split('\n').forEach((part, index) => {
        if (index > 0) end();
        for (const word of part.split(/(\s+)/).filter(Boolean)) {
          const space = !word.trim();
          // A run of spaces between words is one space, as HTML sets it; none starts a line.
          if (space && !line.pieces.length) continue;
          const text = space ? ' ' : word;
          let size = measure(text, style.size, style.weight, style.italic);
          if (!space && used + size > room && line.pieces.length) end();
          if (!space && size > room && !options.keepWords) {
            // Too wide alone: letters until the line is full, the rest on the next line.
            let rest = text;
            while (rest && measure(rest, style.size, style.weight, style.italic) > room) {
              let cut = 1;
              while (cut < rest.length && measure(rest.slice(0, cut + 1), style.size, style.weight, style.italic) <= room) cut += 1;
              const head = rest.slice(0, cut);
              line.pieces.push({ ...style, text: head, width: measure(head, style.size, style.weight, style.italic) });
              end();
              rest = rest.slice(cut);
            }
            if (!rest) continue;
            size = measure(rest, style.size, style.weight, style.italic);
            line.pieces.push({ ...style, text: rest, width: size });
            used += size;
            continue;
          }
          line.pieces.push({ ...style, text, width: size });
          used += size;
        }
      });
    }
    end();
    advance(block.spaceBefore ?? 0);
    for (const each of lines) {
      const tallest = each.pieces.reduce((most, piece) => Math.max(most, piece.size), each.pieces.length ? 0 : base.fontSize);
      // An empty paragraph takes no height, as an empty HTML block; a `<br>` line inside one does.
      if (!each.pieces.length && lines.length === 1 && !block.runs.some((run) => run.text.includes('\n'))) continue;
      const height = tallest * base.lineHeight;
      set.push({ y, height, baseline: (height - tallest) / 2 + tallest * 0.8, line: each });
      y += height;
    }
    margin = block.spaceAfter ?? 0;
  }
  const widest = set.reduce((most, { line }) => Math.max(most, line.indent + line.pieces.reduce((sum, piece) => sum + piece.width, 0)), 0);
  // Lines align in the label's box (`options.box`), or in the widest line when that is wider.
  const box = width ?? Math.max(widest, options.box ?? 0);
  const lines: RichLine[] = set.map(({ y: top, height, baseline, line }) => {
    const total = line.pieces.reduce((sum, piece) => sum + piece.width, 0);
    const room = Math.max(0, box - line.indent);
    const left = line.indent + (line.align === 'center' ? (room - total) / 2 : line.align === 'end' ? room - total : 0);
    let x = left;
    const pieces = line.pieces.map((piece) => {
      const placed = { ...piece, x };
      x += piece.width;
      return placed;
    });
    return { y: top, height, baseline, align: line.align, left, right: left + total, pieces };
  });
  return { lines, rules: rules.map((at) => ({ x: 0, y: at, width: box })), width: box, height: y };
}
