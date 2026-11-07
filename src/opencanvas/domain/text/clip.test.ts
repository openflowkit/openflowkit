import { describe, expect, it } from 'vitest';
import { clipText } from './clip';

describe('clipText', () => {
  it('keeps text that fits', () => {
    expect(clipText('', 3)).toBe('');
    expect(clipText('abc', 3)).toBe('abc');
  });

  it('cuts at most `max` UTF-16 units, never inside a character', () => {
    expect(clipText('abcd', 3)).toBe('abc');
    // 🙂 is two units: a cut at 3 would leave half of it.
    expect(clipText('ab🙂', 3)).toBe('ab');
    // A thumbs-up with a skin tone is one character of four units; a family, one of eight.
    expect(clipText('a👍🏽', 4)).toBe('a');
    expect(clipText('a👍🏽', 5)).toBe('a👍🏽');
    expect(clipText('x👨‍👩‍👧z', 8)).toBe('x');
    // An accent written as its own mark stays with its letter.
    expect(clipText('aé', 2)).toBe('a');
  });
});
