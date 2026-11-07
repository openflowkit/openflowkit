import type { JsonObject } from '../../opencanvas/domain/document/json';
import { normalizeHex } from '../../lib/colorUtils';

// Excalidraw's element paint (strokeColor, backgroundColor, strokeStyle, opacity…) and arrowheads,
// read into the appearance keys OpenFlowKit draws. What has no counterpart is named for the importer.

/** The fields of an Excalidraw element this importer reads; everything is optional, files are hand-edited too. */
export interface ExcalidrawElement {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly angle?: unknown;
  readonly isDeleted?: unknown;
  readonly strokeColor?: unknown;
  readonly backgroundColor?: unknown;
  readonly fillStyle?: unknown;
  readonly strokeWidth?: unknown;
  readonly strokeStyle?: unknown;
  readonly opacity?: unknown;
  readonly roundness?: unknown;
  readonly text?: unknown;
  readonly originalText?: unknown;
  readonly autoResize?: unknown;
  readonly fontSize?: unknown;
  readonly fontFamily?: unknown;
  readonly textAlign?: unknown;
  readonly verticalAlign?: unknown;
  readonly containerId?: unknown;
  readonly frameId?: unknown;
  readonly name?: unknown;
  readonly points?: unknown;
  readonly startBinding?: unknown;
  readonly endBinding?: unknown;
  readonly startArrowhead?: unknown;
  readonly endArrowhead?: unknown;
  readonly elbowed?: unknown;
  readonly fileId?: unknown;
  readonly crop?: unknown;
  readonly scale?: unknown;
  readonly polygon?: unknown;
  readonly link?: unknown;
  readonly groupIds?: unknown;
}

export const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** `#1E1E1E` / `#abc` as our six-digit lower-case hex (so `#fff` is the white our dark theme washes); `transparent` stays; anything else is unset. */
export function excalidrawColor(value: unknown): string | undefined {
  if (value === 'transparent') return 'transparent';
  return typeof value === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value) ? normalizeHex(value) ?? undefined : undefined;
}

/** Line and text ink: Excalidraw's default black is left unset, so it follows our theme as it follows Excalidraw's. */
export function excalidrawInk(value: unknown): string | undefined {
  const ink = excalidrawColor(value);
  return ink === 'transparent' || ink === '#1e1e1e' || ink === '#000000' ? undefined : ink;
}

/**
 * Ink for words: a colour the author picked stays. Excalidraw's default black stays too where the words sit on a fill
 * that keeps its colour in our dark theme (black on teal reads; the theme's white would not); anywhere else (the canvas,
 * a white box the dark theme washes to the canvas) it is left to the theme, so it turns white on dark.
 */
export function excalidrawWordInk(value: unknown, onSolidFill: boolean): string | undefined {
  const picked = excalidrawInk(value);
  if (picked || !onSolidFill) return picked;
  const ink = excalidrawColor(value);
  return ink === 'transparent' ? undefined : ink;
}

/** Excalidraw's font numbers: 1 Virgil, 5 Excalifont and 8 Comic Shanns are handwriting; 3 Cascadia is code. */
export function excalidrawFont(value: unknown): 'hand' | 'mono' | 'sans' {
  if (value === 1 || value === 5 || value === 8) return 'hand';
  if (value === 3) return 'mono';
  return 'sans';
}

/** Excalidraw's 0–100 opacity as our 0–1, or undefined when fully opaque. */
export const excalidrawOpacity = (element: ExcalidrawElement): number | undefined => {
  const value = finite(element.opacity, 100);
  return value < 100 ? Math.max(0, value) / 100 : undefined;
};

/** A shape's paint and, from its bound text, its label's type and setting. */
export function excalidrawNodeAppearance(element: ExcalidrawElement, label?: ExcalidrawElement): JsonObject {
  const appearance: Record<string, string | number> = {};
  const fill = excalidrawColor(element.backgroundColor);
  const stroke = excalidrawInk(element.strokeColor);
  if (fill) appearance.fill = fill;
  if (stroke) appearance.stroke = stroke;
  if (typeof element.strokeWidth === 'number') appearance.strokeWidth = finite(element.strokeWidth, 2);
  if (element.strokeStyle === 'dashed' || element.strokeStyle === 'dotted') appearance.strokeStyle = element.strokeStyle;
  const alpha = excalidrawOpacity(element);
  if (alpha !== undefined) appearance.opacity = alpha;
  if (label) {
    // Default ink is the builder's call: it alone knows whether the fill stays solid on a dark canvas.
    const ink = excalidrawInk(label.strokeColor);
    if (ink) appearance.textColor = ink;
    if (typeof label.fontSize === 'number') appearance.fontSize = finite(label.fontSize, 16);
    appearance.fontFamily = excalidrawFont(label.fontFamily);
    if (label.textAlign === 'left') appearance.textAlign = 'start';
    if (label.textAlign === 'right') appearance.textAlign = 'end';
    if (label.verticalAlign === 'top' || label.verticalAlign === 'bottom') appearance.textVerticalAlign = label.verticalAlign;
  }
  return appearance;
}

/** Arrowheads we draw, by Excalidraw's name; the rest (bar, crow's feet) are named as a loss by the caller. */
const HEADS: Readonly<Record<string, string>> = {
  arrow: 'arrow', triangle: 'arrow', triangle_outline: 'arrow',
  dot: 'circle', circle: 'circle', circle_outline: 'circle',
  diamond: 'diamond', diamond_outline: 'diamond',
};

/** One end's head: our marker word, `null` for none, or `{ lost }` naming a head we can't draw. */
export function excalidrawHead(value: unknown): string | null | { readonly lost: string } {
  if (typeof value !== 'string' || value === '') return null;
  return Object.hasOwn(HEADS, value) ? HEADS[value]! : { lost: value };
}

/** An arrow's or line's paint; heads are set by the caller, which also reports the ones we can't draw. */
export function excalidrawConnectorAppearance(element: ExcalidrawElement): Record<string, string | number> {
  const appearance: Record<string, string | number> = {};
  const stroke = excalidrawInk(element.strokeColor);
  if (stroke) appearance.stroke = stroke;
  if (typeof element.strokeWidth === 'number') appearance.strokeWidth = finite(element.strokeWidth, 2);
  if (element.strokeStyle === 'dashed' || element.strokeStyle === 'dotted') appearance.dashPattern = element.strokeStyle;
  const alpha = excalidrawOpacity(element);
  if (alpha !== undefined) appearance.opacity = alpha;
  return appearance;
}

/** A freehand stroke's or loose line's paint, in the keys our pen and line nodes read from `content`. */
export function excalidrawStrokeContent(element: ExcalidrawElement): JsonObject {
  const stroke = excalidrawInk(element.strokeColor);
  const alpha = excalidrawOpacity(element);
  return {
    ...(stroke ? { strokeColor: stroke } : {}),
    strokeWidth: finite(element.strokeWidth, 2),
    ...(alpha !== undefined ? { transparency: alpha } : {}),
  };
}
