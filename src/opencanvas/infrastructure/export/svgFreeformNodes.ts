import { resolveTextVisualStyle } from '@/theme';
import { nodePaletteName } from '../../domain/nodes/nodePalette';
import type { SceneNode } from '../../domain/document/types';
import type { Matrix2d } from '../../domain/geometry/types';
import type {
  AnnotationNodePresentation,
  ImageNodePresentation,
  StrokeNodePresentation,
  TextNodePresentation,
} from '../../domain/nodes/freeformNodePresentation';
import { pressureTiltSegmentWidth } from '../../domain/nodes/strokeInput';
import { smoothStroke } from '../../domain/nodes/strokeGeometry';
import { annotationColors } from '../pixi/freeformNodeVisual';
import { matrixAttribute, nodeGroup, number, openPathData, pathData, safeColor, SVG_BACKGROUND, textElement, xml } from './svgMarkup';

function strokePath(
  data: string,
  color: string,
  width: number,
  opacity: number
): string {
  return `<path d="${data}" fill="none" stroke="${color}" stroke-width="${number(width)}" opacity="${number(opacity)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function arrowHeadPath(presentation: StrokeNodePresentation): string {
  if (presentation.kind !== 'arrow') return '';
  const end = presentation.points.at(-1);
  const previous = presentation.points.at(-2);
  if (!end || !previous) return '';
  const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
  const length = Math.max(8, presentation.width * 3);
  const left = {
    x: end.x - Math.cos(angle - Math.PI / 6) * length,
    y: end.y - Math.sin(angle - Math.PI / 6) * length,
  };
  const right = {
    x: end.x - Math.cos(angle + Math.PI / 6) * length,
    y: end.y - Math.sin(angle + Math.PI / 6) * length,
  };
  return `M${number(left.x)} ${number(left.y)} L${number(end.x)} ${number(end.y)} L${number(right.x)} ${number(right.y)}`;
}

export function exportStrokeNode(
  node: SceneNode,
  matrix: Matrix2d,
  presentation: StrokeNodePresentation,
  frame: { readonly className: string; readonly style: string } | null,
  theme: 'light' | 'dark' | 'print' = 'light'
): string {
  // A line with no colour of its own (an imported draw.io pen) follows the theme, as the canvas draws it.
  const themed = theme === 'dark' && typeof node.content.strokeColor !== 'string' && presentation.kind !== 'highlighter';
  const color = themed ? '#e2e8f0' : safeColor(presentation.color, '#334155');
  const inputSamples = presentation.inputSamples;
  const smoothed = inputSamples || (presentation.kind !== 'pen' && presentation.kind !== 'highlighter')
    ? presentation.points : smoothStroke(presentation.points);
  const paths = inputSamples
    ? presentation.points.slice(1).map((point, index) => strokePath(
        openPathData([presentation.points[index], point]),
        color,
        pressureTiltSegmentWidth(
          presentation.width,
          inputSamples[index],
          inputSamples[index + 1]
        ),
        presentation.opacity
      )).join('')
    : strokePath(
        openPathData(smoothed),
        color,
        presentation.width,
        presentation.opacity
      );
  const arrowHead = arrowHeadPath({ ...presentation, points: smoothed });
  return nodeGroup(
    `data-node-id="${xml(node.id)}" data-node-kind="${presentation.kind}" transform="${matrixAttribute(matrix)}"`,
    paths + (arrowHead ? strokePath(arrowHead, color, presentation.width, presentation.opacity) : ''),
    frame
  );
}

export function exportTextNode(
  node: SceneNode,
  matrix: Matrix2d,
  presentation: TextNodePresentation,
  theme: 'light' | 'dark' | 'print',
  frame: { readonly className: string; readonly style: string } | null
): string {
  const colors = resolveTextVisualStyle(
    presentation.colorKey,
    'subtle',
    presentation.customColor,
    'slate',
    nodePaletteName(node)
  );
  const background = presentation.backgroundColor
    ? `<rect width="${number(node.size.width)}" height="${number(node.size.height)}" rx="8" fill="${safeColor(presentation.backgroundColor, '#ffffff')}" stroke="${safeColor(colors.border, '#94a3b8')}"/>`
    : '';
  const color = safeColor(
    node.content.textColor,
    theme === 'dark' && !presentation.backgroundColor ? '#f8fafc' : colors.text
  );
  const text = textElement(
    presentation.label,
    node.size.width / 2,
    node.size.height / 2,
    `text-anchor="middle" dominant-baseline="middle" fill="${color}" font-family="${xml(presentation.fontFamily)}" font-size="${number(presentation.fontSizePx)}" font-weight="${xml(presentation.fontWeight)}" font-style="${xml(presentation.fontStyle)}"`,
    presentation.fontSizePx * 1.25
  );
  return nodeGroup(
    `data-node-id="${xml(node.id)}" data-node-kind="text" transform="${matrixAttribute(matrix)}"`,
    background + text,
    frame
  );
}

export function exportImageNode(
  node: SceneNode,
  matrix: Matrix2d,
  presentation: ImageNodePresentation,
  theme: 'light' | 'dark' | 'print',
  frame: { readonly className: string; readonly style: string } | null
): string {
  const background = theme === 'dark' ? '#1e293b' : '#fff7ed';
  const media = presentation.sourceUrl
    ? `<image href="${xml(presentation.sourceUrl)}" width="${number(node.size.width)}" height="${number(node.size.height)}" opacity="${number(presentation.opacity)}" preserveAspectRatio="xMidYMid meet"/>`
    : textElement(
        presentation.label || 'No Image',
        node.size.width / 2,
        node.size.height / 2,
        `text-anchor="middle" dominant-baseline="middle" fill="${theme === 'dark' ? '#f8fafc' : '#9a3412'}" font-family="system-ui,sans-serif" font-size="12" font-weight="600"`,
        15
      );
  return nodeGroup(
    `data-node-id="${xml(node.id)}" data-node-kind="image" transform="${matrixAttribute(matrix)}"`,
    // As on the canvas: the plate stands in for a missing picture; a picture is drawn on nothing.
    `${presentation.sourceUrl ? '' : `<rect width="${number(node.size.width)}" height="${number(node.size.height)}" rx="8" fill="${background}" stroke="#e95420"/>`}${media}`,
    frame
  );
}

export function exportAnnotationNode(
  node: SceneNode,
  matrix: Matrix2d,
  presentation: AnnotationNodePresentation,
  theme: 'light' | 'dark' | 'print',
  frame: { readonly className: string; readonly style: string } | null
): string {
  const colors = annotationColors(node, presentation, theme === 'dark' ? SVG_BACKGROUND.dark : undefined);
  const foldSize = Math.min(28, node.size.width / 4, node.size.height / 3);
  const fold = pathData([
    { x: node.size.width - foldSize, y: node.size.height },
    { x: node.size.width, y: node.size.height - foldSize },
    { x: node.size.width, y: node.size.height },
  ]);
  const title = presentation.title
    ? textElement(
        presentation.title,
        12,
        22,
        `fill="${safeColor(colors.titleText, '#713f12')}" font-family="system-ui,sans-serif" font-size="14" font-weight="700"`,
        17
      )
    : '';
  const body = textElement(
    presentation.body,
    12,
    presentation.title ? 46 : 24,
    `fill="${safeColor(colors.bodyText, '#854d0e')}" font-family="system-ui,sans-serif" font-size="12" font-weight="500"`,
    15
  );
  return nodeGroup(
    `data-node-id="${xml(node.id)}" data-node-kind="${presentation.kind}" transform="${matrixAttribute(matrix)}"`,
    `<rect width="${number(node.size.width)}" height="${number(node.size.height)}" rx="8" fill="${safeColor(colors.containerBg, '#fef9c3')}" stroke="${safeColor(colors.containerBorder, '#eab308')}" stroke-width="1.5"/><path d="${fold}" fill="${safeColor(colors.foldBg, '#fef08a')}" stroke="${safeColor(colors.foldBorder, '#ca8a04')}"/>${title}${body}`,
    frame
  );
}
