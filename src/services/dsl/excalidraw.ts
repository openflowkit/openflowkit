import { createDefaultSceneLayer, DEFAULT_SCENE_LAYER_ID, UNTITLED_DOCUMENT_NAME } from '../../opencanvas/domain/document/defaults';
import type { JsonObject } from '../../opencanvas/domain/document/json';
import {
  SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION,
  type ConnectorEndpoint, type ConnectorLabel, type SceneConnector, type SceneDocumentV1, type SceneNode, type ScenePage,
} from '../../opencanvas/domain/document/types';
import { validateSceneDocumentV1 } from '../../opencanvas/domain/document/validation';
import type { Bounds2d, Point2d } from '../../opencanvas/domain/geometry/types';
import { createImageNode } from '../../opencanvas/domain/nodes/imageNode';
import { resolveNodeStyle } from '../../opencanvas/domain/nodes/nodeStyle';
import { createShapeNode, type ShapeKind } from '../../opencanvas/domain/nodes/shapeNode';
import { cellRange } from '../../opencanvas/domain/scene/spatialIndex';
import { measurePortableText } from '../../opencanvas/domain/text/measurement';
import {
  excalidrawColor, excalidrawConnectorAppearance, excalidrawFont, excalidrawHead, excalidrawNodeAppearance, excalidrawOpacity,
  excalidrawStrokeContent, excalidrawWordInk, finite, text, type ExcalidrawElement,
} from './excalidrawStyle';

// An Excalidraw drawing (`.excalidraw`, or the `excalidraw/clipboard` JSON its copy puts on the clipboard)
// as OpenFlowKit nodes and connectors. A drawing is placed by hand, so it is mapped one element to one node,
// never through DSL and the layout. What changes what the drawing shows (a fill, a head, a picture's crop, a
// group, an element left out) is named in `losses`. The hand-drawn look comes across clean and unnamed: the
// wobble (roughness), outline or filled heads, an elbow arrow's own route, and locks.

export type ExcalidrawImport =
  | { readonly document: SceneDocumentV1; readonly losses: readonly string[] }
  | { readonly error: string };

interface ExcalidrawScene {
  readonly elements: readonly ExcalidrawElement[];
  /** Pictures by `fileId`: `{ dataURL }`. */
  readonly files: Readonly<Record<string, unknown>>;
}

