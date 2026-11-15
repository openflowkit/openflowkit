import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { measurePortableText, type PortableTextStyle } from './measurement';

const LABELS: string[] = [
  'Auth', 'API Gateway', 'Validate the incoming payment request against fraud rules and limits',
  'user-service-v2-production-eu-west-1-primary', 'Données utilisateur persistées',
  '用户认证服务和数据库连接池管理', 'Deploy 🚀 to production 🎉 now', 'multiple   spaces   inside   label',
  '  leading and trailing  ', 'line one\nline two is a bit longer than the first\n\nline four',
  'https://example.com/a/very/long/path/that/never/breaks/anywhere/at/all?query=1&other=2',
  'MMMMMMMMMMMMMMMMMMMMMMMMMM WWWWWWWWWWW iiiiiiiiiiiiiiiiiiii', 'a'.repeat(300),
  'word '.repeat(80), 'x\ty z w long tab and nbsp separated words here ok', '',
];
const LABEL_STYLES: PortableTextStyle[] = [
  { fontSize: 14, fontWeight: 600 as const, maxWidth: 160, overflow: 'wrap' as const },
  { fontSize: 14, fontWeight: 600 as const, maxWidth: 160, maxLines: 2, overflow: 'wrap' as const },
  { fontSize: 11, maxWidth: 90, maxLines: 3, overflow: 'wrap' as const },
  { fontSize: 12, maxWidth: 40, overflow: 'wrap' as const },
  { fontSize: 14, maxWidth: 120, overflow: 'ellipsis' as const },
  { fontSize: 14, maxWidth: 120, overflow: 'clip' as const },
  { fontSize: 10, overflow: 'visible' as const },
];


describe('portable text measurement', () => {
  it('is deterministic and distinguishes narrow, wide, CJK, and emoji glyphs', () => {
    const style = { fontSize: 10 };
    expect(measurePortableText('iii', style).width).toBeLessThan(measurePortableText('WWW', style).width);
    expect(measurePortableText('漢字', style).width).toBe(20);
    expect(measurePortableText('😀', style).width).toBe(10);
    expect(measurePortableText('repeat', style)).toEqual(measurePortableText('repeat', style));
  });

  it('wraps and ellipsizes within width and line limits', () => {
    const wrapped = measurePortableText('alpha beta gamma delta', {
      fontSize: 10, maxWidth: 42, maxLines: 2, overflow: 'wrap',
    });
    expect(wrapped.lines).toHaveLength(2);
    expect(wrapped.displayText).toMatch(/…$/);
    expect(wrapped.width).toBeLessThanOrEqual(42);
    const ellipsis = measurePortableText('long content', {
      fontSize: 10, maxWidth: 30, overflow: 'ellipsis',
    });
    expect(ellipsis.displayText).toMatch(/…$/);
  });

  it('keeps a line that fits the limit, even when the space after it would not', () => {
    const text = 'Validate the incoming payment request against fraud rules and limits';
    const style = { fontSize: 14, fontWeight: 600 as const, overflow: 'wrap' as const };
    const roomy = measurePortableText(text, { ...style, maxWidth: 288 });
    expect(roomy.lines).toEqual(['Validate the incoming payment request', 'against fraud rules and limits']);
    const snug = measurePortableText(text, { ...style, maxWidth: Math.ceil(roomy.width) });
    expect(snug.lines).toEqual(roomy.lines);
  });

  it('breaks a long name after a hyphen or slash, not mid-word', () => {
    const style = { fontSize: 14, fontWeight: 600 as const, overflow: 'wrap' as const, maxWidth: 110 };
    expect(measurePortableText('shopping-assistant', style).lines).toEqual(['shopping-', 'assistant']);
    expect(measurePortableText('components/shopping-assistant', style).lines.every((l) => /[-/]$|^[a-z-]+$/.test(l))).toBe(true);
    // No break point at all: it still breaks, as before.
    expect(measurePortableText('abcdefghijklmnopqrstuvwxyzabcdefghij', style).lines.length).toBeGreaterThan(1);
  });

  it('keeps a word wider than the line whole when asked, as draw.io wraps', () => {
    const style = { fontSize: 14, fontWeight: 400 as const, overflow: 'wrap' as const, maxWidth: 60, keepWords: true };
    expect(measurePortableText('Partnerships and more', style).lines).toEqual(['Partnerships', 'and more']);
    expect(measurePortableText('a Partnerships', style).lines).toEqual(['a', 'Partnerships']);
    expect(measurePortableText('Partnerships', { ...style, keepWords: false }).lines.length).toBeGreaterThan(1);
  });

  it('wraps a 20,000-character label in linear time', () => {
    const style = { fontSize: 14, fontWeight: 600 as const, maxWidth: 160, overflow: 'wrap' as const };
    for (const label of ['word '.repeat(4_000), 'x'.repeat(20_000)]) {
      const started = performance.now();
      const measured = measurePortableText(label, { ...style, maxLines: 3 });
      expect(performance.now() - started).toBeLessThan(30);
      expect(measured.lines).toHaveLength(3);
      expect(measured.truncated).toBe(true);
    }
    const started = performance.now();
    expect(measurePortableText('word '.repeat(4_000), style).lines.length).toBeGreaterThanOrEqual(1_000);
    expect(performance.now() - started).toBeLessThan(60);
  });

  it('wraps representative labels exactly as the quadratic version did', () => {
    // Captured from the implementation before the one-pass rewrite; only a hyphen or slash name (no space to break at) now breaks after the - or / (hash re-captured 2026-10-12, lane MAP).
    expect(measurePortableText('Validate the incoming payment request against fraud rules and limits', LABEL_STYLES[0]!).lines)
      .toEqual(['Validate the incoming', 'payment request', 'against fraud rules', 'and limits']);
    expect(measurePortableText('Validate the incoming payment request against fraud rules and limits', LABEL_STYLES[1]!).lines)
      .toEqual(['Validate the incoming', 'payment request…']);
    expect(measurePortableText('Validate the incoming payment request against fraud rules and limits', LABEL_STYLES[2]!).lines)
      .toEqual(['Validate the', 'incoming', 'payment reques…']);
    const everything = LABELS.map((label) => LABEL_STYLES.map((style) => {
      const { lines, width, height, truncated } = measurePortableText(label, style);
      return { lines, width, height, truncated };
    }));
    expect(createHash('sha256').update(JSON.stringify(everything)).digest('hex')).toBe('709b27ca737bb1a69d5840918a3d1904f2a374cc516e5f7808ff5f1d09a305fb');
  });
});
