import { describe, expect, it } from 'vitest';
import { commitSessionCommand, createDocumentSession, redoSessionCommand, undoSessionCommand, updateSessionThreads } from '../../application/session/session';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import type { DocumentCommand } from '../commands/types';
import { COMMENT_BODY_MAX, type SceneDocumentV1, type SceneNode } from '../document/types';
import { validateSceneDocumentV1 } from '../document/validation';
import { buildProductionDuplicatePageCommand } from '../../application/active-document/productionPages';
import {
  ThreadError,
  addComment,
  addThread,
  carryThreads,
  editComment,
  findThread,
  moveThread,
  nextThreadNumber,
  openThreadCount,
  removeComment,
  removeThread,
  setThreadResolved,
  withFreeThreadNumbers,
  withoutThreads,
} from './threads';

const human = { kind: 'human' as const, name: 'Ada' };
const agent = { kind: 'agent' as const, name: 'Claude Code' };
const at = '2026-10-26T12:00:00.000Z';

function node(id: string, x = 0, y = 0, overrides: Partial<SceneNode> = {}): SceneNode {
  return createTestNode(id, { transform: { translation: { x, y }, rotationRadians: 0, scale: { x: 1, y: 1 } }, ...overrides });
}

function withThread(document: SceneDocumentV1, threadId = 't1', nodeId: string | null = 'a', point = { x: 110, y: 120 }) {
  return addThread(document, {
    pageId: 'page-1', threadId, nodeId, point,
    comment: { id: `${threadId}-m1`, author: human, body: '  Why is this here?  ', createdAt: at },
  });
}

function move(target: SceneNode, x: number, y: number): DocumentCommand {
  return { kind: 'set-node', id: `move:${target.id}`, label: 'Move', pageId: 'page-1', before: target, after: node(target.id, x, y) };
}

const page = (document: SceneDocumentV1) => document.pages[0]!;

// Page 1 with node a, page 2 empty; documents are immutable, so cases that need two pages start from this one.
const TWO_PAGES = (() => {
  const base = createTestDocument({ nodes: [node('a', 100, 100)] });
  return { ...base, pages: [page(base), { ...page(base), id: 'page-2', name: 'Page 2', nodes: [] }] } as SceneDocumentV1;
})();

describe('comment threads', () => {
  it('pins to a node relative to its world origin, or to the page', () => {
    const document = withThread(withThread(createTestDocument({ nodes: [node('a', 100, 100)] })), 't2', null, { x: 5, y: 6 });
    const [onNode, onPage] = page(document).threads!;
    expect(onNode!.anchor).toEqual({ nodeId: 'a', offset: { x: 10, y: 20 }, point: { x: 110, y: 120 } });
    expect(onPage!.anchor).toEqual({ nodeId: null, offset: null, point: { x: 5, y: 6 } });
    expect(onNode!.comments[0]!.body).toBe('Why is this here?');
    expect(validateSceneDocumentV1(document).success).toBe(true);
  });

  it('pins to the page when the node is not on it', () => {
    const document = withThread(createTestDocument(), 't1', 'missing');
    expect(page(document).threads![0]!.anchor.nodeId).toBeNull();
  });

  it('uses the world origin of a nested node', () => {
    const document = withThread(createTestDocument({ nodes: [node('p', 100, 0), node('a', 10, 0, { parentId: 'p' })] }), 't1', 'a', { x: 115, y: 0 });
    expect(page(document).threads![0]!.anchor.offset).toEqual({ x: 5, y: 0 });
  });

  it('replies, edits, resolves and deletes', () => {
    let document = withThread(createTestDocument({ nodes: [node('a')] }));
    document = addComment(document, 't1', { id: 'm2', author: agent, body: 'It routes auth.', createdAt: at });
    document = editComment(document, 't1', 'm2', 'It routes auth traffic.', '2026-10-26T12:01:00.000Z');
    expect(findThread(document, 't1')!.thread.comments[1]).toMatchObject({ body: 'It routes auth traffic.', editedAt: '2026-10-26T12:01:00.000Z' });
    document = setThreadResolved(document, 't1', true);
    expect(openThreadCount(page(document))).toBe(0);
    // A reply reopens it.
    document = addComment(document, 't1', { id: 'm3', author: human, body: 'Thanks', createdAt: at });
    expect(findThread(document, 't1')!.thread.resolved).toBe(false);
    document = removeComment(document, 't1', 'm3');
    expect(findThread(document, 't1')!.thread.comments).toHaveLength(2);
    // Deleting the opening message deletes the thread, and the last thread drops the key.
    document = removeComment(document, 't1', 't1-m1');
    expect(page(document).threads).toBeUndefined();
    expect(validateSceneDocumentV1(document).success).toBe(true);
  });

  it('refuses empty, too long, unknown and duplicate input', () => {
    const document = withThread(createTestDocument({ nodes: [node('a')] }));
    expect(() => addComment(document, 't1', { id: 'x', author: human, body: '   ', createdAt: at })).toThrow(ThreadError);
    expect(() => addComment(document, 't1', { id: 'x', author: human, body: 'x'.repeat(COMMENT_BODY_MAX + 1), createdAt: at })).toThrow(ThreadError);
    expect(() => addComment(document, 'nope', { id: 'x', author: human, body: 'hi', createdAt: at })).toThrow(ThreadError);
    expect(() => editComment(document, 't1', 'nope', 'hi', at)).toThrow(ThreadError);
    expect(() => removeThread(document, 'nope')).toThrow(ThreadError);
    expect(() => withThread(document)).toThrow(ThreadError);
    expect(() => addThread(document, { pageId: 'nope', threadId: 't9', nodeId: null, point: { x: 0, y: 0 }, comment: { id: 'm', author: human, body: 'hi', createdAt: at } })).toThrow(ThreadError);
  });
});

