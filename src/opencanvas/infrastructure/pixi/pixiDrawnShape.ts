import type { Graphics } from 'pixi.js';
import { invertForDark } from '../../domain/color/adaptiveColor';
import { applyMatrixToPoint } from '../../domain/geometry/matrix';
import type { Matrix2d } from '../../domain/geometry/types';
import { drawnPaint, flattenDrawnPath, type DrawnPart } from '../../domain/nodes/drawnShape';
import type { NodeStyle } from '../../domain/nodes/nodeStyle';

/** What painting draw.io's parts reads of a style: a node's, or a line's own colours. */
export type DrawnStyle = Pick<NodeStyle, 'fill' | 'stroke' | 'invertColors' | 'opacity'>;
import { drawDashedPath } from './PixiConnectorRenderer';
import { pixiPaintColor } from './pixiColor';

/**
 * A draw.io shape's parts, each filled and outlined as draw.io drew it: the node's own fill and line where the part
 * asks for them, the shape's own colours elsewhere (flipped with the rest on a dark canvas). `lineScale` is the node's
 * line width over the width draw.io drew with, so a thicker line on the node thickens every part.
 */
export function drawPixiDrawnShape(target: Graphics, parts: readonly DrawnPart[], matrix: Matrix2d, style: DrawnStyle, lineScale: number): void {
  const own = { fill: style.fill, stroke: style.stroke };
  const colour = (paint: string | null) => {
    const value = drawnPaint(paint, own);
    if (value === null) return null;
    const shown = style.invertColors && paint !== 'fill' && paint !== 'stroke' ? invertForDark(value) : value;
    return pixiPaintColor(shown, 0);
  };
  for (const part of parts) {
    const runs = flattenDrawnPath(part.path).map((run) => ({ ...run, points: run.points.map((point) => applyMatrixToPoint(matrix, point)) }));
    if (runs.length === 0) continue;
    const fill = colour(part.fill);
    if (fill && fill.alpha > 0) {
      for (const run of runs) target.poly(run.points.flatMap((point) => [point.x, point.y]), true);
      target.fill({ color: fill.color, alpha: fill.alpha * part.fillOpacity * style.opacity });
    }
    const stroke = colour(part.stroke);
    const width = part.strokeWidth * lineScale;
    if (!stroke || stroke.alpha === 0 || width <= 0) continue;
    const alpha = stroke.alpha * part.strokeOpacity * style.opacity;
    for (const run of runs) {
      const points = run.closed ? [...run.points, run.points[0]!] : [...run.points];
      if (part.dash.length > 0) {
        drawDashedPath(target, points, {
          color: `#${stroke.color.toString(16).padStart(6, '0')}`, width, opacity: alpha, dash: part.dash.map((step) => step * width),
        });
      } else {
        target.poly(points.flatMap((point) => [point.x, point.y]), false);
        target.stroke({ color: stroke.color, width, alpha });
      }
    }
  }
}
