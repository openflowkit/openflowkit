import type { SetConnectorCommand } from './types';
import type { ConnectorRouteKind, ScenePage } from '../document/types';
import type { JsonObject, JsonValue } from '../document/json';
import { areStructurallyEqual } from './equality';

export type ConnectorMarkerEnd = 'none' | 'arrow' | 'dot' | 'cross' | 'diamond';
export type ConnectorDashStyle = 'solid' | 'dashed' | 'dotted';

export interface ConnectorStylePatch {
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly dash?: ConnectorDashStyle;
  readonly cornerRadius?: number;
  readonly markerStart?: ConnectorMarkerEnd;
  readonly markerEnd?: ConnectorMarkerEnd;
  /** Path shape; switching away from polyline drops manual bends. */
  readonly route?: ConnectorRouteKind;
  /** Swap source and target; markers stay on their ends, so the arrow flips. */
  readonly reverse?: boolean;
  /** Label typography and plate (connectors/labelStyle.ts). */
  readonly labelColor?: string;
  readonly labelBackground?: string;
  readonly labelFontSize?: number;
  readonly labelFontFamily?: string;
  readonly labelFontWeight?: number;
  readonly labelFontStyle?: string;
  readonly labelTextDecoration?: string;
}

const LABEL_KEYS = [
  'labelColor', 'labelBackground', 'labelFontSize', 'labelFontFamily', 'labelFontWeight',
  'labelFontStyle', 'labelTextDecoration',
] as const;

/** Appearance keys a style patch writes, over an existing appearance. */
export function connectorAppearanceWithPatch(base: JsonObject, patch: ConnectorStylePatch): JsonObject {
  const appearance: Record<string, JsonValue> = { ...base };
  if (patch.color !== undefined) appearance.stroke = patch.color;
  if (patch.strokeWidth !== undefined) appearance.strokeWidth = patch.strokeWidth;
  if (patch.opacity !== undefined) appearance.opacity = patch.opacity;
  if (patch.cornerRadius !== undefined) appearance.cornerRadius = patch.cornerRadius;
  if (patch.dash !== undefined) {
    if (patch.dash === 'solid') {
      delete appearance.dashPattern;
      delete appearance.strokeDasharray;
    } else {
      appearance.dashPattern = patch.dash;
      delete appearance.strokeDasharray;
    }
  }
  if (patch.markerStart !== undefined) appearance.markerStart = patch.markerStart;
  if (patch.markerEnd !== undefined) appearance.markerEnd = patch.markerEnd;
  for (const key of LABEL_KEYS) {
    const value = patch[key];
    if (value !== undefined) appearance[key] = value;
  }
  // A draw.io line's colours flip on a dark canvas as draw.io's do; a colour picked here is shown as picked.
  const picked = [patch.color !== undefined && 'stroke', ...(['labelColor', 'labelBackground'] as const).filter((key) => patch[key] !== undefined)]
    .filter((key): key is string => typeof key === 'string');
  if (base.darkColors === 'invert' && picked.length) {
    const kept = Array.isArray(base.keepOnDark) ? base.keepOnDark : [];
    appearance.keepOnDark = [...kept, ...picked.filter((key) => !kept.includes(key))];
  }
  return appearance;
}

// One appearance patch over a single connector as one set-connector; no-op
// patches commit nothing. Shared by the v2 connector style bar.
export function buildStyleConnectorCommand(
  page: ScenePage,
  connectorId: string,
  patch: ConnectorStylePatch
): SetConnectorCommand | null {
  const before = page.connectors.find((connector) => connector.id === connectorId);
  if (!before) throw new RangeError(`Connector "${connectorId}" was not found.`);
  const appearance = connectorAppearanceWithPatch(before.appearance, patch);
  let after = patch.route !== undefined && patch.route !== before.route.kind
    ? {
        ...before, appearance, route: { kind: patch.route, ownership: 'automatic' as const },
        // A polyline keeps the bends it already has; every other kind routes itself.
        waypoints: patch.route === 'polyline' ? before.waypoints : [],
      }
    : { ...before, appearance };
  if (patch.reverse) {
    after = {
      ...after, source: after.target, target: after.source,
      waypoints: [...after.waypoints].reverse(),
      labels: after.labels.map((label) => ({ ...label, pathRatio: 1 - label.pathRatio })),
    };
  }
  if (areStructurallyEqual(after, before)) return null;
  return {
    kind: 'set-connector',
    id: `style-connector:${connectorId}`,
    label: 'Style connector',
    pageId: page.id,
    before,
    after,
  };
}
