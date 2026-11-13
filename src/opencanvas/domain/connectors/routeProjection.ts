import type { SceneConnector, SceneNode, ScenePage } from '../document/types';
import { applyMatrixToPoint } from '../geometry/matrix';
import { pointAtPolylineRatio } from '../geometry/polyline';
import type { Bounds2d, Matrix2d, Point2d } from '../geometry/types';
import { connectorLabelPlate } from './labelStyle';
import { richLabelOf } from '../text/richLabel';
import { transformBounds } from '../geometry/matrix';
import { containerTextBounds } from '../nodes/nodeLabelBounds';
import { buildNodeWorldMatrices, nodeWorldBounds, nodeWorldCenter } from '../scene/worldGeometry';
import { resolveSequenceNodePresentation, SEQUENCE_ACTIVATION_WIDTH } from '../nodes/sequenceNodePresentation';
import { resolveConnectorPresentation } from './presentation';
import { routeOrthogonalBetweenSides } from './obstacleRouting';
import type { ProjectedConnector } from './types';
import { clearLabelPoint } from './routeLabels';
import { connectWorldBounds, endpointPoint, orthogonalEnd, pointBounds, spreadEnds, type SpreadEnd } from './routeEnds';
import {
  connectorPath,
  linearPath,
  linkOrthogonal,
  midShift,
  selfLoopPath,
  shiftInteriorOrthogonal,
} from './routePaths';

interface ConnectorProjectionContext {
  readonly nodesById: ReadonlyMap<string, SceneNode>;
  readonly matrices: ReadonlyMap<string, Matrix2d>;
  readonly lateralByConnectorId: ReadonlyMap<string, number>;
  /** Keyed `${connectorId}:source|target`. */
  readonly spreadByEnd: ReadonlyMap<string, SpreadEnd>;
  /** Nodes a label must not cover: every node but the containers, which a label may sit inside, and their header text. */
  readonly labelObstacles: () => readonly Bounds2d[];
  /** The words of every container's header and tag, world-space: a line may cross the band, never read through a name. */
  readonly headerText: () => readonly Bounds2d[];
}

const SEQUENCE_PARTICIPANT_HEADER_HEIGHT = 48;
const SEQUENCE_ACTOR_HEIGHT = 40;
const SEQUENCE_MESSAGE_OFFSET = 44;
const SEQUENCE_MESSAGE_SPACING = 52;

function createConnectorProjectionContext(page: ScenePage): ConnectorProjectionContext {
  const nodesById = new Map(page.nodes.map((node) => [node.id, node]));
  const matrices = buildNodeWorldMatrices(page);
  let labelObstacles: readonly Bounds2d[] | null = null;
  let headerText: readonly Bounds2d[] | null = null;
  const headers = () => headerText ??= page.nodes.filter((node) => matrices.has(node.id))
    .flatMap((node) => containerTextBounds(node).map((box) => transformBounds(matrices.get(node.id)!, box)));
  return {
    nodesById, matrices,
    lateralByConnectorId: parallelLateralOffsets(page.connectors),
    spreadByEnd: spreadEnds(page.connectors, nodesById, matrices),
    headerText: headers,
    labelObstacles: () => {
      if (labelObstacles) return labelObstacles;
      const parents = new Set(page.nodes.map((node) => node.parentId));
      labelObstacles = [
        ...page.nodes.filter((node) => !parents.has(node.id) && matrices.has(node.id))
          .map((node) => nodeWorldBounds(node, matrices.get(node.id)!)),
        ...headers(),
      ];
      return labelObstacles;
    },
  };
}

// Parallel (and reverse) edges between the same node pair fan out so none
// hides behind another: member i rides (i-(n-1)/2)×12 px off the lane,
// endpoints pinned to their ports. Free ends never group.
const PARALLEL_EDGE_OFFSET_PX = 12;

