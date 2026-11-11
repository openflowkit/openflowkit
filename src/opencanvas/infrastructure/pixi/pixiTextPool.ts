import { Text, type Container } from 'pixi.js';
import type { NodeStyle } from '../../domain/nodes/nodeStyle';
import { createPixiText, createStyledPixiText, currentPixiTextResolution } from './pixiText';

type PlainOptions = Parameters<typeof createPixiText>[1];

/**
 * Label Texts rasterize to a texture on creation, and Pixi frees that texture when the Text is destroyed, so a redraw
 * that destroys and re-creates every label re-rasterizes all of them. A renderer takes back last draw's Texts here and
 * reuses those with the same text and style; what a draw does not take is destroyed at its end.
 */
export class PixiTextPool {
  private free = new Map<string, Text[]>();
  private readonly keys = new WeakMap<Text, string>();

  styled(text: string, style: NodeStyle, fill: number, wrapWidth: number | null): Text {
    const key = ['s', currentPixiTextResolution(), style.fontSize, style.fontFamily, style.fontWeight, style.fontStyle, style.textDecoration,
      style.lineHeight, style.letterSpacing, style.textAlign, fill, wrapWidth ?? '', text].join('|');
    return this.take(key, () => createStyledPixiText(text, style, fill, wrapWidth));
  }

  plain(text: string, options: PlainOptions): Text {
    const key = ['p', currentPixiTextResolution(), JSON.stringify(options), text].join('|');
    return this.take(key, () => createPixiText(text, options));
  }

  /** Takes back the Texts that are direct children of a label's content and destroys the rest of it. */
  recycle(content: Container): void {
    for (const child of [...content.children]) {
      if (!(child instanceof Text)) continue;
      child.removeFromParent();
      const key = this.keys.get(child);
      if (key === undefined) child.destroy();
      else this.free.set(key, [...(this.free.get(key) ?? []), child]);
    }
    content.destroy({ children: true });
  }

  /** Destroys the Texts no draw took back. */
  flush(): void {
    for (const texts of this.free.values()) texts.forEach((text) => text.destroy());
    this.free.clear();
  }

  private take(key: string, make: () => Text): Text {
    const cached = this.free.get(key)?.pop();
    if (cached) {
      cached.anchor.set(0, 0);
      cached.rotation = 0;
      cached.label = '';
      cached.visible = true;
      return cached;
    }
    const created = make();
    this.keys.set(created, key);
    return created;
  }
}
