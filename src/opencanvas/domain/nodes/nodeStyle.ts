import type { SceneNode } from '../document/types';
import { resolveNodeVisualStyle, resolveSectionVisualStyle, resolveTextVisualStyle } from '../../../theme';
import { resolveArchitectureNodePresentation } from './architectureNodePresentation';
import { resolveBasicNodePresentation } from './basicNodePresentation';
import { resolveContainerNodePresentation } from './containerNodePresentation';
import { resolveNodeStroke, type NodeStrokeStyle } from './nodeStroke';
import { optionalPresentationString } from './nodePresentationValues';
import { darkWashFill, isDarkCanvas, resolveAdaptiveInk, WASH_SUB_INK } from '../color/adaptiveColor';
import { hasExplicitColor, nodePaletteName, PALETTE_KEYS, paletteResolver } from './nodePalette';
import { widgetLabelBox } from './widgetNodePresentation';
import { framePresetOf } from './framePreset';
import { DRAWN_SHAPE_FILL } from './shapeNode';
import { mixHex, normalizeHex, readableTextOn } from '../../../lib/colorUtils';

// Every visible property of a node, resolved from flat `appearance` keys
// with legacy `content.*` palette/typography keys as fallbacks. Renderers, the
// label editor and measurement all read this and nothing else, so a style edit is one shallow appearance merge.

export type FontFamilyKey = 'sans' | 'serif' | 'mono' | 'hand';
export type FontWeight = 400 | 500 | 600 | 700;
export type TextDecoration = 'none' | 'underline' | 'line-through';
export type TextAlign = 'start' | 'center' | 'end';
export type TextVerticalAlign = 'top' | 'middle' | 'bottom';

export const FONT_STACKS: Readonly<Record<FontFamilyKey, string>> = {
  sans: 'Inter, ui-sans-serif, system-ui, sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  hand: '"Comic Sans MS", "Chalkboard SE", "Segoe Print", cursive',
};

export interface NodeStyle {
  /** Hex, rgba() or 'transparent'. */
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly strokeStyle: NodeStrokeStyle;
  readonly dash: readonly number[];
  readonly cornerRadius: number;
  readonly opacity: number;
  readonly shadow: boolean;
  readonly textColor: string;
  /** Ink for descriptions, kind tags and legends when the node is a dark-canvas wash; otherwise undefined (the palette's own). */
  readonly subTextColor?: string;
  readonly fontSize: number;
  readonly fontFamily: FontFamilyKey;
  readonly fontWeight: FontWeight;
  readonly fontStyle: 'normal' | 'italic';
  readonly textDecoration: TextDecoration;
  readonly textAlign: TextAlign;
  readonly textVerticalAlign: TextVerticalAlign;
  /** Multiplier of fontSize. */
  readonly lineHeight: number;
  /** Fraction of fontSize (em). */
  readonly letterSpacing: number;
  readonly textPadding: number;
}

export const STYLE_LIMITS = {
  strokeWidth: { min: 0, max: 24 },
  cornerRadius: { min: 0, max: 64 },
  fontSize: { min: 8, max: 96 },
  lineHeight: { min: 1, max: 2 },
  letterSpacing: { min: -0.05, max: 0.2 },
  textPadding: { min: 0, max: 32 },
} as const;

const FONT_SIZE_ALIASES: Readonly<Record<string, number>> = { small: 14, medium: 16, large: 18 };
const FONT_FAMILY_ALIASES: Readonly<Record<string, FontFamilyKey>> = {
  inter: 'sans', sans: 'sans', serif: 'serif', mono: 'mono', monospace: 'mono', hand: 'hand',
};

function clampNumber(value: unknown, limits: { readonly min: number; readonly max: number }, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, parsed));
}

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