function parallelLateralOffsets(connectors: readonly SceneConnector[]): ReadonlyMap<string, number> {
  const groups = new Map<string, SceneConnector[]>();
  for (const connector of connectors) {
    if (!connector.source.nodeId || !connector.target.nodeId) continue;
    // Sequence messages already sit on their own rows; fanning them bends each into a V.
    if (typeof connector.semantics.seqMessageKind === 'string') continue;
    // A fixed route is drawn where it was saved: its bends are its own, not a lane to step aside in.
    if (connector.route.ownership === 'imported-fixed') continue;
    const key = [connector.source.nodeId, connector.target.nodeId].sort().join('→');
    const group = groups.get(key);
    if (group) group.push(connector);
    else groups.set(key, [connector]);
  }
  const offsets = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.forEach((connector, index) => {
      offsets.set(connector.id, (index - (group.length - 1) / 2) * PARALLEL_EDGE_OFFSET_PX);
    });
  }
  return offsets;
}

function onActivationBar(node: SceneNode, order: number): boolean {
  const presentation = resolveSequenceNodePresentation(node);
  return presentation?.kind === 'sequence_participant'
    && presentation.activations.some(({ startOrder, endOrder }) => order >= startOrder && order <= endOrder);
}

function sequenceMessageEndpoints(
  connector: SceneConnector,
  sourceNode: SceneNode,
  targetNode: SceneNode,
  sourceMatrix: Matrix2d,
  targetMatrix: Matrix2d
): { readonly start: Point2d; readonly end: Point2d } | null {
  if (
    sourceNode.kind !== 'sequence_participant' ||
    targetNode.kind !== 'sequence_participant' ||
    typeof connector.semantics.seqMessageKind !== 'string'
  ) {
    return null;
  }
  // A row (fractional: notes above it take room) wins over the bare message order.
  const row = connector.semantics.seqMessageRow;
  const sequenceOrder = typeof row === 'number' && Number.isFinite(row) ? Math.max(0, row)
    : typeof connector.semantics.seqMessageOrder === 'number' &&
    Number.isFinite(connector.semantics.seqMessageOrder)
      ? Math.max(0, Math.floor(connector.semantics.seqMessageOrder))
      : 0;
  const sourceHeaderHeight =
    SEQUENCE_PARTICIPANT_HEADER_HEIGHT +
    (sourceNode.content.seqParticipantKind === 'actor' ? SEQUENCE_ACTOR_HEIGHT : 0);
  const targetHeaderHeight =
    SEQUENCE_PARTICIPANT_HEADER_HEIGHT +
    (targetNode.content.seqParticipantKind === 'actor' ? SEQUENCE_ACTOR_HEIGHT : 0);
  const sourceHeader = applyMatrixToPoint(sourceMatrix, {
    x: sourceNode.size.width / 2,
    y: sourceHeaderHeight,
  });
  const targetHeader = applyMatrixToPoint(targetMatrix, {
    x: targetNode.size.width / 2,
    y: targetHeaderHeight,
  });
  // A bar is drawn over its lane, so a head that stopped on the lane's centre ended half under it.
  // A message on a bar starts or ends on the bar's edge, the side facing the other lane (a self loop leaves right).
  const facing = sourceNode.id === targetNode.id ? 1 : Math.sign(targetHeader.x - sourceHeader.x);
  const sourceEdge = onActivationBar(sourceNode, sequenceOrder) ? facing * SEQUENCE_ACTIVATION_WIDTH / 2 : 0;
  const targetEdge = onActivationBar(targetNode, sequenceOrder) ? -facing * SEQUENCE_ACTIVATION_WIDTH / 2 : 0;
  const y =
    Math.max(sourceHeader.y, targetHeader.y) +
    SEQUENCE_MESSAGE_OFFSET +
    sequenceOrder * SEQUENCE_MESSAGE_SPACING;
  return {
    start: { x: sourceHeader.x + sourceEdge, y },
    end: { x: targetHeader.x + targetEdge, y },
  };
}


