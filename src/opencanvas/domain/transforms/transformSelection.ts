import type { DocumentCommand } from '../commands/types';
import { areStructurallyEqual } from '../commands/equality';
import type { SceneNode } from '../document/types';
import { createBounds2d, unionBounds } from '../geometry/bounds';
import { applyMatrixToPoint } from '../geometry/matrix';
import { buildNodeWorldMatrices, nodeWorldBounds, nodeWorldCenter } from '../scene/worldGeometry';
import type { ScenePage } from '../document/types';
import type { Bounds2d, Point2d } from '../geometry/types';
import { snapBoundsToObjects } from './objectSnap';
import { isContainerNodeKind } from '../nodes/containerNodePresentation';
import type {
  MoveTransformOptions,
  ResizeTransformInput,
  TransformHandle,
  TransformResult,
  TransformSnapshot,
} from './types';

const DEFAULT_GRID_SIZE = 16;
const DEFAULT_MINIMUM_SIZE = 24;

function snapValue(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

function rotatePoint(point: Point2d, center: Point2d, angle: number): Point2d {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine,
  };
}

function boundsCenter(bounds: Bounds2d): Point2d {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function selectionBounds(page: ScenePage, nodes: readonly SceneNode[]): Bounds2d {
  const matrices = buildNodeWorldMatrices(page);
  const bounds = nodes.map((node) => nodeWorldBounds(node, matrices.get(node.id)!));
  if (bounds.length === 0) throw new Error('A transform requires at least one node.');
  return bounds.slice(1).reduce(unionBounds, bounds[0]);
}

export function createTransformSnapshot(
  page: ScenePage,
  nodeIds: readonly string[]
): TransformSnapshot {
  const selected = new Set(nodeIds);
  const nodes = page.nodes.filter((node) => selected.has(node.id));
  if (nodes.length !== selected.size) throw new Error('A selected node was not found.');
  const containers = new Set(nodes.filter((node) => isContainerNodeKind(node.kind)).map((node) => node.id));
  const members = page.nodes.filter((node) => node.parentId !== null && containers.has(node.parentId) && !selected.has(node.id));
  const matrices = buildNodeWorldMatrices(page);
  const origins = new Map(nodes.flatMap((node) => {
    const parent = node.parentId ? matrices.get(node.parentId) : undefined;
    return parent ? [[node.id, applyMatrixToPoint(parent, { x: 0, y: 0 })] as const] : [];
  }));
  return { nodes, members, bounds: selectionBounds(page, nodes), origins };
}

/** The records a transform command replaces, in `TransformResult.nodes` order. */
export function transformBefore(snapshot: TransformSnapshot): readonly SceneNode[] {
  return [...snapshot.nodes, ...snapshot.members];
}

export function moveTransform(
  snapshot: TransformSnapshot,
  delta: Point2d,
  options: MoveTransformOptions = {}
): TransformResult {
  const gridSize = options.gridSize ?? DEFAULT_GRID_SIZE;
  // ⇧ pins the axis the drag has moved less along; it never snaps off its line.
  const lockX = options.axisLock === true && Math.abs(delta.x) < Math.abs(delta.y);
  const lockY = options.axisLock === true && !lockX;
  const rawX = snapshot.bounds.x + (lockX ? 0 : delta.x);
  const rawY = snapshot.bounds.y + (lockY ? 0 : delta.y);
  const gridX = options.snap === false || lockX ? rawX : snapValue(rawX, gridSize);
  const gridY = options.snap === false || lockY ? rawY : snapValue(rawY, gridSize);
  const object = options.objects
    ? snapBoundsToObjects(
        createBounds2d(gridX, gridY, snapshot.bounds.width, snapshot.bounds.height),
        options.objects,
        options.objectThreshold
      )
    : null;
  const x = lockX ? rawX : object?.bounds.x ?? gridX;
  const y = lockY ? rawY : object?.bounds.y ?? gridY;
  const applied = { x: x - snapshot.bounds.x, y: y - snapshot.bounds.y };
  return {
    ...(object ? { guideX: lockX ? null : object.guideX, guideY: lockY ? null : object.guideY } : {}),
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      transform: {
        ...node.transform,
        translation: {
          x: node.transform.translation.x + applied.x,
          y: node.transform.translation.y + applied.y,
        },
      },
    })).concat(snapshot.members),
    bounds: createBounds2d(x, y, snapshot.bounds.width, snapshot.bounds.height),
    snappedX: x !== rawX,
    snappedY: y !== rawY,
  };
}

