import { describe, expect, it } from 'vitest';
import { FRESH_GUARD, hasDraftText, outsideClick, typed } from './v2DraftGuard';

describe('draft guard', () => {
  it('closes an empty box on the first outside click', () => {
    expect(outsideClick(FRESH_GUARD, false)).toEqual({ outcome: 'close', guard: FRESH_GUARD });
  });

  it('warns on the first outside click over text, and closes on the second', () => {
    const first = outsideClick(FRESH_GUARD, true);
    expect(first.outcome).toBe('warn');
    expect(outsideClick(first.guard, true).outcome).toBe('close');
  });

  it('starts over when the text changes', () => {
    const warned = outsideClick(FRESH_GUARD, true).guard;
    const again = outsideClick(typed(warned), true);
    expect(again.outcome).toBe('warn');
    // Twice in a row after typing: warn, then close.
    expect(outsideClick(again.guard, true).outcome).toBe('close');
  });

  it('typing with nothing warned changes nothing', () => {
    expect(typed(FRESH_GUARD)).toBe(FRESH_GUARD);
  });

  it('closes when the text was erased after a warning', () => {
    const warned = outsideClick(FRESH_GUARD, true).guard;
    expect(outsideClick(typed(warned), false).outcome).toBe('close');
  });

  it('counts whitespace as empty', () => {
    expect(hasDraftText('  \n\t ')).toBe(false);
    expect(hasDraftText(' a ')).toBe(true);
    expect(hasDraftText('')).toBe(false);
  });
});
