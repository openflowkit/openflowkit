import { createDefaultSceneLayer, DEFAULT_SCENE_LAYER_ID, UNTITLED_DOCUMENT_NAME } from '../../opencanvas/domain/document/defaults';
import type { JsonObject } from '../../opencanvas/domain/document/json';
import {
  SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION,
  type ConnectorEndpoint, type ConnectorLabel, type SceneConnector, type SceneDocumentV1, type SceneNode, type ScenePage,
} from '../../opencanvas/domain/document/types';
import { validateSceneDocumentV1 } from '../../opencanvas/domain/document/validation';
import type { Point2d } from '../../opencanvas/domain/geometry/types';
import { createImageNode } from '../../opencanvas/domain/nodes/imageNode';
import { createShapeNode, type ShapeKind } from '../../opencanvas/domain/nodes/shapeNode';
import { measurePortableText } from '../../opencanvas/domain/text/measurement';
import {
  excalidrawColor, excalidrawConnectorAppearance, excalidrawFont, excalidrawHead, excalidrawInk, excalidrawNodeAppearance,
  excalidrawStrokeContent, finite, text, type ExcalidrawElement,
} from './excalidrawStyle';

// An Excalidraw drawing (`.excalidraw`, or the `excalidraw/clipboard` JSON its copy puts on the clipboard)
// as OpenFlowKit nodes and connectors. A drawing is placed by hand, so it is mapped one element to one node,
// never through DSL and the layout. What has no counterpart is listed in `losses`, never silently dropped.

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

/** True when `text` is an Excalidraw file or its clipboard JSON. */
export const looksLikeExcalidraw = (text: string): boolean => readExcalidraw(text) !== null;

const SHAPES: Readonly<Record<string, ShapeKind>> = { rectangle: 'rectangle', ellipse: 'ellipse', diamond: 'diamond' };

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

const lowest = (points: readonly Point2d[]): Point2d =>
  points.length ? { x: Math.min(...points.map((point) => point.x)), y: Math.min(...points.map((point) => point.y)) } : { x: 0, y: 0 };

