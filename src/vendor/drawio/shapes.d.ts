// Types for draw.io's shape code (shapes.js, generated). Only what src/services/dsl/drawioShapes.ts touches.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DrawioShapeHost {
  window: unknown; document: unknown; navigator: unknown; mxClient: unknown; mxLog: unknown; mxEvent: unknown;
  mxCellRenderer: unknown; Graph: unknown; mxConnectionConstraint: unknown; mxGraphView: unknown;
  /** The editor's own classes: left undefined, so the editor-only parts of draw.io's shape code skip themselves. */
  mxCellState: undefined; mxEdgeHandler: undefined; mxVertexHandler: undefined; Element: unknown; Node: unknown;
  GRAPH_IMAGE_PATH: string;
}

export function runDrawioShapes(host: DrawioShapeHost): Record<string, any>;