function orthogonalPath(
  connector: SceneConnector,
  sourceNode: SceneNode | undefined,
  sourceMatrix: Matrix2d | undefined,
  targetNode: SceneNode | undefined,
  targetMatrix: Matrix2d | undefined,
  context: ConnectorProjectionContext
): readonly Point2d[] | null {
  const sourceBounds = sourceNode && sourceMatrix ? connectWorldBounds(sourceNode, sourceMatrix)
    : connector.source.point ? pointBounds(connector.source.point) : null;
  const targetBounds = targetNode && targetMatrix ? connectWorldBounds(targetNode, targetMatrix)
    : connector.target.point ? pointBounds(connector.target.point) : null;
  if (!sourceBounds || !targetBounds) return null;
  const first = connector.waypoints[0];
  const last = connector.waypoints.at(-1);
  // Only a route the router lays out steers its ends clear of header text; the user's corners stay theirs.
  const headers = connector.waypoints.length > 0 ? [] : context.headerText();
  const start = orthogonalEnd(connector.source, sourceNode, sourceMatrix, first ? pointBounds(first) : targetBounds,
    context.spreadByEnd.get(`${connector.id}:source`), headers);
  const end = orthogonalEnd(connector.target, targetNode, targetMatrix, last ? pointBounds(last) : sourceBounds,
    context.spreadByEnd.get(`${connector.id}:target`), headers);
  if (!start || !end) return null;
  if (connector.waypoints.length > 0) return linkOrthogonal(start, connector.waypoints, end);
  // Every node is an obstacle, the endpoints' own included: that is what
  // keeps a lane from doubling back through the shape it just left.
  const obstacles: Bounds2d[] = [...context.headerText()];
  for (const node of context.nodesById.values()) {
    obstacles.push(nodeWorldBounds(node, context.matrices.get(node.id)!));
  }
  return routeOrthogonalBetweenSides(start.point, start.side, end.point, end.side, obstacles,
    midShift(start, end));
}

function draftConnector(
  connector: SceneConnector,
  context: ConnectorProjectionContext
): ConnectorDraft | null {
  if (connector.metadata.hidden === true) return null;
  const sourceNode =
    connector.source.nodeId === null ? undefined : context.nodesById.get(connector.source.nodeId);
  const targetNode =
    connector.target.nodeId === null ? undefined : context.nodesById.get(connector.target.nodeId);
  const sourceMatrix = sourceNode ? context.matrices.get(sourceNode.id) : undefined;
  const targetMatrix = targetNode ? context.matrices.get(targetNode.id) : undefined;
  if (sourceNode && !sourceMatrix) return null;
  if (targetNode && !targetMatrix) return null;
  // Free ends resolve to their page-space point; bound ends resolve against
  // the opposite center exactly as before. Missing data yields no geometry.
  const sourceCenter =
    sourceNode && sourceMatrix ? nodeWorldCenter(sourceNode, sourceMatrix) : null;
  const targetCenter =
    targetNode && targetMatrix ? nodeWorldCenter(targetNode, targetMatrix) : null;
  const sourceToward = targetCenter ?? connector.target.point;
  const targetToward = sourceCenter ?? connector.source.point;
  if (!sourceToward || !targetToward) return null;
  const sequenceEndpoints =
    sourceNode && targetNode && sourceMatrix && targetMatrix
      ? sequenceMessageEndpoints(connector, sourceNode, targetNode, sourceMatrix, targetMatrix)
      : null;
  const start =
    sequenceEndpoints?.start ??
    connector.source.point ??
    (sourceNode && sourceMatrix
      ? endpointPoint(connector.source, sourceNode, sourceMatrix, sourceToward)
      : null);
  const end =
    sequenceEndpoints?.end ??
    connector.target.point ??
    (targetNode && targetMatrix
      ? endpointPoint(connector.target, targetNode, targetMatrix, targetToward)
      : null);
  if (!start || !end) return null;
  const orthogonal = connector.route.kind === 'orthogonal' && !sequenceEndpoints
    && !(sourceNode && targetNode && sourceNode.id === targetNode.id)
    ? orthogonalPath(connector, sourceNode, sourceMatrix, targetNode, targetMatrix, context)
    : null;
  const path = orthogonal ? linearPath(orthogonal) :
    sequenceEndpoints && sourceNode && targetNode && sourceNode.id === targetNode.id
      ? linearPath([
          start,
          { x: start.x + 56, y: start.y },
          { x: start.x + 56, y: start.y + 28 },
          { x: start.x, y: start.y + 28 },
        ])
      : sourceNode && sourceMatrix && targetNode && sourceNode.id === targetNode.id
          && connector.route.ownership === 'automatic'
          && connector.waypoints.length === 0
        ? selfLoopPath(connector, sourceNode, sourceMatrix)
        : connectorPath(connector, start, end);
  const lateral = context.lateralByConnectorId.get(connector.id) ?? 0;
  // Reverse edges fan with the group: canonical normal runs from the
  // lexicographically smaller endpoint, regardless of edge direction.
  const flipNormal = !!connector.source.nodeId && !!connector.target.nodeId
    && connector.source.nodeId > connector.target.nodeId;
  const samples = shiftInteriorOrthogonal(path.samples, lateral, flipNormal);
  const presentation = resolveConnectorPresentation(connector);
  return {
    connector, start, commands: path.commands, samples, presentation,
    // An automatic route's labels step off whatever they would cover; a placed route's stay put.
    steersLabels: orthogonal !== null && connector.waypoints.length === 0,
  };
}

