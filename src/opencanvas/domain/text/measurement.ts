import type { Size2d } from '../geometry/types';

export type TextOverflowPolicy = 'clip' | 'ellipsis' | 'visible' | 'wrap';

export interface PortableTextStyle {
  readonly fontSize: number;
  readonly fontWeight?: 400 | 500 | 600 | 700;
  readonly lineHeight?: number;
  readonly maxWidth?: number;
  readonly maxLines?: number;
  readonly overflow?: TextOverflowPolicy;
  /** Never split a word wider than the line (draw.io's labels); by default it breaks. */
  readonly keepWords?: boolean;
}

/** The node title and the kind/description line under it: one definition for sizing, canvas and export. */
export const LABEL_FONT = { fontSize: 14, fontWeight: 600 } as const;
export const SUBLABEL_FONT = { fontSize: 11, fontWeight: 400 } as const;

export interface PortableTextMeasurement extends Size2d {
  readonly lines: readonly string[];
  readonly displayText: string;
  readonly truncated: boolean;
}

function glyphUnits(character: string): number {
  if (/\s/u.test(character)) return 0.32;
  if (/[ilI1|.,'`!]/u.test(character)) return 0.3;
  if (/[MW@#%&]/u.test(character)) return 0.9;
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Extended_Pictographic}/u.test(character)) return 1;
  return 0.56;
}

/** Width of a run of glyph units; the one place the weight and size factors are applied. */
function unitsWidth(units: number, fontSize: number, weight: number): number {
  const weightFactor = 1 + Math.max(0, weight - 400) / 3_000;
  return units * fontSize * weightFactor;
}

/** Estimated width of one line of text: the measure every renderer and the exports agree on. */
export function lineWidth(text: string, fontSize: number, weight: number): number {
  return unitsWidth([...text].reduce((sum, character) => sum + glyphUnits(character), 0), fontSize, weight);
}

/** The longest prefix of `text` from `start` that fits `maximum`: where it ends (a string index), where the last space in it sits and the last place a `-` or `/` lets a long name break. One pass. */
function fitFrom(text: string, start: number, maximum: number, fontSize: number, weight: number): { end: number; lastSpace: number; lastSoft: number; whole: boolean } {
  let units = 0;
  let lastSpace = -1;
  let lastSoft = -1;
  let index = start;
  while (index < text.length) {
    const character = String.fromCodePoint(text.codePointAt(index)!);
    const next = units + glyphUnits(character);
    if (unitsWidth(next, fontSize, weight) > maximum) return { end: index, lastSpace, lastSoft, whole: false };
    units = next;
    if (character === ' ') lastSpace = index;
    index += character.length;
    if (character === '-' || character === '/') lastSoft = index;
  }
  return { end: index, lastSpace, lastSoft, whole: true };
}

function fitPrefix(text: string, maximum: number, fontSize: number, weight: number): string {
  return text.slice(0, fitFrom(text, 0, maximum, fontSize, weight).end);
}

/** Wraps one paragraph in one pass; stops once `limit` lines exist, since the caller drops the rest. */
function wrapParagraph(text: string, maximum: number, fontSize: number, weight: number, limit: number, keepWords = false): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  let start = 0;
  while (start < text.length && lines.length < limit) {
    const fit = fitFrom(text, start, maximum, fontSize, weight);
    if (fit.whole) {
      lines.push(text.slice(start));
      break;
    }
    // Nothing fits: take one character anyway.
    let end = fit.end > start ? fit.end : start + String.fromCodePoint(text.codePointAt(start)!).length;
    // A prefix that ends right before a space is already whole words; only cut back to a space mid-word.
    // A name with no space to break at breaks after a `-` or `/` rather than mid-word.
    const cut = fit.lastSpace > start ? fit.lastSpace : fit.lastSoft;
    if (text[end] !== ' ' && cut > start) end = cut;
    // Whole words (CSS `word-wrap: normal`, as draw.io wraps): a word wider than the line takes its own line and runs past the edge.
    else if (keepWords && text[end] !== ' ') {
      end = start;
      while (end < text.length && !/\s/u.test(text[end]!)) end += 1;
    }
    lines.push(text.slice(start, end).trimEnd());
    start = end;
    while (start < text.length && /\s/u.test(text[start]!)) start += 1;
  }
  return lines;
}

export function measurePortableText(
  text: string,
  style: PortableTextStyle
): PortableTextMeasurement {
  if (!Number.isFinite(style.fontSize) || style.fontSize <= 0) {
    throw new Error('Portable text font size must be positive and finite.');
  }
  const lineHeight = style.lineHeight ?? style.fontSize * 1.2;
  const weight = style.fontWeight ?? 400;
  const overflow = style.overflow ?? 'visible';
  const maximum = style.maxWidth;
  if (maximum !== undefined && (!Number.isFinite(maximum) || maximum <= 0)) {
    throw new Error('Portable text max width must be positive and finite.');
  }
  const sourceLines = text.split('\n');
  // One line past the limit is enough to know the text was cut; a longer label is never wrapped to its end.
  let budget = style.maxLines !== undefined && Number.isFinite(style.maxLines) ? Math.max(1, Math.ceil(style.maxLines)) + 1 : Number.POSITIVE_INFINITY;
  let lines = maximum && overflow === 'wrap'
    ? sourceLines.flatMap((line) => {
      if (budget <= 0) return [];
      const wrapped = wrapParagraph(line, maximum, style.fontSize, weight, budget, style.keepWords);
      budget -= wrapped.length;
      return wrapped;
    })
    : sourceLines;
  let truncated = false;
  if (style.maxLines !== undefined && lines.length > style.maxLines) {
    if (!Number.isInteger(style.maxLines) || style.maxLines < 1) {
      throw new Error('Portable text max lines must be a positive integer.');
    }
    lines = lines.slice(0, style.maxLines);
    truncated = true;
  }
  if (maximum && overflow !== 'visible' && overflow !== 'wrap') {
    lines = lines.map((line) => {
      if (lineWidth(line, style.fontSize, weight) <= maximum) return line;
      truncated = true;
      if (overflow === 'clip') return fitPrefix(line, maximum, style.fontSize, weight);
      const suffix = '…';
      return `${fitPrefix(line, Math.max(0, maximum - lineWidth(suffix, style.fontSize, weight)), style.fontSize, weight)}${suffix}`;
    });
  } else if (maximum && overflow === 'wrap' && style.maxLines && truncated) {
    const last = lines.length - 1;
    const suffix = '…';
    lines[last] = `${fitPrefix(lines[last], Math.max(0, maximum - lineWidth(suffix, style.fontSize, weight)), style.fontSize, weight)}${suffix}`;
  }
  const width = Math.min(
    maximum ?? Number.POSITIVE_INFINITY,
    Math.max(0, ...lines.map((line) => lineWidth(line, style.fontSize, weight)))
  );
  return {
    width,
    height: Math.max(lineHeight, lines.length * lineHeight),
    lines,
    displayText: lines.join('\n'),
    truncated,
  };
}

/** Cut to roughly `width` at a fixed character width, with an ellipsis: the canvas and the export truncate alike. */
export function truncateTextToWidth(value: string, width: number, characterWidth = 6.5): string {
  const limit = Math.max(3, Math.floor(width / characterWidth));
  return value.length <= limit ? value : `${value.slice(0, Math.max(1, limit - 1))}…`;
}
