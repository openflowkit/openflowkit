import { isFiniteNumber } from '../geometry/finite';
import { isPoint2d } from '../geometry/point';
import { isSize2d } from '../geometry/size';
import { isTransform2d } from '../geometry/transform';
import { isJsonObject } from './json';
import { validateNodeContentLayout } from '../node-layout/model';
import { validateNodeSizingPolicy } from '../node-sizing/model';
import {
  COMMENT_BODY_MAX,
  SCENE_DOCUMENT_FORMAT,
  SCENE_DOCUMENT_VERSION,
  type ConnectorEndpoint,
  type ConnectorLabel,
  type ConnectorRouteIntent,
  type SceneAnchor,
  type SceneComment,
  type SceneThread,
  type SceneConnector,
  type SceneDocumentV1,
  type SceneLayer,
  type SceneNode,
  type ScenePage,
  type ScenePort,
} from './types';

export interface DocumentValidationIssue {
  readonly path: string;
  readonly message: string;
}

type DocumentValidationResult =
  | { readonly success: true; readonly document: SceneDocumentV1 }
  | { readonly success: false; readonly issues: readonly DocumentValidationIssue[] };

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isAnchor(value: unknown): value is SceneAnchor {
  if (!isRecord(value)) return false;
  if (value.kind === 'center') return true;
  if (value.kind === 'normalized') {
    return isFiniteNumber(value.x) && isFiniteNumber(value.y);
  }
  return (
    value.kind === 'side' &&
    ['top', 'right', 'bottom', 'left'].includes(String(value.side)) &&
    isFiniteNumber(value.ratio) &&
    value.ratio >= 0 &&
    value.ratio <= 1
  );
}

function isPort(value: unknown): value is ScenePort {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isAnchor(value.anchor) &&
    isStringArray(value.accepts) &&
    isJsonObject(value.metadata)
  );
}

function isEndpoint(value: unknown): value is ConnectorEndpoint {
  if (!isRecord(value)) return false;
  if (value.nodeId === null) {
    return value.portId === null && value.anchor === null && isPoint2d(value.point);
  }
  return (
    isNonEmptyString(value.nodeId) &&
    isNullableString(value.portId) &&
    (value.anchor === null || isAnchor(value.anchor)) &&
    // Pre-spike payloads omit point; absent reads as null, never as free.
    (value.point === null || value.point === undefined)
  );
}

function isRouteIntent(value: unknown): value is ConnectorRouteIntent {
  return (
    isRecord(value) &&
    ['direct', 'polyline', 'bezier', 'orthogonal'].includes(String(value.kind)) &&
    ['automatic', 'manual', 'imported-fixed', 'hybrid'].includes(String(value.ownership))
  );
}

function isLabel(value: unknown): value is ConnectorLabel {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    typeof value.text === 'string' &&
    isFiniteNumber(value.pathRatio) &&
    value.pathRatio >= 0 &&
    value.pathRatio <= 1 &&
    isPoint2d(value.offset) &&
    isJsonObject(value.metadata)
  );
}

function isLayer(value: unknown): value is SceneLayer {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    typeof value.visible === 'boolean' &&
    typeof value.locked === 'boolean'
  );
}

function isNode(value: unknown): value is SceneNode {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.kind) &&
    isNullableString(value.parentId) &&
    isNonEmptyString(value.layerId) &&
    isFiniteNumber(value.zIndex) &&
    isTransform2d(value.transform) &&
    isSize2d(value.size) &&
    isJsonObject(value.content) &&
    validateNodeContentLayout(value.content.contentLayout).success &&
    validateNodeSizingPolicy(value.content.sizingPolicy).success &&
    isJsonObject(value.appearance) &&
    Array.isArray(value.ports) &&
    value.ports.every(isPort) &&
    hasUniqueIds(value.ports) &&
    isJsonObject(value.metadata) &&
    isJsonObject(value.extensions)
  );
}

