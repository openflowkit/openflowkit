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

/** One cell of a table row: its words on one line, on the side it is aligned to. */
export interface RichCell { readonly runs: readonly RichRun[]; readonly align?: RichAlign }

/**
 * A paragraph, a divider line across the label, or a table row. Spacing is in px; the space between two blocks is the
 * larger of theirs. A paragraph's `background` fills a band the label's width behind it, `padding` inside the band.
 * Rows of one `table` share their columns, each as wide as its widest cell; a `full` table stretches to the label.
 */
export type RichBlock =
  | { readonly kind: 'text'; readonly runs: readonly RichRun[]; readonly align?: RichAlign; readonly indent?: number; readonly spaceBefore?: number; readonly spaceAfter?: number; readonly background?: string; readonly padding?: number }
  | { readonly kind: 'rule'; readonly spaceBefore?: number; readonly spaceAfter?: number }
  | { readonly kind: 'row'; readonly table: number; readonly cells: readonly RichCell[]; readonly padding?: number; readonly full?: boolean };

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
  const alignOf = (value: unknown): { align?: RichAlign } => (value === 'start' || value === 'center' || value === 'end' ? { align: value } : {});
  const runsOf = (value: unknown) => (Array.isArray(value) ? value.map(readRun).filter((run): run is RichRun => run !== null) : []);
  const positive = (key: string, value: unknown) => { const number = finiteOr(value); return number !== undefined && number > 0 ? { [key]: Math.min(number, 400) } : {}; };
  for (const value of raw) {
    if (!isRecord(value)) continue;
    if (value.kind === 'rule') { blocks.push({ kind: 'rule', ...spacing(value) }); continue; }
    if (value.kind === 'row' && Array.isArray(value.cells)) {
      const cells = value.cells.filter(isRecord).map((cell) => ({ runs: runsOf(cell.runs), ...alignOf(cell.align) }));
      blocks.push({ kind: 'row', table: finiteOr(value.table) ?? 0, cells, ...positive('padding', value.padding), ...(value.full === true ? { full: true } : {}) });
      continue;
    }
    if (value.kind !== 'text' || !Array.isArray(value.runs)) continue;
    const background = typeof value.background === 'string' && HEX.test(value.background) ? { background: value.background.toLowerCase() } : {};
    blocks.push({ kind: 'text', runs: runsOf(value.runs), ...alignOf(value.align), ...positive('indent', value.indent), ...spacing(value), ...background, ...positive('padding', value.padding) });
  }
  return blocks.length ? blocks : null;
}

/** The words of a rich label as plain text: one line per paragraph and per line break. */
export function richLabelText(blocks: readonly RichBlock[]): string {
  const words = (runs: readonly RichRun[]) => runs.map((run) => run.text).join('');
  return blocks.flatMap((block) => (block.kind === 'text' ? [words(block.runs)] : block.kind === 'row' ? [block.cells.map((cell) => words(cell.runs)).join(' ')] : [])).join('\n');
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
  /** A table row: each piece sits at its own `x`, in its column, not flowing after the one before. */
  readonly columns?: boolean;
}