/** The drawing in `text`, or null when it isn't Excalidraw's file or clipboard JSON. */
export function readExcalidraw(text: string): ExcalidrawScene | null {
  if (!/^\s*\{/.test(text) || !/"type"\s*:\s*"excalidraw(\/clipboard)?"/.test(text)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const scene = parsed as { type?: unknown; elements?: unknown; files?: unknown };
  if (scene.type !== 'excalidraw' && scene.type !== 'excalidraw/clipboard') return null;
  if (!Array.isArray(scene.elements)) return null;
  const files = scene.files && typeof scene.files === 'object' && !Array.isArray(scene.files) ? scene.files as Record<string, unknown> : {};
  return { elements: scene.elements.filter((element): element is ExcalidrawElement => !!element && typeof element === 'object'), files };
}

/** "3 things didn’t come across: a; b; c." — the first few, so a toast stays readable. Import and paste both say it. */
export function lossNote(losses: readonly string[]): string {
  const shown = losses.slice(0, 3).join('; ');
  const more = losses.length > 3 ? `; and ${losses.length - 3} more` : '';
  return `${losses.length} ${losses.length === 1 ? 'thing' : 'things'} didn’t come across: ${shown}${more}.`;
}

/** True when `text` is an Excalidraw file or its clipboard JSON. */
export const looksLikeExcalidraw = (text: string): boolean => readExcalidraw(text) !== null;

const SHAPES: Readonly<Record<string, ShapeKind>> = { rectangle: 'rectangle', ellipse: 'ellipse', diamond: 'diamond' };
/** What draws no label: text bound to one of these (only a hand-made file does that) stays text of its own. */
const NO_LABEL = new Set(['text', 'freedraw', 'frame', 'magicframe', 'image']);

/** Excalidraw turns an element about its centre; ours turn about the top-left corner, so the corner moves. */
function turnedCorner(x: number, y: number, width: number, height: number, radians: number): Point2d {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const half = { x: width / 2, y: height / 2 };
  return { x: x + half.x - (half.x * cos - half.y * sin), y: y + half.y - (half.x * sin + half.y * cos) };
}

const pointsOf = (element: ExcalidrawElement): Point2d[] =>
  Array.isArray(element.points)
    ? element.points.flatMap((point) => (Array.isArray(point) && point.length >= 2 ? [{ x: finite(point[0]), y: finite(point[1]) }] : []))
    : [];

/** The box around `points`, in a loop: spreading a long stroke into Math.min overflows the stack past ~100 000 points. */
function extent(points: readonly Point2d[]): { readonly min: Point2d; readonly max: Point2d } {
  if (points.length === 0) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  const min = { ...points[0]! };
  const max = { ...points[0]! };
  for (const { x, y } of points) {
    min.x = Math.min(min.x, x); min.y = Math.min(min.y, y);
    max.x = Math.max(max.x, x); max.y = Math.max(max.y, y);
  }
  return { min, max };
}

const lowest = (points: readonly Point2d[]): Point2d => extent(points).min;

/** A name from the file, fit for a toast: no control or direction characters, at most 24 characters. */
function shortName(value: string): string {
  const chars = [...value.replace(/[\p{Cc}\p{Cf}]/gu, '')];
  return chars.length > 24 ? `${chars.slice(0, 23).join('')}…` : chars.join('');
}

/** Excalidraw fills a line or stroke that closes on itself (its ends within 8 px), or a line it calls a polygon. */
function filledLoop(element: ExcalidrawElement, points: readonly Point2d[]): boolean {
  const fill = excalidrawColor(element.backgroundColor);
  if (!fill || fill === 'transparent') return false;
  const first = points[0];
  const last = points[points.length - 1];
  return element.polygon === true || (points.length >= 3 && Math.hypot(first!.x - last!.x, first!.y - last!.y) <= 8);
}

/** A line's or arrow's points, turned by its angle about their centre, as Excalidraw draws them. */
function turnedPoints(element: ExcalidrawElement): Point2d[] {
  const points = pointsOf(element);
  const radians = finite(element.angle);
  if (!radians || points.length === 0) return points;
  const { min, max } = extent(points);
  const centre = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map(({ x, y }) => ({
    x: centre.x + (x - centre.x) * cos - (y - centre.y) * sin,
    y: centre.y + (x - centre.x) * sin + (y - centre.y) * cos,
  }));
}

/** Our dark canvas; the style only asks whether the canvas is dark. */
const DARK_CANVAS = '#191b19';

/** A painted fill that keeps its colour on a dark canvas. White and paper fills don't: the dark theme washes them to the canvas. */
const solidOnDark = (node: SceneNode): boolean => typeof node.appearance.fill === 'string' && node.appearance.fill !== 'transparent'
  && resolveNodeStyle(node, DARK_CANVAS).fill.startsWith('#');

const FILL_CELL = 256;
/** A shape covering more cells than this (a page-sized backdrop) goes on a short list instead of into every cell. */
const MAX_FILL_CELLS = 256;

/** A filled shape's box in Excalidraw's space, and its place in the drawing order: a later one lies on top. */
interface Fill { readonly box: Bounds2d; readonly node: SceneNode; readonly order: number }

/** Filled shapes placed so far, filed by the cells they cover in Excalidraw's own space: what lies under a word is a lookup, not a scan. */
class FillIndex {
  private readonly cells = new Map<string, Fill[]>();
  private readonly wide: Fill[] = [];
  private count = 0;

  add(box: Bounds2d, node: SceneNode): void {
    const fill = { box, node, order: this.count++ };
    const [minX, minY, maxX, maxY] = cellRange(fill.box, FILL_CELL);
    if (!((maxX - minX + 1) * (maxY - minY + 1) <= MAX_FILL_CELLS)) { this.wide.push(fill); return; }
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const cell = this.cells.get(`${x}:${y}`);
        if (cell) cell.push(fill);
        else this.cells.set(`${x}:${y}`, [fill]);
      }
    }
  }

  /** The topmost filled shape under `point`: the words sit on it, whatever lies below (a white card on a pastel zone). */
  top(point: Point2d): SceneNode | undefined {
    let top: Fill | undefined;
    const cell = this.cells.get(`${Math.floor(point.x / FILL_CELL)}:${Math.floor(point.y / FILL_CELL)}`) ?? [];
    for (const list of [cell, this.wide]) {
      for (const fill of list) {
        const { box } = fill;
        const under = point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
        if (under && (!top || fill.order > top.order)) top = fill;
      }
    }
    return top?.node;
  }
}

