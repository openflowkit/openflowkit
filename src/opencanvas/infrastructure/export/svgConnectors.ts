import { FONT_STACKS, type NodeStyle } from '../../domain/nodes/nodeStyle';
import type { Point2d } from '../../domain/geometry/types';
import type { ConnectorMarkerGlyph, ProjectedConnector } from '../../domain/connectors/types';
import { connectorMarkerShapes, markerOutward, type MarkerShape } from '../../domain/connectors/markers';
import { connectorLabelLineHeight, connectorLabelLines, connectorLabelPlate, connectorRichPlate } from '../../domain/connectors/labelStyle';
import type { RichBlock } from '../../domain/text/richLabel';
import { richLabelElement } from './svgNodeText';
import type { projectPageConnectors } from '../../domain/connectors/routeProjection';
import { number, xml } from './svgMarkup';

export function connectorPathData(commands: ReturnType<typeof projectPageConnectors>[number]['commands']): string {
  return commands.map((command) => command.kind === 'cubic'
    ? `C${number(command.control1.x)} ${number(command.control1.y)} ${number(command.control2.x)} ${number(command.control2.y)} ${number(command.point.x)} ${number(command.point.y)}`
    : `${command.kind === 'move' ? 'M' : 'L'}${number(command.point.x)} ${number(command.point.y)}`
  ).join(' ');
}

/** A connector label as the canvas draws it: text on a rounded plate over the line. */
export function connectorLabelMarkup(text: string, point: Point2d, style: NodeStyle, rich: readonly RichBlock[] | null = null): string {
  if (!text) return '';
  const plate = rich ? connectorRichPlate(rich, style, point) : connectorLabelPlate(text, style, point);
  const fill = style.fill === 'transparent' ? 'none' : style.fill;
  const stroke = style.stroke === 'transparent' || style.strokeWidth <= 0 ? 'none' : style.stroke;
  return `<rect x="${number(plate.x)}" y="${number(plate.y)}" width="${number(plate.width)}" height="${number(plate.height)}" rx="${number(style.cornerRadius)}" fill="${fill}" stroke="${stroke}" stroke-width="${number(style.strokeWidth)}"/>`
    + (rich ? richLabelElement({ ...style, textAlign: 'center', textVerticalAlign: 'middle' }, plate, rich, null, false) : '')
    + (rich ? [] : connectorLabelLines(text, style).map((line, index, lines) => {
      // Wrapped like the canvas: the block of lines is centred on the point.
      const y = point.y + (index - (lines.length - 1) / 2) * connectorLabelLineHeight(style);
      return `<text x="${number(point.x)}" y="${number(y)}" text-anchor="middle" dominant-baseline="middle" fill="${xml(style.textColor)}" font-family="${xml(FONT_STACKS[style.fontFamily])}" font-size="${number(style.fontSize)}" font-weight="${style.fontWeight}">${xml(line)}</text>`;
    })).join('');
}

/** Arrowheads and end glyphs, with the exact geometry the Pixi renderer uses. */
export function markerMarkup(connector: ProjectedConnector, stroke: string, surface: string): string {
  const { samples, presentation } = connector;
  if (samples.length < 2) return '';
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const width = presentation.stroke.width;
  const glyph = (value: ConnectorMarkerGlyph, endpoint: Point2d, outward: Point2d, index: number) =>
    connectorMarkerShapes(value, endpoint, outward, index * 9)
      .map((shape) => markerShapeMarkup(shape, stroke, width, presentation.stroke.opacity, surface)).join('');
  const start = presentation.sourceMarkers
    .map((value, index) => glyph(value, first, markerOutward(samples, 'source'), index)).join('');
  const end = presentation.targetMarkers
    .map((value, index) => glyph(value, last, markerOutward(samples, 'target'), index)).join('');
  return start + end;
}

// Hollow glyphs (circle, open triangle/diamond) are filled with the page surface, as the canvas fills them, so the line never shows through.
function markerShapeMarkup(shape: MarkerShape, stroke: string, width: number, opacity: number, surface: string): string {
  const paint = (fill: string) => `fill="${fill}" stroke="${stroke}" stroke-width="${number(width)}" opacity="${number(opacity)}"`;
  if (shape.kind === 'circle') {
    return `<circle cx="${number(shape.center.x)}" cy="${number(shape.center.y)}" r="${number(shape.radius)}" ${paint(shape.filled ? stroke : surface)}/>`;
  }
  const data = shape.subpaths
    .map((points) => points.map((point, index) => `${index ? 'L' : 'M'}${number(point.x)} ${number(point.y)}`).join(' '))
    .join(' ') + (shape.closed ? ' Z' : '');
  if (shape.filled) return `<path d="${data}" fill="${stroke}" opacity="${number(opacity)}"/>`;
  return `<path d="${data}" ${paint(shape.closed ? surface : 'none')}${shape.round ? ' stroke-linejoin="round"' : ''}/>`;
}