describe('comment validation', () => {
  const valid = withThread(createTestDocument({ nodes: [node('a')] }));
  const threadAt = (patch: object) => ({ ...valid, pages: [{ ...page(valid), threads: [{ ...page(valid).threads![0]!, ...patch }] }] });

  it('accepts a thread whose node is gone', () => {
    expect(validateSceneDocumentV1({ ...valid, pages: [{ ...page(valid), nodes: [] }] }).success).toBe(true);
  });

  it.each([
    ['no comments', { comments: [] }],
    ['a bad author', { comments: [{ id: 'm', author: { kind: 'bot', name: 'x' }, body: 'hi', createdAt: at }] }],
    ['an empty body', { comments: [{ id: 'm', author: human, body: ' ', createdAt: at }] }],
    ['a body over the limit', { comments: [{ id: 'm', author: human, body: 'x'.repeat(COMMENT_BODY_MAX + 1), createdAt: at }] }],
    ['an offset without a node', { anchor: { nodeId: null, offset: { x: 0, y: 0 }, point: { x: 0, y: 0 } } }],
    ['a node without an offset', { anchor: { nodeId: 'a', offset: null, point: { x: 0, y: 0 } } }],
    ['a non-boolean resolved', { resolved: 'no' }],
    ['no number', { number: undefined }],
    ['a zero number', { number: 0 }],
    ['a negative number', { number: -2 }],
    ['a fractional number', { number: 1.5 }],
    ['a string number', { number: '1' }],
  ])('rejects %s', (_name, patch) => {
    expect(validateSceneDocumentV1(threadAt(patch)).success).toBe(false);
  });

  it('rejects duplicate thread ids', () => {
    const thread = page(valid).threads![0]!;
    expect(validateSceneDocumentV1({ ...valid, pages: [{ ...page(valid), threads: [thread, thread] }] }).success).toBe(false);
  });
});

describe('thread numbers', () => {
  const start = (document: SceneDocumentV1, threadId: string, pageId = 'page-1') =>
    addThread(document, { pageId, threadId, nodeId: null, point: { x: 0, y: 0 }, comment: { id: `${threadId}-m`, author: human, body: 'x', createdAt: at } });
  const numbers = (document: SceneDocumentV1) => document.pages.flatMap((candidate) => (candidate.threads ?? []).map((thread) => [thread.id, thread.number]));

  it('starts at 1 and counts up across pages', () => {
    expect(nextThreadNumber(TWO_PAGES)).toBe(1);
    const document = start(start(start(TWO_PAGES, 'a'), 'b', 'page-2'), 'c');
    expect(numbers(document)).toEqual([['a', 1], ['c', 3], ['b', 2]]);
    expect(validateSceneDocumentV1(document).success).toBe(true);
  });

  it('gives max + 1 after a deletion: the highest number is reused, a gap is not', () => {
    const three = start(start(start(TWO_PAGES, 'a'), 'b', 'page-2'), 'c');
    expect(numbers(start(removeThread(three, 'b'), 'd'))).toContainEqual(['d', 4]);
    expect(numbers(start(removeThread(three, 'c'), 'd'))).toContainEqual(['d', 3]);
    expect(nextThreadNumber(removeThread(removeThread(removeThread(three, 'a'), 'b'), 'c'))).toBe(1);
  });

  it('rejects two threads with one number, even on different pages', () => {
    const document = start(start(TWO_PAGES, 'a'), 'b', 'page-2');
    const [one, two] = document.pages;
    const clash = { ...document, pages: [one!, { ...two!, threads: [{ ...two!.threads![0]!, number: 1 }] }] };
    expect(validateSceneDocumentV1(clash).success).toBe(false);
  });
});

