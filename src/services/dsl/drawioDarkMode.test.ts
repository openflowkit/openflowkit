import { describe, expect, it } from 'vitest';
import { createTestConnector, createTestNode } from '../../opencanvas/testing/builders/documentBuilder';
import { applyAdaptiveColors, keepsSetColors } from './drawioDarkMode';

const flipped = () => createTestNode('a', { appearance: { fill: '#2f5b7c', darkColors: 'invert' } });

describe('applyAdaptiveColors', () => {
  it('flips a page’s colours as draw.io does by default (`auto`, or unset), whatever colours it uses', () => {
    for (const setting of [undefined, 'auto']) {
      const nodes = [flipped()];
      applyAdaptiveColors(nodes, [], setting);
      expect(nodes[0]!.appearance.darkColors).toBe('invert');
    }
  });

  it('keeps the colours a page sets when it says `simple` or `none`', () => {
    for (const setting of ['simple', 'none']) {
      const nodes = [flipped()];
      const lines = [{ ...createTestConnector('c', 'a', 'a'), appearance: { darkColors: 'invert' } }];
      applyAdaptiveColors(nodes, lines, setting);
      expect(nodes[0]!.appearance.darkColors).toBeUndefined();
      expect(lines[0]!.appearance.darkColors).toBeUndefined();
      expect(keepsSetColors(setting)).toBe(true);
    }
  });
});
