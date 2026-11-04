import type { Point2d, Size2d, Transform2d } from '../geometry/types';
import type { JsonObject } from './json';

export const SCENE_DOCUMENT_FORMAT = 'openflowkit.scene' as const;
export const SCENE_DOCUMENT_VERSION = 1 as const;

export interface ScenePort {
  readonly id: string;
  readonly anchor: SceneAnchor;
  readonly accepts: readonly string[];
  readonly metadata: JsonObject;
}

export type SceneAnchor =
  | { readonly kind: 'center' }
  | {
      readonly kind: 'side';
      readonly side: 'top' | 'right' | 'bottom' | 'left';
      readonly ratio: number;
    }
  | { readonly kind: 'normalized'; readonly x: number; readonly y: number };

export interface SceneNode {
  readonly id: string;
  readonly kind: string;
  readonly parentId: string | null;
  readonly layerId: string;
  readonly zIndex: number;
  readonly transform: Transform2d;
  readonly size: Size2d;
  readonly content: JsonObject;
  readonly appearance: JsonObject;
  readonly ports: readonly ScenePort[];
  readonly metadata: JsonObject;
  readonly extensions: JsonObject;
}

export interface ConnectorEndpoint {
  /** Bound node, or null for a free page-space point (drop on empty canvas). */
  readonly nodeId: string | null;
  readonly portId: string | null;
  readonly anchor: SceneAnchor | null;
  /**
   * Free point in page coordinates. Required when nodeId is null, must be
   * null when bound: an endpoint is either bound or free, never both.
   */
  readonly point: Point2d | null;
}

export type ConnectorRouteKind = 'direct' | 'polyline' | 'bezier' | 'orthogonal';
export type ConnectorRouteOwnership = 'automatic' | 'manual' | 'imported-fixed' | 'hybrid';

export interface ConnectorRouteIntent {
  readonly kind: ConnectorRouteKind;
  readonly ownership: ConnectorRouteOwnership;
}

export interface ConnectorLabel {
  readonly id: string;
  readonly text: string;
  readonly pathRatio: number;
  readonly offset: Point2d;
  readonly metadata: JsonObject;
}

export interface SceneConnector {
  readonly id: string;
  readonly source: ConnectorEndpoint;
  readonly target: ConnectorEndpoint;
  readonly route: ConnectorRouteIntent;
  readonly waypoints: readonly Point2d[];
  readonly labels: readonly ConnectorLabel[];
  readonly appearance: JsonObject;
  readonly semantics: JsonObject;
  readonly metadata: JsonObject;
  readonly extensions: JsonObject;
}

export interface SceneLayer {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
}

export interface SceneCommentAuthor {
  readonly kind: 'human' | 'agent';
  readonly name: string;
}

export interface SceneComment {
  readonly id: string;
  readonly author: SceneCommentAuthor;
  /** Plain text, at most COMMENT_BODY_MAX characters. */
  readonly body: string;
  readonly createdAt: string;
  readonly editedAt?: string;
}

/**
 * Where a thread is pinned. `point` is the pin tip in page coordinates; with a `nodeId` it follows the node
 * (`offset` from the node's world origin) and keeps the node's last position when the node is gone.
 */
export interface SceneThreadAnchor {
  readonly nodeId: string | null;
  readonly offset: Point2d | null;
  readonly point: Point2d;
}

/** A discussion pinned on a page. Not part of undo history or the DSL; JSON exports and share links leave it out unless an export asks for it. */
export interface SceneThread {
  readonly id: string;
  /** Positive, unique within the document: the "#3" people say aloud. */
  readonly number: number;
  readonly anchor: SceneThreadAnchor;
  readonly resolved: boolean;
  /** At least one; the first opens the thread. */
  readonly comments: readonly SceneComment[];
}

export const COMMENT_BODY_MAX = 4000;

export interface ScenePage {
  readonly id: string;
  readonly name: string;
  readonly diagramKind: string;
  readonly layers: readonly SceneLayer[];
  readonly nodes: readonly SceneNode[];
  readonly connectors: readonly SceneConnector[];
  readonly metadata: JsonObject;
  readonly extensions: JsonObject;
  readonly threads?: readonly SceneThread[];
}

export interface SceneDocumentV1 {
  readonly format: typeof SCENE_DOCUMENT_FORMAT;
  readonly schemaVersion: typeof SCENE_DOCUMENT_VERSION;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pages: readonly ScenePage[];
  readonly metadata: JsonObject;
  readonly extensions: JsonObject;
}
