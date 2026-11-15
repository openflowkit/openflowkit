import { drawioSketchSeed } from './drawioSketch';
import type { Point2d } from '../../opencanvas/domain/geometry/types';
import { resolveDrawioStyle, type DrawioStyle } from './drawioStyle';
import { parseXml, type XmlElement } from './xmlReader';

// A draw.io page's XML read into plain cells: ids, parents, style, geometry. Compressed pages are inflated here.

export interface Geometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly points: readonly Point2d[];
  readonly sourcePoint: Point2d | null;
  readonly targetPoint: Point2d | null;
  /** A vertex placed by fractions of its parent's size (x 1, y 0.5 = right edge, halfway down), then `offset`. */
  readonly relative: boolean;
  readonly offset: Point2d;
  /** A folded container's open size (`alternateBounds`), when it is a real size. */
  readonly unfolded: { readonly width: number; readonly height: number } | null;
}

export interface Cell {
  readonly id: string;
  readonly parent: string | null;
  readonly value: string;
  readonly style: DrawioStyle;
  readonly vertex: boolean;
  readonly edge: boolean;
  readonly source: string | null;
  readonly target: string | null;
  readonly visible: boolean;
  /** Folded in draw.io: the geometry is the folded size and the children are hidden. */
  readonly collapsed: boolean;
  /** A `<UserObject>`/`<object>` wrapper's own data (`status="New"`), which `%status%` in a label stands for. */
  readonly data: Readonly<Record<string, string>>;
  readonly placeholders: boolean;
  readonly geometry: Geometry | null;
}

export const num = (value: string | undefined, fallback = 0): number => {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) ? parsed : fallback;
};

const pointOf = (element: XmlElement): Point2d => ({ x: num(element.attributes.x), y: num(element.attributes.y) });

function readGeometry(element: XmlElement | undefined): Geometry | null {
  if (!element) return null;
  const { attributes } = element;
  const named = (as: string) => element.children.find((child) => child.name === 'mxPoint' && child.attributes.as === as);
  const source = named('sourcePoint');
  const target = named('targetPoint');
  const points = element.children.find((child) => child.name === 'Array' && child.attributes.as === 'points');
  const offset = named('offset');
  const open = element.children.find((child) => child.name === 'mxRectangle' && child.attributes.as === 'alternateBounds');
  const openWidth = num(open?.attributes.width);
  const openHeight = num(open?.attributes.height);
  return {
    x: num(attributes.x), y: num(attributes.y), width: num(attributes.width), height: num(attributes.height),
    points: points ? points.children.filter((child) => child.name === 'mxPoint').map(pointOf) : [],
    sourcePoint: source ? pointOf(source) : null,
    targetPoint: target ? pointOf(target) : null,
    relative: attributes.relative === '1',
    offset: offset ? pointOf(offset) : { x: 0, y: 0 },
    unfolded: openWidth > 0 && openHeight > 0 ? { width: openWidth, height: openHeight } : null,
  };
}

/** `<mxCell>`, or a `<UserObject>` / `<object>` wrapping one: the wrapper holds the id and the label. */
export function readCell(element: XmlElement, resolve: typeof resolveDrawioStyle = resolveDrawioStyle): Cell | null {
  const wrapped = element.name === 'UserObject' || element.name === 'object';
  const cell = wrapped ? element.children.find((child) => child.name === 'mxCell') : element.name === 'mxCell' ? element : undefined;
  const id = wrapped ? element.attributes.id : cell?.attributes.id;
  if (!cell || !id) return null;
  const { attributes } = cell;
  const style = resolve(attributes.style, attributes.edge === '1' ? 'edge' : 'vertex');
  return {
    id,
    parent: attributes.parent ?? null,
    // `noLabel=1`: draw.io draws no words for the cell, though it keeps them.
    value: style.noLabel === '1' ? '' : (wrapped ? element.attributes.label : attributes.value) ?? '',
    // A sketched cell wobbles by its id, as in draw.io; the seed rides in its style, which is kept with its drawing.
    style: style.sketch === '1' ? { ...style, sketchSeed: String(drawioSketchSeed(id)) } : style,
    vertex: attributes.vertex === '1',
    edge: attributes.edge === '1',
    source: attributes.source ?? null,
    target: attributes.target ?? null,
    visible: attributes.visible !== '0',
    collapsed: attributes.collapsed === '1',
    data: wrapped ? element.attributes : {},
    placeholders: wrapped && element.attributes.placeholders === '1',
    geometry: readGeometry(cell.children.find((child) => child.name === 'mxGeometry')),
  };
}

/** draw.io's compression, for pages and stencils: base64 of raw-deflated, URI-encoded XML. */
export async function inflate(text: string): Promise<string> {
  const bytes = Uint8Array.from(atob(text.replace(/\s+/g, '')), (char) => char.charCodeAt(0));
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('deflate-raw'));
  return decodeURIComponent(await new Response(stream).text());
}

export async function pageModel(diagram: XmlElement): Promise<XmlElement | { error: string }> {
  const model = diagram.children.find((child) => child.name === 'mxGraphModel');
  if (model) return model;
  if (!diagram.text.trim()) return { error: 'a page is empty' };
  let xml: string;
  try {
    xml = await inflate(diagram.text);
  } catch {
    return { error: 'a page is compressed in a way OpenFlowKit can’t read' };
  }
  const parsed = parseXml(xml);
  if ('error' in parsed) return { error: `a page isn’t readable XML (${parsed.error})` };
  return parsed.root;
}

export function pageCells(model: XmlElement): Cell[] {
  const root = model.children.find((child) => child.name === 'root');
  // A big file repeats a handful of styles: each distinct one is resolved once and shared (styles are never changed).
  const styles = new Map<string, DrawioStyle>();
  const resolve: typeof resolveDrawioStyle = (style, kind) => {
    const key = `${kind}:${style ?? ''}`;
    let resolved = styles.get(key);
    if (!resolved) styles.set(key, resolved = resolveDrawioStyle(style, kind));
    return resolved;
  };
  return (root?.children ?? []).map((element) => readCell(element, resolve)).filter((cell): cell is Cell => cell !== null);
}