function resizeAxes(handle: Exclude<TransformHandle, 'rotate'>): {
  readonly west: boolean;
  readonly east: boolean;
  readonly north: boolean;
  readonly south: boolean;
} {
  return {
    west: handle.includes('west'),
    east: handle.includes('east'),
    north: handle.includes('north'),
    south: handle.includes('south'),
  };
}

function fixedResizeAnchor(bounds: Bounds2d, axes: ReturnType<typeof resizeAxes>): Point2d {
  let x = bounds.x;
  let y = bounds.y;
  if (axes.west) x += bounds.width;
  if (axes.north) y += bounds.height;
  return { x, y };
}

export function resizeTransform(
  snapshot: TransformSnapshot,
  input: ResizeTransformInput
): TransformResult {
  const axes = resizeAxes(input.handle);
  const minimum = input.minimumSize ?? DEFAULT_MINIMUM_SIZE;
  const gridSize = input.gridSize ?? DEFAULT_GRID_SIZE;
  const before = snapshot.bounds;
  const right = before.x + before.width;
  const bottom = before.y + before.height;
  const rawX = axes.west ? input.pointer.x : before.x;
  const rawY = axes.north ? input.pointer.y : before.y;
  const rawRight = axes.east ? input.pointer.x : right;
  const rawBottom = axes.south ? input.pointer.y : bottom;
  const snap = input.snap !== false;
  const candidateX = snap && axes.west ? snapValue(rawX, gridSize) : rawX;
  const candidateY = snap && axes.north ? snapValue(rawY, gridSize) : rawY;
  const candidateRight = snap && axes.east ? snapValue(rawRight, gridSize) : rawRight;
  const candidateBottom = snap && axes.south ? snapValue(rawBottom, gridSize) : rawBottom;
  const center = boundsCenter(before);
  const anchor = input.fromCenter ? center : fixedResizeAnchor(before, axes);
  // Dragged edge distance from the anchor, mirrored when growing from the centre.
  const grow = input.fromCenter ? 2 : 1;
  let width = axes.west ? (anchor.x - candidateX) * grow
    : axes.east ? (candidateRight - anchor.x) * grow : before.width;
  let height = axes.north ? (anchor.y - candidateY) * grow
    : axes.south ? (candidateBottom - anchor.y) * grow : before.height;
  const horizontal = axes.west || axes.east;
  const vertical = axes.north || axes.south;
  if (input.keepAspect && before.width > 0 && before.height > 0) {
    const scale = horizontal && vertical
      ? Math.max(width / before.width, height / before.height)
      : horizontal ? width / before.width : height / before.height;
    width = before.width * scale;
    height = before.height * scale;
  }
  width = Math.max(minimum, width);
  height = Math.max(minimum, height);
  const scalesX = horizontal || input.keepAspect === true;
  const scalesY = vertical || input.keepAspect === true;
  // A side handle with aspect lock grows the other axis around its centre line.
  const anchorX = scalesX && !horizontal ? center.x : anchor.x;
  const anchorY = scalesY && !vertical ? center.y : anchor.y;
  const x = !scalesX ? before.x
    : input.fromCenter || !horizontal ? anchorX - width / 2 : axes.west ? anchorX - width : anchorX;
  const y = !scalesY ? before.y
    : input.fromCenter || !vertical ? anchorY - height / 2 : axes.north ? anchorY - height : anchorY;
  const nextBounds = createBounds2d(x, y, width, height);
  const scaleX = nextBounds.width / before.width;
  const scaleY = nextBounds.height / before.height;

  // A resize changes the box, never the scale (Figma): labels wrap to the
  // new width and the DOM editor sees the same size the renderer draws.
  // Containers additionally shift their members so those keep their world
  // position. ponytail: translation math is axis-aligned; rotated selections
  // resize their own frame's box, which is what tldraw does too.
  const originShift = new Map<string, Point2d>();
  const nodes = snapshot.nodes.map((node) => {
    const translation = node.transform.translation;
    // The anchor is on the canvas; a nested node's translation is from its parent's origin.
    const origin = snapshot.origins?.get(node.id) ?? { x: 0, y: 0 };
    const moved = {
      x: scalesX ? anchorX - origin.x + (translation.x - anchorX + origin.x) * scaleX : translation.x,
      y: scalesY ? anchorY - origin.y + (translation.y - anchorY + origin.y) * scaleY : translation.y,
    };
    if (isContainerNodeKind(node.kind)) {
      originShift.set(node.id, { x: translation.x - moved.x, y: translation.y - moved.y });
    }
    return {
      ...node,
      transform: { ...node.transform, translation: moved },
      size: {
        width: node.size.width * (scalesX ? scaleX : 1),
        height: node.size.height * (scalesY ? scaleY : 1),
      },
    };
  });
  const members = snapshot.members.map((member) => {
    const shift = originShift.get(member.parentId ?? '');
    if (!shift) return member;
    return {
      ...member,
      transform: { ...member.transform, translation: {
        x: member.transform.translation.x + shift.x, y: member.transform.translation.y + shift.y,
      } },
    };
  });
  return {
    nodes: [...nodes, ...members],
    bounds: nextBounds,
    snappedX: snap && (candidateX !== rawX || candidateRight !== rawRight),
    snappedY: snap && (candidateY !== rawY || candidateBottom !== rawBottom),
  };
}

