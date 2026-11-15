import type { Bounds2d, Point2d } from '../geometry/types';
import type { SceneNode } from '../document/types';

export type TransformHandle =
  | 'north-west'
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west'
  | 'rotate';

export interface TransformSnapshot {
  readonly bounds: Bounds2d;
  readonly nodes: readonly SceneNode[];
  /** Direct children of selected containers: they ride along in the parent's frame. */
  readonly members: readonly SceneNode[];
  /** Where each selected node's parent sits on the canvas: a nested node's translation is from there. */
  readonly origins?: ReadonlyMap<string, Point2d>;
}

export interface TransformResult {
  /** Transformed `snapshot.nodes` followed by `snapshot.members`, same order. */
  readonly nodes: readonly SceneNode[];
  readonly bounds: Bounds2d;
  readonly snappedX: boolean;
  readonly snappedY: boolean;
  /** World line the selection snapped to another object on; only set when `objects` was given. */
  readonly guideX?: number | null;
  readonly guideY?: number | null;
}

export interface MoveTransformOptions {
  readonly gridSize?: number;
  readonly snap?: boolean;
  /** ⇧: only the dominant axis of the drag moves (Figma, tldraw, Excalidraw). */
  readonly axisLock?: boolean;
  /** World bounds of non-selected nodes to snap against (after the grid). */
  readonly objects?: readonly Bounds2d[];
  readonly objectThreshold?: number;
}

export interface ResizeTransformInput {
  readonly handle: Exclude<TransformHandle, 'rotate'>;
  readonly pointer: Point2d;
  readonly minimumSize?: number;
  readonly gridSize?: number;
  readonly snap?: boolean;
  /** ⇧: keep the selection's aspect ratio. */
  readonly keepAspect?: boolean;
  /** ⌥: grow from the centre instead of the opposite edge. */
  readonly fromCenter?: boolean;
}
