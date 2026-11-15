import { describe, expect, it } from 'vitest';
import { drawnUnderLines, rankOf, treeRanks } from './drawioStacking';

const box = (id: string, rank: number, x: number, y = 0, width = 100, height = 100) => ({ id, rank, box: { x, y, width, height } });

describe('drawnUnderLines', () => {
  it('puts under a line the shapes drawn before it that it crosses', () => {
    const line = { rank: 5, points: [{ x: -50, y: 50 }, { x: 1000, y: 50 }] };
    expect(drawnUnderLines([box('before', 1, 0), box('after', 9, 200), box('aside', 2, 0, 400)], [line])).toEqual(new Set(['before']));
  });

  it('leaves a shape the line only ends on, at its edge', () => {
    const line = { rank: 5, points: [{ x: 100, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 0 }] };
    expect(drawnUnderLines([box('start', 1, 0), box('end', 2, 250, -100)], [line])).toEqual(new Set());
  });

  it('finds a crossing on a page far from the origin and across grid cells', () => {
    const line = { rank: 3, points: [{ x: -5000, y: -5000 }, { x: 5000, y: 5000 }] };
    expect(drawnUnderLines([box('far', 0, 2000, 2000, 300, 300)], [line])).toEqual(new Set(['far']));
  });
});

describe('drawnUnderLines on a pile of boxes in one place', () => {
  it('puts under a line only the boxes of the pile drawn before it', () => {
    const pile = [box('a', 1, 0), box('b', 3, 0), box('c', 7, 0)];
    const line = { rank: 5, points: [{ x: 50, y: -10 }, { x: 50, y: 110 }] };
    expect(drawnUnderLines(pile, [line])).toEqual(new Set(['a', 'b']));
  });

  it('opens a large pile no line crosses quickly', () => {
    const pile = Array.from({ length: 20_000 }, (_, index) => box(`b${index}`, index * 2, 0));
    const lines = Array.from({ length: 20_000 }, (_, index) => ({ rank: index * 2 + 1, points: [{ x: 50, y: 0 }, { x: 50, y: 0 }] }));
    const started = performance.now();
    expect(drawnUnderLines(pile, lines).size).toBe(0);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('treeRanks and rankOf', () => {
  it('ranks a parent before its children and siblings in file order, and a drawn part as its cell', () => {
    const tree: Record<string, string[]> = { 0: ['1'], 1: ['a', 'e'], a: ['a1'], e: [] };
    const ranks = treeRanks('0', (id) => (tree[id] ?? []).map((child) => ({ id: child })));
    expect([...ranks.keys()]).toEqual(['0', '1', 'a', 'a1', 'e']);
    expect(rankOf('a:shape', ranks)).toBe(2);
    expect(rankOf('missing:x', ranks)).toBeUndefined();
  });
});
