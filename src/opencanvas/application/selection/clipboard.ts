import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneConnector, SceneNode, ScenePage } from '../../domain/document/types';
import type { Bounds2d, Point2d } from '../../domain/geometry/types';
import { intersectsBounds, unionBounds } from '../../domain/geometry/bounds';
import { applyMatrixToPoint, invertMatrix } from '../../domain/geometry/matrix';
import { buildNodeWorldMatrices } from '../../domain/scene/worldGeometry';

const PASTE_STEP = { x: 24, y: 24 };

/**
 * Where a paste goes: a step off the copied shapes, back in the containers they came from (⌘D's rule), while that
 * spot is in `view` (world); else the middle of the view, on the page, so a paste never lands out of sight (Figma, tldraw).
 * ponytail: roots' unrotated boxes; a copied rotated shape centres by its unrotated box.
 */
export function pastePlacement(snapshot: ProductionClipboardSnapshot, view: Bounds2d): PastePlacement {
  const ids = new Set(snapshot.nodes.map(({ id }) => id));
  const boxes = snapshot.nodes.filter((node) => !node.parentId || !ids.has(node.parentId)).map(({ transform, size }) => ({
    x: transform.translation.x, y: transform.translation.y,
    width: size.width * transform.scale.x, height: size.height * transform.scale.y,
  }));
  // Connectors' free ends and bends count too: arrows copied in Excalidraw without their shapes have nothing else.
  for (const { source, target, waypoints } of snapshot.connectors) {
    const free = [source, target].flatMap((end) => (end.nodeId === null && end.point ? [end.point] : []));
    for (const point of [...free, ...waypoints]) boxes.push({ x: point.x, y: point.y, width: 0, height: 0 });
  }
  if (boxes.length === 0) return STEP_PLACEMENT;
  const box = boxes.slice(1).reduce(unionBounds, boxes[0]!);
  const stepped = { ...box, x: box.x + PASTE_STEP.x, y: box.y + PASTE_STEP.y };
  if (intersectsBounds(stepped, view)) return STEP_PLACEMENT;
  return {
    offset: { x: view.x + view.width / 2 - (box.x + box.width / 2), y: view.y + view.height / 2 - (box.y + box.height / 2) },
    keepParents: false,
  };
}

const STEP_PLACEMENT: PastePlacement = { offset: PASTE_STEP, keepParents: true };

export interface ProductionClipboardSnapshot {
  readonly version: 1;
  /** Copied roots sit on the page at their canvas position (`parentId` null); their members keep local transforms. */
  readonly nodes: readonly SceneNode[];
  readonly connectors: readonly SceneConnector[];
  /** The container each root was copied out of, by root id: a paste in view goes back into it, as ⌘D does. */
  readonly parents?: Readonly<Record<string, string>>;
}

/** How a paste is placed: moved by `offset` (world), and back into the copied roots' containers or not. */
export interface PastePlacement {
  readonly offset: Point2d;
  readonly keepParents: boolean;
}

type ClipboardIdFactory = (kind: 'node' | 'connector', sourceId: string) => string;

function selectedTreeIds(page: ScenePage, selectedNodeIds: readonly string[]): Set<string> {
  const ids = new Set(selectedNodeIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of page.nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id); changed = true;
      }
    }
  }
  return ids;
}

export function copyProductionSelection(
  page: ScenePage,
  selectedNodeIds: readonly string[]
): ProductionClipboardSnapshot {
  const ids = selectedTreeIds(page, selectedNodeIds);
  if (ids.size === 0) throw new TypeError('Copy requires at least one selected node.');
  const copied = page.nodes.filter(({ id }) => ids.has(id));
  if (copied.length !== ids.size) throw new RangeError('Copy selection contains an unknown node.');
  // A root copied out of a container is stored at its canvas position: its own translation is local to a parent
  // the clipboard does not carry.
  const matrices = buildNodeWorldMatrices(page);
  const parents: Record<string, string> = {};
  const nodes = copied.map((node) => {
    if (!node.parentId || ids.has(node.parentId)) return node;
    parents[node.id] = node.parentId;
    const origin = applyMatrixToPoint(matrices.get(node.id)!, { x: 0, y: 0 });
    return { ...node, parentId: null, transform: { ...node.transform, translation: origin } };
  });
  const connectors = page.connectors.filter(({ source, target }) =>
    ids.has(source.nodeId) && ids.has(target.nodeId));
  return { version: 1, nodes, connectors, ...(Object.keys(parents).length > 0 ? { parents } : {}) };
}

