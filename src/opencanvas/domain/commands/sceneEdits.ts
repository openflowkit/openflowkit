// Command builders for every v2 editor operation. The toolbar, keyboard and
// agent actions all build records here so their history entries match.
// Pure: no session, no store, no React.
import type {
  BatchDocumentCommand,
  DocumentCommand,
  InsertConnectorCommand,
  InsertNodeCommand,
  RemoveConnectorCommand,
  RemoveNodeCommand,
  SetNodeCommand,
} from './types';
import type { JsonObject } from '../document/json';
import { refitIconCard } from '../nodes/iconCardLayout';
import { resolveNodeStyle, type NodeStyle } from '../nodes/nodeStyle';
import { descendantIds } from '../scene/queries';
import { buildNodeStateMap } from '../scene/nodeState';
import type {
  ConnectorEndpoint,
  ConnectorRouteKind,
  SceneConnector,
  SceneNode,
  ScenePage,
} from '../document/types';
import type { Point2d, Size2d } from '../geometry/types';
import {
  createTransformCommand,
  createTransformSnapshot,
  moveTransform,
  transformBefore,
} from '../transforms/transformSelection';

import {
  createShapeNode, nextNodeZIndex, type ShapeKind,
} from '../nodes/shapeNode';
import { planQuickCreate } from '../connectors/quickCreate';
import { resolveBasicNodePresentation } from '../nodes/basicNodePresentation';
import { adoptOnInsert } from '../transforms/containment';
import { refitGroups } from './groupNodes';
import { measurePortableText } from '../text/measurement';
import type { ConnectSide } from '../connectors/connectHandles';

export type V2ShapeKind = ShapeKind;

interface V2CreateShapeOptions {
  readonly kind: V2ShapeKind;
  readonly id: string;
  readonly at: Point2d;
  readonly size?: Size2d;
  readonly label?: string;
  readonly appearance?: JsonObject;
}

// I-03: click or drag creates at the theme default size; one history entry on
// pointer-up; Escape mid-drag commits nothing (the caller drops the command).
export function buildInsertShapeCommand(
  page: ScenePage,
  options: V2CreateShapeOptions
): InsertNodeCommand {
  // Placed inside a frame, it joins the frame, as a drag in would.
  const node = adoptOnInsert(page, createShapeNode(page, options));
  return {
    kind: 'insert-node',
    id: `create-node:${node.id}`,
    label: `Create ${options.kind}`,
    pageId: page.id,
    index: page.nodes.length,
    node,
  };
}

// Free-standing text hugs its content (tldraw/Excalidraw): the box is the
// text, never a frame around it. Same font metrics the renderer uses.
export function textNodeSize(label: string, style: NodeStyle): Size2d {
  const measured = measurePortableText(label || ' ', {
    fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.fontSize * style.lineHeight,
  });
  const letterSpacing = style.letterSpacing * style.fontSize * Math.max(0, [...label].length - 1);
  return {
    width: Math.max(24, Math.ceil(measured.width + letterSpacing) + style.textPadding * 2),
    height: Math.max(24, Math.ceil(measured.height) + style.textPadding * 2),
  };
}

// I-06: completion commits exactly one set-node; empty string is a valid label.
function withoutRichLabel(content: SceneNode['content']): SceneNode['content'] {
  const { richLabel: _formatting, ...plain } = content;
  return plain;
}

export function buildSetNodeLabelCommand(
  page: ScenePage,
  nodeId: string,
  label: string
): SetNodeCommand {
  const node = page.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new RangeError(`Node "${nodeId}" was not found.`);
  return {
    kind: 'set-node',
    id: `edit-label:${nodeId}`,
    label: 'Edit label',
    pageId: page.id,
    before: node,
    after: refitIconCard({
      ...node,
      // New words are plain: the formatting set on the old ones (a rich label) doesn't carry over. The same words keep it.
      content: label === node.content.label ? node.content : withoutRichLabel({ ...node.content, label }),
      size: node.kind === 'text' ? textNodeSize(label, resolveNodeStyle(node)) : node.size,
    }, node),
  };
}

/**
 * A label edit as the person means it: the node's words, and with them its label partner's. A shape whose words sit
 * beside it (an imported picture's caption, words above a box) has them in a node of their own, marked
 * `content.labelOf` with the shape's id; editing either one changes both, in one undo step.
 */
