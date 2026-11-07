import { getContrastText, mixHex, normalizeHex, readableTextOn, rgbToHex } from '../../../lib/colorUtils';

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

/** A fill as it shows over `canvas` at `opacity` (0–1): through a see-through fill, the canvas shows. */
export const fillOverCanvas = (fill: string, canvas: string, opacity: number): string =>
  (opacity < 1 ? mixHex(fill, canvas, 1 - opacity) : fill);

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
