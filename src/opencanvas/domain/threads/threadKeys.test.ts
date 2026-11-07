import { describe, expect, it } from 'vitest';
import { THREAD_NUMBER_MAX } from '../document/types';
import { freeThreadId, freeThreadNumber, lowestFreeThreadNumber } from './threadKeys';

describe('thread keys', () => {
  it('numbers count up from the highest, and fall back to the lowest free one at the cap', () => {
    expect(freeThreadNumber(new Set())).toBe(1);
    expect(freeThreadNumber(new Set([1, 5]))).toBe(6);
    expect(freeThreadNumber(new Set([1, 2, THREAD_NUMBER_MAX]))).toBe(3);
    expect(lowestFreeThreadNumber(new Set([1, 2, 4]))).toBe(3);
  });

  it('an id that is taken gets the first free suffix', () => {
    expect(freeThreadId(new Set(['b']), 'a')).toBe('a');
    expect(freeThreadId(new Set(['a']), 'a')).toBe('a-2');
    expect(freeThreadId(new Set(['a', 'a-2', 'a-3']), 'a')).toBe('a-4');
  });
});