/** The words as typed, or as Excalidraw broke them into lines (`text`) where it wraps them and we would not. */
const wordsOf = (element: ExcalidrawElement, asWrapped: boolean): string =>
  asWrapped ? text(element.text) || text(element.originalText) : text(element.originalText) || text(element.text);

const bindingOf = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const id = (value as { elementId?: unknown }).elementId;
  return typeof id === 'string' ? id : null;
};

class SceneBuilder {
  readonly nodes: SceneNode[] = [];
  readonly connectors: SceneConnector[] = [];
  private readonly losses = new Map<string, number>();
  private readonly byId = new Map<string, ExcalidrawElement>();
  /** Text bound to a shape or an arrow, by the container's id: its label, not a node of its own. */
  private readonly labels = new Map<string, ExcalidrawElement>();
  /** Every text bound to a shape or an arrow, the label and any second one left out: none is a node. */
  private readonly boundTexts = new Set<string>();
  private readonly nodeIds = new Set<string>();
  private readonly frames = new Set<string>();
  private readonly fills = new FillIndex();
  /** What createShapeNode and createImageNode read: no nodes, as their zIndex (a scan of every node) is replaced by ours. */
  private readonly page: ScenePage;

  constructor(private readonly scene: ExcalidrawScene, private readonly layerId: string) {
    this.page = { layers: [{ id: layerId }], nodes: [] } as unknown as ScenePage;
    const groups = new Set<string>();
    for (const element of scene.elements) {
      if (element.isDeleted === true) continue;
      if (typeof element.id !== 'string' || !element.id.trim()) { this.lose('elements without an id were left out'); continue; }
      if (this.byId.has(element.id)) { this.lose('elements sharing an earlier element’s id were left out'); continue; }
      this.byId.set(element.id, element);
      if (element.type === 'frame' || element.type === 'magicframe') this.frames.add(element.id);
      if (Array.isArray(element.groupIds)) for (const group of element.groupIds) if (typeof group === 'string') groups.add(group);
      if (text(element.link) && element.type !== 'embeddable' && element.type !== 'iframe') this.lose('links on shapes were left out');
    }
    // Once every element is known: a container may come after its text.
    for (const [id, element] of this.byId) {
      const container = element.type === 'text' && typeof element.containerId === 'string' ? this.byId.get(element.containerId) : undefined;
      if (!container || NO_LABEL.has(text(container.type))) continue;
      this.boundTexts.add(id);
      if (this.labels.has(element.containerId as string)) this.lose('a second text bound to the same shape was left out');
      else this.labels.set(element.containerId as string, element);
    }
    for (let index = 0; index < groups.size; index += 1) this.lose('groups come in as separate shapes');
  }

  /** Each kind of loss once, counted: "3 freehand strokes…" reads better than three lines. */
  private lose(message: string): void {
    this.losses.set(message, (this.losses.get(message) ?? 0) + 1);
  }

  lossList(): string[] {
    return [...this.losses].map(([message, count]) => (count > 1 ? `${message} (${count} times)` : message));
  }

  build(): void {
    let z = 0;
    for (const element of this.byId.values()) {
      const type = text(element.type);
      if (type === 'arrow' || type === 'line') continue;
      if (this.boundTexts.has(element.id as string)) continue;
      this.addNode(element, type, z);
      z += 1;
    }
    for (const element of this.byId.values()) {
      if (element.type === 'arrow' || element.type === 'line') this.addLinear(element, z++);
    }
  }

  /** A frame's member sits in the frame's own space; everything else on the page. Frames don't nest, so a frame is never a member. */
  private place(element: ExcalidrawElement): { parentId: string | null; origin: Point2d } {
    const member = typeof element.frameId === 'string' && !this.frames.has(element.id as string) && this.frames.has(element.frameId);
    const frameId = member ? element.frameId as string : null;
    const frame = frameId ? this.byId.get(frameId) : undefined;
    return { parentId: frameId, origin: frame ? { x: finite(frame.x), y: finite(frame.y) } : { x: 0, y: 0 } };
  }