export function buildEditLabelCommand(page: ScenePage, nodeId: string, label: string): DocumentCommand {
  const node = page.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new RangeError(`Node "${nodeId}" was not found.`);
  const owner = typeof node.content.labelOf === 'string' ? node.content.labelOf : node.id;
  const partners = page.nodes.filter((candidate) => candidate.id !== nodeId
    && (candidate.id === owner || candidate.content.labelOf === owner));
  const own = buildSetNodeLabelCommand(page, nodeId, label);
  if (!partners.length) return own;
  return {
    kind: 'batch', id: `edit-label:${nodeId}`, label: 'Edit label',
    commands: [own, ...partners.map((partner) => buildSetNodeLabelCommand(page, partner.id, label))],
  };
}

// Keyboard nudge, agent `move` and drag-move share one commit shape: snapshot,
// move, command. Null when every id is locked — style, align and icon edits skip
// locked nodes the same way, and the pointer path never picks one up at all.
export function buildMoveNodesCommand(
  page: ScenePage,
  nodeIds: readonly string[],
  delta: Point2d
): DocumentCommand | null {
  const states = buildNodeStateMap(page);
  const movable = nodeIds.filter((id) => !states.get(id)?.locked);
  if (movable.length === 0) return null;
  const snapshot = createTransformSnapshot(page, movable);
  const result = moveTransform(snapshot, delta, { snap: false });
  const fitted = refitGroups(page, transformBefore(snapshot), result.nodes);
  return createTransformCommand(page.id, fitted.before, fitted.after, 'Move selection');
}

function removeNodeCommands(
  page: ScenePage,
  nodeIds: ReadonlySet<string>
): RemoveNodeCommand[] {
  return page.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => nodeIds.has(node.id))
    .sort((left, right) => right.index - left.index)
    .map(({ node, index }) => ({
      kind: 'remove-node' as const,
      id: `delete-node:${node.id}`,
      label: 'Delete node',
      pageId: page.id,
      index,
      node,
    }));
}

function attachedConnectorIds(page: ScenePage, nodeIds: ReadonlySet<string>): Set<string> {
  const attached = new Set<string>();
  for (const connector of page.connectors) {
    if (
      (connector.source.nodeId && nodeIds.has(connector.source.nodeId)) ||
      (connector.target.nodeId && nodeIds.has(connector.target.nodeId))
    ) {
      attached.add(connector.id);
    }
  }
  return attached;
}

function removeConnectorCommands(
  page: ScenePage,
  connectorIds: ReadonlySet<string>
): RemoveConnectorCommand[] {
  return page.connectors
    .map((connector, index) => ({ connector, index }))
    .filter(({ connector }) => connectorIds.has(connector.id))
    .sort((left, right) => right.index - left.index)
    .map(({ connector, index }) => ({
      kind: 'remove-connector' as const,
      id: `delete-connector:${connector.id}`,
      label: 'Delete connector',
      pageId: page.id,
      index,
      connector,
    }));
}

// Delete removes nodes plus connectors attached only to deleted nodes (I-09
// basic); surviving connectors keep their other endpoint. Undo restores all.
export function buildDeleteSelectionCommand(
  page: ScenePage,
  nodeIds: readonly string[],
  connectorIds: readonly string[]
): BatchDocumentCommand {
  // A container takes its children with it; a dangling parentId is never stored.
  const nodes = new Set([...nodeIds, ...descendantIds(page, nodeIds)]);
  const connectors = new Set(connectorIds);
  for (const attached of attachedConnectorIds(page, nodes)) connectors.add(attached);
  const commands: DocumentCommand[] = [
    ...removeConnectorCommands(page, connectors),
    ...removeNodeCommands(page, nodes),
  ];
  if (commands.length === 0) throw new RangeError('Delete selection is empty.');
  return { kind: 'batch', id: 'delete-selection', label: 'Delete selection', commands };
}

