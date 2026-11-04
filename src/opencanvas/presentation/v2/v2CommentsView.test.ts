import { describe, expect, it } from 'vitest';
import { avatarColor, keyboardSpot, pinNudge, PIN_STEP, relativeTime } from './v2CommentsView';

const NOW = Date.parse('2026-10-26T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('relativeTime', () => {
  it('reads "Just now" under a minute and for a clock that ran backwards', () => {
    expect(relativeTime(ago(0), NOW)).toBe('Just now');
    expect(relativeTime(ago(59_999), NOW)).toBe('Just now');
    expect(relativeTime(ago(-5000), NOW)).toBe('Just now');
  });

  it('counts minutes, hours and days, rounding down', () => {
    expect(relativeTime(ago(60_000), NOW)).toBe('1m');
    expect(relativeTime(ago(5 * 60_000 + 30_000), NOW)).toBe('5m');
    expect(relativeTime(ago(60 * 60_000), NOW)).toBe('1h');
    expect(relativeTime(ago(23 * 3_600_000), NOW)).toBe('23h');
    expect(relativeTime(ago(24 * 3_600_000), NOW)).toBe('1d');
    expect(relativeTime(ago(6 * 86_400_000), NOW)).toBe('6d');
  });

  it('falls back to a date after a week, and to nothing for garbage', () => {
    expect(relativeTime(ago(8 * 86_400_000), NOW)).toMatch(/\w/);
    expect(relativeTime(ago(8 * 86_400_000), NOW)).not.toMatch(/\d+d$/);
    expect(relativeTime('not a date', NOW)).toBe('');
  });
});

describe('avatars', () => {
  it('gives a name one stable colour, regardless of case and padding', () => {
    expect(avatarColor('Ada')).toBe(avatarColor(' ada '));
    expect(avatarColor('Ada')).toMatch(/^hsl\(\d{1,3} 55% 42%\)$/);
  });

  it('spreads different names over different hues', () => {
    const hues = new Set(['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal'].map(avatarColor));
    expect(hues.size).toBeGreaterThan(4);
  });
});

describe('keyboardSpot', () => {
  const viewport = { width: 1000, height: 600 };
  it('is the centre of the selected node, which the thread then anchors to', () => {
    expect(keyboardSpot({ x: 100, y: 200, width: 80, height: 40 }, viewport)).toEqual({ point: { x: 140, y: 220 }, onNode: true });
  });
  it('is the centre of the canvas when the selected node is scrolled out of view', () => {
    expect(keyboardSpot({ x: 2000, y: 200, width: 80, height: 40 }, viewport)).toEqual({ point: { x: 500, y: 300 }, onNode: false });
    expect(keyboardSpot({ x: -300, y: 200, width: 80, height: 40 }, viewport)).toEqual({ point: { x: 500, y: 300 }, onNode: false });
  });
  it('is the centre of the canvas, as a page pin, with nothing selected', () => {
    expect(keyboardSpot(null, viewport)).toEqual({ point: { x: 500, y: 300 }, onNode: false });
  });
});

describe('pinNudge', () => {
  it('moves a focused pin with Alt and an arrow, ten times as far with Shift', () => {
    expect(pinNudge('ArrowLeft', true, false)).toEqual({ x: -PIN_STEP, y: 0 });
    expect(pinNudge('ArrowDown', true, false)).toEqual({ x: 0, y: PIN_STEP });
    expect(pinNudge('ArrowUp', true, true)).toEqual({ x: 0, y: -PIN_STEP * 10 });
  });
  it('leaves a plain arrow, another key and a missing Alt alone', () => {
    expect(pinNudge('ArrowRight', false, false)).toBeNull();
    expect(pinNudge('Enter', true, false)).toBeNull();
  });
});
