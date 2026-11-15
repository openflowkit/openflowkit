import type { SceneNode, ScenePage } from '../document/types';
import type { Point2d, Size2d } from '../geometry/types';
import type { JsonObject } from '../document/json';
import { nextNodeZIndex } from './shapeNode';
import { invertForDark, isDarkCanvas } from '../color/adaptiveColor';

// Placed images fit inside 480 px on their long side, like a dropped photo in
// Figma; the bytes live in the assets store and the node keeps only the id.
export const MAX_IMAGE_SIDE = 480;

export function fitImageSize(natural: Size2d, max = MAX_IMAGE_SIDE): Size2d {
  const width = Math.max(1, natural.width);
  const height = Math.max(1, natural.height);
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

interface CreateImageNodeOptions {
  readonly id: string;
  readonly at: Point2d;
  readonly size: Size2d;
  readonly label?: string;
  /** Content-addressed asset in the IndexedDB `assets` store. */
  readonly assetId?: string;
  /** Data URL or remote URL; kept for exports that inline the bytes. */
  readonly url?: string;
  /** Fill the box instead of keeping the picture's proportions. */
  readonly stretch?: boolean;
  readonly appearance?: JsonObject;
}

export function createImageNode(page: ScenePage, options: CreateImageNodeOptions): SceneNode {
  return {
    id: options.id,
    kind: 'image',
    parentId: null,
    layerId: page.layers[0]?.id ?? 'default',
    zIndex: nextNodeZIndex(page),
    transform: { translation: { ...options.at }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    size: { ...options.size },
    content: {
      label: options.label ?? 'Image',
      ...(options.assetId ? { imageAssetId: options.assetId } : {}),
      ...(options.url ? { imageUrl: options.url } : {}),
      ...(options.stretch ? { imageFit: 'stretch' } : {}),
    },
    appearance: { ...options.appearance },
    ports: [],
    metadata: {},
    extensions: {},
  };
}

/**
 * A picture the node's own colours paint (draw.io's stencils): its SVG has these two stand-ins where its fill and its
 * line go, so changing the node's Fill or Line repaints it. Stored as `content.stencilSvg`.
 */
export const STENCIL_FILL = '#fe0001';
export const STENCIL_STROKE = '#fe0002';

const hex = (value: unknown, fallback: string): string => (typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? value.slice(0, 7) : value === 'transparent' ? 'none' : fallback);

/** The node's stencil picture in its own colours, as an SVG data URL; null when it isn't one. */
export function stencilPictureUrl(node: Pick<SceneNode, 'content' | 'appearance'>, canvasColor?: unknown): string | null {
  const template = node.content.stencilSvg;
  if (typeof template !== 'string' || !template.startsWith('<svg')) return null;
  // A draw.io stencil (`darkColors: 'invert'`) is painted in its colours flipped on a dark canvas, as draw.io does:
  // the node's own and those the stencil sets itself.
  const flip = node.appearance.darkColors === 'invert' && isDarkCanvas(canvasColor);
  const own = (color: string) => (color === 'none' || !flip ? color : invertForDark(color));
  const svg = template.replace(/#[0-9a-f]{6}\b/gi, (color) => {
    const lower = color.toLowerCase();
    if (lower === STENCIL_FILL) return own(hex(node.appearance.fill, '#ffffff'));
    if (lower === STENCIL_STROKE) return own(hex(node.appearance.stroke, '#000000'));
    return flip ? invertForDark(lower) : color;
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
