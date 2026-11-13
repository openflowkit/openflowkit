import type {
  ConnectorEndpoint,
  ConnectorLabel,
  ConnectorRouteOwnership,
  SceneConnector,
  ScenePage,
} from '../document/types';
import { areStructurallyEqual } from '../commands/equality';
import type { SetConnectorCommand } from '../commands/types';
import { closestPointOnPolyline, dedupePolyline } from '../geometry/polyline';
import { distanceBetweenPoints } from '../geometry/point';
import type { Point2d } from '../geometry/types';
import { projectConnector } from './routeProjection';
import { connectorRichPlate } from './labelStyle';
import type { NodeStyle } from '../nodes/nodeStyle';
import type { RichBlock } from '../text/richLabel';
import type { ConnectorPathCommand } from './types';

export type ConnectorEndpointRole = 'source' | 'target';

export type ConnectorEditHandle =
  | { readonly kind: 'endpoint'; readonly role: ConnectorEndpointRole; readonly point: Point2d }
  | { readonly kind: 'waypoint'; readonly index: number; readonly point: Point2d }
  | { readonly kind: 'segment'; readonly index: number; readonly point: Point2d }
  | { readonly kind: 'control'; readonly index: 0 | 1; readonly point: Point2d };

function cubicCommand(commands: readonly ConnectorPathCommand[]) {
  return commands.find(
    (command): command is Extract<ConnectorPathCommand, { kind: 'cubic' }> =>
      command.kind === 'cubic'
  );
}

