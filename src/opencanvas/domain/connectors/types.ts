import type { Point2d } from '../geometry/types';
import type { NodeStyle } from '../nodes/nodeStyle';
import type { RichBlock } from '../text/richLabel';
import type { DrawnPart } from '../nodes/drawnShape';

export type ConnectorPathCommand =
  | { readonly kind: 'move'; readonly point: Point2d }
  | { readonly kind: 'line'; readonly point: Point2d }
  | {
      readonly kind: 'cubic';
      readonly control1: Point2d;
      readonly control2: Point2d;
      readonly point: Point2d;
    };

export type ConnectorMarkerGlyph =
  | 'arrow'
  | 'triangle-open'
  | 'triangle-filled'
  | 'diamond-open'
  | 'diamond-filled'
  | 'circle'
  | 'circle-filled'
  | 'bar'
  | 'cross'
  | 'crow-foot';

interface ConnectorLabelGeometry {
  readonly id: string;
  readonly text: string;
  readonly point: Point2d;
  /** The words' formatting, when the label has any. */
  readonly rich?: readonly RichBlock[] | null;
  /** The label's own plate colour, over the connector's (`ConnectorLabel.background`). */
  readonly background?: string;
}

export interface ConnectorStrokePresentation {
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly dash: readonly number[];
  /** A draw.io line (`darkColors: 'invert'`): the colour it sets is flipped on a dark canvas, as draw.io does. */
  readonly invertOnDark?: boolean;
}

export interface ConnectorPresentation {
  readonly stroke: ConnectorStrokePresentation;
  /** Bend rounding for orthogonal/polyline routes, page px. */
  readonly cornerRadius: number;
  /** Label plate + typography; see connectors/labelStyle.ts. */
  readonly label: NodeStyle;
  readonly sourceMarkers: readonly ConnectorMarkerGlyph[];
  readonly targetMarkers: readonly ConnectorMarkerGlyph[];
}

export interface ProjectedConnector {
  readonly id: string;
  readonly commands: readonly ConnectorPathCommand[];
  readonly samples: readonly Point2d[];
  readonly labels: readonly ConnectorLabelGeometry[];
  readonly presentation: ConnectorPresentation;
  /** A line draw.io draws with a shape of its own: its parts along the route, painted instead of the line and its ends. */
  readonly drawn?: { readonly parts: readonly DrawnPart[]; readonly fill: string } | null;
}
