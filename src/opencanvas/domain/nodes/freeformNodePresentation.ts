import { stencilPictureUrl } from './imageNode';
import type { SceneNode } from '../document/types';
import {
  optionalPresentationString,
  presentationString,
  safeImageUrl,
} from './nodePresentationValues';
import { normalizeStrokeInput, type StrokeInput } from './strokeInput';

export interface TextNodePresentation {
  readonly kind: 'text';
  readonly label: string;
  readonly colorKey: string;
  readonly customColor?: string;
  readonly backgroundColor?: string;
  readonly fontSizePx: number;
  readonly fontFamily: string;
  readonly fontWeight: string;
  readonly fontStyle: string;
}

export interface ImageNodePresentation {
  readonly kind: 'image';
  readonly label: string;
  readonly sourceUrl: string | null;
  readonly assetId: string | null;
  readonly opacity: number;
}

export interface AnnotationNodePresentation {
  readonly kind: 'annotation' | 'sticky' | 'callout';
  readonly title: string;
  readonly body: string;
  readonly colorKey: string;
  readonly customColor?: string;
}

export interface StrokeNodePresentation {
  readonly kind: 'pen' | 'highlighter' | 'line' | 'arrow';
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly inputSamples: readonly StrokeInput[] | null;
}

export type FreeformNodePresentation =
  | TextNodePresentation
  | ImageNodePresentation
  | AnnotationNodePresentation
  | StrokeNodePresentation;

const FONT_SIZE_ALIASES: Readonly<Record<string, number>> = {
  small: 14,
  medium: 16,
  large: 18,
};

function fontSizePx(value: unknown): number {
  const string = presentationString(value, '16');
  const parsed = Number(string);
  const size = Number.isFinite(parsed) ? parsed : (FONT_SIZE_ALIASES[string] ?? 20);
  return Math.min(96, Math.max(8, size));
}

function opacity(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

function strokeInputSamples(value: unknown, pointCount: number): readonly StrokeInput[] | null {
  if (!Array.isArray(value) || value.length !== pointCount) return null;
  const samples: StrokeInput[] = [];
  for (const sample of value) {
    if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return null;
    if (typeof sample.pressure !== 'number' || !Number.isFinite(sample.pressure)) return null;
    samples.push(normalizeStrokeInput({
      pressure: sample.pressure,
      tiltX: typeof sample.tiltX === 'number' ? sample.tiltX : 0,
      tiltY: typeof sample.tiltY === 'number' ? sample.tiltY : 0,
      twist: typeof sample.twist === 'number' ? sample.twist : 0,
    }));
  }
  return samples;
}

export function resolveFreeformNodePresentation(node: SceneNode): FreeformNodePresentation | null {
  if (node.kind === 'text') {
    const customColor = optionalPresentationString(node.content.customColor);
    const backgroundColor = optionalPresentationString(node.content.backgroundColor);
    return {
      kind: 'text',
      label: presentationString(node.content.label, 'Text'),
      colorKey: presentationString(node.content.color, 'slate'),
      ...(customColor ? { customColor } : {}),
      ...(backgroundColor ? { backgroundColor } : {}),
      fontSizePx: fontSizePx(node.content.fontSize),
      fontFamily: presentationString(node.content.fontFamily, 'inter'),
      fontWeight: presentationString(node.content.fontWeight, '500'),
      fontStyle: presentationString(node.content.fontStyle, 'normal'),
    };
  }
  if (node.kind === 'image') {
    return {
      kind: 'image',
      label: presentationString(node.content.label, 'Image'),
      sourceUrl: stencilPictureUrl(node) ?? safeImageUrl(node.content.imageUrl),
      assetId: optionalPresentationString(node.content.imageAssetId) ?? null,
      opacity: opacity(node.content.transparency),
    };
  }
  // Renderer-exact Mermaid output is inline SVG markup; on a canvas that
  // cannot mount it, it is an image whose source is that markup.
  if (node.kind === 'mermaid_svg') {
    const markup = optionalPresentationString(node.content.mermaidSvg);
    const sanitized = markup?.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '').trim();
    return {
      kind: 'image',
      label: presentationString(node.content.label, 'Mermaid diagram'),
      sourceUrl: sanitized
        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`
        : null,
      assetId: null,
      opacity: opacity(node.content.transparency),
    };
  }
  if (node.kind === 'annotation' || node.kind === 'sticky' || node.kind === 'callout') {
    const customColor = optionalPresentationString(node.content.customColor);
    return {
      kind: node.kind,
      title: presentationString(node.content.label),
      // A note with no body shows none: the editor's hint is not content.
      body: presentationString(node.content.subLabel),
      colorKey: presentationString(node.content.color, 'yellow'),
      ...(customColor ? { customColor } : {}),
    };
  }
  if (node.kind === 'pen' || node.kind === 'highlighter' || node.kind === 'line' || node.kind === 'arrow') {
    const raw = node.content.points;
    const points = Array.isArray(raw) ? raw.flatMap((point) => {
      if (!point || typeof point !== 'object' || Array.isArray(point)) return [];
      const x = point.x; const y = point.y;
      return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
        ? [{ x, y }] : [];
    }).slice(0, 4096) : [];
    if (points.length < 2) return null;
    const authoredWidth = node.content.strokeWidth;
    return { kind: node.kind, points,
      color: presentationString(node.content.strokeColor, node.kind === 'highlighter' ? '#fde047' : '#334155'),
      width: typeof authoredWidth === 'number' && Number.isFinite(authoredWidth)
        ? Math.min(64, Math.max(0.5, authoredWidth)) : node.kind === 'highlighter' ? 16 : 3,
      opacity: node.kind === 'highlighter' ? Math.min(0.5, opacity(node.content.transparency))
        : opacity(node.content.transparency),
      inputSamples: strokeInputSamples(node.content.inputSamples, points.length),
    };
  }
  return null;
}
