import { getContrastText, mixHex, normalizeHex, readableTextOn, rgbToHex } from '../../../lib/colorUtils';

export { contrastRatio, readableTextOn } from '../../../lib/colorUtils';

const AUTO_COLOR = 'auto' as const;
export const DEFAULT_CANVAS_COLOR = '#f7f7f5';

/** Default ink follows canvas luminance. Explicit document colours stay fixed. */
export function resolveAdaptiveInk(value: unknown, background = DEFAULT_CANVAS_COLOR): string {
  if (typeof value === 'string' && value !== AUTO_COLOR) {
    const explicit = normalizeHex(value);
    if (explicit) return explicit;
  }
  return getContrastText(background);
}

export function numericColorToHex(color: number): string {
  return `#${Math.max(0, Math.min(0xffffff, color)).toString(16).padStart(6, '0')}`;
}

/**
 * A fill as it shows over `below` (the canvas, or what is drawn under it) at `opacity` (0–1): a see-through fill and a
 * dark wash (rgba at 8%) let what is below show through; `transparent`, or anything not a colour, shows it whole.
 */
export function paintOver(fill: string, below: string, opacity: number): string {
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(fill);
  if (rgba) return mixHex(rgbToHex(Number(rgba[1]), Number(rgba[2]), Number(rgba[3])), below, 1 - Number(rgba[4]) * opacity);
  if (/^#[0-9a-f]{8}$/i.test(fill)) return mixHex(fill.slice(0, 7), below, 1 - (Number.parseInt(fill.slice(7), 16) / 255) * opacity);
  if (!fill.startsWith('#')) return below;
  return opacity < 1 ? mixHex(fill, below, 1 - opacity) : fill;
}

/** Whether dark ink reads better than white on `backdrop`, by contrast (teal takes dark ink, slate grey white). */
export const darkInkReadsOn = (backdrop: string): boolean => readableTextOn(backdrop) !== '#ffffff';

export const isDarkCanvas = (canvas: unknown): canvas is string =>
  typeof canvas === 'string' && getContrastText(canvas) === '#ffffff';

const WASH_ALPHA = 0.08;

/** Secondary ink (descriptions, kind tags, legends) on a dark-canvas wash: muted, but readable. */
export const WASH_SUB_INK = '#cbd5e1';

/** The one dark-canvas wash: a default fill as a faint rgba of its own hue. */
export function darkWashFill(fill: string): string {
  if (fill.startsWith('rgba(')) return fill.replace(/,\s*[\d.]+\)$/, `,${WASH_ALPHA})`);
  const n = Number.parseInt(fill.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${WASH_ALPHA})`;
}

interface WashInk {
  readonly fill: string;
  readonly stroke: string;
  readonly text: string;
  readonly subText: string;
  readonly accentFill: string;
}

/** `darkWashFill` flattened onto the canvas, for renderers that paint opaque hex. */
export function washOnDark<T extends WashInk>(ink: T, canvas: string): T {
  const [r, g, b] = darkWashFill(ink.fill).match(/\d+/g)!.slice(0, 3).map(Number);
  return {
    ...ink,
    fill: mixHex(canvas, rgbToHex(r!, g!, b!), WASH_ALPHA),
    text: '#ffffff',
    subText: WASH_SUB_INK,
    accentFill: mixHex(canvas, ink.stroke, 0.3),
  };
}

/**
 * A colour as draw.io's dark mode draws it (`mxUtils.getInverseColor`): inverted 93% of the way, then turned 180°
 * round the hue wheel, so its lightness flips and its hue stays. A see-through `#rrggbbaa` keeps its alpha; anything
 * not a hex colour is returned as it is.
 */
export function invertForDark(color: string): string {
  const hex = normalizeHex(color.length === 9 ? color.slice(0, 7) : color);
  if (!hex) return color;
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((m) => Math.round(0.93 * (255 - m) + m * 0.07));
  const [cos, sin] = [Math.cos(Math.PI), Math.sin(Math.PI)];
  const m = [
    0.2126 + 0.7874 * cos - 0.2126 * sin, 0.7152 - 0.7152 * cos - 0.7152 * sin, 0.0722 - 0.0722 * cos + 0.9278 * sin,
    0.2126 - 0.2126 * cos + 0.143 * sin, 0.7152 + (1 - 0.7152) * cos + 0.14 * sin, 0.0722 - 0.0722 * cos - 0.283 * sin,
    0.2126 - 0.2126 * cos - 0.7874 * sin, 0.7152 - 0.7152 * cos + 0.7152 * sin, 0.0722 + 0.9278 * cos + 0.0722 * sin,
  ];
  const clamp = (value: number) => Math.round(Math.max(0, Math.min(255, value)));
  const out = rgbToHex(clamp(m[0]! * r! + m[1]! * g! + m[2]! * b!), clamp(m[3]! * r! + m[4]! * g! + m[5]! * b!), clamp(m[6]! * r! + m[7]! * g! + m[8]! * b!));
  return color.length === 9 ? `${out}${color.slice(7).toLowerCase()}` : out;
}
