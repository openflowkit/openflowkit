import { describe, expect, it } from 'vitest';
import { drawioSketchFillStyle, drawioSketchSeed } from './drawioSketch';
import { loadDrawioShapes } from './drawioShapes';

describe('drawioSketchSeed', () => {
  it('hashes a cell id as draw.io does, the same each time', () => {
    expect(drawioSketchSeed('')).toBe(1);
    expect(drawioSketchSeed('a')).toBe(31 + 97);
    expect(drawioSketchSeed('cell-7')).toBe(drawioSketchSeed('cell-7'));
    expect(drawioSketchSeed('x'.repeat(40))).toBe(drawioSketchSeed('x'.repeat(40)) | 0);
  });
});

describe('drawioSketchFillStyle', () => {
  it('draws white and gradients solid, other fills hatched, and keeps a written style', () => {
    expect(drawioSketchFillStyle(undefined, '#FFFFFF', undefined)).toBe('solid');
    expect(drawioSketchFillStyle('auto', '#dae8fc', '#7ea6e0')).toBe('solid');
    expect(drawioSketchFillStyle(undefined, '#dae8fc', undefined)).toBe('hachure');
    expect(drawioSketchFillStyle('dots', '#dae8fc', 'none')).toBe('hachure');
    expect(drawioSketchFillStyle('zigzag', '#ffffff', undefined)).toBe('zigzag');
  });
});

describe('the sketch canvas', () => {
  it('draws a sketched box by hand: wobbly strokes, hatching in the fill’s colour, the same for the same seed', async () => {
    const code = await loadDrawioShapes();
    const style = { shape: 'rectangle', sketch: '1', sketchSeed: '42', fillColor: '#dae8fc', strokeColor: '#6c8ebf' };
    const parts = code.draw(style, 120, 60)!.parts;
    // Rough.js draws each edge twice and hatches the fill with lines: many strokes, none of them the plain box.
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.some((part) => part.stroke === 'fill')).toBe(true);
    expect(parts.some((part) => part.stroke === 'stroke' && part.path.some((command) => command.kind === 'cubic'))).toBe(true);
    expect(code.draw(style, 120, 60)!.parts).toEqual(parts);
    expect(code.draw({ ...style, sketchSeed: '43' }, 120, 60)!.parts).not.toEqual(parts);
  });

  it('leaves an unsketched box as draw.io draws it plainly', async () => {
    const code = await loadDrawioShapes();
    const parts = code.draw({ shape: 'rectangle', fillColor: '#dae8fc' }, 120, 60)!.parts;
    expect(parts).toHaveLength(1);
    expect(parts[0]!.path.filter((command) => command.kind === 'line')).toHaveLength(3);
  });
});

describe('the comic canvas', () => {
  it('jiggles a comic box as draw.io does, sketched or not, the same for the same seed', async () => {
    const code = await loadDrawioShapes();
    for (const style of [{ shape: 'rectangle', comic: '1', sketchSeed: '42' }, { shape: 'rectangle', sketch: '1', sketchStyle: 'comic', sketchSeed: '42' }]) {
      const parts = code.draw(style, 120, 60)!.parts;
      // draw.io breaks each edge into short jiggled steps (one per 10 px), off the straight line.
      const lines = parts.flatMap((part) => part.path).filter((command) => command.kind === 'line');
      expect(lines.length).toBeGreaterThan(30);
      expect(code.draw(style, 120, 60)!.parts).toEqual(parts);
      expect(code.draw({ ...style, sketchSeed: '43' }, 120, 60)!.parts).not.toEqual(parts);
    }
  });
});
