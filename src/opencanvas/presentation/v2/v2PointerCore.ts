import type { RefObject } from 'react';
import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneNode, ScenePage } from '../../domain/document/types';
import type { JsonObject } from '../../domain/document/json';
import type { CanvasCamera } from '../../domain/camera/types';
import type { TransformResult } from '../../domain/transforms/types';
import type { Matrix2d, Point2d } from '../../domain/geometry/types';
import type { CanvasSelection } from '../../application/selection/selection';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import type { PixiPointerOperation, TransformModifiers } from './pointerOperations';
import type { ConnectSide } from '../../domain/connectors/connectHandles';
import type { V2ShapeKind } from '../../domain/commands/sceneEdits';
import type { V2Tool } from './V2CreationToolbar';
import type { V2ToolConfig } from './v2ToolCatalog';

export const CLICK_THRESHOLD_PX = 4;
// Object-snap reach in screen pixels; divided by zoom before it meets world units.
export const OBJECT_SNAP_PX = 6;
export const MIN_CREATE_SIZE = 8;
/** What a click with the Square tool places: a 1:1 rectangle. */
export const SQUARE_SIZE = 120;

export interface V2CreateOperation {
  readonly kind: 'create';
  readonly pointerId: number;
  readonly shape: V2ShapeKind;
  readonly square: boolean;
  readonly page: ScenePage;
  readonly startWorld: Point2d;
  readonly startScreen: Point2d;
  readonly currentScreen: Point2d;
}

export interface V2ConnectOperation {
  readonly kind: 'connect';
  readonly pointerId: number;
  readonly page: ScenePage;
  readonly sourceNodeId: string | null;
  /** Handle side the drag started from; null for connector-tool drags. */
  readonly sourceSide: ConnectSide | null;
  readonly fromWorld: Point2d;
  readonly startScreen: Point2d;
  readonly toWorld: Point2d;
}

// The ink tools capture raw points; the document is written once on release.
export interface V2InkOperation {
  readonly kind: 'ink';
  readonly pointerId: number;
  readonly page: ScenePage;
  readonly stroke: 'pen' | 'highlighter';
  readonly points: Point2d[];
}

// The eraser is a drag too: it collects the strokes it crossed.
export interface V2EraseOperation {
  readonly kind: 'erase';
  readonly pointerId: number;
  readonly page: ScenePage;
  readonly matrices: ReadonlyMap<string, Matrix2d>;
  readonly from: Point2d;
  readonly removed: Set<string>;
}

// Dragging a quadrant point writes x/y on release: one undo, like any drag.
export interface V2ChartPointOperation {
  readonly kind: 'chart-point';
  readonly pointerId: number;
  readonly page: ScenePage;
  readonly node: SceneNode;
  readonly index: number;
}

// The comment tool's press: a click (released within the threshold) asks for a comment there; anything else is dropped.
export interface V2CommentOperation {
  readonly kind: 'comment';
  readonly pointerId: number;
  readonly start: Point2d;
}

export type V2Operation =
  | PixiPointerOperation | V2CreateOperation | V2ConnectOperation
  | V2InkOperation | V2EraseOperation | V2ChartPointOperation | V2CommentOperation;

export interface V2GestureApi {
  readonly cancelGesture: () => boolean;
  /** The keyboard's click on the canvas: `shape` (else the armed tool's) centred on `at`. False when nothing was placed. */
  readonly placeShape: (at: Point2d, shape?: V2ShapeKind, square?: boolean) => boolean;
  /** Exactly two shapes selected: a connector from the first-selected to the second. False otherwise. */
  readonly connectSelection: () => boolean;
}