/** A line's or arrow's points, turned by its angle about their centre, as Excalidraw draws them. */
function turnedPoints(element: ExcalidrawElement): Point2d[] {
  const points = pointsOf(element);
  const radians = finite(element.angle);
  if (!radians || points.length === 0) return points;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const centre = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map(({ x, y }) => ({
    x: centre.x + (x - centre.x) * cos - (y - centre.y) * sin,
    y: centre.y + (x - centre.x) * sin + (y - centre.y) * cos,
  }));
}

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
  private readonly nodeIds = new Set<string>();
  private readonly frames = new Set<string>();

  constructor(private readonly scene: ExcalidrawScene, private readonly layerId: string) {
    const groups = new Set<string>();
    for (const element of scene.elements) {
      if (element.isDeleted === true || typeof element.id !== 'string') continue;
      if (this.byId.has(element.id)) { this.lose('elements sharing an earlier element’s id were left out'); continue; }
      this.byId.set(element.id, element);
      if (element.type === 'text' && typeof element.containerId === 'string') {
        if (this.labels.has(element.containerId)) this.lose('a second text bound to the same shape was left out');
        else this.labels.set(element.containerId, element);
      }
      if (element.type === 'frame' || element.type === 'magicframe') this.frames.add(element.id);
      if (Array.isArray(element.groupIds)) for (const group of element.groupIds) if (typeof group === 'string') groups.add(group);
      if (text(element.link) && element.type !== 'embeddable' && element.type !== 'iframe') this.lose('links on shapes were left out');
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
      if (type === 'text' && typeof element.containerId === 'string' && this.byId.has(element.containerId)) continue;
      this.addNode(element, type, z);
      z += 1;
    }
    for (const element of this.byId.values()) {
      if (element.type === 'arrow' || element.type === 'line') this.addLinear(element, z++);
    }
  }

  /** A frame's member sits in the frame's own space; everything else on the page. */
  private place(element: ExcalidrawElement): { parentId: string | null; origin: Point2d } {
    const frameId = typeof element.frameId === 'string' && this.frames.has(element.frameId) ? element.frameId : null;
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
    const page = { layers: [{ id: this.layerId }], nodes: this.nodes } as unknown as ScenePage;
    const bound = this.labels.get(id);
    const label = bound ? text(bound.originalText) || text(bound.text) : '';
    const node = this.nodeFor(element, type, page, { id, at: { x, y }, size: { width, height }, label, bound });
    // A node drawn wider than the element (free text) grows away from the edge its words are set against,
    // keeping its 8px margin outside the element: from the centre unless aligned left or right.
    const grown = node.size.width - width;
    const align = node.appearance.textAlign;
    const left = !grown ? x : align === 'start' ? x - 8 : align === 'end' ? x - grown + 8 : x - grown / 2;
    const transform = { translation: rotation ? turnedCorner(left, y, node.size.width, height, rotation) : { x: left, y },
      rotationRadians: rotation, scale: { x: 1, y: 1 } };
    this.nodes.push({ ...node, ...base, transform });
    this.nodeIds.add(id);
  }

  /** Whether a filled shape already placed covers this box's centre. */
  private onFill(at: Point2d, size: { width: number; height: number }): boolean {
    const x = at.x + size.width / 2;
    const y = at.y + size.height / 2;
    return this.nodes.some(({ transform: { translation }, size: box, appearance }) =>
      typeof appearance.fill === 'string' && appearance.fill !== 'transparent'
      && x >= translation.x && x <= translation.x + box.width && y >= translation.y && y <= translation.y + box.height);
  }

  private nodeFor(
    element: ExcalidrawElement, type: string, page: ScenePage,
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
      return createShapeNode(page, { kind: rounded ? 'rounded' : circle ? 'circle' : shape, id: at.id, at: at.at, size: at.size,
        label: at.label, appearance: excalidrawNodeAppearance(element, at.bound) });
    }
    if (type === 'text') {
      // Default ink follows the theme, except on a filled shape drawn below it, where dark ink stays readable.
      const ink = this.onFill(at.at, at.size) ? excalidrawColor(element.strokeColor) : excalidrawInk(element.strokeColor);
      // Excalidraw's box is exactly its words; ours keeps 8px clear each side and draws handwriting in a wider
      // face, so the box widens about the same centre. ponytail: the margin is guessed — measure the canvas face if words break.
      const label = text(element.originalText) || text(element.text);
      const fontSize = finite(element.fontSize, 20);
      const widest = Math.max(0, ...label.split('\n').map((line) => measurePortableText(line, { fontSize, fontWeight: 400 }).width));
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
        appearance: element.textAlign === 'left' ? { textAlign: 'start' } : element.textAlign === 'right' ? { textAlign: 'end' } : {},
        ports: [], metadata: {}, extensions: {},
      };
    }
    if (type === 'freedraw') {
      const points = pointsOf(element);
      const low = lowest(points);
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
      if (/^data:image\//.test(url)) return createImageNode(page, { id: at.id, at: at.at, size: at.size, label: at.label || 'Image', url });
      this.lose('a picture whose file isn’t in the drawing is drawn as a box');
    } else if (type === 'frame' || type === 'magicframe') {
      return {
        id: at.id, kind: 'frame', parentId: null, layerId: this.layerId, zIndex: 0,
        transform: { translation: at.at, rotationRadians: 0, scale: { x: 1, y: 1 } }, size: at.size,
        content: { label: text(element.name) || 'Frame' }, appearance: {}, ports: [], metadata: {}, extensions: {},
      };
    } else if (type === 'embeddable' || type === 'iframe') {
      this.lose('embedded web pages are drawn as a box with their link');
      return createShapeNode(page, { kind: 'rectangle', id: at.id, at: at.at, size: at.size, label: text(element.link) || at.label,
        appearance: excalidrawNodeAppearance(element, at.bound) });
    } else {
      this.lose(`Excalidraw’s “${type || 'unknown'}” element is drawn as a box`);
    }
    return createShapeNode(page, { kind: 'rectangle', id: at.id, at: at.at, size: at.size, label: at.label,
      appearance: excalidrawNodeAppearance(element, at.bound) });
  }

  /** An arrow, or a line tied to a shape, is a connector; a loose line keeps its drawn points as a line node. */
  private addLinear(element: ExcalidrawElement, zIndex: number): void {
    const id = element.id as string;
    const x = finite(element.x);
    const y = finite(element.y);
    const points = turnedPoints(element);
    if (points.length < 2) { this.lose('an arrow without two points was left out'); return; }
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
      else if (head) this.lose(`the “${head.lost}” arrowhead is drawn as a plain end`);
    }
    const elbowed = element.elbowed === true;
    // A curved arrow passes through its points; ours bends at them.
    if (!elbowed && points.length > 2 && element.roundness) this.lose('curved arrows are drawn with straight segments');
    const waypoints = elbowed ? [] : points.slice(1, -1).map((point) => ({ x: x + point.x, y: y + point.y }));
    const labels: ConnectorLabel[] = label
      ? [{ id: `${id}:label`, text: text(label.originalText) || text(label.text), pathRatio: 0.5, offset: { x: 0, y: 0 }, metadata: {} }]
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
    const { x: minX, y: minY } = lowest(points);
    const { parentId, origin } = this.place(element);
    this.nodes.push({
      id: element.id as string, kind: 'line', parentId, layerId: this.layerId, zIndex,
      transform: { translation: { x: finite(element.x) + minX - origin.x, y: finite(element.y) + minY - origin.y }, rotationRadians: 0, scale: { x: 1, y: 1 } },
      size: {
        width: Math.max(1, Math.max(...points.map((point) => point.x)) - minX),
        height: Math.max(1, Math.max(...points.map((point) => point.y)) - minY),
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
