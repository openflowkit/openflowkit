import { describe, expect, it } from 'vitest';
import type { SceneNode } from '../document/types';
import { contrastRatio as contrast, mixHex } from '../../../lib/colorUtils';
import { darkWashFill } from '../color/adaptiveColor';
import { nodeStyleFont, resolveNodeStyle } from './nodeStyle';
import { createShapeNode } from './shapeNode';
import { createTestDocument } from '../../testing/builders/documentBuilder';
import { PALETTE_KEYS, paletteResolver } from './nodePalette';

function node(overrides: Partial<SceneNode>): SceneNode {
  return {
    id: 'n', kind: 'process', parentId: null, layerId: 'default', zIndex: 0,
    transform: { translation: { x: 0, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    size: { width: 160, height: 72 }, content: { shape: 'rounded', label: 'A' }, appearance: {},
    ports: [], metadata: {}, extensions: {}, ...overrides,
  };
}

describe('resolveNodeStyle', () => {
  it('reads an 8-digit fill, as the custom picker saves it, like its 6-digit colour', () => {
    for (const canvas of ['#f7f7f5', '#191b19']) {
      for (const [hex, ink] of [['#1e3a5f', '#ffffff'], ['#a5d8ff', '#0f172a'], ['#f59f00', '#0f172a']] as const) {
        const picked = resolveNodeStyle(node({ appearance: { fill: `${hex}ff` } }), canvas);
        expect(picked.textColor, `${hex} on ${canvas}`).toBe(ink);
        expect(picked.textColor).toBe(resolveNodeStyle(node({ appearance: { fill: hex } }), canvas).textColor);
      }
    }
  });

  it('keeps an 8-digit text colour, and gives the sub-label of a dark 8-digit fill an ink that reads on it', () => {
    expect(resolveNodeStyle(node({ appearance: { fill: '#ffffffff', textColor: '#ff0000ff' } }), '#f7f7f5').textColor).toBe('#ff0000');
    const style = resolveNodeStyle(node({ content: { shape: 'actor', label: 'Ops', subLabel: '[Person]' }, appearance: { fill: '#08427bff', textColor: '#ffffff' } }), '#f7f7f5');
    expect(contrast(style.fill, style.subTextColor!)).toBeGreaterThanOrEqual(4.5);
  });

  it('gives the sub-label of a dark authored fill an ink that reads on it, light canvas or dark', () => {
    for (const canvas of [undefined, '#f7f7f5', '#191b19']) {
      const style = resolveNodeStyle(node({ content: { shape: 'actor', label: 'Ops', subLabel: '[Person]' }, appearance: { fill: '#08427b', textColor: '#ffffff' } }), canvas);
      expect(contrast(style.fill, style.textColor), String(canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(style.fill, style.subTextColor!), String(canvas)).toBeGreaterThanOrEqual(4.5);
    }
    // A light fill keeps the palette's own sub-label ink.
    expect(resolveNodeStyle(node({ appearance: { fill: '#f5f3ff', textColor: '#5b21b6' } })).subTextColor).toBeUndefined();
    // Palette swatches and architecture cards render exactly as before.
    for (const key of PALETTE_KEYS) {
      const solid = paletteResolver()(key, 'solid');
      expect(resolveNodeStyle(node({ appearance: { fill: solid.fill, textColor: solid.textColor } })).subTextColor, key).toBeUndefined();
    }
    const card = node({ kind: 'architecture', content: { label: 'API', assetPresentation: 'card' }, appearance: { fill: '#08427b', textColor: '#ffffff' } });
    expect(resolveNodeStyle(card).subTextColor).toBeUndefined();
  });
  it('adapts unpinned text ink to canvas but preserves explicit ink', () => {
    expect(resolveNodeStyle(node({ kind: 'text' }), '#191b19').textColor).toBe('#ffffff');
    expect(resolveNodeStyle(node({ kind: 'text', appearance: { textColor: '#ef4444' } }), '#191b19').textColor).toBe('#ef4444');
  });
  it('adapts an unpinned shape label against its visible backdrop', () => {
    expect(resolveNodeStyle(node({ appearance: { fill: 'transparent' } }), '#191b19').textColor).toBe('#ffffff');
    expect(resolveNodeStyle(node({ appearance: { fill: '#fef2f2' } }), '#191b19').textColor).toBe('#0f172a');
    expect(resolveNodeStyle(node({ appearance: { fill: 'transparent', textColor: '#ef4444' } }), '#191b19').textColor).toBe('#ef4444');
  });
  it('turns a frame default wash faint on a dark canvas and keeps authored fills', () => {
    const frame = node({ kind: 'section', content: { label: 'Frame', color: 'slate' } });
    const light = resolveNodeStyle(frame, '#f7f7f5');
    expect(light.fill).toBe('rgba(241,245,249,0.52)');
    const dark = resolveNodeStyle(frame, '#191b19');
    expect(dark.fill).toBe('rgba(241,245,249,0.08)');
    expect(dark.textColor).toBe('#ffffff');
    expect(resolveNodeStyle(node({ kind: 'section', appearance: { fill: '#fef2f2' } }), '#191b19').fill).toBe('#fef2f2');
  });
  it('washes a default node on a dark canvas but never an explicit colour', () => {
    expect(resolveNodeStyle(node({}), '#191b19')).toMatchObject({ fill: 'rgba(255,255,255,0.08)', textColor: '#ffffff' });
    expect(resolveNodeStyle(node({}), '#f7f7f5').fill).toBe('#ffffff');
    const explicit = [
      node({ content: { shape: 'rounded', label: 'A', color: 'blue' } }),
      node({ content: { shape: 'rounded', label: 'A', color: 'custom', customColor: '#123456' } }),
      node({ kind: 'text', content: { label: 'A', backgroundColor: '#fef2f2' } }),
    ];
    for (const each of explicit) {
      expect(resolveNodeStyle(each, '#191b19').fill, JSON.stringify(each.content)).toBe(resolveNodeStyle(each, '#f7f7f5').fill);
    }
  });
  // Found 2026-10-11 (U4-12): a drawn rectangle stays paper-white on a dark canvas, a glaring block.
  it('washes a drawn shape on its default paper fill in dark; a fill the author picked stays', () => {
    const page = createTestDocument({ nodes: [] }).pages[0]!;
    const drawn = createShapeNode(page, { kind: 'rectangle', id: 'r', at: { x: 0, y: 0 }, label: 'A' });
    expect(resolveNodeStyle(drawn, '#191b19')).toMatchObject({ fill: 'rgba(255,255,255,0.08)', textColor: '#ffffff' });
    expect(resolveNodeStyle(drawn, '#f7f7f5').fill).toBe('#fdfdfb');
    const picked = createShapeNode(page, { kind: 'rectangle', id: 'p', at: { x: 0, y: 0 }, appearance: { fill: '#fde68a' } });
    expect(resolveNodeStyle(picked, '#191b19').fill).toBe('#fde68a');
  });

  it('washes a C4 card on its own kind hue in dark, but keeps an authored colour', () => {
    const card = (content: Record<string, unknown>) => node({ kind: 'architecture', content: { label: 'A', icon: 'tabler/user', ...content } });
    const kind = card({ color: 'violet', archKindColor: 'violet' });
    const dark = resolveNodeStyle(kind, '#191b19');
    expect(dark.fill).toMatch(/^rgba\(\d+,\d+,\d+,0\.08\)$/);
    expect(dark.fill).not.toBe(resolveNodeStyle(card({ color: 'blue', archKindColor: 'blue' }), '#191b19').fill);
    expect(dark.subTextColor).toBeDefined();
    expect(resolveNodeStyle(kind, '#f7f7f5').fill).toBe(resolveNodeStyle(card({ color: 'violet' }), '#f7f7f5').fill);
    const authored = card({ color: 'red', archKindColor: 'violet' });
    expect(resolveNodeStyle(authored, '#191b19').fill).toBe(resolveNodeStyle(authored, '#f7f7f5').fill);
    const bold = card({ color: 'violet', colorMode: 'filled', archKindColor: 'violet' });
    expect(resolveNodeStyle(bold, '#191b19').fill).toBe(resolveNodeStyle(bold, '#f7f7f5').fill);
    const plain = card({ color: 'violet' });
    expect(resolveNodeStyle(plain, '#191b19').fill).toBe(resolveNodeStyle(plain, '#f7f7f5').fill);
  });
  it('gives descriptions and kind tags on a dark wash readable ink; light and explicit colours are untouched', () => {
    const canvas = '#191b19';
    const washed = [
      node({}),
      node({ kind: 'architecture', content: { label: 'A' } }),
      node({ kind: 'frame', content: { label: 'F', color: 'slate' } }),
      node({ kind: 'section', content: { label: 'S', color: 'slate' } }),
    ];
    for (const each of washed) {
      const dark = resolveNodeStyle(each, canvas);
      const rgb = darkWashFill(dark.fill).match(/\d+/g)!.map(Number);
      const backdrop = mixHex(canvas, `#${rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`, Number(dark.fill.match(/[\d.]+\)$/)![0].slice(0, -1)));
      expect(dark.subTextColor, each.kind).toBeDefined();
      expect(contrast(dark.subTextColor!, backdrop), each.kind).toBeGreaterThanOrEqual(4.5);
      expect(resolveNodeStyle(each, '#f7f7f5').subTextColor, each.kind).toBeUndefined();
    }
    const pinned = node({ appearance: { textColor: '#ef4444' } });
    expect(resolveNodeStyle(pinned, canvas).subTextColor).toBeUndefined();
    expect(resolveNodeStyle(node({ content: { shape: 'rounded', label: 'A', color: 'blue' } }), canvas).subTextColor).toBeUndefined();
  });
  it('falls back to the palette for shapes with no appearance keys', () => {
    const style = resolveNodeStyle(node({ content: { shape: 'rounded', color: 'blue' } }));
    expect(style.fill).toBe('#eff6ff');
    expect(style.stroke).toBe('#60a5fa');
    expect(style.cornerRadius).toBe(12);
    expect(style.fontSize).toBe(14);
    expect(style.fontWeight).toBe(600);
    expect(style.textPadding).toBe(16);
  });

  it('prefers flat appearance keys and clamps them', () => {
    const style = resolveNodeStyle(node({ appearance: {
      fill: '#FF0000', stroke: 'transparent', strokeWidth: 99, cornerRadius: -4, fontSize: 200,
      fontFamily: 'mono', fontWeight: 700, fontStyle: 'italic', textDecoration: 'underline',
      textAlign: 'end', textVerticalAlign: 'bottom', lineHeight: 3, letterSpacing: 0.1, textPadding: 4,
      opacity: 0.5, shadow: true,
    } }));
    expect(style).toMatchObject({
      fill: '#ff0000', stroke: 'transparent', strokeWidth: 24, cornerRadius: 0, fontSize: 96,
      fontFamily: 'mono', fontWeight: 700, fontStyle: 'italic', textDecoration: 'underline',
      textAlign: 'end', textVerticalAlign: 'bottom', lineHeight: 2, letterSpacing: 0.1, textPadding: 4,
      opacity: 0.5, shadow: true,
    });
  });

  it('ignores malformed values', () => {
    const style = resolveNodeStyle(node({ appearance: { fill: 'red', fontFamily: 'wingdings', fontWeight: 'x' } }));
    expect(style.fill).toBe('#ffffff');
    expect(style.fontFamily).toBe('sans');
    expect(style.fontWeight).toBe(600);
  });

  it('reads legacy text-node content keys', () => {
    const style = resolveNodeStyle(node({ kind: 'text', content: {
      label: 'T', fontSize: 'large', fontFamily: 'inter', fontWeight: '700', fontStyle: 'italic',
      customColor: '#123456', backgroundColor: '#fefefe',
    } }));
    expect(style).toMatchObject({
      fill: '#fefefe', stroke: 'transparent', strokeWidth: 0, fontSize: 18, fontFamily: 'sans',
      fontWeight: 700, fontStyle: 'italic', textColor: '#123456', textPadding: 8,
    });
  });

  it('text node defaults: no fill, no stroke, 16px medium', () => {
    const style = resolveNodeStyle(node({ kind: 'text', content: { label: 'T' } }));
    expect(style).toMatchObject({ fill: 'transparent', strokeWidth: 0, fontSize: 16, fontWeight: 500 });
  });

  it('builds a CSS font shorthand scaled by zoom', () => {
    const style = resolveNodeStyle(node({ appearance: { fontSize: 20, fontFamily: 'serif', fontStyle: 'italic' } }));
    expect(nodeStyleFont(style, 2)).toBe('italic 600 40px/1.2 Georgia, "Iowan Old Style", "Times New Roman", serif');
  });
});

describe('icon card styles', () => {
  const card = (iconPlacement: string) => node({
    kind: 'architecture',
    content: { label: 'API', assetPresentation: 'icon', contentLayout: { version: 1, iconPlacement } },
  });

  it('paints an icon tile\'s plate and leaves its caption on the canvas', () => {
    expect(resolveNodeStyle(card('top'))).toMatchObject({ cornerRadius: 14, textAlign: 'center', textVerticalAlign: 'top', textPadding: 4 });
  });

  it('paints a row card as one rounded card with its text start-aligned and centred vertically', () => {
    const style = resolveNodeStyle(card('left'));
    expect(style).toMatchObject({ cornerRadius: 10, strokeWidth: 1, textAlign: 'start', textVerticalAlign: 'middle', textPadding: 12 });
    expect(style.fill).toBe(paletteResolver()('white', 'pastel').fill);
  });
});
