import type { SceneNode } from '../../opencanvas/domain/document/types';
import { createBounds2d } from '../../opencanvas/domain/geometry/bounds';
import { transformBounds } from '../../opencanvas/domain/geometry/matrix';
import type { Bounds2d, Matrix2d, Point2d, Size2d } from '../../opencanvas/domain/geometry/types';

// draw.io paints shapes and lines in one order (its cell tree, depth first), so a line drawn after a shape it
// crosses goes over it. Ours paints lines over backdrops and under every other shape: a shape a later line crosses
// is a backdrop here, so that line stays on top as it does in draw.io.

export interface StackedBox { readonly id: string; readonly rank: number; readonly box: Bounds2d }
export interface StackedLine { readonly rank: number; readonly points: readonly Point2d[] }

/** A line that only touches a shape's edge (where it ends on it) doesn't cross it. */
const INSET = 2;
const CELL = 256;

/** Whether the segment a→b passes through the box's inside (Liang–Barsky clipping). */
function crosses(a: Point2d, b: Point2d, box: Bounds2d): boolean {
  const [left, top, right, bottom] = [box.x + INSET, box.y + INSET, box.x + box.width - INSET, box.y + box.height - INSET];
  if (right <= left || bottom <= top) return false;
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  let [low, high] = [0, 1];
  for (const [p, q] of [[-dx, a.x - left], [dx, right - a.x], [-dy, a.y - top], [dy, bottom - a.y]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) low = Math.max(low, t); else high = Math.min(high, t);
    if (low > high) return false;
  }
  return true;
}

interface Pile { readonly box: Bounds2d; readonly members: StackedBox[]; under: number }

/** The ids of the boxes some line drawn after them crosses. */
export function drawnUnderLines(boxes: readonly StackedBox[], lines: readonly StackedLine[]): Set<string> {
  // Boxes of one size in one place are one test (a pile of them is crossed by a line or not), each pile with its
  // boxes in paint order and how many are already under a line.
  const piles = new Map<string, Pile>();
  for (const entry of boxes) {
    const { x, y, width, height } = entry.box;
    if (!(width > 0 && height > 0)) continue;
    const key = `${x},${y},${width},${height}`;
    const pile = piles.get(key);
    if (pile) pile.members.push(entry); else piles.set(key, { box: entry.box, members: [entry], under: 0 });
  }
  // Piles bucketed on a grid, so each segment only meets the piles near it.
  const grid = new Map<string, Pile[]>();
  for (const pile of piles.values()) {
    pile.members.sort((left, right) => left.rank - right.rank);
    const { x, y, width, height } = pile.box;
    for (let gx = Math.floor(x / CELL); gx <= Math.floor((x + width) / CELL); gx += 1) {
      for (let gy = Math.floor(y / CELL); gy <= Math.floor((y + height) / CELL); gy += 1) {
        const key = `${gx},${gy}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(pile); else grid.set(key, [pile]);
      }
    }
  }
  // Each cell's piles by their first box's paint order, so a line looks only at those drawn before it; `skip` jumps
  // past piles wholly under lines already (path-compressed).
  const cells = new Map([...grid].map(([key, bucket]) => {
    const sorted = bucket.sort((left, right) => left.members[0]!.rank - right.members[0]!.rank);
    return [key, { sorted, skip: Int32Array.from(sorted, (_, index) => index) }];
  }));
  const next = (skip: Int32Array, index: number): number => {
    let root = index;
    while (root < skip.length && skip[root] !== root) root = skip[root]!;
    for (let at = index; at < skip.length && skip[at] !== at; ) { const after = skip[at]!; skip[at] = root; at = after; }
    return root;
  };
  const under = new Set<string>();
  for (const { rank, points } of lines) {
    for (let index = 1; index < points.length; index += 1) {
      const [a, b] = [points[index - 1]!, points[index]!];
      for (let gx = Math.floor(Math.min(a.x, b.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x) / CELL); gx += 1) {
        for (let gy = Math.floor(Math.min(a.y, b.y) / CELL); gy <= Math.floor(Math.max(a.y, b.y) / CELL); gy += 1) {
          const cell = cells.get(`${gx},${gy}`);
          if (!cell) continue;
          for (let at = next(cell.skip, 0); at < cell.sorted.length && cell.sorted[at]!.members[0]!.rank < rank; at = next(cell.skip, at + 1)) {
            const pile = cell.sorted[at]!;
            const { members } = pile;
            if (pile.under === members.length) { cell.skip[at] = at + 1; continue; }
            if (members[pile.under]!.rank > rank || !crosses(a, b, pile.box)) continue;
            for (; pile.under < members.length && members[pile.under]!.rank < rank; pile.under += 1) under.add(members[pile.under]!.id);
            if (pile.under === members.length) cell.skip[at] = at + 1;
          }
        }
      }
    }
  }
  return under;
}

/** Each cell's place in draw.io's paint order: its tree, a parent before its children, siblings in file order. */
export function treeRanks(rootId: string, childrenOf: (id: string) => readonly { readonly id: string }[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const stack = [rootId]; stack.length; ) {
    const id = stack.pop()!;
    if (ranks.has(id)) continue;
    ranks.set(id, ranks.size);
    stack.push(...childrenOf(id).map((child) => child.id).reverse());
  }
  return ranks;
}

/** A node's cell rank: its own cell's, or for a part drawn for a cell (`<cell>:shape`) that cell's. */
export function rankOf(nodeId: string, ranks: ReadonlyMap<string, number>): number | undefined {
  for (let id = nodeId; ; id = id.slice(0, id.lastIndexOf(':'))) {
    const rank = ranks.get(id);
    if (rank !== undefined || !id.includes(':')) return rank;
  }
}

/** Marks `underLines` on the nodes a line drawn after them crosses; `placed` is each node's page matrix and size. */
export function stackUnderLines(
  nodes: SceneNode[], lines: readonly { readonly id: string; readonly points: readonly Point2d[] }[],
  ranks: ReadonlyMap<string, number>, placed: ReadonlyMap<string, { readonly matrix: Matrix2d; readonly size: Size2d }>,
): void {
  const boxes = nodes.flatMap((node) => {
    const [rank, at] = [rankOf(node.id, ranks), placed.get(node.id)];
    return rank === undefined || !at ? [] : [{ id: node.id, rank, box: transformBounds(at.matrix, createBounds2d(0, 0, at.size.width, at.size.height)) }];
  });
  const under = drawnUnderLines(boxes, lines.map(({ id, points }) => ({ rank: ranks.get(id) ?? Infinity, points })));
  for (const [index, node] of nodes.entries()) if (under.has(node.id)) nodes[index] = { ...node, content: { ...node.content, underLines: true } };
}
