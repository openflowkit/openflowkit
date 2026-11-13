import type { JsonObject, JsonValue } from '../document/json';
import type { SceneConnector } from '../document/types';
import type {
  ConnectorMarkerGlyph,
  ConnectorPresentation,
  ConnectorStrokePresentation,
} from './types';
import { resolveConnectorLabelStyle } from './labelStyle';
import { invertForDark, isDarkCanvas } from '../color/adaptiveColor';

const DEFAULT_STROKE = '#64748b';

function optionalString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function boundedNumber(
  value: JsonValue | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

const GLYPHS: ReadonlySet<string> = new Set<ConnectorMarkerGlyph>([
  'arrow', 'triangle-open', 'triangle-filled', 'diamond-open', 'diamond-filled', 'circle', 'bar', 'cross', 'crow-foot',
]);

function markerFromAppearance(value: JsonValue | undefined): ConnectorMarkerGlyph[] {
  if (typeof value === 'string') {
    // Glyph names, one or several from the line's end inward (`crow-foot bar`), are drawn as named.
    const words = value.trim().split(/\s+/);
    if (words.every((word) => GLYPHS.has(word))) return words as ConnectorMarkerGlyph[];
    const text = value.toLowerCase();
    if (text.includes('arrow')) return ['arrow'];
    if (text.includes('dot') || text.includes('circle')) return ['circle'];
    if (text.includes('cross')) return ['cross'];
    if (text.includes('diamond')) return ['diamond-open'];
    return [];
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const type = optionalString((value as JsonObject).type)?.toLowerCase();
  return type?.includes('arrow') ? ['arrow'] : [];
}

function classRelationMarkers(token: string): {
  source: ConnectorMarkerGlyph[];
  target: ConnectorMarkerGlyph[];
  dashed: boolean;
} {
  const source: ConnectorMarkerGlyph[] = [];
  const target: ConnectorMarkerGlyph[] = [];
  if (token.startsWith('<|')) source.push('triangle-open');
  else if (token.startsWith('*')) source.push('diamond-filled');
  else if (token.startsWith('o')) source.push('diamond-open');
  else if (token.startsWith('<')) source.push('arrow');
  if (token.endsWith('|>')) target.push('triangle-open');
  else if (token.endsWith('*')) target.push('diamond-filled');
  else if (token.endsWith('o')) target.push('diamond-open');
  else if (token.endsWith('>')) target.push('arrow');
  return { source, target, dashed: token.includes('..') };
}

/**
 * Every crow's-foot relation Mermaid writes: `<left>(--|..)<right>` with
 * `|o` zero-or-one, `||` exactly one, `}o` zero-or-many, `}|` one-or-many.
 * One definition for the DSL, the Mermaid importer and the renderer.
 */
export const ER_RELATION_TOKEN = /^(?:\|o|\|\||\}o|\}\|)(?:--|\.\.)(?:o\||\|\||o\{|\|\{)$/;

export function isErRelationToken(value: string): boolean {
  return ER_RELATION_TOKEN.test(value);
}

function erCardinalityMarkers(symbol: string): ConnectorMarkerGlyph[] {
  if (symbol === '||') return ['bar', 'bar'];
  if (symbol === '|o' || symbol === 'o|') return ['bar', 'circle'];
  if (symbol === '}o' || symbol === 'o{') return ['crow-foot', 'circle'];
  if (symbol === '}|' || symbol === '|{') return ['crow-foot', 'bar'];
  return [];
}

function erRelationMarkers(token: string): {
  source: ConnectorMarkerGlyph[];
  target: ConnectorMarkerGlyph[];
  dashed: boolean;
} {
  const separator = token.includes('..') ? '..' : '--';
  const [source = '', target = ''] = token.split(separator);
  return {
    source: erCardinalityMarkers(source),
    target: erCardinalityMarkers(target),
    dashed: separator === '..',
  };
}

function conditionStroke(condition: string | null): string {
  if (condition === 'error') return '#b91c1c';
  if (condition === 'success') return '#15803d';
  if (condition === 'timeout') return '#c2410c';
  return DEFAULT_STROKE;
}

function dashPattern(appearance: JsonObject, dashedBySemantics: boolean): readonly number[] {
  const explicit = optionalString(appearance.strokeDasharray);
  if (explicit) {
    const values = explicit
      .split(/[ ,]+/)
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0);
    if (values.length > 0) return values;
  }
  const pattern = optionalString(appearance.dashPattern);
  if (pattern === 'dotted') return [2, 5];
  if (pattern === 'dashdot') return [10, 5, 2, 5];
  if (pattern === 'dashed' || dashedBySemantics) return [10, 6];
  return [];
}

function semanticMarkers(connector: SceneConnector): {
  source: ConnectorMarkerGlyph[];
  target: ConnectorMarkerGlyph[];
  dashed: boolean;
} {
  const classRelation = optionalString(connector.semantics.classRelation);
  if (classRelation) return classRelationMarkers(classRelation);
  const erRelation = optionalString(connector.semantics.erRelation);
  if (erRelation) return erRelationMarkers(erRelation);
  const sequenceKind = optionalString(connector.semantics.seqMessageKind);
  if (sequenceKind) {
    // A message that ends in a cross (`-x`) says so in its appearance; otherwise its kind decides the head.
    const lost = markerFromAppearance(connector.appearance.markerEnd).filter((glyph) => glyph === 'cross');
    return {
      source: [],
      target: lost.length > 0 ? lost : [sequenceKind === 'sync' || sequenceKind === 'create' ? 'triangle-filled' : 'arrow'],
      dashed: sequenceKind === 'return',
    };
  }
  return { source: [], target: [], dashed: false };
}

export function resolveConnectorPresentation(connector: SceneConnector): ConnectorPresentation {
  const markers = semanticMarkers(connector);
  const condition = optionalString(connector.semantics.condition);
  const stroke: ConnectorStrokePresentation = {
    color: optionalString(connector.appearance.stroke) ?? conditionStroke(condition),
    width: boundedNumber(connector.appearance.strokeWidth, 1.75, 0.5, 8),
    opacity: boundedNumber(connector.appearance.opacity, 1, 0, 1),
    dash: dashPattern(connector.appearance, markers.dashed),
    ...(connector.appearance.darkColors === 'invert' && optionalString(connector.appearance.stroke) ? { invertOnDark: true } : {}),
  };
  return {
    stroke,
    cornerRadius: boundedNumber(connector.appearance.cornerRadius, 8, 0, 24),
    label: resolveConnectorLabelStyle(connector),
    sourceMarkers:
      markers.source.length > 0
        ? markers.source
        : markerFromAppearance(connector.appearance.markerStart),
    targetMarkers:
      markers.target.length > 0
        ? markers.target
        : markerFromAppearance(connector.appearance.markerEnd),
  };
}

/** The line's colour on this canvas: a draw.io line's own colour flips on a dark one; every other line keeps its colour. */
export function connectorStrokeOnCanvas(stroke: ConnectorStrokePresentation, canvasColor?: unknown): ConnectorStrokePresentation {
  return stroke.invertOnDark && isDarkCanvas(canvasColor) ? { ...stroke, color: invertForDark(stroke.color) } : stroke;
}