// Duplicate remaps IDs and internal bindings atomically (I-08 basic); edges to
// omitted nodes are excluded. Offset keeps the copy visible next to the source.
export function buildDuplicateSelectionCommand(
  page: ScenePage,
  nodeIds: readonly string[],
  connectorIds: readonly string[],
  mintId: (prefix: string) => string,
  offset: Point2d = { x: 20, y: 20 }
): BatchDocumentCommand {
  // A container brings its subtree; members keep their local transform, so
  // only roots take the offset.
  const selectedNodes = new Set([...nodeIds, ...descendantIds(page, nodeIds)]);
  const selectedConnectors = new Set(connectorIds);
  const idMap = new Map<string, string>();
  for (const id of selectedNodes) idMap.set(id, mintId('node'));
  const commands: DocumentCommand[] = [];
  let nodeIndex = page.nodes.length;
  let zIndex = nextNodeZIndex(page);
  for (const node of page.nodes) {
    const copyId = idMap.get(node.id);
    if (!copyId) continue;
    const copiedParent = (node.parentId && idMap.get(node.parentId)) || null;
    // A root copy stays in its original's container: its translation is local to that parent.
    const copy: SceneNode = {
      ...node,
      id: copyId,
      parentId: copiedParent ?? node.parentId,
      zIndex: zIndex++,
      transform: {
        ...node.transform,
        translation: copiedParent ? { ...node.transform.translation } : {
          x: node.transform.translation.x + offset.x,
          y: node.transform.translation.y + offset.y,
        },
      },
      content: { ...node.content },
      appearance: { ...node.appearance },
      ports: node.ports.map((port) => ({ ...port })),
      metadata: { ...node.metadata },
      extensions: { ...node.extensions },
    };
    commands.push({
      kind: 'insert-node',
      id: `duplicate-node:${copyId}`,
      label: 'Duplicate node',
      pageId: page.id,
      index: nodeIndex,
      node: copy,
    });
    nodeIndex += 1;
  }
  let connectorIndex = page.connectors.length;
  for (const connector of page.connectors) {
    if (!selectedConnectors.has(connector.id)) continue;
    const sourceId = connector.source.nodeId;
    const targetId = connector.target.nodeId;
    if (!sourceId || !targetId || !idMap.has(sourceId) || !idMap.has(targetId)) continue;
    const copyId = mintId('connector');
    const copy: SceneConnector = {
      ...connector,
      id: copyId,
      source: { ...connector.source, nodeId: idMap.get(sourceId)! },
      target: { ...connector.target, nodeId: idMap.get(targetId)! },
      waypoints: connector.waypoints.map((point) => ({ ...point })),
      labels: connector.labels.map((label) => ({ ...label })),
      appearance: { ...connector.appearance },
      semantics: { ...connector.semantics },
      metadata: { ...connector.metadata },
      extensions: { ...connector.extensions },
    };
    commands.push({
      kind: 'insert-connector',
      id: `duplicate-connector:${copyId}`,
      label: 'Duplicate connector',
      pageId: page.id,
      index: connectorIndex,
      connector: copy,
    });
    connectorIndex += 1;
  }
  if (commands.length === 0) throw new RangeError('Duplicate selection is empty.');
  return { kind: 'batch', id: 'duplicate-selection', label: 'Duplicate selection', commands };
}

// `]` / `[`: the selection moves above or below everything else, keeping
// its own internal order. One batch, one undo.
export function buildReorderCommand(
  page: ScenePage,
  nodeIds: readonly string[],
  direction: 'front' | 'back'
): BatchDocumentCommand | null {
  const selected = new Set(nodeIds);
  const others = page.nodes.filter((node) => !selected.has(node.id)).map((node) => node.zIndex);
  const chosen = page.nodes.filter((node) => selected.has(node.id))
    .sort((left, right) => left.zIndex - right.zIndex);
  if (chosen.length === 0) throw new RangeError('Reorder selection is empty.');
  const base = direction === 'front'
    ? Math.max(-1, ...others) + 1
    : Math.min(0, ...others) - chosen.length;
  const commands: SetNodeCommand[] = chosen.flatMap((node, index) =>
    node.zIndex === base + index ? [] : [{
      kind: 'set-node' as const, id: `reorder:${node.id}`, label: 'Reorder',
      pageId: page.id, before: node, after: { ...node, zIndex: base + index },
    }]);
  // Already in front (or behind): nothing to commit, and an empty batch is not a command.
  if (commands.length === 0) return null;
  return { kind: 'batch', id: `reorder-${direction}`, label: direction === 'front' ? 'Bring to front' : 'Send to back', commands };
}

// ⌘L: lock when any selected node is unlocked, else unlock all. Locked
// nodes stay selectable (that is how they get unlocked) but never move.
export function buildToggleLockCommand(
  page: ScenePage,
  nodeIds: readonly string[]
): BatchDocumentCommand {
  const nodes = page.nodes.filter((node) => nodeIds.includes(node.id));
  if (nodes.length === 0) throw new RangeError('Lock selection is empty.');
  const lock = nodes.some((node) => node.content.sectionLocked !== true);
  return {
    kind: 'batch', id: lock ? 'lock-selection' : 'unlock-selection', label: lock ? 'Lock' : 'Unlock',
    commands: nodes.map((node) => ({
      kind: 'set-node' as const, id: `lock:${node.id}`, label: lock ? 'Lock' : 'Unlock',
      pageId: page.id, before: node,
      after: { ...node, content: { ...node.content, sectionLocked: lock } },
    })),
  };
}

