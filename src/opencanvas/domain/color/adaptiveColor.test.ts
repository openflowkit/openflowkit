import { describe, expect, it } from 'vitest';
import { contrastRatio, darkInkReadsOn, darkWashFill, invertForDark, paintOver, numericColorToHex, resolveAdaptiveInk } from './adaptiveColor';

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
    expect(paintOver('#a5d8ff4d', '#191b19', 1)).toBe(paintOver('#a5d8ff', '#191b19', 0x4d / 255));
    expect(darkInkReadsOn('#15aabf')).toBe(true);
    expect(darkInkReadsOn('#43545e')).toBe(false);
  });

  it('converts renderer colours to six-digit hex', () => {
    expect(numericColorToHex(0x191b19)).toBe('#191b19');
  });
});

describe('invertForDark', () => {
  it('draws a colour as draw.io’s dark mode does: lightness flipped, hue kept', () => {
    // draw.io's own mxUtils.getInverseColor (93%, 180°) gives #1a1a1a #959595 #121212 #ededed #1d293b #bdc7d4
    // #d86d0c; ours are those lifted so white lands on our canvas (#191b19) instead of draw.io's page (#121212).
    expect(['#f5f5f5', '#666666', '#ffffff', '#000000', '#dae8fc', '#232f3e', '#ed7100'].map(invertForDark))
      .toEqual(['#212321', '#989998', '#191b19', '#eeeeee', '#233140', '#bfc9d6', '#d97213']);
  });

  it('keeps a light-grey group a step above the dark canvas, as draw.io keeps it above its page', () => {
    expect(contrastRatio(invertForDark('#f5f5f5'), '#191b19')).toBeGreaterThan(contrastRatio('#1a1a1a', '#121212') - 0.01);
  });

  it('turns a three-digit colour black, as draw.io’s dark mode does (its parser reads #444 as two-digit pairs)', () => {
    expect(['#444', '#EEE', '#333'].map(invertForDark)).toEqual(['#080a08', '#080a08', '#080a08']);
    expect(invertForDark('#444444')).not.toBe('#080a08');
  });

  it('keeps a see-through colour’s alpha and leaves anything not a hex colour alone', () => {
    expect(invertForDark('#ffffff80')).toBe('#191b1980');
    expect(invertForDark('transparent')).toBe('transparent');
    expect(invertForDark('rgba(0,0,0,0.1)')).toBe('rgba(0,0,0,0.1)');
  });
});
