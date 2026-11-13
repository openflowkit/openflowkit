import type { SceneConnector } from '../document/types';
import type { Bounds2d, Point2d } from '../geometry/types';
import { resolveNodeStyle, type NodeStyle } from '../nodes/nodeStyle';
import { invertForDark, isDarkCanvas } from '../color/adaptiveColor';
import { measurePortableText } from '../text/measurement';
import { layoutRichLabel, type RichBlock } from '../text/richLabel';
import { richBaseOf } from '../text/richLabelStyle';

// Connector labels share the node style vocabulary (nodeStyle.ts) under
// `label*` appearance keys, so the renderer, the label editor and
// the style bar use one NodeStyle for both. `fill` is the label plate,
// `stroke` its border.
// Presentation resolves every connector every frame while dragging; the
// appearance object is immutable, so its identity is the cache key.
const cache = new WeakMap<object, NodeStyle>();
// Styles whose plate is the unset default; only those follow a dark canvas.
const defaultPlate = new WeakSet<NodeStyle>();
// A draw.io line's label (`darkColors: 'invert'`) as draw.io's dark mode draws it: the colours it sets flipped.
const darkVersion = new WeakMap<NodeStyle, NodeStyle>();
const LABEL_COLOURS = ['labelBackground', 'labelBorder', 'labelColor'] as const;

export function resolveConnectorLabelStyle(connector: SceneConnector): NodeStyle {
  const a = connector.appearance;
  const cached = cache.get(a);
  if (cached) return cached;
  const style = labelStyleOf(connector.id, a);
  cache.set(a, style);
  if (a.labelBackground === undefined) defaultPlate.add(style);
  if (a.darkColors === 'invert') {
    const flipped: Record<string, unknown> = { ...a };
    for (const key of LABEL_COLOURS) if (typeof flipped[key] === 'string') flipped[key] = invertForDark(flipped[key] as string);
    darkVersion.set(style, { ...labelStyleOf(connector.id, flipped as SceneConnector['appearance']), invertColors: true });
  }
  return style;
}

function labelStyleOf(id: string, a: SceneConnector['appearance']): NodeStyle {
  return resolveNodeStyle({
    id, kind: 'text', parentId: null, layerId: '', zIndex: 0,
    transform: { translation: { x: 0, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    size: { width: 0, height: 0 }, content: {}, ports: [], metadata: {}, extensions: {},
    appearance: {
      fill: a.labelBackground ?? '#ffffff',
      stroke: a.labelBorder ?? '#e2e8f0',
      strokeWidth: 1,
      textColor: a.labelColor ?? '#334155',
      fontSize: a.labelFontSize ?? 12,
      fontFamily: a.labelFontFamily ?? 'sans',
      fontWeight: a.labelFontWeight ?? 500,
      fontStyle: a.labelFontStyle ?? 'normal',
      textDecoration: a.labelTextDecoration ?? 'none',
      textPadding: 5,
      cornerRadius: 4,
    },
  });
}

/** A default label plate is the canvas colour on a dark canvas, not paper-white; an explicit one stays. */
export function connectorLabelOnCanvas(own: NodeStyle, canvasColor?: unknown): NodeStyle {
  const dark = isDarkCanvas(canvasColor);
  const style = (dark && darkVersion.get(own)) || own;
  if (!defaultPlate.has(own) || !dark) return style;
  // Ink and border are remapped by value (the unset defaults), not by flag: a label colour set to exactly
  // those defaults follows the canvas too.
  return { ...style, fill: canvasColor, textColor: style.textColor === '#334155' ? '#e2e8f0' : style.textColor,
    stroke: style.stroke === '#e2e8f0' ? '#475569' : style.stroke };
}

/** Labels wrap here, as the canvas draws them. */
export const LABEL_WRAP_WIDTH = 140;

// ponytail: exporters cannot measure text, so the plate is padded generously (0.58em per character, an
// over-estimate) — upgrade to a shared metrics table if long labels overflow.
const CHAR_EM = 0.58;

/** The lines a label breaks into: the author's own breaks, then greedy word wrap at LABEL_WRAP_WIDTH (a word is never split), measured as the canvas wraps. */
export function connectorLabelLines(text: string, style: NodeStyle): readonly string[] {
  const fits = (line: string) => measurePortableText(line, { fontSize: style.fontSize, fontWeight: style.fontWeight, overflow: 'visible' }).width <= LABEL_WRAP_WIDTH;
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = [];
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && !fits(`${line} ${word}`)) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    return [...lines, line];
  });
}

/** The height of one label line, as the plate counts it. */
export function connectorLabelLineHeight(style: NodeStyle): number {
  return style.fontSize * 1.25;
}

/** The plate behind a label, centred on its point, padded as the canvas pads it. */
export function connectorLabelPlate(text: string, style: NodeStyle, point: Point2d): Bounds2d {
  const lines = connectorLabelLines(text, style);
  const width = Math.max(...lines.map((line) => line.length)) * style.fontSize * CHAR_EM + style.textPadding * 2;
  const height = lines.length * connectorLabelLineHeight(style) + style.textPadding;
  return { x: point.x - width / 2, y: point.y - height / 2, width, height };
}

/** The plate of a formatted label: its words set on one line a paragraph, as draw.io sets a line's label, centred on `point`. */
export function connectorRichPlate(blocks: readonly RichBlock[], style: NodeStyle, point: Point2d): Bounds2d {
  const { width, height } = layoutRichLabel(blocks, richBaseOf(style), null, { keepWords: style.keepWords });
  const pad = style.textPadding;
  return { x: point.x - width / 2 - pad, y: point.y - height / 2 - pad / 2, width: width + pad * 2, height: height + pad };
}
