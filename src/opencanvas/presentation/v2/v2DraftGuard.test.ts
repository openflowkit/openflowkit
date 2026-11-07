import { describe, expect, it } from 'vitest';
import { CommentDrafts, draftKey, FRESH_GUARD, hasDraftText, outsideClick, typed } from './v2DraftGuard';

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

describe('CommentDrafts', () => {
  it('keeps text by box, drops blank text, and tells its owner of every write', () => {
    const heard: number[] = [];
    const drafts = new CommentDrafts(() => heard.push(1));
    drafts.set(draftKey.reply('t1'), 'unsent');
    drafts.set(draftKey.compose('p1'), '   ');
    expect(drafts.get(draftKey.reply('t1'))).toBe('unsent');
    expect(drafts.has(draftKey.compose('p1'))).toBe(false);
    expect(drafts.get(draftKey.compose('p1'))).toBe('');
    expect(heard).toHaveLength(2);
  });

  it('knows a thread holds unsent text through its reply or an edit, and forgets a deleted thread', () => {
    const drafts = new CommentDrafts();
    expect(drafts.inThread('t1')).toBe(false);
    drafts.set(draftKey.edit('t1', 'm2'), 'better');
    drafts.set(draftKey.reply('t10'), 'other thread');
    expect(drafts.inThread('t1')).toBe(true);
    drafts.dropThread('t1');
    expect(drafts.inThread('t1')).toBe(false);
    expect(drafts.inThread('t10')).toBe(true);
  });
});
