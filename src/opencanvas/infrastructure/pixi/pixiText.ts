import { Graphics, Text, type Container, type TextOptions, type TextStyleFontWeight, type TextStyleOptions } from 'pixi.js';
import { measurePortableText } from '../../domain/text/measurement';
import { FONT_STACKS, type NodeStyle } from '../../domain/nodes/nodeStyle';

export { truncateTextToWidth } from '../../domain/text/measurement';

// A text texture wider than the GPU allows fails to upload and draws as a solid block. 4096 is the floor every WebGL
// device guarantees; a huge label gives up sharpness (resolution below 1), never the label.
const MAX_TEXT_TEXTURE_PX = 4096;

/** The resolution `text` rasterizes at: the wanted one, lowered until its texture fits the GPU. Sized by the portable estimate, since measuring a Text needs a canvas. */
function textureSafeResolution(text: Text, wanted: number): number {
  const { fontSize, fontWeight, wordWrap, wordWrapWidth } = text.style;
  const measured = measurePortableText(text.text, {
    fontSize: Number(fontSize) || 12,
    fontWeight: Number(fontWeight) >= 600 ? 700 : 400,
    ...(wordWrap && wordWrapWidth > 0 ? { maxWidth: wordWrapWidth, overflow: 'wrap' as const } : {}),
  });
  const largest = Math.max(measured.width, measured.height);
  return largest * wanted > MAX_TEXT_TEXTURE_PX ? MAX_TEXT_TEXTURE_PX / largest : wanted;
}

function newText(options: TextOptions): Text {
  const text = new Text(options);
  const resolution = textureSafeResolution(text, currentTextResolution);
  if (resolution !== text.resolution) text.resolution = resolution;
  return text;
}

export function createPixiText(
  text: string,
  options: {
    readonly size: number;
    readonly weight: string;
    readonly fill: number;
    readonly family?: string;
    readonly style?: string;
    readonly wrapWidth?: number;
  }
): Text {
  return newText({
    text,
    resolution: currentTextResolution,
    style: {
      fontFamily: options.family ?? 'Inter, ui-sans-serif, system-ui, sans-serif',
      fontSize: options.size,
      fontWeight: options.weight as 'normal' | 'bold',
      fontStyle: (options.style ?? 'normal') as 'normal' | 'italic',
      fill: options.fill,
      ...(options.wrapWidth
        ? { wordWrap: true, wordWrapWidth: options.wrapWidth, breakWords: true }
        : {}),
    },
  });
}

// Labels rasterize once at a fixed resolution; zooming in scales that bitmap
// and blurs it. The host re-buckets the resolution when the zoom crosses an
// integer step so type stays crisp, without re-rasterizing on every wheel tick.
let currentTextResolution = 1;

export function textResolutionForZoom(zoom: number, devicePixelRatio: number): number {
  return Math.min(4, Math.max(1, Math.ceil(zoom * devicePixelRatio)));
}

export function currentPixiTextResolution(): number {
  return currentTextResolution;
}

export function applyTextResolution(root: Container, resolution: number): void {
  currentTextResolution = resolution;
  const visit = (node: Container): void => {
    if (node instanceof Text) {
      const safe = textureSafeResolution(node, resolution);
      if (node.resolution !== safe) node.resolution = safe;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
}

/** Pixi TextStyle for a resolved node style; `fill` already resolved to a number. */
export function pixiTextStyle(style: NodeStyle, fill: number, wrapWidth: number | null): TextStyleOptions {
  return {
    fontFamily: FONT_STACKS[style.fontFamily],
    fontSize: style.fontSize,
    fontWeight: String(style.fontWeight) as TextStyleFontWeight,
    fontStyle: style.fontStyle,
    fill,
    lineHeight: style.fontSize * style.lineHeight,
    letterSpacing: style.fontSize * style.letterSpacing,
    // Each line sits on the side the label is aligned to, as the SVG export sets it; one line is unchanged by this.
    align: style.textAlign === 'center' ? 'center' : style.textAlign === 'end' ? 'right' : 'left',
    ...(wrapWidth ? { wordWrap: true, wordWrapWidth: wrapWidth, breakWords: true } : {}),
  };
}

/** A label drawn from the node's resolved style (family renderers). */
export function createStyledPixiText(text: string, style: NodeStyle, fill: number, wrapWidth: number | null): Text {
  return newText({ text, resolution: currentTextResolution, style: pixiTextStyle(style, fill, wrapWidth) });
}

// Pixi text has no text-decoration; draw the rule per rendered line.
export function decoratePixiText(parent: Container, text: Text, style: NodeStyle, color: number): void {
  if (style.textDecoration === 'none') return;
  const lines = text.text.split('\n').length;
  const lineHeight = style.fontSize * style.lineHeight;
  const rule = new Graphics();
  // Ruled from the text's own anchor point, then placed and turned as the text is.
  const left = -text.anchor.x * text.width;
  const top = -text.anchor.y * text.height;
  const thickness = Math.max(1, style.fontSize / 14);
  for (let line = 0; line < lines; line += 1) {
    const y = style.textDecoration === 'underline'
      ? top + line * lineHeight + style.fontSize * 1.08
      : top + line * lineHeight + style.fontSize * 0.62;
    rule.rect(left, y, text.width, thickness);
  }
  rule.fill({ color });
  rule.position.copyFrom(text.position);
  rule.rotation = text.rotation;
  parent.addChild(rule);
}

/** A Text that names its node (a title, not tech or description): it stays readable at a smaller size on screen. */
export function markTitle(text: Text): Text {
  text.label = TITLE_LABEL;
  return text;
}
const TITLE_LABEL = 'title';

export function isTitle(text: Text): boolean {
  return text.label === TITLE_LABEL;
}

const stripFonts = new WeakMap<Container, number>();
/** A strip painted behind text of `fontSize` (a card header): it hides with that text, so zoomed out no empty bar stays. */
export function markStrip<T extends Container>(strip: T, fontSize: number): T {
  stripFonts.set(strip, fontSize);
  return strip;
}

/** The text size a marked strip goes with, or null for any other view. */
export function stripFont(view: Container): number | null {
  return stripFonts.get(view) ?? null;
}