export interface V2PointerOptions {
  readonly hostRef: RefObject<PixiRendererHost | null>;
  readonly cameraRef: RefObject<CanvasCamera>;
  readonly pageRef: RefObject<ScenePage | null>;
  readonly selectionRef: RefObject<CanvasSelection>;
  readonly selectedConnectorIdsRef: RefObject<readonly string[]>;
  readonly toolRef: RefObject<V2Tool>;
  /** Which variant a flyout tool draws with (shape library, connector kind). */
  readonly toolConfigRef: RefObject<V2ToolConfig>;
  readonly spacePanRef: RefObject<boolean>;
  readonly readOnlyRef: RefObject<boolean>;
  readonly gestureApiRef: RefObject<V2GestureApi | null>;
  readonly commit: (command: DocumentCommand) => void;
  readonly applySelection: (selection: CanvasSelection) => void;
  readonly applyConnectorSelection: (connectorIds: readonly string[]) => void;
  readonly updateCamera: (camera: CanvasCamera) => void;
  readonly openEditor: (nodeId: string, options?: { readonly isNew?: boolean }) => void;
  readonly openConnectorEditor: (connectorId: string, at: Point2d) => void;
  readonly onToolChange: (tool: V2Tool) => void;
  readonly onTransformPreview?: (result: TransformResult | null) => void;
  readonly snapToGrid?: boolean;
  readonly mintId: (prefix: string) => string;
  /**
   * Model pages wrap a connector insert with the matching model relation, so a
   * connector drawn on a C4 view survives the next Generate.
   */
  readonly extendConnectorCommand?: (command: DocumentCommand, fromNodeId: string, toNodeId: string) => DocumentCommand;
  /** Sticky defaults: appearance the last style edit left behind, per kind (tldraw). */
  readonly stylePresetsRef?: RefObject<StylePresets>;
  /** Double-click on a chart opens its data panel; true means it was handled. */
  readonly onOpenChartData?: (nodeId: string) => boolean;
  /** A plain click that landed on a node (not a drag, marquee or additive click); Map mode opens and closes boxes with it. */
  readonly onNodeClick?: (nodeId: string) => void;
  /** Read-only: a double-click on a node (Map opens it where it can be edited). */
  readonly onNodeDoubleClick?: (nodeId: string) => void;
  /** Read-only: a drag that started on a node. Nothing moves, so the host says why; no marquee is drawn. */
  readonly onNodeDrag?: (nodeId: string) => void;
  /** A click with the comment tool on the canvas itself (screen point in the canvas): the comment layer opens a composer there. */
  readonly onCommentClick?: (point: Point2d) => void;
}

export interface StylePresets {
  shape: JsonObject;
  text: JsonObject;
  connector: JsonObject;
  /** Last ink pick: colour, width and opacity for the next stroke. */
  ink: JsonObject;
}

// Both React's synthetic event and a native window event, re-targeted at the
// canvas section, satisfy this.
export interface PointerLike {
  readonly currentTarget: HTMLElement;
  readonly target: EventTarget | null;
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly pointerType?: string;
  readonly nativeEvent?: Partial<PointerEvent>;
}

export function modifiersOf(event: PointerLike): TransformModifiers {
  return { shiftKey: event.shiftKey, altKey: event.altKey, metaKey: Boolean(event.metaKey || event.ctrlKey) };
}

export function localPoint(event: PointerLike): Point2d {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

// Trackpads report at 120 Hz+; the browser queues more moves than we can
// paint. Collapse each batch to its latest point — intermediate positions are
// never shown, so computing previews for them is pure waste.
export function latestLocalPoint(event: PointerLike): Point2d {
  const coalesced = typeof event.nativeEvent?.getCoalescedEvents === 'function'
    ? event.nativeEvent.getCoalescedEvents()
    : null;
  if (!coalesced || coalesced.length === 0) return localPoint(event);
  const bounds = event.currentTarget.getBoundingClientRect();
  const last = coalesced[coalesced.length - 1];
  return { x: last.clientX - bounds.left, y: last.clientY - bounds.top };
}

/** A coalesced sample re-pointed at the section, so its client coords resolve. */
export function retargetSample(event: PointerLike, sample: { clientX: number; clientY: number }): PointerLike {
  return { ...event, clientX: sample.clientX, clientY: sample.clientY };
}

/**
 * The box a drag from `start` to `world` draws: `square` (the Square tool, or ⇧) keeps both sides at the larger
 * extent, anchored at `start`; `fromCenter` (⌥) makes `start` the middle, so the box is twice the drag.
 */
export function dragBox(
  start: Point2d, world: Point2d, square: boolean, fromCenter = false,
): { at: Point2d; size: { width: number; height: number } } {
  const grow = fromCenter ? 2 : 1;
  const dx = Math.abs(world.x - start.x) * grow;
  const dy = Math.abs(world.y - start.y) * grow;
  const width = Math.max(MIN_CREATE_SIZE, square ? Math.max(dx, dy) : dx);
  const height = Math.max(MIN_CREATE_SIZE, square ? Math.max(dx, dy) : dy);
  if (fromCenter) return { at: { x: start.x - width / 2, y: start.y - height / 2 }, size: { width, height } };
  return {
    at: { x: world.x < start.x ? start.x - width : start.x, y: world.y < start.y ? start.y - height : start.y },
    size: { width, height },
  };
}
/**
 * The ⌘G group the selection sits directly in, so is "inside" (Figma): clicks pick among its members and Escape
 * climbs back out to it. Null when the selection is not all in one group.
 */
export function enteredGroup(page: ScenePage, nodeIds: readonly string[]): string | null {
  if (nodeIds.length === 0) return null;
  const byId = new Map(page.nodes.map((node) => [node.id, node]));
  const parentId = byId.get(nodeIds[0]!)?.parentId ?? null;
  if (!parentId || byId.get(parentId)?.kind !== 'group') return null;
  return nodeIds.every((id) => byId.get(id)?.parentId === parentId) ? parentId : null;
}