/** A connector end: bound to a shape, or a free page-space point (ADR-001). */
type V2ConnectorEnd = { readonly nodeId: string } | { readonly point: Point2d };

interface V2ConnectorOptions {
  readonly id: string;
  readonly source: V2ConnectorEnd;
  readonly target: V2ConnectorEnd;
  /** Route the connector tool was armed with; orthogonal when unspecified. */
  readonly route?: ConnectorRouteKind;
  /** Authored bends for the path tool, page-space, in order. */
  readonly waypoints?: readonly Point2d[];
  /** Sticky style from the last connector edit. */
  readonly appearance?: JsonObject;
}

function connectorEndpoint(page: ScenePage, end: V2ConnectorEnd): ConnectorEndpoint {
  if ('point' in end) return { nodeId: null, portId: null, anchor: null, point: { ...end.point } };
  if (!page.nodes.some((node) => node.id === end.nodeId)) {
    throw new RangeError(`Connector end "${end.nodeId}" was not found.`);
  }
  return { nodeId: end.nodeId, portId: null, anchor: null, point: null };
}

// I-13 basic: automatic route and a target arrowhead by default; the tool
// picks the route kind and marker. Ports, labels and marker UI arrive in V2-06.
export function buildInsertConnectorCommand(
  page: ScenePage,
  options: V2ConnectorOptions
): InsertConnectorCommand {
  return {
    kind: 'insert-connector',
    id: `create-connector:${options.id}`,
    label: 'Connect',
    pageId: page.id,
    index: page.connectors.length,
    connector: {
      id: options.id,
      source: connectorEndpoint(page, options.source),
      target: connectorEndpoint(page, options.target),
      route: { kind: options.route ?? 'orthogonal', ownership: options.waypoints?.length ? 'manual' : 'automatic' },
      waypoints: options.waypoints?.map((point) => ({ ...point })) ?? [],
      labels: [],
      appearance: { markerEnd: 'arrow', ...options.appearance },
      semantics: {},
      metadata: {},
      extensions: {},
    },
  };
}

interface QuickCreateOptions {
  readonly sourceNodeId: string;
  readonly sourceSide: ConnectSide;
  readonly newNodeId: string;
  readonly connectorId: string;
  /** World release point of a handle drag; absent for a click (fixed gap). */
  readonly dropAt?: Point2d;
}

/**
 * Change shape: every unlocked basic shape in the selection takes the new
 * outline in one step. Label, size, kind (so its colour) and paint stay.
 */
export function buildSetShapeCommand(page: ScenePage, nodeIds: readonly string[], shape: ShapeKind): BatchDocumentCommand | null {
  const selected = new Set(nodeIds);
  const states = buildNodeStateMap(page);
  const commands: SetNodeCommand[] = page.nodes
    .filter((node) => {
      const current = resolveBasicNodePresentation(node)?.shape;
      return selected.has(node.id) && !states.get(node.id)?.locked && current !== undefined && current !== shape;
    })
    .map((before) => ({
      kind: 'set-node', id: `shape:${before.id}`, label: 'Change shape', pageId: page.id,
      before, after: { ...before, content: { ...before.content, shape } },
    }));
  return commands.length ? { kind: 'batch', id: 'set-shape', label: 'Change shape', commands } : null;
}

// Handle-drag released on empty canvas: new same-kind node at the fixed gap
// plus the side-bound connector as one undo step.
export function buildQuickCreateCommand(
  page: ScenePage,
  options: QuickCreateOptions
): BatchDocumentCommand {
  const plan = planQuickCreate(
    page, options.sourceNodeId, options.sourceSide, options.newNodeId, options.connectorId, options.dropAt
  );
  return {
    kind: 'batch', id: `quick-create:${plan.node.id}`, label: 'Quick create',
    commands: [
      {
        kind: 'insert-node', id: `create-node:${plan.node.id}`, label: 'Quick create',
        pageId: page.id, index: page.nodes.length, node: plan.node,
      },
      {
        kind: 'insert-connector', id: `create-connector:${plan.connector.id}`, label: 'Quick create',
        pageId: page.id, index: page.connectors.length, connector: plan.connector,
      },
    ],
  };
}