  private addNode(element: ExcalidrawElement, type: string, zIndex: number): void {
    const id = element.id as string;
    const { parentId, origin } = this.place(element);
    // A freehand stroke drawn up or left of its start has negative points: place it by its lowest one.
    const low = type === 'freedraw' ? lowest(pointsOf(element)) : { x: 0, y: 0 };
    const x = finite(element.x) + low.x - origin.x;
    const y = finite(element.y) + low.y - origin.y;
    const width = Math.max(1, finite(element.width, 1));
    const height = Math.max(1, finite(element.height, 1));
    const rotation = finite(element.angle);
    const base = { parentId, layerId: this.layerId, zIndex };
    const bound = this.labels.get(id);
    // A rectangle wraps its own label to its width; a diamond or an ellipse draws it on one line, so it keeps Excalidraw's lines.
    const label = bound ? wordsOf(bound, type === 'diamond' || type === 'ellipse') : '';
    const node = this.nodeFor(element, type, { id, at: { x, y }, size: { width, height }, label, bound });
    // A node drawn wider than the element (free text) grows away from the edge its words are set against,
    // keeping its 8px margin outside the element: from the centre unless aligned left or right.
    const grown = node.size.width - width;
    const align = node.appearance.textAlign;
    const left = !grown ? x : align === 'start' ? x - 8 : align === 'end' ? x - grown + 8 : x - grown / 2;
    const transform = { translation: rotation ? turnedCorner(left, y, node.size.width, height, rotation) : { x: left, y },
      rotationRadians: rotation, scale: { x: 1, y: 1 } };
    this.nodes.push({ ...node, ...base, transform });
    this.nodeIds.add(id);
    if (typeof node.appearance.fill === 'string' && node.appearance.fill !== 'transparent') {
      this.fills.add({ x: finite(element.x), y: finite(element.y), width, height }, node);
    }
  }

