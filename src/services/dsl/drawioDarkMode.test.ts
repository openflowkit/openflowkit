import { describe, expect, it } from 'vitest';
import type { SceneConnector, SceneNode } from '../../opencanvas/domain/document/types';
import { drawnDark, keepDarkDrawnPage } from './drawioDarkMode';

const box = (fill: string | undefined, width: number): SceneNode => ({
  id: `${fill}-${width}`, kind: 'process', parentId: null, layerId: 'default', zIndex: 0,
  transform: { translation: { x: 0, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
  size: { width, height: 10 }, content: {}, ports: [], metadata: {}, extensions: {},
  appearance: { darkColors: 'invert', ...(fill ? { fill } : {}) },
});

describe('draw.io pages in the dark theme', () => {
  it('calls a page dark when more of its solid fill area is dark than light', () => {
    expect(drawnDark([box('#333333', 100), box('#ffffff', 50)])).toBe(true);
    expect(drawnDark([box('#333333', 50), box('#f5f5f5', 100)])).toBe(false);
    // See-through and unset fills are not counted; a page of only those is light.
    expect(drawnDark([box('transparent', 500), box('#33333380', 500), box(undefined, 500)])).toBe(false);
  });

  it('keeps a page drawn dark as it is, and leaves a light page to flip', () => {
    const dark = [box('#333333', 100), box('#ffffff', 50)];
    keepDarkDrawnPage(dark);
    expect(dark.every((node) => node.appearance.darkColors === undefined)).toBe(true);
    const line = { id: 'l', appearance: { darkColors: 'invert', stroke: '#ffffff' } } as unknown as SceneConnector;
    const lines = [line];
    keepDarkDrawnPage([box('#333333', 100)], lines);
    expect(lines[0]!.appearance).toEqual({ stroke: '#ffffff' });
    const light = [box('#f5f5f5', 100)];
    keepDarkDrawnPage(light);
    expect(light[0]!.appearance.darkColors).toBe('invert');
  });
});
