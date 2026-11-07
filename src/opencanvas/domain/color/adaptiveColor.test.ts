import { describe, expect, it } from 'vitest';
import { darkInkReadsOn, darkWashFill, paintOver, numericColorToHex, resolveAdaptiveInk } from './adaptiveColor';

describe('adaptive canvas colour', () => {
  it('chooses readable ink for light and dark canvas grounds', () => {
    expect(resolveAdaptiveInk(undefined, '#f7f7f5')).toBe('#0f172a');
    expect(resolveAdaptiveInk('auto', '#191b19')).toBe('#ffffff');
  });

  it('keeps explicit user colour overrides', () => {
    expect(resolveAdaptiveInk('#123ABC', '#191b19')).toBe('#123abc');
  });

  it('shows a see-through fill with the canvas through it, and picks the ink that reads on what shows', () => {
    expect(paintOver('#a5d8ff', '#191b19', 1)).toBe('#a5d8ff');
    expect(paintOver('#a5d8ff', '#191b19', 0.3)).toBe('#43545e');
    // A dark wash of white over a yellow zone is still nearly the yellow; transparent shows what is below.
    expect(paintOver(darkWashFill('#ffffff'), '#ffec99', 1)).toBe('#ffeea1');
    expect(paintOver('transparent', '#ffec99', 1)).toBe('#ffec99');
    expect(darkInkReadsOn('#15aabf')).toBe(true);
    expect(darkInkReadsOn('#43545e')).toBe(false);
  });

  it('converts renderer colours to six-digit hex', () => {
    expect(numericColorToHex(0x191b19)).toBe('#191b19');
  });
});