export interface RichLayout {
  readonly lines: readonly RichLine[];
  /** Divider lines, each across the label at `y`, from `x` for `width`. */
  readonly rules: readonly { readonly x: number; readonly y: number; readonly width: number }[];
  /** Paragraph backgrounds, each a band across the label, drawn under the words. */
  readonly bands: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly color: string }[];
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
  type Measured = Styled & { width: number };
  type Row = { readonly table: number; readonly padding: number; readonly full: boolean; readonly cells: readonly { readonly pieces: readonly Measured[]; readonly align: RichAlign; readonly width: number }[] };
  type Pending = { readonly align: RichAlign; readonly indent: number; readonly pieces: Measured[]; readonly row?: Row };
  const set: { readonly y: number; readonly height: number; readonly baseline: number; readonly line: Pending }[] = [];
  const rules: number[] = [];
  const bands: { y: number; height: number; color: string }[] = [];
  const styled = (run: RichRun): Styled => ({
    text: '', size: run.size ?? base.fontSize, weight: run.bold ? 700 : base.fontWeight, italic: run.italic ?? base.italic,
    underline: run.underline ?? base.underline, strike: run.strike ?? base.strike, color: run.color ?? base.color,
  });
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
    if (block.kind === 'row') {
      // A cell's words stay on one line. ponytail: no wrapping inside a cell — upgrade by wrapping at its column's width.
      const padding = block.padding ?? 0;
      const cells = block.cells.map((cell) => {
        const pieces = cell.runs.map((run) => {
          const style = styled(run);
          const text = run.text.replace(/\s+/g, ' ');
          return { ...style, text, width: measure(text, style.size, style.weight, style.italic) };
        }).filter((piece) => piece.text !== '');
        return { pieces, align: cell.align ?? 'start', width: pieces.reduce((sum, piece) => sum + piece.width, 0) };
      });
      const tallest = cells.flatMap((cell) => cell.pieces).reduce((most, piece) => Math.max(most, piece.size), base.fontSize);
      const text = tallest * base.lineHeight;
      advance(0);
      set.push({ y, height: text + padding * 2, baseline: padding + (text - tallest) / 2 + tallest * 0.8,
        line: { align: 'start', indent: 0, pieces: [], row: { table: block.table, padding, full: block.full === true, cells } } });
      y += text + padding * 2;
      margin = 0;
      continue;
    }
    const padding = block.padding ?? 0;
    const indent = (block.indent ?? 0) + padding;
    const room = width === null ? Number.POSITIVE_INFINITY : Math.max(1, width - indent - padding);
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
      const style = styled(run);
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
    const top = y;
    y += padding;
    for (const each of lines) {
      const tallest = each.pieces.reduce((most, piece) => Math.max(most, piece.size), each.pieces.length ? 0 : base.fontSize);
      // An empty paragraph takes no height, as an empty HTML block; a `<br>` line inside one does.
      if (!each.pieces.length && lines.length === 1 && !block.runs.some((run) => run.text.includes('\n'))) continue;
      const height = tallest * base.lineHeight;
      set.push({ y, height, baseline: (height - tallest) / 2 + tallest * 0.8, line: each });
      y += height;
    }
    y += padding;
    if (block.background) bands.push({ y: top, height: y - top, color: block.background });
    margin = block.spaceAfter ?? 0;
  }
  // Each table's columns are as wide as their widest cell, as a browser's automatic table layout sets them.
  const columns = new Map<number, number[]>();
  for (const { line: { row } } of set) {
    if (!row) continue;
    const widths = columns.get(row.table) ?? [];
    row.cells.forEach((cell, index) => { widths[index] = Math.max(widths[index] ?? 0, cell.width + row.padding * 2); });
    columns.set(row.table, widths);
  }
  const natural = (table: number) => (columns.get(table) ?? []).reduce((sum, each) => sum + (each ?? 0), 0);
  const widest = set.reduce((most, { line }) => Math.max(most, line.row ? natural(line.row.table)
    : line.indent + line.pieces.reduce((sum, piece) => sum + piece.width, 0)), 0);
  // Lines align in the label's box (`options.box`), or in the widest line when that is wider.
  const box = width ?? Math.max(widest, options.box ?? 0);
  const placeRow = (row: Row): RichPiece[] => {
    const widths = (columns.get(row.table) ?? []).map((each) => each ?? 0);
    const total = widths.reduce((sum, each) => sum + each, 0);
    // A full-width table shares the room left over among its columns in proportion to their widths, as a browser does.
    const extra = row.full && box > total ? box - total : 0;
    let x = 0;
    return row.cells.flatMap((cell, index) => {
      const column = widths[index]! + (total > 0 ? (extra * widths[index]!) / total : extra / widths.length);
      const inner = column - row.padding * 2;
      let at = x + row.padding + (cell.align === 'center' ? (inner - cell.width) / 2 : cell.align === 'end' ? inner - cell.width : 0);
      x += column;
      return cell.pieces.map((piece) => { const placed = { ...piece, x: at }; at += piece.width; return placed; });
    });
  };
  const lines: RichLine[] = set.map(({ y: top, height, baseline, line }) => {
    if (line.row) {
      const pieces = placeRow(line.row);
      return { y: top, height, baseline, align: 'start', left: 0, right: pieces.at(-1) ? pieces.at(-1)!.x + pieces.at(-1)!.width : 0, pieces, columns: true };
    }
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
  return { lines, rules: rules.map((at) => ({ x: 0, y: at, width: box })), bands: bands.map((band) => ({ x: 0, width: box, ...band })), width: box, height: y };
}