describe('comments and history', () => {
  const a = node('a', 100, 100);
  const onPage = (document: SceneDocumentV1, pageId: string, threadId: string) =>
    addThread(document, { pageId, threadId, nodeId: null, point: { x: 0, y: 0 }, comment: { id: `${threadId}-m`, author: human, body: 'x', createdAt: at } });
  const threadIds = (document: SceneDocumentV1) => document.pages.flatMap((candidate) => (candidate.threads ?? []).map((thread) => thread.id));
  const numbersById = (document: SceneDocumentV1) => Object.fromEntries(document.pages.flatMap((candidate) => (candidate.threads ?? []).map((thread) => [thread.id, thread.number])));
  it('follow the node as it moves and stay where it was deleted', () => {
    let session = createDocumentSession(withThread(createTestDocument({ nodes: [a] })));
    session = commitSessionCommand(session, move(a, 300, 400), session.revision);
    expect(page(session.document).threads![0]!.anchor.point).toEqual({ x: 310, y: 420 });
    const moved = page(session.document).nodes[0]!;
    session = commitSessionCommand(session, { kind: 'remove-node', id: 'rm', label: 'Delete', pageId: 'page-1', index: 0, node: moved }, session.revision);
    expect(page(session.document).threads![0]!.anchor).toEqual({ nodeId: 'a', offset: { x: 10, y: 20 }, point: { x: 310, y: 420 } });
    // Undo brings the node back and the pin follows it again.
    session = undoSessionCommand(session, session.revision);
    session = undoSessionCommand(session, session.revision);
    expect(page(session.document).threads![0]!.anchor.point).toEqual({ x: 110, y: 120 });
  });

  it('a comment change is a revision with no undo step, and undo/redo keep it', () => {
    let session = createDocumentSession(createTestDocument({ nodes: [a] }));
    session = commitSessionCommand(session, move(a, 0, 0), session.revision);
    const pastBefore = session.history.past;
    session = updateSessionThreads(session, (document) => withThread(document), session.revision);
    expect(session.revision).toBe(2);
    expect(session.history.past).toBe(pastBefore);
    expect(session.history.present).toBe(session.document);
    session = undoSessionCommand(session, session.revision);
    expect(page(session.document).nodes[0]!.transform.translation).toEqual({ x: 100, y: 100 });
    expect(page(session.document).threads).toHaveLength(1);
    session = redoSessionCommand(session, session.revision);
    expect(page(session.document).threads).toHaveLength(1);
  });

  it('an unchanged comment update is not a revision', () => {
    const session = createDocumentSession(createTestDocument());
    expect(updateSessionThreads(session, (document) => document, 0)).toBe(session);
  });

  it('a page snapshot (set-page) neither drops nor restores comments, and its undo still applies', () => {
    let session = createDocumentSession(createTestDocument({ nodes: [a] }));
    const before = page(session.document);
    session = commitSessionCommand(session, { kind: 'set-page', id: 'rename', label: 'Rename', pageId: 'page-1', before, after: { ...before, name: 'Renamed' } }, session.revision);
    session = updateSessionThreads(session, (document) => withThread(document), session.revision);
    session = undoSessionCommand(session, session.revision);
    expect(page(session.document).name).toBe('Page 1');
    expect(page(session.document).threads).toHaveLength(1);
  });

  it('deleting a page takes its threads; undoing the delete brings them back', () => {
    let session = createDocumentSession(onPage(TWO_PAGES, 'page-1', 't1'));
    // The threads at deletion time count, not the stale copy in the command.
    session = updateSessionThreads(session, (document) => addComment(document, 't1', { id: 'm2', author: agent, body: 'later', createdAt: at }), session.revision);
    session = commitSessionCommand(session, { kind: 'remove-page', id: 'rm', label: 'Delete', index: 0, page: page(TWO_PAGES) }, session.revision);
    expect(findThread(session.document, 't1')).toBeUndefined();
    session = undoSessionCommand(session, session.revision);
    expect(findThread(session.document, 't1')!.thread.comments).toHaveLength(2);
  });

  it('a page joining a document keeps the thread numbers that are still free', () => {
    const document = withThread(withThread(createTestDocument({ nodes: [a] })), 't2', null, { x: 1, y: 1 });
    const incoming = page(document);
    expect(withFreeThreadNumbers({ ...document, pages: [] }, incoming)).toBe(incoming);
    // #2 is taken on the other page; #1 is not: only #2 moves, past the highest number anywhere.
    const other = { ...incoming, id: 'other', threads: [{ ...incoming.threads![1]!, id: 'o2' }, { ...incoming.threads![0]!, id: 'o7', number: 7 }] };
    const joined = withFreeThreadNumbers({ ...document, pages: [other] }, incoming);
    expect(joined.threads!.map(({ id, number }) => [id, number])).toEqual([['t1', 1], ['t2', 8]]);
  });

  describe('through undo and redo', () => {
    const insertPage2 = (): DocumentCommand => ({ kind: 'insert-page', id: 'add', label: 'Add', index: 1, page: { ...page(TWO_PAGES), id: 'page-3', name: 'Page 3', nodes: [] } });

    it('a comment on an added page survives undo and redo of the add', () => {
      let session = createDocumentSession(TWO_PAGES);
      session = commitSessionCommand(session, insertPage2(), session.revision);
      session = updateSessionThreads(session, (document) => onPage(document, 'page-3', 'n1'), session.revision);
      session = redoSessionCommand(undoSessionCommand(session, session.revision), session.revision + 1);
      expect(threadIds(session.document)).toEqual(['n1']);
      // And the same again, so the entry redo stored holds up.
      session = redoSessionCommand(undoSessionCommand(session, session.revision), session.revision + 1);
      expect(threadIds(session.document)).toEqual(['n1']);
    });

    it('a comment on a duplicated page survives undo and redo', () => {
      let session = createDocumentSession(onPage(TWO_PAGES, 'page-1', 't1'));
      session = commitSessionCommand(session, buildProductionDuplicatePageCommand(session.document, 'page-1', 'page-3'), session.revision);
      session = updateSessionThreads(session, (document) => onPage(document, 'page-3', 'n1'), session.revision);
      session = redoSessionCommand(undoSessionCommand(session, session.revision), session.revision + 1);
      expect(threadIds(session.document)).toEqual(['t1', 'n1']);
    });

    it('a comment made after undoing a page delete survives redo and undo of the delete', () => {
      let session = createDocumentSession(onPage(TWO_PAGES, 'page-1', 't1'));
      session = commitSessionCommand(session, { kind: 'remove-page', id: 'rm', label: 'Delete', index: 0, page: page(session.document) }, session.revision);
      session = undoSessionCommand(session, session.revision);
      session = updateSessionThreads(session, (document) => onPage(document, 'page-1', 'n1'), session.revision);
      session = redoSessionCommand(session, session.revision);
      expect(threadIds(session.document)).toEqual([]);
      session = undoSessionCommand(session, session.revision);
      expect(threadIds(session.document).sort()).toEqual(['n1', 't1']);
    });

    it('thread numbers stay unique when the page with the highest number goes and comes back', () => {
      // #1 on page 1, #2 on page 2. Remove page 2, start a thread on page 1 (it gets #2), undo the removal.
      let session = createDocumentSession(onPage(onPage(TWO_PAGES, 'page-1', 'one'), 'page-2', 'two'));
      session = commitSessionCommand(session, { kind: 'remove-page', id: 'rm', label: 'Delete', index: 1, page: session.document.pages[1]! }, session.revision);
      session = updateSessionThreads(session, (document) => onPage(document, 'page-1', 'three'), session.revision);
      session = undoSessionCommand(session, session.revision);
      expect(numbersById(session.document)).toEqual({ one: 1, three: 2, two: 3 });
      expect(validateSceneDocumentV1(session.document).success).toBe(true);
      // Redo takes the page away again; undo brings it back with the numbers it has now.
      session = undoSessionCommand(redoSessionCommand(session, session.revision), session.revision + 1);
      expect(numbersById(session.document)).toEqual({ one: 1, three: 2, two: 3 });
    });

    it('a page snapshot taken before a thread was removed does not bring its numbers back', () => {
      // Rename page 1 (both snapshots hold #1), delete that thread, start another on page 2 (#1), undo the rename.
      let session = createDocumentSession(onPage(TWO_PAGES, 'page-1', 'T1'));
      const before = page(session.document);
      session = commitSessionCommand(session, { kind: 'set-page', id: 'rename', label: 'Rename', pageId: 'page-1', before, after: { ...before, name: 'Renamed' } }, session.revision);
      session = updateSessionThreads(session, (document) => onPage(removeThread(document, 'T1'), 'page-2', 'T2'), session.revision);
      session = undoSessionCommand(session, session.revision);
      expect(page(session.document).name).toBe('Page 1');
      expect(numbersById(session.document)).toEqual({ T2: 1 });
      expect(validateSceneDocumentV1(session.document).success).toBe(true);
    });

  });

  it('refuses a thread change that would make the document invalid', () => {
    const session = createDocumentSession(withThread(createTestDocument({ nodes: [a] })));
    const reuse = (document: SceneDocumentV1) => addComment(document, 't1', { id: 't1-m1', author: agent, body: 'same id', createdAt: at });
    expect(() => updateSessionThreads(session, reuse, session.revision)).toThrow(ThreadError);
  });

  it('carryThreads returns the same document when nothing changes', () => {
    const document = withThread(createTestDocument({ nodes: [a] }));
    expect(carryThreads(document, document)).toBe(document);
  });
});

