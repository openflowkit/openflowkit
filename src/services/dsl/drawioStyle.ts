import type { JsonObject } from '../../opencanvas/domain/document/json';
import type { SceneAnchor } from '../../opencanvas/domain/document/types';
import type { ShapeKind } from '../../opencanvas/domain/nodes/shapeNode';
import { DRAWIO_STYLESHEET } from './drawioStylesheet';
import { decodeEntities } from './xmlReader';

// draw.io's cell `style` ("rounded=1;fillColor=#dae8fc;ellipse") read into the
// shapes and paint keys OpenFlowKit draws. What has no counterpart is named, so
// the importer can say so.

export type DrawioStyle = Readonly<Record<string, string>>;

/** `table[key]` only when the table itself has it: "constructor" in a file is a word, not Object's own. */
export function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * A cell's style as draw.io reads it (mxStylesheet.getCellStyle): its default shape or connector style, then the
 * string left to right, each bare word merging that named style from draw.io's sheet and each `key=value` setting
 * one key. A string starting with `;` starts from nothing. Two departures keep the rest of the importer reading as
 * it does: the bare word stays as a key (`text: ''`), and the default `shape` (draw.io's `label` box and
 * `connector` line, both drawn as ours by default) is left out so a bare word still names the shape.
 * draw.io deletes a key set to `none`; it is kept here, read everywhere as "no paint", which draws the same.
 */
export function resolveDrawioStyle(style: string | undefined, kind: 'vertex' | 'edge'): DrawioStyle {
  const resolved: Record<string, string> = Object.create(null) as Record<string, string>;
  const text = style ?? '';
  if (!text.startsWith(';')) {
    const { shape: _shape, ...defaults } = DRAWIO_STYLESHEET[kind === 'edge' ? 'defaultEdge' : 'defaultVertex']!;
    Object.assign(resolved, defaults);
  }
  for (const part of text.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const equals = trimmed.indexOf('=');
    if (equals !== -1) { resolved[trimmed.slice(0, equals)] = trimmed.slice(equals + 1); continue; }
    const named = own(DRAWIO_STYLESHEET, trimmed);
    if (named) Object.assign(resolved, named);
    resolved[trimmed] = '';
  }
  return resolved;
}

/** The shape a cell names: `shape=` wins over a bare word (`ellipse`, `rhombus`, `text`, `swimlane`). */
export function drawioShapeName(style: DrawioStyle): string {
  if (style.shape) return style.shape;
  // Asked several times a cell, of styles a big file shares between thousands of cells: found once a style.
  let name = BARE_NAMES.get(style);
  if (name === undefined) BARE_NAMES.set(style, name = Object.keys(style).find((key) => style[key] === '') ?? '');
  return name;
}
const BARE_NAMES = new WeakMap<DrawioStyle, string>();

