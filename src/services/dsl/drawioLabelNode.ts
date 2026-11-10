import type { JsonObject } from '../../opencanvas/domain/document/json';
import type { ScenePage, SceneNode } from '../../opencanvas/domain/document/types';
import { DEFAULT_NODE_SIZING_POLICY } from '../../opencanvas/domain/node-sizing/model';
import { createShapeNode } from '../../opencanvas/domain/nodes/shapeNode';
import type { DrawioBox, DrawioLabelBox } from './drawioLabelBox';

// A draw.io label as our node: its box and alignment straight from draw.io's layout (drawioLabelBox), nothing
// measured. A text cell is draw.io's plain box with no fill or line, so it is ours: a rectangle, which carries
// alignment, inset and wrapping on canvas and in export alike.

const { minSize, maxSize } = DEFAULT_NODE_SIZING_POLICY;
/** Lines run on past the box, as draw.io's without `whiteSpace=wrap`. */
const SPILL: JsonObject = { ...DEFAULT_NODE_SIZING_POLICY, minSize: { ...minSize }, maxSize: { ...maxSize } };
/** Lines break at the box's width, as many as the words need (our cap is 100). */
const WRAP: JsonObject = { ...SPILL, overflow: 'wrap', maxLines: 100 };

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

/** Where a box lands once turned with its shape about the shape's centre, as draw.io turns a label. */
function turned(box: DrawioBox, about: DrawioBox, radians: number): { x: number; y: number } {
  if (!radians) return { x: box.x, y: box.y };
  const [cx, cy] = [about.x + about.width / 2, about.y + about.height / 2];
  const [dx, dy] = [box.x + box.width / 2 - cx, box.y + box.height / 2 - cy];
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  return { x: cx + dx * cos - dy * sin - box.width / 2, y: cy + dx * sin + dy * cos - box.height / 2 };
}

/**
 * A node holding just a label, at draw.io's label box: a text cell's words that sit unevenly in it, or a shape's
 * words set beside, above, below or unevenly in it. `paint` is the cell's own (a text cell's fill and font), else
 * none. It turns with `about`, its shape's box, by `radians`; `corner` maps a box's top-left to our turned corner.
 */
export function labelNode(options: {
  readonly id: string; readonly box: DrawioLabelBox; readonly label: string; readonly paint: JsonObject;
  readonly about: DrawioBox; readonly radians: number; readonly padding?: number; readonly base: Pick<SceneNode, 'parentId' | 'layerId' | 'zIndex'>;
  readonly corner: (x: number, y: number, width: number, height: number, radians: number) => { x: number; y: number };
}): SceneNode {
  const { box, radians } = options;
  const layout = labelLayout(box, options.padding ?? 0);
  const at = turned(box, options.about, radians);
  const size = { width: Math.max(1, box.width), height: Math.max(1, box.height) };
  const page = { id: '', name: '', diagramKind: 'flowchart', layers: [], nodes: [], connectors: [], metadata: {}, extensions: {} } as unknown as ScenePage;
  const node = createShapeNode(page, {
    kind: 'rectangle', id: options.id, at, size, label: options.label,
    appearance: { fill: 'transparent', stroke: 'transparent', ...options.paint, ...layout.appearance },
  });
  return {
    ...node, ...options.base,
    transform: { translation: radians ? options.corner(at.x, at.y, size.width, size.height, radians) : at, rotationRadians: radians, scale: { x: 1, y: 1 } },
    content: { ...node.content, sizingPolicy: layout.sizingPolicy },
  };
}