/** A connector's route and look: everything but where its labels sit, which needs the whole page. */
interface ConnectorDraft {
  readonly connector: SceneConnector;
  readonly start: Point2d;
  readonly commands: ProjectedConnector['commands'];
  readonly samples: readonly Point2d[];
  readonly presentation: ProjectedConnector['presentation'];
  readonly steersLabels: boolean;
}

/**
 * Where every label of a page sits, keyed `${connectorId}:${labelId}`. A label the user placed, or on
 * a route they drew, stays where it is and is taken from the start; the rest are placed in connector
 * order, each placed plate an obstacle for the next, so no two labels cover each other or a node.
 * ponytail: O(labels × candidates × (nodes + labels)); a grid over the plates if a page ever needs it.
 */
function placeLabels(drafts: readonly ConnectorDraft[], leaves: readonly Bounds2d[]): ReadonlyMap<string, Point2d> {
  const points = new Map<string, Point2d>();
  const taken: Bounds2d[] = [...leaves];
  const free: { key: string; text: string; pathRatio: number; draft: ConnectorDraft }[] = [];
  for (const draft of drafts) {
    for (const label of draft.connector.labels) {
      const key = `${draft.connector.id}:${label.id}`;
      if (draft.steersLabels && label.text && label.offset.x === 0 && label.offset.y === 0) {
        free.push({ key, text: label.text, pathRatio: label.pathRatio, draft });
        continue;
      }
      const at = pointAtPolylineRatio(draft.samples, label.pathRatio) ?? draft.start;
      const point = { x: at.x + label.offset.x, y: at.y + label.offset.y };
      points.set(key, point);
      if (label.text) taken.push(connectorLabelPlate(label.text, draft.presentation.label, point));
    }
  }
  for (const { key, text, pathRatio, draft } of free) {
    const plate = (words: string, at: Point2d) => connectorLabelPlate(words, draft.presentation.label, at);
    const others = drafts.filter((other) => other !== draft).map((other) => other.samples);
    const point = clearLabelPoint(text, pathRatio, draft.samples, taken, plate, others) ?? draft.start;
    points.set(key, point);
    taken.push(plate(text, point));
  }
  return points;
}

function finishConnector(draft: ConnectorDraft, points: ReadonlyMap<string, Point2d>): ProjectedConnector {
  const { connector } = draft;
  return {
    id: connector.id,
    commands: draft.commands,
    samples: draft.samples,
    labels: connector.labels.map((label) => ({ id: label.id, text: label.text, point: points.get(`${connector.id}:${label.id}`) ?? draft.start, rich: richLabelOf({ richLabel: label.richLabel }) })),
    presentation: draft.presentation,
  };
}

export function projectConnector(
  page: ScenePage,
  connector: SceneConnector
): ProjectedConnector | null {
  return projectConnectors(page, [connector])[0] ?? null;
}

export function projectPageConnectors(page: ScenePage): readonly ProjectedConnector[] {
  return projectConnectors(page, page.connectors);
}

/**
 * Some of a page's connectors, sharing one projection context. Their labels are placed among
 * themselves: ask for the whole page to place them among every label on it.
 */
export function projectConnectors(page: ScenePage, connectors: readonly SceneConnector[]): readonly ProjectedConnector[] {
  const context = createConnectorProjectionContext(page);
  const drafts = connectors.flatMap((connector) => draftConnector(connector, context) ?? []);
  const points = placeLabels(drafts, context.labelObstacles());
  return drafts.map((draft) => finishConnector(draft, points));
}

export { clearLabelPoint };