  private nodeFor(
    element: ExcalidrawElement, type: string,
    at: { id: string; at: Point2d; size: { width: number; height: number }; label: string; bound: ExcalidrawElement | undefined },
  ): SceneNode {
    // Own keys only: a hand-edited "constructor" falls back to a box instead of reading Object's.
    const shape = Object.hasOwn(SHAPES, type) ? SHAPES[type] : undefined;
    if (shape) {
      const rounded = shape === 'rectangle' && element.roundness !== null && element.roundness !== undefined;
      const circle = shape === 'ellipse' && Math.abs(at.size.width - at.size.height) < 1;
      if (element.fillStyle && element.fillStyle !== 'solid' && excalidrawColor(element.backgroundColor) !== 'transparent') {
        this.lose('hatched fills are drawn solid');
      }
      const node = createShapeNode(this.page, { kind: rounded ? 'rounded' : circle ? 'circle' : shape, id: at.id, at: at.at, size: at.size,
        label: at.label, appearance: excalidrawNodeAppearance(element, at.bound) });
      const ink = at.bound && node.appearance.textColor === undefined ? excalidrawWordInk(at.bound.strokeColor, solidOnDark(node)) : undefined;
      return ink ? { ...node, appearance: { ...node.appearance, textColor: ink } } : node;
    }
    if (type === 'text') {
      // Default ink follows the theme, except where the topmost fill drawn below it stays solid on dark: there dark ink stays readable.
      const centre = { x: finite(element.x) + at.size.width / 2, y: finite(element.y) + at.size.height / 2 };
      const under = this.fills.top(centre);
      const ink = excalidrawWordInk(element.strokeColor, !!under && solidOnDark(under));
      // Excalidraw's box is exactly its words; ours keeps 8px clear each side and draws handwriting in a wider
      // face, so the box widens about the same centre. ponytail: the margin is guessed — measure the canvas face if words break.
      // Fixed-width text (autoResize false) is wrapped by Excalidraw to its box: those lines, not one long one.
      const label = wordsOf(element, element.autoResize === false);
      const fontSize = finite(element.fontSize, 20);
      const alpha = excalidrawOpacity(element);
      const widest = label.split('\n').reduce((most, line) => Math.max(most, measurePortableText(line, { fontSize, fontWeight: 400 }).width), 0);
      const width = Math.max(at.size.width + 16, Math.ceil(widest * (excalidrawFont(element.fontFamily) === 'hand' ? 1.25 : 1.05)) + 20);
      return {
        id: at.id, kind: 'text', parentId: null, layerId: this.layerId, zIndex: 0,
        transform: { translation: at.at, rotationRadians: 0, scale: { x: 1, y: 1 } },
        size: { width, height: at.size.height },
        content: {
          label, fontSize,
          fontFamily: excalidrawFont(element.fontFamily), fontWeight: '400',
          ...(ink ? { customColor: ink } : {}),
        },
        appearance: {
          ...(element.textAlign === 'left' ? { textAlign: 'start' } : element.textAlign === 'right' ? { textAlign: 'end' } : {}),
          ...(alpha !== undefined ? { opacity: alpha } : {}),
        },
        ports: [], metadata: {}, extensions: {},
      };
    }
    if (type === 'freedraw') {
      const points = pointsOf(element);
      const low = lowest(points);
      if (filledLoop(element, points)) this.lose('filled lines are drawn as outlines');
      return {
        id: at.id, kind: 'pen', parentId: null, layerId: this.layerId, zIndex: 0,
        transform: { translation: at.at, rotationRadians: 0, scale: { x: 1, y: 1 } }, size: at.size,
        content: { points: points.map((point) => ({ x: point.x - low.x, y: point.y - low.y })), ...excalidrawStrokeContent(element) },
        appearance: {}, ports: [], metadata: {}, extensions: {},
      };
    }
    if (type === 'image') {
      const file = this.scene.files[text(element.fileId)] as { dataURL?: unknown } | undefined;
      const url = text(file?.dataURL);
      if (/^data:image\//.test(url)) {
        const flipped = Array.isArray(element.scale) && element.scale.some((factor) => typeof factor === 'number' && factor < 0);
        if (flipped || (element.crop && typeof element.crop === 'object')) this.lose('cropped or flipped pictures come in whole and unflipped');
        const node = createImageNode(this.page, { id: at.id, at: at.at, size: at.size, label: at.label || 'Image', url });
        const alpha = excalidrawOpacity(element);
        return alpha === undefined ? node : { ...node, content: { ...node.content, transparency: alpha } };
      }
      this.lose('a picture whose file isn’t in the drawing is drawn as a box');
    } else if (type === 'frame' || type === 'magicframe') {
      return {
        id: at.id, kind: 'frame', parentId: null, layerId: this.layerId, zIndex: 0,
        transform: { translation: at.at, rotationRadians: 0, scale: { x: 1, y: 1 } }, size: at.size,
        content: { label: text(element.name) || 'Frame' }, appearance: {}, ports: [], metadata: {}, extensions: {},
      };
    } else if (type === 'embeddable' || type === 'iframe') {
      this.lose('embedded web pages are drawn as a box with their link');
      return createShapeNode(this.page, { kind: 'rectangle', id: at.id, at: at.at, size: at.size, label: text(element.link) || at.label,
        appearance: excalidrawNodeAppearance(element, at.bound) });
    } else {
      this.lose(`Excalidraw’s “${shortName(type) || 'unknown'}” element is drawn as a box`);
    }
    return createShapeNode(this.page, { kind: 'rectangle', id: at.id, at: at.at, size: at.size, label: at.label,
      appearance: excalidrawNodeAppearance(element, at.bound) });
  }

