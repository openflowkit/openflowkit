import type { SceneNode } from '../document/types';
import { resolveAdaptiveInk } from '../color/adaptiveColor';
import { normalizeHex } from '../../../lib/colorUtils';
import { resolveNodeStyle, type NodeStyle } from './nodeStyle';
import { paletteSwatch } from './nodePalette';
import {
  WIDGETS,
  WIDGET_SEVERITIES,
  type WidgetInk,
  type WidgetInkPaint,
  type WidgetPresentation,
  type WidgetVariant,
  isWidgetKind,
} from './widgetNodeSpec';
import { BODY, SMALL, widgetPrimitives } from './widgetNodeGeometry';

// Wireframe widgets are one node kind, `widget`, whose `content.widget` names
// the control. This module turns a widget into a renderer-neutral list of
// primitives (rects, circles, paths, text) that Pixi and the SVG export both
// paint, so the canvas and the file can never disagree. Pure TypeScript.

export {
  WIDGET_KINDS,
  WIDGET_SEVERITIES,
  WIDGETS,
  isWidgetKind,
  type WidgetInk,
  type WidgetInkPaint,
  type WidgetKind,
  type WidgetPrimitive,
  type WidgetVariant,
} from './widgetNodeSpec';
export { estimateTextWidth, wrapText } from './widgetNodeGeometry';

/**
 * What a flat control is drawn on: the nearest ancestor with an opaque fill
 * (a white phone frame), else the canvas.
 */
export function widgetBackdrop(
  node: SceneNode, parentOf: (id: string) => SceneNode | undefined, canvasColor: string
): string {
  const seen = new Set<string>();
  for (let parent = node.parentId ? parentOf(node.parentId) : undefined; parent && !seen.has(parent.id);
    parent = parent.parentId ? parentOf(parent.parentId) : undefined) {
    seen.add(parent.id);
    const fill = resolveNodeStyle(parent, canvasColor).fill;
    if (normalizeHex(fill)) return fill;
  }
  return canvasColor;
}

/**
 * Colour per role. Flat controls (a heading, a checkbox's label) sit on their
 * backdrop, boxed ones (an input's placeholder) sit on the widget's fill, so
 * the two text roles adapt separately and both read in dark mode.
 */
export function resolveWidgetInks(node: SceneNode, style: NodeStyle, backdrop: string): Readonly<Record<WidgetInk, WidgetInkPaint>> {
  const ink = resolveAdaptiveInk(node.appearance.textColor, backdrop);
  const solid = (key: Parameters<typeof paletteSwatch>[0]): WidgetInkPaint => ({ color: paletteSwatch(key, 'solid').fill, alpha: 1 });
  const surface = style.fill === 'transparent' ? backdrop : style.fill;
  return {
    ink: { color: ink, alpha: 1 },
    muted: { color: ink, alpha: 0.6 },
    faint: { color: ink, alpha: 0.1 },
    text: { color: style.textColor, alpha: 1 },
    subtle: { color: style.textColor, alpha: 0.5 },
    line: { color: style.stroke === 'transparent' ? ink : style.stroke, alpha: style.stroke === 'transparent' ? 0.3 : 1 },
    surface: { color: surface, alpha: 1 },
    accent: solid('blue'),
    onAccent: { color: '#ffffff', alpha: 1 },
    info: solid('blue'),
    success: solid('emerald'),
    warning: solid('amber'),
    error: solid('red'),
  };
}

/** `A | B | C` → items; empty entries are dropped. */
export function widgetItems(label: string): string[] {
  return label.split('|').map((item) => item.trim()).filter(Boolean);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function resolveWidgetPresentation(node: SceneNode): WidgetPresentation | null {
  if (node.kind !== 'widget' || !isWidgetKind(node.content.widget)) return null;
  const widget = node.content.widget;
  const spec = WIDGETS[widget];
  const label = typeof node.content.label === 'string' ? node.content.label : spec.label;
  const rawValue = node.content.value;
  const rawActive = node.content.active;
  const rawVariant = node.content.variant;
  const variant = rawVariant === 'primary' || (WIDGET_SEVERITIES as readonly unknown[]).includes(rawVariant)
    ? rawVariant as WidgetVariant : null;
  const state = {
    widget,
    label,
    items: spec.items ? widgetItems(label) : [],
    checked: node.content.checked === true,
    value: typeof rawValue === 'number' && Number.isFinite(rawValue) ? clamp01(rawValue) : 0,
    active: typeof rawActive === 'number' && Number.isInteger(rawActive) ? rawActive : -1,
    variant,
  };
  return { ...state, primitives: widgetPrimitives(state, node.size) };
}

/** Where a widget draws its label, node-local, and how: the label editor opens on it. */
interface WidgetLabelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly align: 'start' | 'center';
  readonly verticalAlign: 'top' | 'middle';
  readonly size: number;
  readonly weight: 400 | 500 | 600 | 700;
  /** The ink the label is drawn in, so the editor's text matches it (white in a tooltip). */
  readonly ink: WidgetInk;
}

