// A unified line diff of two DSL texts, so an agent can read what changed instead of the whole text again.

type LineEdit = { readonly op: ' ' | '-' | '+'; readonly text: string };

/**
 * Each line of `before` and `after` as kept, removed or added, in order (longest common subsequence). The lines both
 * texts start and end with need no table: a shared start is kept line by line, and a shared end adds the same to every
 * entry of the table, so leaving it out changes none of the choices.
 */
function lineEdits(before: readonly string[], after: readonly string[]): LineEdit[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let rows = before.length;
  let cols = after.length;
  while (rows > start && cols > start && before[rows - 1] === after[cols - 1]) {
    rows -= 1;
    cols -= 1;
  }
  // ponytail: O(n·m) in the changed middle, bounded by the canvas-edit caps (1000 shapes) — Myers' O(ND) past them.
  // common[i - start][j - start]: the longest common run of before[i..rows) and after[j..cols).
  const common = Array.from({ length: rows - start + 1 }, () => new Uint32Array(cols - start + 1));
  const at = (i: number, j: number) => common[i - start]![j - start]!;
  for (let i = rows - 1; i >= start; i -= 1) {
    for (let j = cols - 1; j >= start; j -= 1) {
      common[i - start]![j - start] = before[i] === after[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const edits: LineEdit[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (before[i] === after[j]) {
      edits.push({ op: ' ', text: before[i]! });
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      // On a tie the removal goes first, as diff -u prints a changed line.
      edits.push({ op: '-', text: before[i]! });
      i += 1;
    } else {
      edits.push({ op: '+', text: after[j]! });
      j += 1;
    }
  }
  // One side's middle is used up. The other side's rest goes out (or in), keeping a line that matches the next line
  // of the shared end, as the walk over a table of the whole texts does.
  const adding = i === rows;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      edits.push({ op: ' ', text: before[i]! });
      i += 1;
      j += 1;
    } else if (adding) {
      edits.push({ op: '+', text: after[j]! });
      j += 1;
    } else {
      edits.push({ op: '-', text: before[i]! });
      i += 1;
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