const SHAPES: Readonly<Record<string, ShapeKind>> = {
  '': 'rectangle', rect: 'rectangle', rectangle: 'rectangle', label: 'rectangle', process: 'rectangle', partialRectangle: 'rectangle',
  ellipse: 'ellipse', doubleEllipse: 'ellipse', rhombus: 'diamond', triangle: 'triangle',
  hexagon: 'hexagon', parallelogram: 'parallelogram', trapezoid: 'trapezoid',
  cylinder: 'cylinder', cylinder2: 'cylinder', cylinder3: 'cylinder', datastore: 'cylinder',
  cloud: 'cloud', document: 'document', umlActor: 'actor', actor: 'actor', step: 'chevron',
  note: 'page', folder: 'folder', cube: 'cube', star: 'star', callout: 'speech-bubble',
  cross: 'plus', singleArrow: 'arrow-right', mxgraph_basic_heart: 'heart',
  // draw.io's Bootstrap wireframe set: plain and rounded boxes, a bare label, form controls.
  mxgraph_bootstrap_rect: 'rectangle', mxgraph_bootstrap_rrect: 'rounded', mxgraph_bootstrap_anchor: 'rectangle',
  mxgraph_bootstrap_checkbox: 'rectangle', mxgraph_bootstrap_radioButton: 'circle',
  // draw.io's flowchart, basic and arrow sets repeat shapes we have under other names.
  mxgraph_flowchart_process: 'rectangle', mxgraph_flowchart_predefined_process: 'rectangle',
  mxgraph_flowchart_decision: 'diamond', mxgraph_flowchart_terminator: 'capsule', mxgraph_flowchart_data: 'parallelogram',
  mxgraph_flowchart_document: 'document', 'mxgraph_flowchart_on-page_reference': 'circle',
  mxgraph_flowchart_start_1: 'ellipse', mxgraph_flowchart_start_2: 'circle',
  mxgraph_basic_star: 'star', mxgraph_basic_octagon: 'octagon',
  mxgraph_basic_oval_callout: 'speech-bubble', mxgraph_basic_roundRectCallout: 'speech-bubble',
  mxgraph_basic_rectCallout: 'speech-bubble', mxgraph_basic_rounded_rectangular_callout: 'speech-bubble',
  mxgraph_arrows2_arrow: 'arrow-right', mxgraph_arrows2_stylisedArrow: 'arrow-right',
};

/** Shapes draw.io draws with no outline and no fill: only their label shows. */
const BARE = new Set(['mxgraph.bootstrap.anchor']);

/** The library shape a draw.io vertex becomes, and its own name when it had to become a box. */
export function drawioShape(style: DrawioStyle, width: number, height: number): { readonly kind: ShapeKind; readonly unknown?: string } {
  const name = drawioShapeName(style);
  if (name === 'text') return { kind: 'text' };
  const kind = own(SHAPES, name.replace(/\./g, '_'));
  if (!kind) return { kind: 'rectangle', unknown: name };
  if (kind === 'rectangle' && style.rounded === '1') return { kind: 'rounded' };
  if (kind === 'ellipse' && Math.abs(width - height) < 1) return { kind: 'circle' };
  return { kind };
}

/**
 * The picture a cell shows, as a URL our image node can load: one embedded in the file or on the web.
 * draw.io writes embedded pictures as `data:image/svg+xml,<base64>`, without the `;base64` a browser needs.
 * A picture from draw.io's own library (`img/lib/…`) is only on draw.io's servers, so it is null.
 */
export function drawioImageUrl(style: DrawioStyle): string | null {
  const value = style.image;
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const embedded = /^data:(image\/[a-z0-9.+-]+)(;base64)?,(.*)$/is.exec(value);
  if (!embedded) return null;
  const [, type, base64, data] = embedded;
  return base64 || !/^[A-Za-z0-9+/=\s]+$/.test(data!) ? value : `data:${type};base64,${data}`;
}

/** `#AbC` / `#aabbcc` as our lower-case hex; `none` is transparent; draw.io's `default` and anything else is unset. */
export function drawioColor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === 'none') return 'transparent';
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value) ? value.toLowerCase() : undefined;
}

/** A line colour: draw.io's default black (and near-black grey) is left unset, so lines follow our theme and show on a dark canvas. */
export const drawioLine = (value: string | undefined): string | undefined => {
  const color = drawioColor(value);
  return drawioDarkInk(color) ? undefined : color;
};

/** A near-black grey (`#000` to `#555`): the ink draw.io writes by default, meant for a light page. */
export function drawioDarkInk(value: unknown): boolean {
  if (typeof value !== 'string' || !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) return false;
  const lower = value.toLowerCase();
  const hex = lower.length === 4 ? lower.replace(/[0-9a-f]/g, (digit) => digit + digit) : lower;
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return Math.max(r!, g!, b!) <= 0x55 && Math.max(r!, g!, b!) - Math.min(r!, g!, b!) <= 8;
}

