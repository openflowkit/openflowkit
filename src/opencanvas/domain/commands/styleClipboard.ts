import type { DocumentCommand } from './types';
import type { SceneConnector, SceneNode, ScenePage } from '../document/types';
import type { JsonObject } from '../document/json';
import { resolveNodeStyle } from '../nodes/nodeStyle';
import { resolveConnectorPresentation } from '../connectors/presentation';
import { buildStyleNodesCommand } from './styleNodes';
import { buildStyleConnectorCommand, type ConnectorStylePatch } from './styleConnectors';

// ⌘⌥C / ⌘⌥V: the resolved style travels, never the raw appearance, so a
// legacy palette node pastes the same look as a flat-key node.
export interface StyleClipboard {
  readonly node?: JsonObject;
  readonly connector?: ConnectorStylePatch;
}

export function copyNodeStyle(node: SceneNode): JsonObject {
  const { dash: _dash, shadow, gradient, ...style } = resolveNodeStyle(node);
  // Stored as flat keys; 'transparent' clears a gradient the target had.
  return {
    ...style,
    shadow: shadow !== null,
    ...(shadow ? { shadowColor: shadow.color, shadowOpacity: shadow.opacity, shadowBlur: shadow.blur, shadowOffsetX: shadow.offsetX, shadowOffsetY: shadow.offsetY } : {}),
    gradientColor: gradient?.color ?? 'transparent',
    ...(gradient ? { gradientDirection: gradient.direction } : {}),
  };
}

export function copyConnectorStyle(connector: SceneConnector): ConnectorStylePatch {
  const presentation = resolveConnectorPresentation(connector);
  const marker = (glyphs: readonly string[]): ConnectorStylePatch['markerEnd'] =>
    glyphs.includes('arrow') ? 'arrow' : glyphs.includes('circle') ? 'dot' : glyphs.includes('cross') ? 'cross' : 'none';
  const label = presentation.label;
  return {
    color: presentation.stroke.color,
    strokeWidth: presentation.stroke.width,
    opacity: presentation.stroke.opacity,
    dash: presentation.stroke.dash.length === 0 ? 'solid' : presentation.stroke.dash[0] <= 2 ? 'dotted' : 'dashed',
    cornerRadius: presentation.cornerRadius,
    markerStart: marker(presentation.sourceMarkers),
    markerEnd: marker(presentation.targetMarkers),
    labelColor: label.textColor,
    labelBackground: label.fill,
    labelFontSize: label.fontSize,
    labelFontFamily: label.fontFamily,
    labelFontWeight: label.fontWeight,
    labelFontStyle: label.fontStyle,
    labelTextDecoration: label.textDecoration,
  };
}

export function buildPasteStyleCommand(
  page: ScenePage,
  nodeIds: readonly string[],
  connectorId: string | null,
  clipboard: StyleClipboard
): DocumentCommand | null {
  if (connectorId && clipboard.connector) return buildStyleConnectorCommand(page, connectorId, clipboard.connector);
  if (nodeIds.length && clipboard.node) return buildStyleNodesCommand(page, nodeIds, clipboard.node);
  return null;
}