  /** An arrow, or a line tied to a shape, is a connector; a loose line keeps its drawn points as a line node. */
  private addLinear(element: ExcalidrawElement, zIndex: number): void {
    const id = element.id as string;
    const x = finite(element.x);
    const y = finite(element.y);
    const points = turnedPoints(element);
    if (points.length < 2) { this.lose('an arrow without two points was left out'); return; }
    if (element.type === 'line' && filledLoop(element, points)) this.lose('filled lines are drawn as outlines');
    const startId = bindingOf(element.startBinding);
    const endId = bindingOf(element.endBinding);
    const bound = (startId !== null && this.nodeIds.has(startId)) || (endId !== null && this.nodeIds.has(endId));
    const label = this.labels.get(id);
    if (element.type === 'line' && !bound && !label) { this.addLine(element, points, zIndex); return; }
    const endpoint = (nodeId: string | null, point: Point2d): ConnectorEndpoint =>
      nodeId && this.nodeIds.has(nodeId)
        ? { nodeId, portId: null, anchor: null, point: null }
        : { nodeId: null, portId: null, anchor: null, point: { x: x + point.x, y: y + point.y } };
    const appearance: Record<string, string | number> = excalidrawConnectorAppearance(element);
    const arrow = element.type === 'arrow';
    for (const [key, value] of [['markerStart', element.startArrowhead], ['markerEnd', element.endArrowhead]] as const) {
      const head = arrow ? excalidrawHead(value) : null;
      if (typeof head === 'string') appearance[key] = head;
      else if (head) this.lose(`the “${shortName(head.lost)}” arrowhead is drawn as a plain end`);
    }
    const elbowed = element.elbowed === true;
    // A curved arrow passes through its points; ours bends at them.
    if (!elbowed && points.length > 2 && element.roundness) this.lose('curved arrows are drawn with straight segments');
    const waypoints = elbowed ? [] : points.slice(1, -1).map((point) => ({ x: x + point.x, y: y + point.y }));
    const labels: ConnectorLabel[] = label
      ? [{ id: `${id}:label`, text: wordsOf(label, false), pathRatio: 0.5, offset: { x: 0, y: 0 }, metadata: {} }]
      : [];
    this.connectors.push({
      id, source: endpoint(startId, points[0]!), target: endpoint(endId, points[points.length - 1]!),
      route: {
        kind: elbowed ? 'orthogonal' : waypoints.length ? 'polyline' : 'direct',
        ownership: waypoints.length ? 'imported-fixed' : 'automatic',
      },
      waypoints, labels, appearance, semantics: {}, metadata: {}, extensions: {},
    });
  }

  private addLine(element: ExcalidrawElement, points: readonly Point2d[], zIndex: number): void {
    const { min: { x: minX, y: minY }, max } = extent(points);
    const { parentId, origin } = this.place(element);
    this.nodes.push({
      id: element.id as string, kind: 'line', parentId, layerId: this.layerId, zIndex,
      transform: { translation: { x: finite(element.x) + minX - origin.x, y: finite(element.y) + minY - origin.y }, rotationRadians: 0, scale: { x: 1, y: 1 } },
      size: {
        width: Math.max(1, max.x - minX),
        height: Math.max(1, max.y - minY),
      },
      content: { points: points.map((point) => ({ x: point.x - minX, y: point.y - minY })), ...excalidrawStrokeContent(element) },
      appearance: {}, ports: [], metadata: {}, extensions: {},
    });
  }
}

/** A drawing's nodes and connectors for one page under `layerId`, and what didn't come across. */
export function excalidrawScene(scene: ExcalidrawScene, layerId = DEFAULT_SCENE_LAYER_ID): { nodes: SceneNode[]; connectors: SceneConnector[]; losses: string[] } {
  const builder = new SceneBuilder(scene, layerId);
  builder.build();
  return { nodes: builder.nodes, connectors: builder.connectors, losses: builder.lossList() };
}

/** An Excalidraw file (or its clipboard JSON) as an OpenFlowKit document of one page under `id`. */
export function excalidrawToDocument(source: string, id: string, now = new Date().toISOString()): ExcalidrawImport {
  // ponytail: main thread; 50 000 shapes (a 15 MB file) parse, build and validate in about 130 ms — a worker if drawings grow past that.
  const scene = readExcalidraw(source);
  if (!scene) return { error: 'It isn’t an Excalidraw drawing.' };
  const { nodes, connectors, losses } = excalidrawScene(scene);
  if (nodes.length === 0 && connectors.length === 0) return { error: 'The drawing is empty.' };
  const page: ScenePage = {
    id: `${id}:page-1`, name: 'Excalidraw', diagramKind: 'flowchart',
    layers: [createDefaultSceneLayer()],
    nodes, connectors, metadata: {}, extensions: {},
  };
  const metadata: JsonObject = { importedFrom: 'excalidraw' };
  const document: SceneDocumentV1 = {
    format: SCENE_DOCUMENT_FORMAT, schemaVersion: SCENE_DOCUMENT_VERSION, id, name: UNTITLED_DOCUMENT_NAME,
    createdAt: now, updatedAt: now, pages: [page], metadata, extensions: {},
  };
  const validated = validateSceneDocumentV1(document);
  if (validated.success !== true) return { error: `It couldn’t be turned into a diagram: ${validated.issues[0]?.message ?? 'unknown issue'}` };
  return { document: validated.document, losses };
}
