import { resolveAnnotationVisualStyle, resolveTextVisualStyle } from '@/theme';
import { hasExplicitColor, nodePaletteName } from '../../domain/nodes/nodePalette';
import type { SceneNode } from '../../domain/document/types';
import {
  resolveFreeformNodePresentation,
  type FreeformNodePresentation,
  type StrokeNodePresentation,
} from '../../domain/nodes/freeformNodePresentation';
import { isDarkCanvas, washOnDark } from '../../domain/color/adaptiveColor';
import { pixiHexColor } from './pixiColor';

interface PixiTextNodeVisual {
  readonly presentation: Extract<FreeformNodePresentation, { kind: 'text' }>;
  readonly kind: 'text';
  readonly fill: number;
  readonly stroke: number;
  readonly text: number;
  readonly hasBackground: boolean;
}

interface PixiImageNodeVisual {
  readonly presentation: Extract<FreeformNodePresentation, { kind: 'image' }>;
  readonly kind: 'image';
  readonly fill: number;
  readonly stroke: number;
  readonly text: number;
}

interface PixiAnnotationNodeVisual {
  readonly presentation: Extract<FreeformNodePresentation, { kind: 'annotation' | 'sticky' | 'callout' }>;
  readonly kind: 'annotation' | 'sticky' | 'callout';
  readonly fill: number;
  readonly stroke: number;
  readonly text: number;
  readonly subText: number;
  readonly foldFill: number;
  readonly foldStroke: number;
}

interface PixiStrokeNodeVisual {
  readonly presentation: Extract<FreeformNodePresentation, { kind: 'pen' | 'highlighter' | 'line' | 'arrow' }>;
  readonly kind: 'pen' | 'highlighter' | 'line' | 'arrow';
  readonly fill: number; readonly stroke: number; readonly text: number;
}

export type PixiFreeformNodeVisual =
  | PixiTextNodeVisual
  | PixiImageNodeVisual
  | PixiAnnotationNodeVisual
  | PixiStrokeNodeVisual;

function isStrokePresentation(presentation: FreeformNodePresentation):
  presentation is StrokeNodePresentation {
  return presentation.kind === 'pen' || presentation.kind === 'highlighter'
    || presentation.kind === 'line' || presentation.kind === 'arrow';
}

/**
 * Annotation ink for the canvas and the SVG export. A sequence's fragment band takes its tint from the
 * fragment type, not from the author, so on a dark canvas it washes like any other default card.
 */
export function annotationColors(
  node: SceneNode,
  presentation: { readonly colorKey: string; readonly customColor?: string },
  canvasColor?: unknown
): ReturnType<typeof resolveAnnotationVisualStyle> {
  const colors = resolveAnnotationVisualStyle(presentation.colorKey, 'subtle', presentation.customColor, nodePaletteName(node));
  if (typeof node.content.seqFragmentId !== 'string' || hasExplicitColor(node, presentation.colorKey) || !isDarkCanvas(canvasColor)) return colors;
  const ink = washOnDark({ fill: colors.containerBg, stroke: colors.containerBorder, text: colors.titleText,
    subText: colors.bodyText, accentFill: colors.foldBg }, canvasColor);
  return { ...colors, containerBg: ink.fill, titleText: ink.text, bodyText: ink.subText, foldBg: ink.accentFill };
}

export function projectFreeformNodeVisual(node: SceneNode, canvasColor?: unknown): PixiFreeformNodeVisual | null {
  const presentation = resolveFreeformNodePresentation(node);
  if (!presentation) return null;
  if (presentation.kind === 'text') {
    const colors = resolveTextVisualStyle(
      presentation.colorKey,
      'subtle',
      presentation.customColor,
      'slate',
      nodePaletteName(node)
    );
    return {
      presentation,
      kind: 'text',
      fill: pixiHexColor(presentation.backgroundColor ?? '', 0xffffff),
      stroke: pixiHexColor(colors.border, 0x94a3b8),
      text: pixiHexColor(colors.text, 0x1e293b),
      hasBackground: presentation.backgroundColor !== undefined,
    };
  }
  if (presentation.kind === 'image') {
    return {
      presentation,
      kind: 'image',
      fill: 0xfff7ed,
      stroke: 0xe95420,
      text: 0x9a3412,
    };
  }
  if (isStrokePresentation(presentation)) {
    // A stroke with no colour of its own (draw.io's and Excalidraw's default black, imported) follows the theme.
    const themed = typeof node.content.strokeColor !== 'string' && presentation.kind !== 'highlighter' && isDarkCanvas(canvasColor);
    return { presentation, kind: presentation.kind, fill: 0, text: 0,
      stroke: themed ? 0xe2e8f0 : pixiHexColor(presentation.color, 0x334155) };
  }
  const colors = annotationColors(node, presentation, canvasColor);
  return {
    presentation,
    kind: presentation.kind,
    fill: pixiHexColor(colors.containerBg, 0xfef9c3),
    stroke: pixiHexColor(colors.containerBorder, 0xeab308),
    text: pixiHexColor(colors.titleText, 0x713f12),
    subText: pixiHexColor(colors.bodyText, 0x854d0e),
    foldFill: pixiHexColor(colors.foldBg, 0xfef08a),
    foldStroke: pixiHexColor(colors.foldBorder, 0xca8a04),
  };
}
