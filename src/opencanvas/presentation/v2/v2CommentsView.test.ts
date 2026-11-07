import { describe, expect, it, vi } from 'vitest';
import { keyboardSpot, pinLabel, unlessGone, pinNudge, pinsOnPreview, PIN_STEP, relativeTime } from './v2CommentsView';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { addComment, addThread, ThreadError } from '../../domain/threads/threads';
import type { SceneDocumentV1, SceneNode } from '../../domain/document/types';

const NOW = Date.parse('2026-10-26T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('relativeTime', () => {
  it('reads "Just now" under a minute and for a clock that ran backwards', () => {
    expect(relativeTime(ago(0), NOW)).toBe('Just now');
    expect(relativeTime(ago(59_999), NOW)).toBe('Just now');
    expect(relativeTime(ago(-5000), NOW)).toBe('Just now');
  });

  it('counts minutes, hours and days, rounding down', () => {
    expect(relativeTime(ago(60_000), NOW)).toBe('1m');
    expect(relativeTime(ago(5 * 60_000 + 30_000), NOW)).toBe('5m');
    expect(relativeTime(ago(60 * 60_000), NOW)).toBe('1h');
    expect(relativeTime(ago(23 * 3_600_000), NOW)).toBe('23h');
    expect(relativeTime(ago(24 * 3_600_000), NOW)).toBe('1d');
    expect(relativeTime(ago(6 * 86_400_000), NOW)).toBe('6d');
  });

  it('falls back to a date after a week, and to nothing for garbage', () => {
    expect(relativeTime(ago(8 * 86_400_000), NOW)).toMatch(/\w/);
    expect(relativeTime(ago(8 * 86_400_000), NOW)).not.toMatch(/\d+d$/);
    expect(relativeTime('not a date', NOW)).toBe('');
  });
});

describe('keyboardSpot', () => {
  const viewport = { width: 1000, height: 600 };
  it('is the centre of the selected node, which the thread then anchors to', () => {
    expect(keyboardSpot({ x: 100, y: 200, width: 80, height: 40 }, viewport)).toEqual({ point: { x: 140, y: 220 }, onNode: true });
  });
  it('is the centre of the canvas when the selected node is scrolled out of view', () => {
    expect(keyboardSpot({ x: 2000, y: 200, width: 80, height: 40 }, viewport)).toEqual({ point: { x: 500, y: 300 }, onNode: false });
    expect(keyboardSpot({ x: -300, y: 200, width: 80, height: 40 }, viewport)).toEqual({ point: { x: 500, y: 300 }, onNode: false });
  });
  it('is the centre of the canvas, as a page pin, with nothing selected', () => {
    expect(keyboardSpot(null, viewport)).toEqual({ point: { x: 500, y: 300 }, onNode: false });
  });
});

describe('pinNudge', () => {
  it('moves a focused pin with Alt and an arrow, ten times as far with Shift', () => {
    expect(pinNudge('ArrowLeft', true, false)).toEqual({ x: -PIN_STEP, y: 0 });
    expect(pinNudge('ArrowDown', true, false)).toEqual({ x: 0, y: PIN_STEP });
    expect(pinNudge('ArrowUp', true, true)).toEqual({ x: 0, y: -PIN_STEP * 10 });
  });
  it('leaves a plain arrow, another key and a missing Alt alone', () => {
    expect(pinNudge('ArrowRight', false, false)).toBeNull();
    expect(pinNudge('Enter', true, false)).toBeNull();
  });
});