export function buildPasteProductionSelectionCommand(
  page: ScenePage,
  snapshot: ProductionClipboardSnapshot,
  createId: ClipboardIdFactory,
  placement: PastePlacement = STEP_PLACEMENT
): { readonly command: DocumentCommand; readonly pastedNodeIds: readonly string[]; readonly pastedConnectorIds: readonly string[] } {
  const { offset, keepParents } = placement;
  const matrices = buildNodeWorldMatrices(page);
  if (snapshot.version !== 1 || snapshot.nodes.length + snapshot.connectors.length === 0) throw new TypeError('Clipboard is empty or unsupported.');
  const occupied = new Set([
    ...page.nodes.map(({ id }) => id), ...page.connectors.map(({ id }) => id),
  ]);
  const nodeIds = new Map<string, string>();
  for (const node of snapshot.nodes) {
    const id = createId('node', node.id);
    if (!id || occupied.has(id)) throw new TypeError('Paste ids must be unique.');
    occupied.add(id);
    nodeIds.set(node.id, id);
  }
  // Pasted shapes go on top, in their copied order: found once, not per shape (a whole drawing pastes at once).
  const top = page.nodes.reduce((highest, { zIndex }) => Math.max(highest, zIndex), 0);
  const commands: DocumentCommand[] = snapshot.nodes.map((node, index) => {
    const pastedParent = node.parentId && nodeIds.has(node.parentId) ? nodeIds.get(node.parentId)! : null;
    // Members keep their local transform; only roots take the offset, on the canvas, then go back into the
    // container they were copied from when it is still on this page.
    const world = { x: node.transform.translation.x + offset.x, y: node.transform.translation.y + offset.y };
    const home = keepParents ? snapshot.parents?.[node.id] : undefined;
    const inverse = home && matrices.has(home) ? invertMatrix(matrices.get(home)!) : null;
    const pasted: SceneNode = {
      ...structuredClone(node), id: nodeIds.get(node.id)!,
      parentId: pastedParent ?? (inverse ? home! : null),
      zIndex: top + index + 1,
      transform: { ...node.transform, translation: pastedParent ? { ...node.transform.translation }
        : inverse ? applyMatrixToPoint(inverse, world) : world },
    };
    return { kind: 'insert-node', id: `paste-node:${pasted.id}`, label: 'Paste node',
      pageId: page.id, index: page.nodes.length + index, node: pasted };
  });
  // A free end (no node) keeps its null and moves with the paste, as do the connector's bends.
  const end = (endpoint: SceneConnector['source']): SceneConnector['source'] => endpoint.nodeId === null
    ? { ...endpoint, point: endpoint.point && { x: endpoint.point.x + offset.x, y: endpoint.point.y + offset.y } }
    : { ...endpoint, nodeId: nodeIds.get(endpoint.nodeId)! };
  const connectorIds: string[] = [];
  for (const connector of snapshot.connectors) {
    const id = createId('connector', connector.id);
    if (!id || occupied.has(id)) throw new TypeError('Paste ids must be unique.');
    occupied.add(id);
    connectorIds.push(id);
    const pasted: SceneConnector = {
      ...structuredClone(connector), id, source: end(connector.source), target: end(connector.target),
      waypoints: connector.waypoints.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y })),
    };
    commands.push({ kind: 'insert-connector', id: `paste-connector:${id}`, label: 'Paste connector',
      pageId: page.id, index: page.connectors.length + commands.length - snapshot.nodes.length,
      connector: pasted });
  }
  return { command: { kind: 'batch', id: 'paste-selection', label: 'Paste selection', commands },
    pastedNodeIds: [...nodeIds.values()], pastedConnectorIds: connectorIds };
}
