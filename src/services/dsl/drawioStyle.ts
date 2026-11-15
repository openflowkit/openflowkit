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
  if (name === undefined) BARE_NAMES.set(style, name = Object.keys(style).find((key) => style[key] === '' && namesKind(key)) ?? '');
  return name;
}
const BARE_NAMES = new WeakMap<DrawioStyle, string>();

/** Keys a named style sets only to colour a cell (draw.io's `plain-blue`, `fancy`): naming one picks no kind of shape. */
const LOOKS = new Set(['shadow', 'glass', 'gradientColor', 'fillColor', 'strokeColor']);

/**
 * Whether a bare word picks what a cell is (`text`, `group`, `ellipse`): one of draw.io's own named styles that is
 * more than a colour. draw.io ignores a word its sheet doesn't have, and a colour preset leaves the default box.
 */
const namesKind = (word: string): boolean => {
  const named = own(DRAWIO_STYLESHEET, word);
  return named !== undefined && Object.keys(named).some((key) => !LOOKS.has(key));
};

/**
 * The draw.io shapes OpenFlowKit draws identically itself. Every other shape is drawn by draw.io's own code or
 * stencil (drawioShapes.ts), so it looks as in draw.io instead of as the nearest shape we have.
 */
const SHAPES: Readonly<Record<string, ShapeKind>> = {
  '': 'rectangle', rect: 'rectangle', rectangle: 'rectangle', label: 'rectangle', ellipse: 'ellipse', rhombus: 'diamond',
  mxgraph_bootstrap_anchor: 'rectangle',
};

/** Shapes draw.io draws with no outline and no fill: only their label shows. */
const BARE = new Set(['mxgraph.bootstrap.anchor']);

/** The library shape a draw.io vertex becomes, and its own name when it had to become a box. */
/** The name draw.io's code registers a shape under: a box written without a shape, or as `rect`, is its `rectangle`. */
export const drawioCodeName = (name: string): string => (name === '' || name === 'rect' ? 'rectangle' : name);