export function rotateTransform(
  page: ScenePage,
  snapshot: TransformSnapshot,
  startPointer: Point2d,
  pointer: Point2d,
  snap = true
): TransformResult {
  const center = boundsCenter(snapshot.bounds);
  const startAngle = Math.atan2(startPointer.y - center.y, startPointer.x - center.x);
  const currentAngle = Math.atan2(pointer.y - center.y, pointer.x - center.x);
  const rawDelta = currentAngle - startAngle;
  const step = Math.PI / 12;
  const delta = snap ? Math.round(rawDelta / step) * step : rawDelta;
  const matrices = buildNodeWorldMatrices(page);
  const nodes = snapshot.nodes.map((node) => {
    const matrix = matrices.get(node.id)!;
    const oldCenter = nodeWorldCenter(node, matrix);
    const nextCenter = rotatePoint(oldCenter, center, delta);
    const rotation = node.transform.rotationRadians + delta;
    const localCenter = {
      x: (node.size.width * node.transform.scale.x) / 2,
      y: (node.size.height * node.transform.scale.y) / 2,
    };
    const rotatedOffset = rotatePoint(localCenter, { x: 0, y: 0 }, rotation);
    const origin = snapshot.origins?.get(node.id) ?? { x: 0, y: 0 };
    return {
      ...node,
      transform: {
        ...node.transform,
        rotationRadians: rotation,
        translation: {
          x: nextCenter.x - rotatedOffset.x - origin.x,
          y: nextCenter.y - rotatedOffset.y - origin.y,
        },
      },
    };
  });
  const previewPage = {
    ...page,
    nodes: page.nodes.map((node) => nodes.find((next) => next.id === node.id) ?? node),
  };
  return {
    nodes: [...nodes, ...snapshot.members],
    bounds: selectionBounds(previewPage, nodes),
    snappedX: snap && delta !== rawDelta,
    snappedY: false,
  };
}

export function createTransformCommand(
  pageId: string,
  before: readonly SceneNode[],
  after: readonly SceneNode[],
  label: string,
  id = `transform-${before.map((node) => node.id).join(',')}`
): DocumentCommand {
  if (before.length !== after.length || before.length === 0) {
    throw new Error('Transform commands require matching non-empty node sets.');
  }
  // Members of a moved container ride along unchanged; a set-node that changes
  // nothing is rejected by execute, so those pairs are dropped here.
  const commands = before.flatMap((node, index) => {
    if (node.id !== after[index].id) throw new Error('Transform node order must be stable.');
    if (areStructurallyEqual(node, after[index])) return [];
    return [{
      kind: 'set-node' as const,
      id: `${id}:${node.id}`,
      label,
      pageId,
      before: node,
      after: after[index],
    }];
  });
  if (commands.length === 0) throw new Error('Transform commands require a change.');
  return commands.length === 1 ? commands[0] : { kind: 'batch', id, label, commands };
}