function isConnector(value: unknown): value is SceneConnector {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isEndpoint(value.source) &&
    isEndpoint(value.target) &&
    isRouteIntent(value.route) &&
    Array.isArray(value.waypoints) &&
    value.waypoints.every(isPoint2d) &&
    Array.isArray(value.labels) &&
    value.labels.every(isLabel) &&
    isJsonObject(value.appearance) &&
    isJsonObject(value.semantics) &&
    isJsonObject(value.metadata) &&
    isJsonObject(value.extensions)
  );
}

function isComment(value: unknown): value is SceneComment {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isRecord(value.author) &&
    (value.author.kind === 'human' || value.author.kind === 'agent') &&
    isNonEmptyString(value.author.name) &&
    isNonEmptyString(value.body) &&
    value.body.length <= COMMENT_BODY_MAX &&
    isNonEmptyString(value.createdAt) &&
    (value.editedAt === undefined || isNonEmptyString(value.editedAt))
  );
}

// A missing anchor node is not an issue: the node may have been deleted, and the pin stays at `point`.
function isThread(value: unknown): value is SceneThread {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    Number.isSafeInteger(value.number) &&
    (value.number as number) > 0 &&
    isRecord(value.anchor) &&
    isNullableString(value.anchor.nodeId) &&
    (value.anchor.offset === null || isPoint2d(value.anchor.offset)) &&
    (value.anchor.nodeId === null) === (value.anchor.offset === null) &&
    isPoint2d(value.anchor.point) &&
    typeof value.resolved === 'boolean' &&
    Array.isArray(value.comments) &&
    value.comments.length > 0 &&
    value.comments.every(isComment) &&
    hasUniqueIds(value.comments)
  );
}

function hasUniqueIds(values: readonly { readonly id: string }[]): boolean {
  return new Set(values.map((value) => value.id)).size === values.length;
}

function isPage(value: unknown): value is ScenePage {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.diagramKind) &&
    Array.isArray(value.layers) &&
    value.layers.length > 0 &&
    value.layers.every(isLayer) &&
    hasUniqueIds(value.layers) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isNode) &&
    hasUniqueIds(value.nodes) &&
    Array.isArray(value.connectors) &&
    value.connectors.every(isConnector) &&
    hasUniqueIds(value.connectors) &&
    isJsonObject(value.metadata) &&
    isJsonObject(value.extensions) &&
    (value.threads === undefined ||
      (Array.isArray(value.threads) && value.threads.every(isThread) && hasUniqueIds(value.threads)))
  );
}

function collectPageReferenceIssues(page: ScenePage, path: string): DocumentValidationIssue[] {
  const issues: DocumentValidationIssue[] = [];
  const layerIds = new Set(page.layers.map((layer) => layer.id));
  const nodeIds = new Set(page.nodes.map((node) => node.id));
  const nodesById = new Map(page.nodes.map((node) => [node.id, node]));

  page.nodes.forEach((node, index) => {
    if (!layerIds.has(node.layerId)) {
      issues.push({ path: `${path}.nodes[${index}].layerId`, message: 'Unknown layer ID.' });
    }
    if (node.parentId !== null && !nodeIds.has(node.parentId)) {
      issues.push({ path: `${path}.nodes[${index}].parentId`, message: 'Unknown parent node ID.' });
    }
    if (node.parentId === node.id) {
      issues.push({
        path: `${path}.nodes[${index}].parentId`,
        message: 'Node cannot parent itself.',
      });
    }
  });

  page.nodes.forEach((node, index) => {
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) {
        issues.push({
          path: `${path}.nodes[${index}].parentId`,
          message: 'Node hierarchy must not contain a cycle.',
        });
        break;
      }
      visited.add(parentId);
      parentId = nodesById.get(parentId)?.parentId ?? null;
    }
  });

  page.connectors.forEach((connector, index) => {
    if (connector.source.nodeId !== null && !nodeIds.has(connector.source.nodeId)) {
      issues.push({
        path: `${path}.connectors[${index}].source.nodeId`,
        message: 'Unknown node ID.',
      });
    }
    if (connector.target.nodeId !== null && !nodeIds.has(connector.target.nodeId)) {
      issues.push({
        path: `${path}.connectors[${index}].target.nodeId`,
        message: 'Unknown node ID.',
      });
    }
    const sourceNode =
      connector.source.nodeId === null ? undefined : nodesById.get(connector.source.nodeId);
    if (
      sourceNode &&
      connector.source.portId !== null &&
      !sourceNode.ports.some((port) => port.id === connector.source.portId)
    ) {
      issues.push({
        path: `${path}.connectors[${index}].source.portId`,
        message: 'Unknown source port ID.',
      });
    }
    const targetNode =
      connector.target.nodeId === null ? undefined : nodesById.get(connector.target.nodeId);
    if (
      targetNode &&
      connector.target.portId !== null &&
      !targetNode.ports.some((port) => port.id === connector.target.portId)
    ) {
      issues.push({
        path: `${path}.connectors[${index}].target.portId`,
        message: 'Unknown target port ID.',
      });
    }
  });
  return issues;
}