function paint(value: unknown, fallback: string): string {
  return typeof value === 'string' && (value === 'transparent' || /^#[0-9a-f]{3,8}$/i.test(value))
    ? value.toLowerCase() : fallback;
}

export function isTextNode(node: Pick<SceneNode, 'kind'>): boolean {
  return node.kind === 'text';
}

function fontSizeFallback(node: SceneNode): number {
  if (!isTextNode(node)) return 14;
  const legacy = node.content.fontSize;
  const text = typeof legacy === 'string' ? legacy : typeof legacy === 'number' ? String(legacy) : '';
  const parsed = Number(text);
  return Number.isFinite(parsed) && text !== '' ? parsed : (FONT_SIZE_ALIASES[text] ?? 16);
}

function fontWeightValue(value: unknown, fallback: FontWeight): FontWeight {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (parsed === 'bold') return 700;
  return oneOf<FontWeight>(parsed, [400, 500, 600, 700], fallback);
}

// Nodes are immutable records: a style edit replaces the node, so the node
// itself is the cache key and the renderer pays the resolve once per edit.
const cache = new WeakMap<SceneNode, NodeStyle>();

export function resolveNodeStyle(node: SceneNode, canvasColor?: string): NodeStyle {
  if (canvasColor !== undefined) return computeNodeStyle(node, canvasColor);
  const cached = cache.get(node);
  if (cached) return cached;
  const style = computeNodeStyle(node);
  cache.set(node, style);
  return style;
}

// Per-family defaults: what a node looks like before any appearance key is
// set. Containers and architecture nodes have their own palette and title
// typography; everything else is a basic shape.
interface FamilyDefaults {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly text: string;
  readonly cornerRadius: number;
  readonly fontSize: number;
  readonly fontWeight: FontWeight;
  readonly textAlign: TextAlign;
  readonly textVerticalAlign: TextVerticalAlign;
  readonly textPadding: number;
  /** The label sits on the canvas, not on the node's fill (icon nodes). */
  readonly labelOnCanvas: boolean;
}

function familyDefaults(node: SceneNode): FamilyDefaults {
  const container = resolveContainerNodePresentation(node);
  if (container) {
    const colors = resolveSectionVisualStyle(container.colorKey, container.colorMode, container.customColor,
      container.kind === 'group' ? 'violet' : 'blue', nodePaletteName(node));
    return {
      fill: colors.bg, stroke: colors.border, strokeWidth: container.kind === 'swimlane' ? 2 : 1.5,
      text: colors.title, cornerRadius: 12, fontSize: container.kind === 'swimlane' ? 13 : 14, fontWeight: 700,
      textAlign: 'start', textVerticalAlign: 'middle', textPadding: 0, labelOnCanvas: container.preset !== null,
    };
  }
  // A widget paints its own text; these only shape the label editor to match.
  const widget = widgetLabelBox(node);
  if (widget) {
    return {
      fill: '#ffffff', stroke: '#555952', strokeWidth: 1.5, text: '#1f2937', cornerRadius: 6,
      fontSize: widget.size, fontWeight: widget.weight, textAlign: widget.align === 'center' ? 'center' : 'start',
      textVerticalAlign: widget.verticalAlign, textPadding: 0, labelOnCanvas: false,
    };
  }
  const architecture = resolveArchitectureNodePresentation(node);
  if (architecture) {
    const colors = resolveNodeVisualStyle(architecture.colorKey, architecture.colorMode, architecture.customColor,
      nodePaletteName(node));
    const icon = architecture.display === 'provider-icon';
    // A row card (icon left of its text) is a plain rounded card: its own fill, text on it, start-aligned.
    if (icon && architecture.iconPlacement === 'left') {
      return {
        fill: colors.bg, stroke: colors.border, strokeWidth: 1, text: colors.text, cornerRadius: 10,
        fontSize: 13, fontWeight: 600, textAlign: 'start', textVerticalAlign: 'middle', textPadding: 12, labelOnCanvas: false,
      };
    }
    return {
      fill: icon ? colors.iconBg : colors.bg, stroke: colors.border, strokeWidth: icon ? 1 : 1.5, text: colors.text,
      cornerRadius: icon ? 14 : 12,
      fontSize: icon ? 12 : 14, fontWeight: 600, textAlign: icon ? 'center' : 'start', textVerticalAlign: 'top',
      textPadding: icon ? 4 : 12, labelOnCanvas: icon,
    };
  }
  const text = isTextNode(node);
  const basic = resolveBasicNodePresentation(node);
  const c = node.content;
  const palette = text
    ? { bg: 'transparent', border: 'transparent',
        text: resolveTextVisualStyle(optionalPresentationString(c.color) ?? 'slate', 'subtle',
          optionalPresentationString(c.customColor), 'slate', nodePaletteName(node)).text }
    : resolveNodeVisualStyle(basic?.colorKey, basic?.colorMode, basic?.customColor, nodePaletteName(node));
  const legacyBackground = text ? optionalPresentationString(c.backgroundColor) : undefined;
  return {
    fill: legacyBackground ?? palette.bg, stroke: palette.border, strokeWidth: 1.5,
    text: text ? optionalPresentationString(c.customColor) ?? palette.text : palette.text,
    cornerRadius: basic?.shape === 'rounded' ? 12 : 0,
    fontSize: fontSizeFallback(node), fontWeight: text ? fontWeightValue(c.fontWeight, 500) : 600,
    textAlign: 'center', textVerticalAlign: 'middle', textPadding: text ? 8 : 16, labelOnCanvas: false,
  };
}

/** The colour word a node of this family has when none is set. */
function familyColorKey(node: SceneNode): string | undefined {
  // A C4 kind's own colour is the family default too: the author did not choose it.
  if (typeof node.content.archKindColor === 'string' && node.content.colorMode !== 'filled') return node.content.archKindColor;
  const bare = { ...node, content: { ...node.content, color: undefined } };
  return (resolveBasicNodePresentation(bare) ?? resolveArchitectureNodePresentation(bare))?.colorKey;
}

const PALETTE_FILLS = new Map<string, ReadonlySet<string>>();

/** Whether `fill` is one of the palette's own swatch fills (pastel or solid), not a colour the author typed. */
function isPaletteFill(fill: string, palette: ReturnType<typeof nodePaletteName>): boolean {
  let fills = PALETTE_FILLS.get(palette);
  if (!fills) {
    const swatch = paletteResolver(palette);
    fills = new Set(PALETTE_KEYS.flatMap((key) => [swatch(key, 'pastel').fill.toLowerCase(), swatch(key, 'solid').fill.toLowerCase()]));
    PALETTE_FILLS.set(palette, fills);
  }
  return fills.has(fill.toLowerCase());
}

function computeNodeStyle(node: SceneNode, canvasColor?: string): NodeStyle {
  const a = node.appearance;
  const c = node.content;
  const text = isTextNode(node);
  const defaults = familyDefaults(node);
  const stroke = resolveNodeStroke(node);
  const strokeWidth = a.strokeWidth === undefined ? (text ? 0 : defaults.strokeWidth) : stroke.width;
  // A container's default tint is a light wash; on a dark canvas it turns into
  // a grey slab. Keep the hue as a faint wash and let the title ink follow the canvas.
  const dark = isDarkCanvas(canvasColor);
  const containerWash = a.fill === undefined && defaults.fill.startsWith('rgba(') && dark;
  // A default paper-white or pastel node washes the same way; an explicit colour never does. The DSL
  // writes the white swatch for a node with no colour word, and a drawn shape is born with its paper fill: both count as unset.
  const white = paletteResolver(nodePaletteName(node))('white', 'pastel');
  const unsetFill = a.fill === undefined
    || (typeof a.fill === 'string' && (a.fill.toLowerCase() === white.fill || a.fill.toLowerCase() === DRAWN_SHAPE_FILL));
  const defaultWash = dark && unsetFill && /^#[0-9a-f]{6}$/i.test(defaults.fill)
    && !widgetLabelBox(node) && !framePresetOf(node) && !hasExplicitColor(node, familyColorKey(node));
  const darkWash = containerWash || defaultWash;
  const fill = darkWash ? darkWashFill(a.fill === undefined ? defaults.fill : white.fill) : paint(a.fill, defaults.fill);
  // The white swatch's own ink is part of that default and follows the canvas with it.
  const swatchInk = darkWash && a.fill !== undefined && typeof a.textColor === 'string' && a.textColor.toLowerCase() === white.textColor;
  const explicitTextColor = swatchInk ? undefined : a.textColor ?? (text ? c.customColor : undefined);
  // Ink adapts to whatever is behind the label: a solid fill, or the canvas
  // when the label sits outside the fill or the fill is transparent. A tinted
  // (rgba) container fill keeps its palette ink, except as a dark-canvas wash.
  const textBackdrop = defaults.labelOnCanvas || fill === 'transparent' || darkWash ? canvasColor
    : fill.startsWith('#') ? fill : undefined;
  const textColor = canvasColor !== undefined && textBackdrop !== undefined
    ? resolveAdaptiveInk(explicitTextColor, textBackdrop)
    : paint(a.textColor, defaults.text);
  // The palette's grey sub-label ink is for its own fills; on a dark authored hex it follows the label, as the export
  // draws it (72%). Palette swatches and cards (whose header reads subTextColor as a wash) keep their look.
  const darkFill = explicitTextColor !== undefined && normalizeHex(fill) !== null && readableTextOn(fill) === '#ffffff'
    && !resolveArchitectureNodePresentation(node) && !isPaletteFill(fill, nodePaletteName(node));
  return {
    fill,
    stroke: paint(a.stroke, defaults.stroke),
    strokeWidth,
    strokeStyle: stroke.style,
    dash: strokeWidth > 0 ? stroke.dash : [],
    cornerRadius: clampNumber(a.cornerRadius, STYLE_LIMITS.cornerRadius, defaults.cornerRadius),
    opacity: clampNumber(a.opacity, { min: 0, max: 1 }, 1),
    shadow: a.shadow === true,
    textColor,
    ...(darkWash && explicitTextColor === undefined ? { subTextColor: WASH_SUB_INK }
      : darkFill ? { subTextColor: mixHex(textColor, fill, 0.28) } : {}),
    fontSize: clampNumber(a.fontSize, STYLE_LIMITS.fontSize, defaults.fontSize),
    fontFamily: oneOf<FontFamilyKey>(a.fontFamily, ['sans', 'serif', 'mono', 'hand'],
      FONT_FAMILY_ALIASES[optionalPresentationString(c.fontFamily) ?? ''] ?? 'sans'),
    fontWeight: fontWeightValue(a.fontWeight, defaults.fontWeight),
    fontStyle: oneOf(a.fontStyle, ['normal', 'italic'], text ? oneOf(c.fontStyle, ['normal', 'italic'], 'normal') : 'normal'),
    textDecoration: oneOf<TextDecoration>(a.textDecoration, ['none', 'underline', 'line-through'], 'none'),
    textAlign: oneOf<TextAlign>(a.textAlign, ['start', 'center', 'end'], defaults.textAlign),
    textVerticalAlign: oneOf<TextVerticalAlign>(a.textVerticalAlign, ['top', 'middle', 'bottom'], defaults.textVerticalAlign),
    lineHeight: clampNumber(a.lineHeight, STYLE_LIMITS.lineHeight, 1.2),
    letterSpacing: clampNumber(a.letterSpacing, STYLE_LIMITS.letterSpacing, 0),
    textPadding: clampNumber(a.textPadding, STYLE_LIMITS.textPadding, defaults.textPadding),
  };
}

/** CSS `font` shorthand for the DOM label editor; `scale` is the screen zoom. */
export function nodeStyleFont(style: NodeStyle, scale = 1): string {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize * scale}px/${style.lineHeight} ${FONT_STACKS[style.fontFamily]}`;
}
