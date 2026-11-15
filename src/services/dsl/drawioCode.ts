import type { JsonObject } from '../../opencanvas/domain/document/json';
import { provideDrawnShapes } from '../../opencanvas/domain/nodes/drawnShape';
import { provideDrawnLines } from '../../opencanvas/domain/connectors/drawnLine';
import type { Cell } from './drawioCells';
import { DRAWIO_CODE_ROUTERS, installDrawioRouters } from './drawioEdgeView';
import { DRAWIO_CODE_PERIMETERS, installDrawioPerimeters } from './drawioPerimeter';
import { loadDrawioShapes, type DrawioShapes } from './drawioShapes';
import { drawioCodeName, drawioColor, drawioShape, drawioShapeName, type DrawioStyle } from './drawioStyle';
import type { SceneConnector } from '../../opencanvas/domain/document/types';
import { resolveConnectorLine } from '../../opencanvas/domain/connectors/presentation';
import type { Point2d } from '../../opencanvas/domain/geometry/types';
import { DRAWIO_STYLESHEET } from './drawioStylesheet';

// When an import needs draw.io's own code (src/vendor/drawio), and handing it the parts that code does.

/** A bare word that names one of draw.io's styles (`group`, `text`), not a shape: no code draws it. */
export const namedStyle = (style: DrawioStyle): boolean => {
  const name = drawioShapeName(style);
  return style.shape === undefined && Object.hasOwn(DRAWIO_STYLESHEET, name) && DRAWIO_STYLESHEET[name]!.shape === undefined;
};

/** A cell draw.io draws with its `label` shape (its default): a picture inside a box, placed by that shape's code. */
export const drawnAsLabel = (style: DrawioStyle): boolean => ['label', ''].includes(drawioShapeName(style)) || namedStyle(style);

/** Whether a page has a shape, a line's routing or a shape's outline that only draw.io's own code draws. */
export function usesDrawioCode(cells: readonly Cell[]): boolean {
  return cells.some((cell) => (cell.edge && (DRAWIO_CODE_ROUTERS.has(cell.style.edgeStyle ?? '') || drawnAsShape(cell.style) || hasEnds(cell.style) || cell.style.sketch === '1'))
    || (cell.vertex && (DRAWIO_CODE_PERIMETERS.has(cell.style.perimeter ?? '') || drawioShapeName(cell.style) === 'swimlane' || (drawioShape(cell.style, 1, 1).unknown !== undefined && !namedStyle(cell.style))
      // draw.io's label card places its picture by its own code.
      || (cell.style.image !== undefined && drawnAsLabel(cell.style)))));
}

/** Whether draw.io ends a line with a head at either end (its end has an arrow unless `endArrow=none`). */
export const hasEnds = (style: DrawioStyle): boolean => !['none', ''].includes(style.endArrow ?? 'classic') || !['none', ''].includes(style.startArrow ?? 'none');

/** A line draw.io draws with a shape of its own (a block arrow, a link), not its plain connector. */
export const drawnAsShape = (style: DrawioStyle): boolean => !['', 'connector'].includes(style.shape ?? '');

/** Loads draw.io's code on first need; it then routes, outlines and draws what isn't ported here. */
export async function installDrawioCode(): Promise<DrawioShapes> {
  const code = await loadDrawioShapes();
  installDrawioRouters((name) => code.router(name));
  installDrawioPerimeters((name) => code.perimeter(name));
  provideDrawnShapes((style, width, height) => code.draw(style, width, height)?.parts ?? null);
  provideDrawnLines((style, points) => code.drawLine(style, points));
  return code;
}

/** The line width draw.io draws a shape with: its `strokeWidth`, else 1. */
export const drawnLine = (style: DrawioStyle): number => Math.max(0, Number.parseFloat(style.strokeWidth ?? '') || 1);

/** A shape draw.io draws (code, stencil, or code with a stencil inside) as the node content that draws it; else null. */
export function drawnContent(code: DrawioShapes | null, written: string, style: DrawioStyle, size: { width: number; height: number }): JsonObject | null {
  // A sketched box is drawn by hand by draw.io's rectangle code; a plain one without a name is ours to draw.
  const name = style.sketch === '1' ? drawioCodeName(written) : written;
  if (!code?.has(name) || size.width <= 0 || size.height <= 0) return null;
  const named = { ...style, shape: name };
  const drawn = code.draw(named, size.width, size.height);
  if (!drawn || drawn.parts.length === 0) return null;
  return { drawio: named, drawioParts: drawn.parts as unknown as JsonObject[], drawioSize: { width: size.width, height: size.height } };
}

/** Every stencil a page's cells name: their shapes, and the icons AWS's resource icons carry. */
export function stencilNames(cells: readonly Cell[]): string[] {
  const names: string[] = [];
  for (const cell of cells) {
    if (!cell.vertex) continue;
    const shape = cell.style.shape;
    if (shape?.startsWith('mxgraph.')) names.push(shape);
    if (cell.style.resIcon?.startsWith('mxgraph.')) names.push(cell.style.resIcon);
  }
  return names;
}

/**
 * A line draw.io draws with a shape of its own, keeping that drawing along its points (`drawnLine`); `lost` names
 * one draw.io's code can't draw, which stays a plain line.
 */
export function shapedLine(code: DrawioShapes | null, connector: SceneConnector, style: DrawioStyle, points: readonly Point2d[]): { connector: SceneConnector; lost?: string } {
  const shaped = drawnAsShape(style);
  // A plain line with an end is drawn by draw.io's connector too, so every one of its ends (34 kinds, at its size,
  // the line stopping where draw.io stops it) is draw.io's own; until its look is changed here (`look`).
  // So is a sketched line (`sketch=1`), drawn by hand by draw.io's sketch code.
  if (!shaped && !hasEnds(style) && style.sketch !== '1') return { connector };
  const drawnStyle = shaped ? { ...style } : { ...style, shape: 'connector' };
  // A plain line keeps no drawing of its own: it is drawn when shown (a page of 24,000 lines imports at once), and
  // where draw.io's code isn't loaded it is drawn as ours.
  const parts = shaped ? code?.drawLine(drawnStyle, points) ?? null : code ? [] : null;
  if (!parts) return shaped ? { connector, lost: `draw.io’s “${style.shape}” line is drawn as a plain line` } : { connector };
  const { stroke, sourceMarkers, targetMarkers } = resolveConnectorLine(connector);
  const look = shaped ? {} : { look: { width: stroke.width, dash: [...stroke.dash], start: [...sourceMarkers], end: [...targetMarkers] } };
  const drawioLine = { style: drawnStyle, fill: drawioColor(style.fillColor) ?? 'transparent', points: points.map(({ x, y }) => ({ x, y })), parts, ...look };
  return { connector: { ...connector, extensions: { ...connector.extensions, drawioLine: drawioLine as unknown as JsonObject } } };
}
