import type { JsonObject } from '../../opencanvas/domain/document/json';
import type { SceneAnchor } from '../../opencanvas/domain/document/types';
import type { ShapeKind } from '../../opencanvas/domain/nodes/shapeNode';
import { decodeEntities } from './xmlReader';

// draw.io's cell `style` ("rounded=1;fillColor=#dae8fc;ellipse") read into the
// shapes and paint keys OpenFlowKit draws. What has no counterpart is named, so
// the importer can say so.

export type DrawioStyle = Readonly<Record<string, string>>;

/** `table[key]` only when the table itself has it: "constructor" in a file is a word, not Object's own. */
export function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** `ellipse;fillColor=#fff` → `{ ellipse: '', fillColor: '#fff' }`. A bare first word is the cell's base shape. */
export function parseDrawioStyle(style: string | undefined): DrawioStyle {
  // No prototype: a `__proto__=x` key in a hand-edited style stays a key.
  const parsed: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const part of (style ?? '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const equals = trimmed.indexOf('=');
    if (equals === -1) parsed[trimmed] = '';
    else parsed[trimmed.slice(0, equals)] = trimmed.slice(equals + 1);
  }
  return parsed;
}

/** The shape a cell names: `shape=` wins over a bare word (`ellipse`, `rhombus`, `text`, `swimlane`). */
export function drawioShapeName(style: DrawioStyle): string {
  if (style.shape) return style.shape;
  return Object.keys(style).find((key) => style[key] === '') ?? '';
}

const SHAPES: Readonly<Record<string, ShapeKind>> = {
  '': 'rectangle', rect: 'rectangle', rectangle: 'rectangle', label: 'rectangle', process: 'rectangle',
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

const finite = (value: string | undefined): number | undefined => {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Paint and type a vertex carries, in our appearance keys; unset keys are left out so the app's defaults apply. */
export function drawioNodeAppearance(style: DrawioStyle): JsonObject {
  const appearance: Record<string, string | number> = {};
  // Paint the cell doesn't set is left to the theme, which pairs fill and ink in light and dark alike.
  const bare = BARE.has(drawioShapeName(style));
  const fill = bare ? 'transparent' : drawioColor(style.fillColor);
  const stroke = bare ? 'transparent' : drawioColor(style.strokeColor);
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
  if (fontStyle & 1) appearance.fontWeight = 700;
  if (fontStyle & 2) appearance.fontStyle = 'italic';
  if (fontStyle & 4) appearance.textDecoration = 'underline';
  if (style.dashed === '1') appearance.strokeStyle = 'dashed';
  const opacity = finite(style.opacity);
  if (opacity !== undefined && opacity < 100) appearance.opacity = Math.max(0, opacity) / 100;
  return appearance;
}

/** Arrow head names draw.io writes, as the marker words our connectors draw; `none` is no marker. */
function marker(value: string | undefined, fallback: string | null): string | null {
  const name = value ?? fallback;
  if (name === null || name === 'none' || name === '') return null;
  if (name === 'oval') return 'circle';
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
  const stroke = drawioColor(style.strokeColor);
  if (stroke && stroke !== 'transparent') appearance.stroke = stroke;
  const strokeWidth = finite(style.strokeWidth);
  if (strokeWidth !== undefined) appearance.strokeWidth = strokeWidth;
  if (style.dashed === '1') appearance.dashPattern = 'dashed';
  const opacity = finite(style.opacity);
  if (opacity !== undefined && opacity < 100) appearance.opacity = Math.max(0, opacity) / 100;
  return appearance;
}

/** A label as plain text: draw.io's `html=1` labels lose their markup, keeping line breaks. */
export function drawioLabel(value: string | undefined, style: DrawioStyle): string {
  if (!value) return '';
  if (style.html !== '1') return value.trim();
  // A block (`Global<div>Partnerships</div>`) starts and ends a line: its edges mark a break, and the run of
  // marks between two blocks is one break. `<br>` is a break of its own, so `<br><br>` keeps its blank line.
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(div|p|li|h[1-6])\b[^>]*>/gi, '\ue000')
    .replace(/<[^>]*>/g, '')
    .replace(/\ue000+/g, '\n');
  return decodeEntities(text).replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
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