describe('pinsOnPreview', () => {
  const at = '2026-10-26T12:00:00.000Z';
  const box = (id: string, x: number, y: number, extra: Partial<SceneNode> = {}): SceneNode =>
    createTestNode(id, { transform: { translation: { x, y }, rotationRadians: 0, scale: { x: 1, y: 1 } }, ...extra });
  const pinned = (nodes: SceneNode[], pins: { id: string; nodeId: string | null; point: { x: number; y: number } }[]) => {
    let document = createTestDocument({ nodes });
    for (const pin of pins) {
      document = addThread(document, { pageId: document.pages[0]!.id, threadId: pin.id, nodeId: pin.nodeId, point: pin.point,
        comment: { id: `${pin.id}-m`, author: { kind: 'human', name: 'User' }, body: 'here', createdAt: at } });
    }
    return document.pages[0]!;
  };

  it('moves the pins on the shapes being dragged, and only those', () => {
    const page = pinned([box('a', 0, 0), box('b', 300, 0)], [
      { id: 'on-a', nodeId: 'a', point: { x: 10, y: 10 } }, { id: 'on-b', nodeId: 'b', point: { x: 310, y: 10 } },
      { id: 'page', nodeId: null, point: { x: 50, y: 200 } },
    ]);
    const moved = pinsOnPreview(page, [box('a', 40, 25)]);
    expect([...moved.keys()]).toEqual(['on-a']);
    expect(moved.get('on-a')).toEqual({ x: 50, y: 35 });
  });

  it('carries a pin on a child of a dragged frame, and turns a pin on a shape being rotated', () => {
    const page = pinned([box('frame', 0, 0, { kind: 'frame', size: { width: 400, height: 300 } }), box('child', 20, 20, { parentId: 'frame' }), box('r', 500, 0)], [
      { id: 'on-child', nodeId: 'child', point: { x: 30, y: 30 } }, { id: 'on-r', nodeId: 'r', point: { x: 590, y: 10 } },
    ]);
    expect(pinsOnPreview(page, [box('frame', 100, 50, { kind: 'frame', size: { width: 400, height: 300 } })]).get('on-child')).toEqual({ x: 130, y: 80 });
    // A quarter turn about the 100×50 box's centre (550, 25).
    const turned = pinsOnPreview(page, [box('r', 575, -25, { transform: { translation: { x: 575, y: -25 }, rotationRadians: Math.PI / 2, scale: { x: 1, y: 1 } } })]).get('on-r')!;
    expect(turned.x).toBeCloseTo(565);
    expect(turned.y).toBeCloseTo(65);
  });

  it('leaves a pin whose shape is gone where it last was', () => {
    const page = pinned([box('a', 0, 0)], [{ id: 'on-a', nodeId: 'a', point: { x: 10, y: 10 } }]);
    expect(pinsOnPreview({ ...page, nodes: [] }, [box('x', 5, 5)]).size).toBe(0);
  });
});

describe('pinLabel', () => {
  const thread = (number: number, bodies: string[], name = 'User') => ({
    id: `t${number}`, number, resolved: false, anchor: { nodeId: null, offset: null, point: { x: 0, y: 0 } },
    comments: bodies.map((body, i) => ({ id: `m${i}`, author: { kind: 'human' as const, name }, body, createdAt: '2026-10-26T12:00:00.000Z' })),
  });

  it('names the thread by number, author and its first words, so no two pins read alike', () => {
    expect(pinLabel(thread(3, ['Why is this a queue?']))).toBe('Comment #3 by User: Why is this a queue?');
    expect(pinLabel(thread(4, ['Why\n  is   this a queue?', 'Latency.', 'Ok']))).toBe('Comment #4 by User: Why is this a queue?, 3 messages');
  });

  it('cuts a long opening at a word, with an ellipsis', () => {
    const label = pinLabel(thread(1, ['Rename the cache layer to something that says what it actually stores for the sessions']));
    expect(label).toBe('Comment #1 by User: Rename the cache layer to something that says…');
  });
});

describe('unlessGone', () => {
  const base = createTestDocument();
  const human = { kind: 'human' as const, name: 'User' };
  const withReply = () => {
    const first = addThread(base, { pageId: base.pages[0]!.id, threadId: 't1', nodeId: null, point: { x: 1, y: 1 },
      comment: { id: 'm1', author: human, body: 'one', createdAt: '2026-10-26T12:00:00.000Z' } });
    return addComment(first, 't1', { id: 'm2', author: human, body: 'two', createdAt: '2026-10-26T12:00:00.000Z' });
  };
  const rename = (doc: SceneDocumentV1) => ({ ...doc, name: 'changed' });

  it('applies the change while the thread and message are there', () => {
    const gone = vi.fn();
    expect(unlessGone({ thread: 't1', comment: 'm2' }, rename, gone)(withReply()).name).toBe('changed');
    expect(gone).not.toHaveBeenCalled();
  });

  it('makes a change to a thread or message someone else removed first no change, and says so', () => {
    const doc = withReply();
    const gone = vi.fn();
    expect(unlessGone({ thread: 't9' }, rename, gone)(doc)).toBe(doc);
    expect(unlessGone({ thread: 't1', comment: 'm9' }, rename, gone)(doc)).toBe(doc);
    expect(gone).toHaveBeenCalledTimes(2);
  });

  it('lets every other error through', () => {
    const doc = withReply();
    expect(() => unlessGone({ thread: 't1' }, () => { throw new ThreadError('A comment cannot be empty.'); }, vi.fn())(doc)).toThrow('empty');
    expect(() => unlessGone({ thread: 't1' }, () => { throw new Error('boom'); }, vi.fn())(doc)).toThrow('boom');
  });
});