const finite = (value: string | undefined): number | undefined => {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Paint and type a vertex carries, in our appearance keys; unset keys are left out so the app's defaults apply. */
export function drawioNodeAppearance(style: DrawioStyle): JsonObject {
  // draw.io's dark mode draws every colour a cell sets with its lightness flipped (`invertForDark`).
  const appearance: Record<string, string | number | boolean> = { darkColors: 'invert' };
  // Paint the cell doesn't set is left to the theme, which pairs fill and ink in light and dark alike.
  const bare = BARE.has(drawioShapeName(style));
  const fill = bare ? 'transparent' : drawioFaded(drawioColor(style.fillColor), style.fillOpacity);
  const stroke = bare ? 'transparent' : drawioFaded(drawioLine(style.strokeColor), style.strokeOpacity);
  const text = drawioColor(style.fontColor);
  if (fill) appearance.fill = fill;
  if (stroke) appearance.stroke = stroke;
  if (text && text !== 'transparent') appearance.textColor = text;
  if (style.align === 'left') appearance.textAlign = 'start';
  if (style.align === 'right') appearance.textAlign = 'end';
  if (style.verticalAlign === 'top' || style.verticalAlign === 'bottom') appearance.textVerticalAlign = style.verticalAlign;
  // draw.io insets a label by `spacing` (2) plus each side's own; ours has one inset for every side, so it takes
  // the side the label is set against (a centred label's one-sided `spacingRight` would squeeze it from both).
  const side = style.align === 'left' ? finite(style.spacingLeft) : style.align === 'right' ? finite(style.spacingRight) : 0;
  const inset = (finite(style.spacing) ?? 2) + (side ?? 0);
  appearance.textPadding = Math.min(32, Math.max(0, inset));
  const strokeWidth = finite(style.strokeWidth);
  if (strokeWidth !== undefined) appearance.strokeWidth = strokeWidth;
  const fontSize = finite(style.fontSize);
  if (fontSize !== undefined && fontSize > 0) appearance.fontSize = fontSize;
  // fontStyle is a bit mask: 1 bold, 2 italic, 4 underline.
  const fontStyle = finite(style.fontStyle) ?? 0;
  // draw.io sets words in a regular weight unless bold.
  appearance.fontWeight = fontStyle & 1 ? 700 : 400;
  if (fontStyle & 2) appearance.fontStyle = 'italic';
  if (fontStyle & 4) appearance.textDecoration = 'underline';
  if (style.dashed === '1') appearance.strokeStyle = 'dashed';
  const opacity = finite(style.opacity);
  if (opacity !== undefined && opacity < 100) appearance.opacity = Math.max(0, opacity) / 100;
  const gradient = drawioColor(style.gradientColor);
  if (gradient && gradient !== 'transparent' && fill !== 'transparent') {
    appearance.gradientColor = gradient;
    const direction = style.gradientDirection;
    if (direction === 'north' || direction === 'east' || direction === 'west' || direction === 'radial') appearance.gradientDirection = direction;
  }
  if (style.shadow === '1') {
    // draw.io's per-shape shadow, with its defaults: offset 2, 3; a CSS blur of 2 (an SVG blur of half that); black at 25%.
    appearance.shadow = true;
    appearance.shadowColor = drawioColor(style.shadowColor) ?? '#000000';
    appearance.shadowOffsetX = finite(style.shadowOffsetX) ?? 2;
    appearance.shadowOffsetY = finite(style.shadowOffsetY) ?? 3;
    appearance.shadowBlur = Math.max(0, finite(style.shadowBlur) ?? 2) / 2;
    appearance.shadowOpacity = Math.min(100, Math.max(0, finite(style.shadowOpacity) ?? 25)) / 100;
  }
  return appearance;
}

/** `color` seen through at draw.io's `percent` (0–100), as #rrggbbaa; a full one, or a theme colour, stays as it is. */
export function drawioFaded(color: string | undefined, percent: string | undefined): string | undefined {
  const value = finite(percent);
  if (color === undefined || value === undefined || value >= 100 || !/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(color)) return color;
  const hex = color.length === 4 ? color.replace(/[0-9a-f]/g, (digit) => digit + digit) : color;
  return `${hex}${Math.round(Math.max(0, value) * 255 / 100).toString(16).padStart(2, '0')}`;
}

/** Heads `marker` draws as themselves: an arrow, a circle, a diamond or a cross. */
const DRAWN_HEADS = new Set(['', 'none', 'classic', 'classicThin', 'block', 'blockThin', 'open', 'openThin', 'openAsync', 'async', 'oval', 'circle', 'circlePlus', 'cross']);
/** Colour words draw.io writes that mean "the default" or "none", which we keep as the theme or as no paint. */
const COLOUR_WORDS = new Set(['', 'default', 'none', 'swimlane', 'inherit']);
/** Fonts close enough to ours that swapping them is no loss. */
const OUR_FONTS = new Set(['helvetica', 'arial', 'verdana', 'inter', 'sans-serif']);

/**
 * What a cell's style asks for that we don't draw, one plain line each; the importer counts them across the page.
 * Arrow heads are named by draw.io's word, since `marker` draws any head it doesn't know as an arrow.
 */
export function drawioStyleLosses(style: DrawioStyle, of: 'shape' | 'connector'): string[] {
  const losses: string[] = [];
  if (style.gradientColor && style.gradientColor !== 'none' && !drawioColor(style.gradientColor)) losses.push('gradient fills are drawn solid');
  if (style.sketch === '1' || style.comic === '1') losses.push('the hand-drawn sketch look is drawn clean');
  if (style.fillStyle && style.fillStyle !== 'solid' && style.fillStyle !== 'auto') losses.push('hatched and patterned fills are drawn solid');
  if (style.glass === '1') losses.push('the glass shine is left off');
  const unread = (value: string | undefined) => value !== undefined && !COLOUR_WORDS.has(value) && drawioColor(value) === undefined;
  if (unread(style.fillColor) || unread(style.strokeColor) || unread(style.fontColor)) losses.push('colours not written as #hex use the theme’s instead');
  const font = style.fontFamily?.trim();
  if (font && !OUR_FONTS.has(font.toLowerCase())) losses.push(`the “${font}” font is drawn in ours`);
  if (of === 'connector') {
    // Entity-relation ends are drawn only as a pair; one on its own is drawn as an arrow.
    const relation = drawioErRelation(style) !== null;
    for (const head of [style.endArrow, style.startArrow]) {
      if (head !== undefined && !DRAWN_HEADS.has(head) && !head.startsWith('diamond') && !(relation && head.startsWith('ER'))) {
        losses.push(`draw.io’s “${head}” arrow head is drawn as an arrow`);
      }
    }
  }
  return losses;
}

/** Arrow head names draw.io writes, as the marker words our connectors draw; `none` is no marker. */
function marker(value: string | undefined, fallback: string | null): string | null {
  const name = value ?? fallback;
  if (name === null || name === 'none' || name === '') return null;
  if (name === 'oval' || name === 'circle' || name === 'circlePlus') return 'circle';
  if (name.startsWith('diamond')) return 'diamond';
  if (name === 'cross') return 'cross';
  return 'arrow';
}

/** draw.io's entity-relation ends, as the cardinality symbols Mermaid writes on each side of `--`. */
const ER_ENDS: Readonly<Record<string, readonly [source: string, target: string]>> = {
  ERmandOne: ['||', '||'], ERone: ['||', '||'], ERzeroToOne: ['|o', 'o|'],
  ERoneToMany: ['}|', '|{'], ERmany: ['}|', '|{'], ERzeroToMany: ['}o', 'o{'],
};

/**
 * An edge whose both ends are draw.io's crow's-foot kind, as the relation token our entity diagrams draw
 * (`}|--||`): one many-or-more end, one exactly-one end. Null unless both ends are entity-relation ends.
 */
export function drawioErRelation(style: DrawioStyle): string | null {
  const source = own(ER_ENDS, style.startArrow ?? '');
  const target = own(ER_ENDS, style.endArrow ?? '');
  if (!source || !target) return null;
  return `${source[0]}${style.dashed === '1' ? '..' : '--'}${target[1]}`;
}

/** An edge's paint and heads. draw.io ends an edge with an arrow unless `endArrow=none`. */
export function drawioConnectorAppearance(style: DrawioStyle): JsonObject {
  const appearance: Record<string, string | number> = {};
  const end = marker(style.endArrow, 'classic');
  const start = marker(style.startArrow, null);
  if (end) appearance.markerEnd = end;
  if (start) appearance.markerStart = start;
  const stroke = drawioLine(style.strokeColor);
  if (stroke && stroke !== 'transparent') appearance.stroke = stroke;
  const strokeWidth = finite(style.strokeWidth);
  if (strokeWidth !== undefined) appearance.strokeWidth = strokeWidth;
  if (style.dashed === '1') appearance.dashPattern = 'dashed';
  // A line is one paint: its own opacity and the whole cell's multiply.
  const opacity = (finite(style.opacity) ?? 100) * (finite(style.strokeOpacity) ?? 100) / 100;
  if (opacity < 100) appearance.opacity = Math.max(0, opacity) / 100;
  // draw.io's connector is rounded unless `rounded=0`, by half its `arcSize` (default 20).
  appearance.cornerRadius = style.rounded === '0' ? 0 : Math.min(24, Math.max(0, (finite(style.arcSize) ?? 20) / 2));
  // Its label sits on the page's colour (ours: the canvas's, the unset plate) with no border unless one is set;
  // a black border is left to the theme, as lines are.
  const border = style.labelBorderColor;
  if (!border || border === 'none') appearance.labelBorder = 'transparent';
  else if (drawioLine(border)) appearance.labelBorder = drawioLine(border)!;
  const plate = style.labelBackgroundColor;
  if (plate && plate !== 'default') appearance.labelBackground = drawioColor(plate) ?? 'transparent';
  appearance.labelFontSize = finite(style.fontSize) ?? 11;
  const ink = drawioColor(style.fontColor);
  if (ink && ink !== 'transparent') appearance.labelColor = ink;
  return appearance;
}

/** `<script>` and `<style>` bodies are code, not words: cut in one forward scan (a regex here goes quadratic on unclosed tags). */
export function withoutCode(value: string): string {
  const lower = value.toLowerCase();
  const opening = /<(script|style)\b/g;
  let kept = '';
  let at = 0;
  for (let match = opening.exec(lower); match; match = opening.exec(lower)) {
    kept += value.slice(at, match.index);
    const close = lower.indexOf(`</${match[1]}`, match.index);
    if (close === -1) return kept;
    const end = lower.indexOf('>', close);
    at = end === -1 ? value.length : end + 1;
    opening.lastIndex = at;
  }
  return kept + value.slice(at);
}

/**
 * A `<br>` that ends a paragraph, a table cell or the label starts no line of its own in a browser: it is dropped.
 * ponytail: one break before the closing tag; a run of them keeps all but the last, as a browser does.
 */
export function withoutClosingBreaks(value: string): string {
  return value.replace(/<br\b[^<>]*>(\s*(?:<\/(?:p|div|td|th|li|h[1-6]|tr|span|font|b|i|u|strong)>\s*)*(?:<\/(?:p|div|td|th|li|h[1-6]|tr)>|$))/gi, '$1');
}

/** A label as plain text: draw.io's `html=1` labels lose their markup, keeping line breaks. */
export function drawioLabel(value: string | undefined, style: DrawioStyle): string {
  if (!value) return '';
  if (style.html !== '1') return value.trim();
  // A block (`Global<div>Partnerships</div>`) starts and ends a line: its edges mark a break, and the run of
  // marks between two blocks is one break. `<br>` is a break of its own, so `<br><br>` keeps its blank line.
  // Source whitespace collapses as a browser's would; `[^<>]` keeps a run of unclosed `<` linear, not quadratic.
  const text = withoutClosingBreaks(withoutCode(value))
    .replace(/\s+/g, ' ')
    // A table's cells sit side by side on their row's line.
    .replace(/<\/t[dh]>\s*<t[dh]\b[^<>]*>/gi, ' ')
    .replace(/<br\b[^<>]*>/gi, '\n')
    .replace(/<\/?(div|p|li|ul|ol|h[1-6]|tr|table)\b[^<>]*>/gi, '\ue000')
    .replace(/<[^<>]*>/g, '')
    .replace(/ ?\ue000[\ue000 ]*/g, '\n');
  return decodeEntities(text).replace(/\u00a0/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Where draw.io pinned a line to a shape (`exitX/exitY` or `entryX/entryY`, 0 to 1): a side when on the outline, else a point inside. */
export function drawioAnchor(style: DrawioStyle, end: 'exit' | 'entry'): SceneAnchor | null {
  const read = (axis: string): number | null => {
    const raw = style[`${end}${axis}`];
    const value = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
  };
  const x = read('X');
  const y = read('Y');
  if (x === null || y === null) return null;
  if (x === 0) return { kind: 'side', side: 'left', ratio: y };
  if (x === 1) return { kind: 'side', side: 'right', ratio: y };
  if (y === 0) return { kind: 'side', side: 'top', ratio: x };
  if (y === 1) return { kind: 'side', side: 'bottom', ratio: x };
  return { kind: 'normalized', x, y };
}

export interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/**
 * A layout container (`childLayout`) is saved with no size: draw.io runs its layout on open and wraps the children
 * in the layout's padding (ELK's `elk.padding`, else 20 a side and the title band on top). Ours keeps the children
 * where they were saved and wraps them the same way, in the container's own coordinates; null with no children.
 * ponytail: no layout runs, so children saved mid-edit keep their places — run ELK here if that shows.
 */
export function drawioLayoutBox(children: readonly Box[], style: DrawioStyle): Box | null {
  if (!children.length) return null;
  let layout = style.childLayout ?? '';
  try { layout = decodeURIComponent(layout); } catch { /* left as written */ }
  const padding = /elk\.padding[^\]]*\]/.exec(layout)?.[0] ?? '';
  const band = Number(style.startSize ?? 23);
  const side = (name: string, fallback: number) => {
    const value = Number(new RegExp(`${name}=(-?[\\d.]+)`).exec(padding)?.[1]);
    return Number.isFinite(value) ? value : fallback;
  };
  // A loop, not Math.min(...): a container with tens of thousands of children would overflow the stack.
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { x, y, width, height } of children) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + width); bottom = Math.max(bottom, y + height);
  }
  left -= side('left', 20);
  top -= side('top', (Number.isFinite(band) ? band : 23) + 20);
  return { x: left, y: top, width: right + side('right', 20) - left, height: bottom + side('bottom', 20) - top };
}

/**
 * A box standing in for a shape we don't draw is a dashed outline, so it reads as a stand-in. An icon's fill is
 * its ink (an AWS icon's green, a floor plan's black walls), so the outline takes that colour and the box stays
 * open: a filled slab would hide what is under it. draw.io's default black is left to the theme, as lines are.
 */
export function drawioStandIn(style: DrawioStyle): JsonObject {
  const { stroke: _stroke, ...appearance } = drawioNodeAppearance(style);
  const ink = drawioLine(style.fillColor) ?? drawioLine(style.strokeColor);
  return { ...appearance, fill: 'transparent', ...(ink && ink !== 'transparent' ? { stroke: ink } : {}), strokeStyle: 'dashed' };
}
