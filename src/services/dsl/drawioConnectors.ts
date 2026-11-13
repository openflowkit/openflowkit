import type { JsonValue } from '../../opencanvas/domain/document/json';
import type { ConnectorEndpoint, ConnectorLabel, SceneConnector } from '../../opencanvas/domain/document/types';
import { bezierPath } from '../../opencanvas/domain/connectors/routePaths';
import { applyMatrixToPoint, invertMatrix } from '../../opencanvas/domain/geometry/matrix';
import { pointAtPolylineRatio } from '../../opencanvas/domain/geometry/polyline';
import type { Matrix2d, Point2d, Size2d } from '../../opencanvas/domain/geometry/types';
import { drawioConnectorAppearance, drawioErRelation, type DrawioStyle } from './drawioStyle';
import type { EdgeState } from './drawioView';

// A draw.io connector's line (drawioView) as ours. The line is draw.io's own, point for point: each end is pinned
// to its shape at the spot draw.io worked out, and the points between are fixed bends, so our router moves nothing.

export interface EndNode { readonly matrix: Matrix2d; readonly size: Size2d }

/** Where a page point sits in a node, as fractions of its size: the node carries the end with it when it moves. */
function pinned(nodeId: string, node: EndNode, point: Point2d): ConnectorEndpoint {
  const inverse = invertMatrix(node.matrix);
  const local = inverse ? applyMatrixToPoint(inverse, point) : { x: node.size.width / 2, y: node.size.height / 2 };
  return { nodeId, portId: null, anchor: { kind: 'normalized', x: local.x / node.size.width, y: local.y / node.size.height }, point: null };
}

const QUAD_STEPS = 8;

/** draw.io's curve through three or more points (mxPolyline.paintCurvedLine): a quadratic at each, joined halfway to the next. */
function curveThrough(points: readonly Point2d[]): Point2d[] {
  const out: Point2d[] = [points[0]!];
  let from = points[0]!;
  const quad = (control: Point2d, to: Point2d) => {
    for (let step = 1; step <= QUAD_STEPS; step += 1) {
      const t = step / QUAD_STEPS;
      const u = 1 - t;
      out.push({ x: u * u * from.x + 2 * u * t * control.x + t * t * to.x, y: u * u * from.y + 2 * u * t * control.y + t * t * to.y });
    }
    from = to;
  };
  for (let index = 1; index < points.length - 2; index += 1) {
    const [here, next] = [points[index]!, points[index + 1]!];
    quad(here, { x: (here.x + next.x) / 2, y: (here.y + next.y) / 2 });
  }
  quad(points.at(-2)!, points.at(-1)!);
  return out;
}

export interface LabelAt { readonly id: string; readonly text: string; readonly at: Point2d; readonly along: number; readonly rich?: JsonValue }

/**
 * `endNode` finds the node an end is drawn to (null: the end is a free point). `labels` are the connector's own
 * label and any dragged along it, each with the page point draw.io centres it on.
 */
export function drawioConnector(state: EdgeState, style: DrawioStyle, endNode: (cellId: string) => EndNode | null, labels: readonly LabelAt[]): SceneConnector {
  const line = state.line.points;
  const end = (cellId: string | null, point: Point2d): ConnectorEndpoint => {
    const node = cellId === null ? null : endNode(cellId);
    return node ? pinned(cellId!, node, point) : { nodeId: null, portId: null, anchor: null, point };
  };
  const curved = style.curved === '1';
  // One curve through a single bend is our bezier exactly; a longer one is drawn as the short runs it passes through.
  const bezier = curved && line.length === 3;
  const drawn = curved && line.length > 3 ? curveThrough(line) : line;
  const waypoints = bezier
    ? [0, 2].map((at) => ({ x: line[at]!.x + ((line[1]!.x - line[at]!.x) * 2) / 3, y: line[at]!.y + ((line[1]!.y - line[at]!.y) * 2) / 3 }))
    : drawn.slice(1, -1);
  const samples = bezier ? bezierPath(line[0]!, line[2]!, waypoints).samples : drawn;
  const appearance = drawioConnectorAppearance(style);
  return {
    id: state.cell.id,
    source: end(state.sourceId, line[0]!),
    target: end(state.targetId, line.at(-1)!),
    route: { kind: bezier ? 'bezier' : waypoints.length ? 'polyline' : 'direct', ownership: 'imported-fixed' },
    waypoints,
    labels: labels.map(({ id, text, at, along, rich }): ConnectorLabel => {
      const pathRatio = Math.min(1, Math.max(0, (along + 1) / 2));
      const on = pointAtPolylineRatio(samples, pathRatio) ?? line[0]!;
      const round = (value: number) => Math.round(value * 100) / 100 + 0;
      return { id, text, pathRatio, offset: { x: round(at.x - on.x), y: round(at.y - on.y) }, metadata: {}, ...(rich ? { richLabel: rich } : {}) };
    }),
    appearance: curved && line.length > 3 ? { ...appearance, cornerRadius: 0 } : appearance,
    semantics: drawioErRelation(style) ? { erRelation: drawioErRelation(style)! } : {}, metadata: {}, extensions: {},
  };
}
