import type { JsonObject } from '../../opencanvas/domain/document/json';
import type { ScenePage, SceneNode } from '../../opencanvas/domain/document/types';
import { applyMatrixToPoint, invertMatrix, multiplyMatrices } from '../../opencanvas/domain/geometry/matrix';
import { transformToMatrix } from '../../opencanvas/domain/geometry/transform';
import type { Matrix2d, Point2d, Transform2d } from '../../opencanvas/domain/geometry/types';
import { DEFAULT_NODE_SIZING_POLICY } from '../../opencanvas/domain/node-sizing/model';
import { createShapeNode } from '../../opencanvas/domain/nodes/shapeNode';
import type { DrawioBox, DrawioLabelBox } from './drawioLabelBox';

// draw.io's boxes as our nodes' transforms, and a draw.io label as a node of its own: its box and alignment straight
// from draw.io's layout (drawioLabelBox), nothing measured.

const { minSize, maxSize } = DEFAULT_NODE_SIZING_POLICY;
/** Lines run on past the box, as draw.io's without `whiteSpace=wrap`. */
const SPILL: JsonObject = { ...DEFAULT_NODE_SIZING_POLICY, minSize: { ...minSize }, maxSize: { ...maxSize } };
/** Lines break at the box's width, as many as the words need (our cap is 100). */
const WRAP: JsonObject = { ...SPILL, overflow: 'wrap', maxLines: 100 };

export interface Placement {
  /** The node's transform inside its parent node. */
  readonly transform: Transform2d;
  /** The node's own coordinates on the page: what its children are placed in. */
  readonly matrix: Matrix2d;
}

/**
 * A page box turned by `degrees` about `about`, as a node inside the node whose page matrix is `parent` (null: on
 * the page). draw.io turns a shape about its centre and never turns its children with it; ours turn about their
 * top-left corner and carry their children, so the corner is moved and the parent's turn taken back out.
 */
export function placeBox(parent: Matrix2d | null, box: DrawioBox, degrees: number, about: Point2d): Placement {
  const radians = (degrees * Math.PI) / 180;
  const [dx, dy] = [box.x - about.x, box.y - about.y];
  const corner = radians ? { x: about.x + dx * Math.cos(radians) - dy * Math.sin(radians), y: about.y + dx * Math.sin(radians) + dy * Math.cos(radians) } : { x: box.x, y: box.y };
  const inverse = parent ? invertMatrix(parent) : null;
  const transform: Transform2d = parent && inverse
    ? { translation: applyMatrixToPoint(inverse, corner), rotationRadians: radians - Math.atan2(parent.b, parent.a), scale: { x: 1, y: 1 } }
    : { translation: corner, rotationRadians: radians, scale: { x: 1, y: 1 } };
  const local = transformToMatrix(transform);
  return { transform, matrix: parent && inverse ? multiplyMatrices(parent, local) : local };
}

export const centreOf = (box: DrawioBox): Point2d => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** How a label's words are set in its box: draw.io's sides as ours, wrapping as the cell says. */
export function labelLayout(box: DrawioLabelBox, padding: number): { readonly appearance: JsonObject; readonly sizingPolicy: JsonObject } {
  return {
    appearance: {
      textAlign: box.align === 'left' ? 'start' : box.align === 'right' ? 'end' : 'center',
      textVerticalAlign: box.verticalAlign,
      textPadding: padding,
    },
    sizingPolicy: box.wrap ? WRAP : SPILL,
  };
}

/**
 * A node holding just a label, at draw.io's label box: words that sit beside, above, below or unevenly in their
 * shape, or a cell that is only words. It is draw.io's plain box with no fill or line, so it is ours: a rectangle,
 * which carries alignment, inset and wrapping on canvas and in export alike. `paint` is the cell's type and ink.
 */
export function labelNode(options: {
  readonly id: string; readonly box: DrawioLabelBox; readonly label: string; readonly paint: JsonObject;
  readonly placement: Placement; readonly base: Pick<SceneNode, 'parentId' | 'layerId' | 'zIndex'>;
}): SceneNode {
  const { box } = options;
  const layout = labelLayout(box, 0);
  const size = { width: Math.max(1, box.width), height: Math.max(1, box.height) };
  const page = { id: '', name: '', diagramKind: 'flowchart', layers: [], nodes: [], connectors: [], metadata: {}, extensions: {} } as unknown as ScenePage;
  const node = createShapeNode(page, {
    kind: 'rectangle', id: options.id, at: options.placement.transform.translation, size, label: options.label,
    appearance: { fill: 'transparent', stroke: 'transparent', ...options.paint, ...layout.appearance },
  });
  return { ...node, ...options.base, transform: options.placement.transform, content: { ...node.content, sizingPolicy: layout.sizingPolicy } };
}
