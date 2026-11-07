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

  it('takes its context from the lines both texts start and end with', () => {
    const before = 'a\nb\nc\nd\ne\nf';
    expect(unifiedLineDiff(before, `x\n${before}`, 1)).toBe('@@ -1,1 +1,2 @@\n+x\n a\n');
    expect(unifiedLineDiff(before, 'a\nb\nc\nC\nd\ne\nf', 1)).toBe('@@ -3,2 +3,3 @@\n c\n+C\n d\n');
    expect(unifiedLineDiff(before, 'a\nb\nc\nd\ne', 1)).toBe('@@ -5,2 +5,1 @@\n e\n-f\n');
  });

  // Only the changed middle is compared line against line, so one edit in a long text costs about its length.
  it('numbers one edit in a long text at the start, middle or end', () => {
    const lines = Array.from({ length: 6000 }, (_, index) => `n${index + 1}`);
    const before = lines.join('\n');
    const recolour = (line: number) => lines.map((text, index) => (index === line - 1 ? `${text} [red]` : text)).join('\n');
    expect(unifiedLineDiff(before, recolour(1))).toBe('@@ -1,3 +1,3 @@\n-n1\n+n1 [red]\n n2\n n3\n');
    expect(unifiedLineDiff(before, recolour(3000))).toBe('@@ -2998,5 +2998,5 @@\n n2998\n n2999\n-n3000\n+n3000 [red]\n n3001\n n3002\n');
    expect(unifiedLineDiff(before, recolour(6000))).toBe('@@ -5998,3 +5998,3 @@\n n5998\n n5999\n-n6000\n+n6000 [red]\n');
    const shifted = [...lines.slice(0, 2999), ...lines.slice(3000, 4000), 'n4000b', ...lines.slice(4000)].join('\n');
    expect(unifiedLineDiff(before, shifted)).toBe('@@ -2998,5 +2998,4 @@\n n2998\n n2999\n-n3000\n n3001\n n3002\n'
      + '@@ -3999,4 +3998,5 @@\n n3999\n n4000\n+n4000b\n n4001\n n4002\n');
  });

  it('lines up a change next to a repeat of the shared end as comparing every line would', () => {
    expect(unifiedLineDiff('b\na', 'a\na', 0)).toBe('@@ -1,1 +0,0 @@\n-b\n@@ -2,0 +2,1 @@\n+a\n');
    expect(unifiedLineDiff('a\nb\na', 'a\na\na', 0)).toBe('@@ -2,1 +1,0 @@\n-b\n@@ -3,0 +3,1 @@\n+a\n');
  });
});
