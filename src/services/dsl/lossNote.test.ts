import { describe, expect, it } from 'vitest';
import { lossNote } from './lossNote';

describe('lossNote', () => {
  it('names one loss, or the first three and how many more', () => {
    expect(lossNote(['a'])).toBe('1 thing didn’t come across: a.');
    expect(lossNote(['a', 'b', 'c', 'd', 'e'])).toBe('5 things didn’t come across: a; b; c; and 2 more.');
  });
});