/**
 * The label's box, mirroring the offsets `widgetPrimitives` draws at. Null for
 * widgets that draw no label (an image, a divider, a rating…): there is
 * nothing to edit, so the editor does not open.
 */
export function widgetLabelBox(node: SceneNode): WidgetLabelBox | null {
  if (node.kind !== 'widget' || !isWidgetKind(node.content.widget)) return null;
  const { width: w, height: h } = node.size;
  const box = (
    x: number, y: number, width: number, height: number, ink: WidgetInk, align: 'start' | 'center' = 'start',
    size = BODY, weight: WidgetLabelBox['weight'] = 400, verticalAlign: 'top' | 'middle' = 'middle'
  ): WidgetLabelBox => ({ x, y, width: Math.max(1, width), height: Math.max(1, height), align, verticalAlign, size, weight, ink });
  const widget = node.content.widget;
  switch (widget) {
    // Items widgets edit `A | B | C` over the whole control; boxed ones draw on their fill.
    case 'navbar': case 'tabbar': case 'menu': case 'accordion': case 'sidebar': return box(0, 0, w, h, 'text', 'center');
    case 'tabs': case 'segmented': case 'stepper': case 'breadcrumbs': case 'pagination': case 'list': return box(0, 0, w, h, 'ink', 'center');
    case 'button': return box(0, 0, w, h, node.content.variant === 'primary' ? 'onAccent' : 'text', 'center', BODY, 600);
    case 'input': return box(12, 0, w - 24, h, 'text');
    case 'search': return box(34, 0, w - 46, h, 'text');
    case 'dropdown': return box(12, 0, w - 44, h, 'text');
    case 'textarea': return box(12, 8, w - 24, h - 16, 'text', 'start', BODY, 400, 'top');
    case 'checkbox': { const size = Math.min(16, h); return box(size + 8, 0, w - size - 8, h, 'ink'); }
    case 'radio': { const size = Math.min(8, h / 2) * 2; return box(size + 8, 0, w - size - 8, h, 'ink'); }
    case 'toggle': { const track = Math.min(20, h) * 1.8; return box(track + 10, 0, w - track - 10, h, 'ink'); }
    case 'slider': return box(0, 0, w * 0.4, h, 'ink');
    case 'heading': return box(0, 0, w, h, 'ink', 'start', Math.max(14, Math.min(40, h * 0.62)), 700);
    case 'paragraph': return box(0, 0, w, h, 'ink', 'start', BODY, 400, 'top');
    case 'link': return box(0, 0, w, h, 'accent', 'start', BODY, 500);
    case 'badge': return box(0, 0, w, h, 'onAccent', 'center', SMALL, 600);
    case 'card': { const media = Math.max(0, Math.min(h * 0.5, h - 72)); return box(14, media + 14, w - 28, 20, 'text', 'start', 14, 600); }
    case 'alert': return box(38, 0, w - 50, h, 'ink', 'start', BODY, 500);
    case 'tooltip': return box(0, 0, w, Math.max(12, h - 8), 'surface', 'center', 12, 500);
    case 'datepicker': return box(14, 12, w - 70, 20, 'text', 'start', BODY, 600);
    case 'statusbar': return box(16, 0, w / 2, h, 'ink', 'start', 12, 600);
    case 'image': case 'avatar': case 'divider': case 'progress': case 'rating': case 'fab': return null;
  }
}

/** Screen-reader name: "Toggle 'Dark mode', on". */
export function describeWidget(presentation: WidgetPresentation): string {
  const spec = WIDGETS[presentation.widget];
  const label = presentation.label ? ` '${presentation.label}'` : '';
  const state = spec.state === 'checked' ? (presentation.checked ? ', on' : ', off')
    : spec.state === 'value' ? `, ${Math.round(presentation.value * 100)}%`
      : spec.state === 'active' && presentation.active >= 0
        ? `, ${presentation.items[presentation.active] ?? presentation.active} selected`
        : spec.state === 'variant' && presentation.variant ? `, ${presentation.variant}` : '';
  return `Wireframe ${spec.name.toLowerCase()}${label}${state}`;
}
