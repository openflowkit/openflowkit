import type { SceneConnector, SceneNode } from '../document/types';
import { applyMatrixToPoint } from '../geometry/matrix';
import { dedupePolyline, roundPolylineCorners } from '../geometry/polyline';
import { distanceBetweenPoints } from '../geometry/point';
import type { Matrix2d, Point2d } from '../geometry/types';
import { dropCollinear } from './obstacleRouting';
import { type ConnectSide } from './connectHandles';
import type { ConnectorPathCommand } from './types';
import { anchorLocalPoint, type OrthogonalEnd } from './routeEnds';

export function shiftInteriorOrthogonal(
  samples: readonly Point2d[],
  offset: number,
  flipNormal: boolean
): readonly Point2d[] {
  if (samples.length < 2 || offset === 0) return samples;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-9)) return samples;
  const sign = flipNormal ? -1 : 1;
  const shift = { x: (-dy / length) * offset * sign, y: (dx / length) * offset * sign };
  if (samples.length === 2) {
    return [first, { x: (first.x + last.x) / 2 + shift.x, y: (first.y + last.y) / 2 + shift.y }, last];
  }
  return samples.map((point, index) =>
    index === 0 || index === samples.length - 1
      ? point
      : { x: point.x + shift.x, y: point.y + shift.y }
  );
}

// Hybrid routes keep the user's corners and re-link both ends every frame:
// a diagonal hop between consecutive points gets one elbow, chosen so the
// segment touching a node stays perpendicular to that node's side.
export function linkOrthogonal(
  start: OrthogonalEnd,
  waypoints: readonly Point2d[],
  end: OrthogonalEnd
): readonly Point2d[] {
  const points = [start.point, ...waypoints, end.point];
  const linked: Point2d[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from.x !== to.x && from.y !== to.y) {
      const verticalFirst = index === 1
        ? start.side === 'top' || start.side === 'bottom'
        : index === points.length - 1
          ? end.side === 'left' || end.side === 'right'
          : false;
      linked.push(verticalFirst ? { x: from.x, y: to.y } : { x: to.x, y: from.y });
    }
    linked.push(to);
  }
  return dropCollinear(dedupePolyline(linked));
}

function cubicPoint(
  start: Point2d,
  control1: Point2d,
  control2: Point2d,
  end: Point2d,
  ratio: number
): Point2d {
  const inverse = 1 - ratio;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * ratio * control1.x +
      3 * inverse * ratio ** 2 * control2.x +
      ratio ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * ratio * control1.y +
      3 * inverse * ratio ** 2 * control2.y +
      ratio ** 3 * end.y,
  };
}

export function bezierPath(
  start: Point2d,
  end: Point2d,
  authoredControls: readonly Point2d[]
): {
  commands: readonly ConnectorPathCommand[];
  samples: readonly Point2d[];
} {
  const distance = distanceBetweenPoints(start, end);
  const reach = Math.min(180, Math.max(40, distance * 0.4));
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const direction = horizontal
    ? { x: Math.sign(end.x - start.x) || 1, y: 0 }
    : { x: 0, y: Math.sign(end.y - start.y) || 1 };
  const control1 = authoredControls[0] ?? {
    x: start.x + direction.x * reach,
    y: start.y + direction.y * reach,
  };
  const control2 = authoredControls[1] ?? {
    x: end.x - direction.x * reach,
    y: end.y - direction.y * reach,
  };
  return {
    commands: [
      { kind: 'move', point: start },
      { kind: 'cubic', control1, control2, point: end },
    ],
    samples: Array.from({ length: 25 }, (_, index) =>
      cubicPoint(start, control1, control2, end, index / 24)
    ),
  };
}

export function linearPath(points: readonly Point2d[]): {
  commands: readonly ConnectorPathCommand[];
  samples: readonly Point2d[];
} {
  const samples = dedupePolyline(points);
  return {
    commands: samples.map((point, index) => ({ kind: index === 0 ? 'move' : 'line', point })),
    samples,
  };
}

export function selfLoopPath(
  connector: SceneConnector,
  node: SceneNode,
  matrix: Matrix2d
): ReturnType<typeof linearPath> {
  const sourcePort = node.ports.find((port) => port.id === connector.source.portId);
  const targetPort = node.ports.find((port) => port.id === connector.target.portId);
  const sourceAnchor = connector.source.anchor ?? sourcePort?.anchor
    ?? { kind: 'side', side: 'right', ratio: 0.3 } as const;
  const targetAnchor = connector.target.anchor ?? targetPort?.anchor
    ?? { kind: 'side', side: 'right', ratio: 0.7 } as const;
  const start = anchorLocalPoint(node, sourceAnchor);
  const end = anchorLocalPoint(node, targetAnchor);
  const margin = 48;
  // Both ends on one side: a bump out of that side and back, never across the node.
  if (sourceAnchor.kind === 'side' && targetAnchor.kind === 'side' && sourceAnchor.side === targetAnchor.side) {
    const out = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } }[sourceAnchor.side];
    const bump = (point: Point2d) => ({ x: point.x + out.x * margin, y: point.y + out.y * margin });
    return linearPath([start, bump(start), bump(end), end].map((point) => applyMatrixToPoint(matrix, point)));
  }
  return linearPath([
    start,
    { x: node.size.width + margin, y: start.y },
    { x: node.size.width + margin, y: -margin },
    { x: -margin, y: -margin },
    { x: -margin, y: end.y },
    end,
  ].map((point) => applyMatrixToPoint(matrix, point)));
}

export function connectorPath(
  connector: SceneConnector,
  start: Point2d,
  end: Point2d
): ReturnType<typeof linearPath> {
  switch (connector.route.kind) {
    case 'direct':
      return linearPath([start, end]);
    case 'polyline':
      return linearPath([start, ...connector.waypoints, end]);
    case 'orthogonal':
      return linearPath([start, ...connector.waypoints, end]);
    case 'bezier':
      return bezierPath(start, end, connector.waypoints);
  }
}

/**
 * Where a Z's middle run sits off centre, along the route. Ends that sit off their side's
 * middle (spread, or anchored by hand) turn in nested order: the exit farthest from where
 * its partner lies turns farthest from its own node, so the shapes nest instead of sharing
 * a run or crossing.
 */
export function midShift(start: OrthogonalEnd, end: OrthogonalEnd): number {
  const across = (side: ConnectSide | null) => (side === 'left' || side === 'right' ? 'y' : 'x');
  const toward = (from: Point2d, to: Point2d, side: ConnectSide | null) => Math.sign(to[across(side)] - from[across(side)]);
  const along = start.side === 'left' || start.side === 'right' ? 'x' : 'y';
  const shift = -start.offset * toward(start.point, end.point, start.side) + end.offset * toward(end.point, start.point, end.side);
  // `shift` runs from start to end; the router wants a coordinate offset.
  return end.point[along] >= start.point[along] ? shift : -shift;
}

/**
 * The path a connector is drawn with: a line without curves has its corners rounded at its corner radius, as the
 * canvas draws it (PixiConnectorRenderer), so exports match it.
 */
export function roundedConnectorCommands(connector: {
  readonly commands: readonly ConnectorPathCommand[]; readonly samples: readonly Point2d[]; readonly presentation: { readonly cornerRadius: number };
}): readonly ConnectorPathCommand[] {
  const { commands, samples, presentation } = connector;
  if (presentation.cornerRadius <= 0 || samples.length <= 2 || commands.some((command) => command.kind === 'cubic')) return commands;
  return roundPolylineCorners(samples, presentation.cornerRadius).map((point, index) => ({ kind: index ? 'line' : 'move', point }));
}