describe('moving a thread', () => {
  const anchorOf = (document: SceneDocumentV1, id = 't1') => findThread(document, id)!.thread.anchor;
  const base = () => createTestDocument({ nodes: [node('a', 100, 100), node('b', 500, 0), node('p', 1000, 1000), node('c', 10, 20, { parentId: 'p' })] });

  it('pins a page pin onto a node, as an offset from it', () => {
    const document = moveThread(withThread(base(), 't1', null, { x: 5, y: 5 }), 't1', 'a', { x: 130, y: 150 });
    expect(anchorOf(document)).toEqual({ nodeId: 'a', offset: { x: 30, y: 50 }, point: { x: 130, y: 150 } });
  });

  it('turns a node pin into a page pin', () => {
    const document = moveThread(withThread(base(), 't1', 'a', { x: 110, y: 120 }), 't1', null, { x: 900, y: 40 });
    expect(anchorOf(document)).toEqual({ nodeId: null, offset: null, point: { x: 900, y: 40 } });
  });

  it('moves a pin from one node to another, which then carries it', () => {
    let document = moveThread(withThread(base(), 't1', 'a', { x: 110, y: 120 }), 't1', 'b', { x: 520, y: 30 });
    expect(anchorOf(document)).toEqual({ nodeId: 'b', offset: { x: 20, y: 30 }, point: { x: 520, y: 30 } });
    const [pageOne] = document.pages;
    const moved = carryThreads({ ...document, pages: [{ ...pageOne!, threads: undefined, nodes: pageOne!.nodes.map((n) => (n.id === 'b' ? node('b', 600, 0) : n)) }] }, document);
    expect(findThread(moved, 't1')!.thread.anchor.point).toEqual({ x: 620, y: 30 });
    document = moved;
    expect(anchorOf(document).nodeId).toBe('b');
  });

  it('measures a nested node from its world origin', () => {
    const document = moveThread(withThread(base(), 't1', null, { x: 0, y: 0 }), 't1', 'c', { x: 1015, y: 1030 });
    expect(anchorOf(document)).toEqual({ nodeId: 'c', offset: { x: 5, y: 10 }, point: { x: 1015, y: 1030 } });
  });

  it('falls back to a page pin for a node that is not on the page, and keeps everything else', () => {
    const before = addComment(withThread(base()), 't1', { id: 'm2', author: agent, body: 'Because.', createdAt: at });
    const after = moveThread(setThreadResolved(before, 't1', true), 't1', 'missing', { x: 1, y: 2 });
    expect(anchorOf(after)).toEqual({ nodeId: null, offset: null, point: { x: 1, y: 2 } });
    expect(findThread(after, 't1')!.thread).toMatchObject({ number: 1, resolved: true });
    expect(findThread(after, 't1')!.thread.comments).toHaveLength(2);
    expect(validateSceneDocumentV1(after).success).toBe(true);
  });

  it('refuses an unknown thread', () => {
    expect(() => moveThread(base(), 'nope', null, { x: 0, y: 0 })).toThrow(ThreadError);
  });
});

describe('withoutThreads', () => {
  const plain = () => createTestDocument({ nodes: [node('a')] });

  it('strips threads from every page and leaves the source alone', () => {
    const source = withThread(plain(), 'mine');
    const stripped = withoutThreads(source);
    expect(stripped.pages[0]).not.toHaveProperty('threads');
    expect(source.pages[0]!.threads).toHaveLength(1);
  });

  it('returns a comment-free document itself', () => {
    const document = plain();
    expect(withoutThreads(document)).toBe(document);
  });
});
