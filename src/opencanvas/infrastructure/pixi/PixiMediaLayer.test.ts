import { Resolver } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { isSvgUrl, pixiAssetUrl, svgRasterResolution } from './PixiMediaLayer';

// CNCF icons (and any uploaded SVG) colour their paths through `<style>` rules.
const SVG = "data:image/svg+xml,%3csvg%3e%3cstyle%3e.a{fill:%23cbdd72;}.b{fill:%23fff;}%3c/style%3e%3c/svg%3e";

function resolvedBy(url: string): string {
  const resolver = new Resolver();
  resolver.add({ alias: 'icon', src: url });
  return decodeURIComponent(resolver.resolve('icon').src);
}

describe('Pixi media layer', () => {
  it('keeps the CSS braces of a data-URL SVG through the Pixi asset resolver', () => {
    expect(resolvedBy(pixiAssetUrl(SVG))).toBe(decodeURIComponent(SVG));
  });

  it('leaves file URLs alone', () => {
    expect(pixiAssetUrl('/assets/icon.svg')).toBe('/assets/icon.svg');
  });

  it('rasterizes a small SVG big enough to stay sharp, and never shrinks a big one', () => {
    expect(svgRasterResolution(18, 18)).toBe(15); // Azure: 270 px, not 18
    expect(svgRasterResolution(80, 80)).toBe(4); // AWS
    expect(svgRasterResolution(512, 256)).toBe(1);
    expect(svgRasterResolution(0, 0)).toBe(256);
  });

  it('shrinks an SVG too big for a texture: draw.io’s Arista racks say 188 × 367 inches', () => {
    // Drawn at its own 18,077 × 35,216 px the GPU refuses it and the node stays a black box.
    const resolution = svgRasterResolution(18_077, 35_216);
    expect(35_216 * resolution).toBeLessThanOrEqual(4096);
    expect(35_216 * resolution).toBeGreaterThan(4000);
  });

  it('tells SVGs (file or data URL) from other images', () => {
    expect(isSvgUrl(SVG)).toBe(true);
    expect(isSvgUrl('./assets/Athena-C_UvYoqL.svg')).toBe(true);
    expect(isSvgUrl('/a.svg?v=2')).toBe(true);
    expect(isSvgUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isSvgUrl('/photo.png')).toBe(false);
  });
});
