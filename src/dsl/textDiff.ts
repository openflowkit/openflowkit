// A unified line diff of two DSL texts, so an agent can read what changed instead of the whole text again.

/** Each line of `before` and `after` as kept, removed or added, in order (longest common subsequence). */
function lineEdits(before: readonly string[], after: readonly string[]) {
  const rows = before.length;
  const cols = after.length;
  // common[i][j]: the longest common run of before[i..] and after[j..].
  const common = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      common[i]![j] = before[i] === after[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  const edits: { readonly op: ' ' | '-' | '+'; readonly text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    if (i < rows && j < cols && before[i] === after[j]) {
      edits.push({ op: ' ', text: before[i]! });
      i += 1;
      j += 1;
    } else if (i < rows && (j === cols || common[i + 1]![j]! >= common[i]![j + 1]!)) {
      // On a tie the removal goes first, as diff -u prints a changed line.
      edits.push({ op: '-', text: before[i]! });
      i += 1;
    } else {
      edits.push({ op: '+', text: after[j]! });
      j += 1;
    }
  }
  return edits;
}

const splitLines = (text: string) => (text === '' ? [] : text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n'));

/**
 * `before` → `after` as unified-diff hunks (`@@ -a,b +c,d @@`, then ` `, `-` and `+` lines) with `context`
 * unchanged lines around each change. Empty when the texts have the same lines.
 */
export function unifiedLineDiff(before: string, after: string, context = 2): string {
  const edits = lineEdits(splitLines(before), splitLines(after));
  const changed = edits.flatMap((edit, index) => (edit.op === ' ' ? [] : [index]));
  if (changed.length === 0) return '';
  // Changes closer than two contexts apart share a hunk.
  const spans: [number, number][] = [];
  for (const index of changed) {
    const last = spans[spans.length - 1];
    if (last && index - last[1] <= context * 2 + 1) last[1] = index;
    else spans.push([index, index]);
  }
  // Line numbers before each edit, on both sides.
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const edit of edits) {
    oldAt.push(oldLine);
    newAt.push(newLine);
    if (edit.op !== '+') oldLine += 1;
    if (edit.op !== '-') newLine += 1;
  }
  const out: string[] = [];
  for (const [first, last] of spans) {
    const start = Math.max(0, first - context);
    const end = Math.min(edits.length - 1, last + context);
    const hunk = edits.slice(start, end + 1);
    const oldCount = hunk.filter((edit) => edit.op !== '+').length;
    const newCount = hunk.filter((edit) => edit.op !== '-').length;
    // An empty side is numbered by the line before it, as diff -u does.
    const oldStart = oldCount ? oldAt[start]! : oldAt[start]! - 1;
    const newStart = newCount ? newAt[start]! : newAt[start]! - 1;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const edit of hunk) out.push(`${edit.op}${edit.text}`);
  }
  return `${out.join('\n')}\n`;
}