/**
 * `value` for loading: a thread that is invalid, or whose id or number another thread already has, is dropped
 * with a console warning, so one bad thread cannot lock someone out of their diagram. Returns `value` itself
 * when every thread is fine.
 */
export function withoutInvalidThreads(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.pages)) return value;
  const ids = new Set<string>();
  const numbers = new Set<number>();
  let changed = false;
  const pages = value.pages.map((page: unknown) => {
    if (!isRecord(page) || page.threads === undefined) return page;
    const threads: unknown[] = Array.isArray(page.threads) ? page.threads : [];
    const kept = threads.filter((thread) => {
      const fine = isThread(thread) && !ids.has(thread.id) && !numbers.has(thread.number);
      if (fine) {
        ids.add(thread.id);
        numbers.add(thread.number);
      } else {
        console.warn(`Dropped an invalid comment thread on page "${String(page.id)}".`);
      }
      return fine;
    });
    if (kept.length === threads.length && Array.isArray(page.threads)) return page;
    changed = true;
    const { threads: _dropped, ...rest } = page;
    return kept.length ? { ...rest, threads: kept } : rest;
  });
  return changed ? { ...value, pages } : value;
}

export function validateSceneDocumentV1(value: unknown): DocumentValidationResult {
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: '$', message: 'Expected an object.' }] };
  }
  const issues: DocumentValidationIssue[] = [];
  if (value.format !== SCENE_DOCUMENT_FORMAT) {
    issues.push({ path: '$.format', message: `Expected "${SCENE_DOCUMENT_FORMAT}".` });
  }
  if (value.schemaVersion !== SCENE_DOCUMENT_VERSION) {
    issues.push({ path: '$.schemaVersion', message: `Unsupported schema version.` });
  }
  if (!isNonEmptyString(value.id))
    issues.push({ path: '$.id', message: 'Expected a non-empty string.' });
  if (!isNonEmptyString(value.name))
    issues.push({ path: '$.name', message: 'Expected a non-empty string.' });
  if (!isNonEmptyString(value.createdAt))
    issues.push({ path: '$.createdAt', message: 'Expected a timestamp.' });
  if (!isNonEmptyString(value.updatedAt))
    issues.push({ path: '$.updatedAt', message: 'Expected a timestamp.' });
  if (!Array.isArray(value.pages) || value.pages.length === 0 || !value.pages.every(isPage)) {
    issues.push({ path: '$.pages', message: 'Expected valid pages with unique local IDs.' });
  } else {
    if (!hasUniqueIds(value.pages))
      issues.push({ path: '$.pages', message: 'Page IDs must be unique.' });
    const numbers = value.pages.flatMap((page) => (page.threads ?? []).map((thread) => thread.number));
    if (new Set(numbers).size !== numbers.length) {
      issues.push({ path: '$.pages', message: 'Thread numbers must be unique within the document.' });
    }
    value.pages.forEach((page, index) =>
      issues.push(...collectPageReferenceIssues(page, `$.pages[${index}]`))
    );
  }
  if (!isJsonObject(value.metadata))
    issues.push({ path: '$.metadata', message: 'Expected JSON object.' });
  if (!isJsonObject(value.extensions))
    issues.push({ path: '$.extensions', message: 'Expected JSON object.' });

  return issues.length === 0
    ? { success: true, document: value as unknown as SceneDocumentV1 }
    : { success: false, issues };
}
