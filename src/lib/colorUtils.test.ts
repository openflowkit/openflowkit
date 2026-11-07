import { describe, expect, it } from 'vitest';
import { contrastRatio, getContrastText, mixHex, normalizeHex, readableTextOn } from './colorUtils';

describe('hex parsing', () => {
  it('reads #rgb, #rrggbb and #rrggbbaa, and rejects anything else', () => {
    expect(normalizeHex('#1E3')).toBe('#11ee33');
    expect(normalizeHex('1e3a5f')).toBe('#1e3a5f');
    expect(normalizeHex(' #1e3a5fff ')).toBe('#1e3a5f');
    expect(normalizeHex('#1e3a5f80')).toBe('#1e3a5f');
    for (const bad of ['', '#12', '#12345', '#1234567', '#123456789', '#gggggg', 'red']) expect(normalizeHex(bad), bad).toBeNull();
  });

  it('gives an 8-digit hex the ink, contrast and mix of its 6-digit colour', () => {
    expect(readableTextOn('#1e3a5fff')).toBe('#ffffff');
    expect(getContrastText('#1e3a5fff')).toBe('#ffffff');
    expect(getContrastText('#a5d8ffff')).toBe('#0f172a');
    expect(getContrastText('#f59f00ff')).toBe('#0f172a');
    expect(contrastRatio('#1e3a5fff', '#ffffff')).toBe(contrastRatio('#1e3a5f', '#ffffff'));
    expect(mixHex('#1e3a5fff', '#ffffffff', 0.5)).toBe(mixHex('#1e3a5f', '#ffffff', 0.5));
  });
});