function midpoint(start: Point2d, end: Point2d): Point2d {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

/** Shorter segments (screen px) get no midpoint handle: corners and stubs would bristle with dots. */
export const MIN_SEGMENT_HANDLE_PX = 32;

export function connectorEditHandles(
  page: ScenePage,
  connector: SceneConnector,
  /** World length below which a segment shows no midpoint handle; callers pass MIN_SEGMENT_HANDLE_PX / zoom. */
  minSegment = 0
): readonly ConnectorEditHandle[] {
  const projected = projectConnector(page, connector);
  if (!projected || projected.samples.length < 2) return [];
  const first = projected.samples[0];
  const last = projected.samples.at(-1)!;
  const handles: ConnectorEditHandle[] = [
    { kind: 'endpoint', role: 'source', point: first },
    { kind: 'endpoint', role: 'target', point: last },
  ];
  if (connector.route.kind === 'bezier') {
    const cubic = cubicCommand(projected.commands);
    if (cubic) {
      handles.push(
        { kind: 'control', index: 0, point: cubic.control1 },
        { kind: 'control', index: 1, point: cubic.control2 }
      );
    }
    return handles;
  }
  connector.waypoints.forEach((point, index) => handles.push({ kind: 'waypoint', index, point }));
  for (let index = 0; index < projected.samples.length - 1; index += 1) {
    const [start, end] = [projected.samples[index]!, projected.samples[index + 1]!];
    if (Math.hypot(end.x - start.x, end.y - start.y) < minSegment) continue;
    handles.push({
      kind: 'segment',
      index,
      point: midpoint(projected.samples[index], projected.samples[index + 1]),
    });
  }
  return handles;
}

export function pickConnectorAtPoint(
  page: ScenePage,
  point: Point2d,
  tolerance: number
): string | null {
  for (const connector of [...page.connectors].reverse()) {
    if (connector.metadata.locked === true) continue;
    const projected = projectConnector(page, connector);
    const closest = projected && closestPointOnPolyline(projected.samples, point);
    if (closest && closest.distance <= tolerance) return connector.id;
    if (projected?.labels.some((label) => isPointOnConnectorLabel(label, point, projected.presentation.label))) return connector.id;
  }
  return null;
}

/** The label plate is part of the connector: clicking it selects, double-clicking edits. */
function isPointOnConnectorLabel(
  label: { readonly text: string; readonly point: Point2d; readonly rich?: readonly RichBlock[] | null },
  point: Point2d,
  style: NodeStyle
): boolean {
  // Formatted words are picked by the plate they are drawn on.
  if (label.rich) {
    const plate = connectorRichPlate(label.rich, style, label.point);
    return point.x >= plate.x && point.x <= plate.x + plate.width && point.y >= plate.y && point.y <= plate.y + plate.height;
  }
  // ponytail: 7px per glyph approximates Inter 500 12px; measure in the renderer if it misses.
  const halfWidth = label.text.length * 7 / 2 + 5;
  return Math.abs(point.x - label.point.x) <= halfWidth && Math.abs(point.y - label.point.y) <= 10;
}

export function pickConnectorEditHandle(
  handles: readonly ConnectorEditHandle[],
  point: Point2d,
  tolerance: number
): ConnectorEditHandle | null {
  const ordered = [...handles].sort((left, right) => {
    const priority = { endpoint: 0, waypoint: 1, control: 2, segment: 3 } as const;
    return priority[left.kind] - priority[right.kind];
  });
  return ordered.find((handle) => distanceBetweenPoints(handle.point, point) <= tolerance) ?? null;
}

function manualConnector(
  connector: SceneConnector,
  waypoints: readonly Point2d[],
  kind = connector.route.kind,
  ownership: ConnectorRouteOwnership = 'manual'
): SceneConnector {
  return {
    ...connector,
    route: { kind, ownership },
    waypoints: dedupePolyline(waypoints),
  };
}

// Dragging a segment slides it along its normal. Only that segment's two
// corners become waypoints (plus any the user placed before): the rest of
// the route stays automatic, so the ends still re-link when a node moves.
function moveSegment(
  page: ScenePage,
  connector: SceneConnector,
  segmentIndex: number,
  pointer: Point2d
): SceneConnector {
  const projected = projectConnector(page, connector);
  const samples = projected?.samples;
  if (!samples || segmentIndex < 0 || segmentIndex >= samples.length - 1) return connector;
  const start = samples[segmentIndex];
  const end = samples[segmentIndex + 1];
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const shifted = [
    horizontal ? { x: start.x, y: pointer.y } : { x: pointer.x, y: start.y },
    horizontal ? { x: end.x, y: pointer.y } : { x: pointer.x, y: end.y },
  ];
  const points = samples.map((point, index) =>
    index === segmentIndex ? shifted[0] : index === segmentIndex + 1 ? shifted[1] : point);
  const kept = new Set<Point2d>(shifted);
  const authored = connector.waypoints;
  const waypoints = points.filter((point, index) =>
    kept.has(point) || (index > 0 && index < points.length - 1
      && authored.some((existing) => existing.x === point.x && existing.y === point.y)));
  const kind = connector.route.kind === 'orthogonal' ? 'orthogonal' : 'polyline';
  return manualConnector(connector, waypoints, kind, 'hybrid');
}

function moveBezierControl(
  page: ScenePage,
  connector: SceneConnector,
  index: 0 | 1,
  pointer: Point2d
): SceneConnector {
  const projected = projectConnector(page, connector);
  const cubic = projected && cubicCommand(projected.commands);
  if (!cubic) return connector;
  const controls = [cubic.control1, cubic.control2];
  controls[index] = pointer;
  return manualConnector(connector, controls, 'bezier');
}

export function moveConnectorHandle(
  page: ScenePage,
  connector: SceneConnector,
  handle: ConnectorEditHandle,
  pointer: Point2d
): SceneConnector {
  switch (handle.kind) {
    case 'endpoint':
      return connector;
    case 'waypoint': {
      if (!connector.waypoints[handle.index]) return connector;
      const waypoints = [...connector.waypoints];
      waypoints[handle.index] = pointer;
      return manualConnector(connector, waypoints, connector.route.kind, 'hybrid');
    }
    case 'segment':
      return moveSegment(page, connector, handle.index, pointer);
    case 'control':
      return moveBezierControl(page, connector, handle.index, pointer);
  }
}

export function addConnectorWaypoint(
  page: ScenePage,
  connector: SceneConnector,
  pointer: Point2d
): SceneConnector {
  const projected = projectConnector(page, connector);
  const closest = projected && closestPointOnPolyline(projected.samples, pointer);
  if (!projected || !closest || connector.route.kind === 'bezier') return connector;
  const points = [...projected.samples];
  points.splice(closest.segmentIndex + 1, 0, pointer);
  const kind = connector.route.kind === 'orthogonal' ? 'orthogonal' : 'polyline';
  return manualConnector(connector, dedupePolyline(points).slice(1, -1), kind, 'hybrid');
}

export function removeConnectorWaypoint(
  connector: SceneConnector,
  waypointIndex: number
): SceneConnector {
  if (!connector.waypoints[waypointIndex]) return connector;
  const waypoints = connector.waypoints.filter((_, index) => index !== waypointIndex);
  if (waypoints.length === 0) return resetConnectorRoute(connector);
  return manualConnector(connector, waypoints);
}

export function resetConnectorRoute(connector: SceneConnector): SceneConnector {
  return {
    ...connector,
    route: { ...connector.route, ownership: 'automatic' },
    waypoints: [],
  };
}

/** New words drop the old ones' formatting, as a node's label does. */
function withoutFormatting(label: ConnectorLabel): ConnectorLabel {
  const { richLabel: _formatting, ...plain } = label;
  return plain;
}

export function setPrimaryConnectorLabel(
  connector: SceneConnector,
  text: string
): SceneConnector {
  const normalized = text.trim();
  if (!normalized) return { ...connector, labels: connector.labels.slice(1) };
  const current = connector.labels[0];
  const label = current
    ? { ...withoutFormatting(current), text: normalized }
    : {
        id: `${connector.id}:label`, text: normalized, pathRatio: 0.5,
        offset: { x: 0, y: -14 }, metadata: {},
      };
  return { ...connector, labels: [label, ...connector.labels.slice(1)] };
}

export function reconnectConnector(
  connector: SceneConnector,
  role: ConnectorEndpointRole,
  endpoint: ConnectorEndpoint
): SceneConnector {
  return {
    ...resetConnectorRoute(connector),
    [role]: endpoint,
  };
}

export function createConnectorEditCommand(
  pageId: string,
  before: SceneConnector,
  after: SceneConnector,
  label: string
): SetConnectorCommand | null {
  if (areStructurallyEqual(before, after)) return null;
  return {
    kind: 'set-connector',
    id: `connector-edit:${before.id}`,
    label,
    pageId,
    before,
    after,
  };
}
