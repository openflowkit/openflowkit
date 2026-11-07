import { describe, expect, it } from 'vitest';
import { unifiedLineDiff } from './textDiff';

describe('unifiedLineDiff', () => {
  it('is empty when the lines are the same, a trailing newline or CRLF aside', () => {
    expect(unifiedLineDiff('', '')).toBe('');
    expect(unifiedLineDiff('a\nb', 'a\nb\n')).toBe('');
    expect(unifiedLineDiff('a\r\nb\r\n', 'a\nb')).toBe('');
  });

  it('shows a changed line with its context', () => {
    expect(unifiedLineDiff('a\nb\nc\nd\ne', 'a\nb\nC\nd\ne', 1)).toBe('@@ -2,3 +2,3 @@\n b\n-c\n+C\n d\n');
  });

  it('numbers additions and removals at either end', () => {
    expect(unifiedLineDiff('a\nb', 'a\nb\nc', 1)).toBe('@@ -2,1 +2,2 @@\n b\n+c\n');
    expect(unifiedLineDiff('a\nb', 'b', 1)).toBe('@@ -1,2 +1,1 @@\n-a\n b\n');
    expect(unifiedLineDiff('', 'a')).toBe('@@ -0,0 +1,1 @@\n+a\n');
    expect(unifiedLineDiff('a', '')).toBe('@@ -1,1 +0,0 @@\n-a\n');
  });

  it('splits changes far apart into hunks and joins close ones', () => {
    const before = Array.from({ length: 12 }, (_, index) => `l${index + 1}`).join('\n');
    const far = before.replace('l2', 'x2').replace('l11', 'x11');
    expect(unifiedLineDiff(before, far, 1)).toBe('@@ -1,3 +1,3 @@\n l1\n-l2\n+x2\n l3\n@@ -10,3 +10,3 @@\n l10\n-l11\n+x11\n l12\n');
    const near = before.replace('l2', 'x2').replace('l5', 'x5');
    expect(unifiedLineDiff(before, near, 1)).toBe('@@ -1,6 +1,6 @@\n l1\n-l2\n+x2\n l3\n l4\n-l5\n+x5\n l6\n');
  });

  it('keeps a moved line as one removal and one addition', () => {
    expect(unifiedLineDiff('a\nb\nc', 'b\nc\na', 0)).toBe('@@ -1,1 +0,0 @@\n-a\n@@ -3,0 +3,1 @@\n+a\n');
  });
});