export function drawioShape(style: DrawioStyle, width: number, height: number): { readonly kind: ShapeKind; readonly unknown?: string } {
  const name = drawioShapeName(style);
  if (name === 'text') return { kind: 'text' };
  const kind = own(SHAPES, name.replace(/\./g, '_'));
  if (!kind) return { kind: 'rectangle', unknown: name };
  // A sketched shape (`sketch=1`) is drawn by hand, by draw.io's own sketch code (drawioSketch), whatever its kind.
  if (style.sketch === '1') return { kind: kind === 'ellipse' && Math.abs(width - height) < 1 ? 'circle' : kind, unknown: drawioCodeName(name) };
  if (kind === 'rectangle' && style.rounded === '1') return { kind: 'rounded' };
  // An ellipse is drawn by draw.io's own ellipse code, on true curves (ours is a 24-sided outline, cornered when large),
  // with any dot in it (a UML final state: `centerRadius`).
  if (kind === 'ellipse') return { kind: Math.abs(width - height) < 1 ? 'circle' : kind, unknown: name };
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

/**
 * A colour as draw.io paints it: `default` (what draw.io's stylesheet gives every cell) is draw.io's own default for
 * that paint, `none` is transparent. On a dark canvas it flips with every other draw.io colour (`darkColors: 'invert'`),
 * as draw.io's dark mode flips its defaults. Unset, or a word we can't read (`inherit`), is left to the theme.
 */
export function drawioPaint(value: string | undefined, fallback: string): string | undefined {
  return value === 'default' ? fallback : drawioColor(value);
}

/** draw.io's dash: its `dashPattern` (default 3 on, 3 off) in line widths, as page px (mxSvgCanvas2D.createDashPattern). */
export function drawioDash(style: DrawioStyle): string {
  const width = Math.max(1, finite(style.strokeWidth) ?? 1);
  const steps = (style.dashPattern ?? '3 3').split(/[ ,]+/).map(Number).filter((step) => Number.isFinite(step) && step > 0);
  return (steps.length > 0 ? steps : [3, 3]).map((step) => step * width).join(' ');
}

/** A line colour: draw.io's default is black. */
export const drawioLine = (value: string | undefined): string | undefined => drawioPaint(value, '#000000');

const finite = (value: string | undefined): number | undefined => {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Paint and type a vertex carries, in our appearance keys; unset keys are left out so the app's defaults apply. */
export function drawioNodeAppearance(style: DrawioStyle): JsonObject {
  // draw.io's dark mode draws every colour a cell sets with its lightness flipped (`invertForDark`).
  const appearance: Record<string, string | number | boolean> = { darkColors: 'invert' };
  const bare = BARE.has(drawioShapeName(style));
  const fill = bare ? 'transparent' : drawioFaded(drawioPaint(style.fillColor, '#ffffff'), style.fillOpacity);
  const stroke = bare ? 'transparent' : drawioFaded(drawioLine(style.strokeColor), style.strokeOpacity);
  // textOpacity fades the words alone, as fillOpacity fades the fill.
  const text = drawioFaded(drawioPaint(style.fontColor, '#000000'), style.textOpacity);
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
  // draw.io draws a line 1 wide unless the cell says otherwise.
  appearance.strokeWidth = finite(style.strokeWidth) ?? 1;
  const fontSize = finite(style.fontSize);
  if (fontSize !== undefined && fontSize > 0) appearance.fontSize = fontSize;
  // fontStyle is a bit mask: 1 bold, 2 italic, 4 underline.
  const fontStyle = finite(style.fontStyle) ?? 0;
  // draw.io sets words in a regular weight unless bold.
  appearance.fontWeight = fontStyle & 1 ? 700 : 400;
  if (fontStyle & 2) appearance.fontStyle = 'italic';
  if (fontStyle & 4) appearance.textDecoration = 'underline';
  if (style.dashed === '1') {
    appearance.strokeStyle = 'dashed';
    appearance.strokeDasharray = drawioDash(style);
  }
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
const DRAWN_HEADS = new Set(['', 'none', 'classic', 'classicThin', 'block', 'blockThin', 'open', 'openThin', 'openAsync', 'async', 'oval', 'circle', 'circlePlus', 'cross', 'ERmandOne', 'ERone', 'ERmany', 'ERoneToMany', 'ERzeroToMany', 'ERzeroToOne']);
/** Colour words draw.io writes that mean "the default" or "none", which we keep as the theme or as no paint. */
const COLOUR_WORDS = new Set(['', 'default', 'none', 'swimlane', 'inherit']);
/** Fonts close enough to ours that swapping them is no loss. */
const OUR_FONTS = new Set(['helvetica', 'arial', 'verdana', 'inter', 'sans-serif']);

/**
 * What a cell's style asks for that we don't draw, one plain line each; the importer counts them across the page.
 * Arrow heads are named by draw.io's word when its code isn't to hand, since `marker` draws any head it doesn't know as a triangle.
 */
export function drawioStyleLosses(style: DrawioStyle, of: 'shape' | 'connector', endsDrawn = false): string[] {
  const losses: string[] = [];
  if (style.gradientColor && style.gradientColor !== 'none' && !drawioColor(style.gradientColor)) losses.push('gradient fills are drawn solid');
  // A sketched shape is drawn by draw.io's sketch code; draw.io's older `comic` jiggle is not.
  if (style.sketch === '1' ? style.sketchStyle === 'comic' : style.comic === '1') losses.push('the hand-drawn comic look is drawn clean');
  if (style.sketch !== '1' && style.fillStyle && style.fillStyle !== 'solid' && style.fillStyle !== 'auto') losses.push('hatched and patterned fills are drawn solid');
  if (style.glass === '1') losses.push('the glass shine is left off');
  const unread = (value: string | undefined) => value !== undefined && !COLOUR_WORDS.has(value) && drawioColor(value) === undefined;
  if (unread(style.fillColor) || unread(style.strokeColor) || unread(style.fontColor)) losses.push('colours not written as #hex use the theme’s instead');
  const font = style.fontFamily?.trim();
  if (font && !OUR_FONTS.has(font.toLowerCase())) losses.push(`the “${font}” font is drawn in ours`);
  if (style.textShadow === '1') losses.push('shadows under words are left off');
  if (style.clipPath && style.clipPath !== 'none') losses.push('cropped pictures are shown whole');
  if (style.textDirection && style.textDirection !== 'ltr' && style.textDirection !== 'auto') losses.push('right-to-left and vertical words are set left to right');
  // With draw.io's code to hand, its connector draws every end itself (drawioCode.shapedLine).
  if (of === 'connector' && !endsDrawn) {
    // Entity-relation ends on a line with a pair are drawn as its relation; on their own, as their glyphs.
    const relation = drawioErRelation(style) !== null;
    for (const head of [style.endArrow, style.startArrow]) {
      if (head !== undefined && !relation && !DRAWN_HEADS.has(head) && !head.startsWith('diamond')) {
        losses.push(`draw.io’s “${head}” arrow head is drawn as a filled triangle`);
      }
    }
  }
  return losses;
}

/** draw.io's entity-relation ends on their own, as glyphs from the line's end inward. */
const ER_GLYPHS: Readonly<Record<string, string>> = {
  ERmandOne: 'bar bar', ERone: 'bar', ERzeroToOne: 'bar circle',
  ERmany: 'crow-foot', ERoneToMany: 'crow-foot bar', ERzeroToMany: 'crow-foot circle',
};

/**
 * An arrow head draw.io writes, as the glyph our connectors draw; `none` is no marker. `filled` is draw.io's
 * `startFill`/`endFill`: `0` draws a triangle or diamond hollow. Heads we have no glyph for are drawn filled triangles.
 */
function marker(value: string | undefined, fallback: string | null, filled: string | undefined): string | null {
  const name = value ?? fallback;
  if (name === null || name === 'none' || name === '') return null;
  const hollow = filled === '0';
  // An oval or circle end is a filled dot unless its fill is off; draw.io's circlePlus is always open.
  if (name === 'oval' || name === 'circle') return hollow ? 'circle' : 'circle-filled';
  if (name === 'circlePlus') return 'circle';
  if (name.startsWith('diamond')) return hollow ? 'diamond-open' : 'diamond-filled';
  if (name === 'cross') return 'cross';
  if (name === 'open' || name === 'openThin' || name === 'openAsync' || name === 'async') return 'arrow';
  const er = own(ER_GLYPHS, name);
  if (er) return er;
  return hollow ? 'triangle-open' : 'triangle-filled';
}

/**
 * draw.io's entity-relation ends, as the cardinality symbols Mermaid writes on each side of `--`. Its single bar
 * (`ERone`) and bare crow's foot (`ERmany`) have no symbol, so a line with one keeps its own heads instead.
 */
const ER_ENDS: Readonly<Record<string, readonly [source: string, target: string]>> = {
  ERmandOne: ['||', '||'], ERzeroToOne: ['|o', 'o|'], ERoneToMany: ['}|', '|{'], ERzeroToMany: ['}o', 'o{'],
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
  // Its colours flip in the dark theme as draw.io's dark mode flips them, as a shape's do.
  const appearance: Record<string, string | number> = { darkColors: 'invert' };
  const end = marker(style.endArrow, 'classic', style.endFill);
  const start = marker(style.startArrow, null, style.startFill);
  if (end) appearance.markerEnd = end;
  if (start) appearance.markerStart = start;
  const stroke = drawioLine(style.strokeColor);
  if (stroke && stroke !== 'transparent') appearance.stroke = stroke;
  // draw.io draws a line 1 wide unless the cell says otherwise.
  appearance.strokeWidth = finite(style.strokeWidth) ?? 1;
  if (style.dashed === '1') {
    appearance.dashPattern = 'dashed';
    appearance.strokeDasharray = drawioDash(style);
  }
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
  // draw.io's plate is the words' own box: no inset, square corners (its `labelPadding` is never drawn).
  appearance.labelPadding = 0;
  appearance.labelCornerRadius = 0;
  const ink = drawioPaint(style.fontColor, '#000000');
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
/** An `html=1` label as draw.io renders it: each line break in its text is a `<br>`, unless `nl2Br=0` (mxText.replaceLinefeeds). */
export function drawioHtmlValue(value: string, style: DrawioStyle): string {
  return style.html === '1' && style.nl2Br !== '0' ? value.replace(/\r?\n/g, '<br>') : value;
}

export function drawioLabel(value: string | undefined, style: DrawioStyle): string {
  if (!value) return '';
  if (style.html !== '1') return value.trim();
  value = drawioHtmlValue(value, style);
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
  // An icon's fill is its colour; a picture's isn't painted at all (draw.io's image shape), so its line colour is.
  const picture = drawioShapeName(style) === 'image';
  const line = drawioLine(style.strokeColor);
  const ink = picture ? (line && line !== 'transparent' ? line : '#000000') : drawioLine(style.fillColor) ?? line;
  return { ...appearance, fill: 'transparent', ...(ink && ink !== 'transparent' ? { stroke: ink } : {}), strokeStyle: 'dashed' };
}

/** A label cell's own plate: none unless its style sets one; `default` (as `edgeLabel` sets) is the line's own plate. */
export function drawioLabelPlate(style: DrawioStyle): string | undefined {
  const plate = style.labelBackgroundColor;
  return plate === 'default' ? undefined : (plate && drawioColor(plate)) || 'transparent';
}

/** A box's corner radius as draw.io rounds it (mxShape.getArcSize; a lane by its title band, getSwimlaneArcSize); 0 unless `rounded=1`. */
export function drawioCornerRadius(style: DrawioStyle, width: number, height: number, start?: number): number {
  if (style.rounded !== '1') return 0;
  const arc = Number.parseFloat(style.arcSize ?? '');
  if (style.absoluteArcSize === '1') return Math.min(width / 2, height / 2, (Number.isFinite(arc) ? arc : 20) / 2);
  const factor = (Number.isFinite(arc) ? arc : 15) / 100;
  return start === undefined ? Math.min(width, height) * factor : Math.min(start, start * factor * 3);
}
