// Threads pinned on a page. They are document data but not diagram content: commands never edit them, so every
// change goes through these functions, and carryThreads keeps them across every command (applyDocumentCommand),
// the one place that does: a page an undo brings back yields any id or number given out again since it went.
import type { Matrix2d, Point2d } from '../geometry/types';
import { applyMatrixToPoint, invertMatrix } from '../geometry/matrix';
import { buildNodeWorldMatrices } from '../scene/worldGeometry';
import { isIsoTimestamp } from '../document/validation';
import { freeThreadId, freeThreadNumber } from './threadKeys';
import {
  COMMENT_AUTHOR_MAX,
  COMMENT_BODY_MAX,
  type SceneThreadAnchor,
  type SceneCommentAuthor,
  type SceneComment,
  type SceneThread,
  type SceneDocumentV1,
  type ScenePage,
} from '../document/types';

export class ThreadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThreadError';
  }
}

const NO_THREADS: readonly SceneThread[] = [];

export function pageThreads(page: ScenePage): readonly SceneThread[] {
  return page.threads ?? NO_THREADS;
}

export function openThreadCount(page: ScenePage): number {
  return pageThreads(page).filter((thread) => !thread.resolved).length;
}

/** A body as stored: trimmed, non-empty and at most COMMENT_BODY_MAX characters. */
function commentBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new ThreadError('A comment cannot be empty.');
  if (trimmed.length > COMMENT_BODY_MAX) {
    throw new ThreadError(`A comment is at most ${COMMENT_BODY_MAX} characters.`);
  }
  return trimmed;
}

/**
 * Where a node-anchored pin sits, given its node's world matrix: `offset` is in the node's own frame, so the pin moves,
 * turns and flips with the node, like a mark painted on it. The canvas uses it too, to draw a pin on a shape being dragged.
 */
export function pinOnNode(matrix: Matrix2d, offset: Point2d): Point2d {
  return applyMatrixToPoint(matrix, offset);
}

/** Pins `point` to `nodeId` (when it is on the page) so the pin follows the node, or to the page. */
function createAnchor(page: ScenePage, nodeId: string | null, point: Point2d): SceneThreadAnchor {
  const origin = nodeId === null ? undefined : buildNodeWorldMatrices(page).get(nodeId);
  const inverse = origin ? invertMatrix(origin) : null;
  if (!inverse) return { nodeId: null, offset: null, point };
  return { nodeId, offset: applyMatrixToPoint(inverse, point), point };
}

/** Moves each node-anchored pin to where its node is now; a pin whose node is gone keeps its last point. */
function refreshAnchors(page: ScenePage): ScenePage {
  const threads = pageThreads(page);
  if (!threads.some((thread) => thread.anchor.nodeId !== null)) return page;
  const origins = buildNodeWorldMatrices(page);
  let changed = false;
  const next = threads.map((thread) => {
    const { nodeId, offset, point } = thread.anchor;
    const origin = nodeId === null ? undefined : origins.get(nodeId);
    if (!origin || !offset) return thread;
    const { x, y } = pinOnNode(origin, offset);
    if (x === point.x && y === point.y) return thread;
    changed = true;
    return { ...thread, anchor: { ...thread.anchor, point: { x, y } } };
  });
  return changed ? { ...page, threads: next } : page;
}

/**
 * `next` with the threads of `current`: a command (a commit, an undo or redo, an agent op on a file) changes
 * shapes, never threads, even when it restores a whole page snapshot. Pages only in `next` keep their own, but
 * yield an id or a number another page kept (withFreeThreadIds, withFreeThreadNumbers). Anchors then follow
 * their nodes. Returns `next` itself when nothing changes.
 */
export function carryThreads(next: SceneDocumentV1, current: SceneDocumentV1): SceneDocumentV1 {
  const currentById = new Map(current.pages.map((page) => [page.id, page]));
  let changed = false;
  const pages = next.pages.map((page) => {
    const before = currentById.get(page.id);
    // The edit did not touch this page: its threads and anchors are already right.
    if (before === page) return page;
    let result = page;
    if (before && before.threads !== page.threads) {
      const { threads: _dropped, ...rest } = page;
      result = before.threads ? { ...rest, threads: before.threads } : rest;
    }
    result = refreshAnchors(result);
    if (result !== page) changed = true;
    return result;
  });
  // Pages only in `next` (inserted by this command, such as a page an undo brings back) hold the threads they
  // had when they went: they yield any id or number the other pages, with their threads of now, hold. One at a
  // time, so two of them never take the same free one.
  pages.forEach((page, index) => {
    if (currentById.has(page.id) || !page.threads) return;
    const others = { ...next, pages: pages.filter((_, other) => other !== index) };
    const free = withFreeThreadIds(others, withFreeThreadNumbers(others, page));
    if (free === page) return;
    pages[index] = free;
    changed = true;
  });
  return changed ? { ...next, pages } : next;
}

/**
 * `document` without its comment threads, which carry people's names and private conversation. A diagram's own
 * `.openflow.json` keeps them (the app's, an agent's in file mode, the CLI's --doc); JSON export (unless it asks,
 * `includeThreads`), share links, `get_diagram` and the agent `export` op leave them out.
 */
export function withoutThreads(document: SceneDocumentV1): SceneDocumentV1 {
  if (!document.pages.some((page) => page.threads !== undefined)) return document;
  return { ...document, pages: document.pages.map(({ threads: _threads, ...page }) => page) };
}

/**
 * `page` as it can join `document`: a thread whose number a thread already in the document has gets the
 * next free one. Numbers are unique across the document, and a page brought back by undoing its removal
 * can carry a number given out again since. Returns `page` itself when nothing clashes.
 */
export function withFreeThreadNumbers(document: SceneDocumentV1, page: ScenePage): ScenePage {
  const taken = takenNumbers(document);
  const clashes = new Set(page.threads?.filter((thread) => taken.has(thread.number)));
  if (!page.threads || clashes.size === 0) return page;
  // The page's other numbers stay, so a clash never takes one of them.
  for (const thread of page.threads) if (!clashes.has(thread)) taken.add(thread.number);
  const threads = page.threads.map((thread) => {
    if (!clashes.has(thread)) return thread;
    const number = freeThreadNumber(taken);
    taken.add(number);
    return { ...thread, number };
  });
  return { ...page, threads };
}

/** Like withFreeThreadNumbers, for ids: a thread whose id the document already has gets a free one. */
function withFreeThreadIds(document: SceneDocumentV1, page: ScenePage): ScenePage {
  const taken = new Set(document.pages.flatMap((other) => pageThreads(other).map(({ id }) => id)));
  const clashes = new Set(page.threads?.filter((thread) => taken.has(thread.id)));
  if (!page.threads || clashes.size === 0) return page;
  for (const thread of page.threads) if (!clashes.has(thread)) taken.add(thread.id);
  const threads = page.threads.map((thread) => {
    if (!clashes.has(thread)) return thread;
    const id = freeThreadId(taken, thread.id);
    taken.add(id);
    return { ...thread, id };
  });
  return { ...page, threads };
}

function takenNumbers(document: SceneDocumentV1): Set<number> {
  const taken = new Set<number>();
  for (const page of document.pages) for (const thread of pageThreads(page)) taken.add(thread.number);
  return taken;
}

/** `document` with `update` applied to one page's threads. An empty result drops the key. */
function updatePageThreads(
  document: SceneDocumentV1,
  pageId: string,
  update: (threads: readonly SceneThread[], page: ScenePage) => readonly SceneThread[]
): SceneDocumentV1 {
  const index = document.pages.findIndex((page) => page.id === pageId);
  const page = document.pages[index];
  if (!page) throw new ThreadError(`Unknown page "${pageId}".`);
  const threads = update(pageThreads(page), page);
  if (threads === page.threads) return document;
  const { threads: _dropped, ...rest } = page;
  const nextPage: ScenePage = threads.length ? { ...rest, threads: threads } : rest;
  const pages = document.pages.slice();
  pages[index] = nextPage;
  return { ...document, pages };
}

/** The page holding `threadId`, or undefined. */
export function findThread(
  document: SceneDocumentV1,
  threadId: string
): { readonly page: ScenePage; readonly thread: SceneThread } | undefined {
  for (const page of document.pages) {
    const thread = pageThreads(page).find((candidate) => candidate.id === threadId);
    if (thread) return { page, thread };
  }
  return undefined;
}

function requireThread(document: SceneDocumentV1, threadId: string) {
  const found = findThread(document, threadId);
  if (!found) throw new ThreadError(`Unknown comment thread "${threadId}".`);
  return found;
}

function requireComment(thread: SceneThread, commentId: string): SceneComment {
  const found = thread.comments.find((candidate) => candidate.id === commentId);
  if (!found) throw new ThreadError(`Unknown comment "${commentId}".`);
  return found;
}

/** `change` returns the thread itself to leave it, or null to delete it; leaving it returns `document` itself. */
function replaceThread(
  document: SceneDocumentV1,
  threadId: string,
  change: (thread: SceneThread) => SceneThread | null
): SceneDocumentV1 {
  const { page, thread } = requireThread(document, threadId);
  const next = change(thread);
  if (next === thread) return document;
  return updatePageThreads(document, page.id, (threads) =>
    threads.flatMap((candidate) => (candidate !== thread ? [candidate] : next ? [next] : []))
  );
}

/**
 * The number the next thread gets: one past the highest on any page (a deleted thread's number is only reused
 * when it was the highest), or the lowest free one past THREAD_NUMBER_MAX.
 */
export function nextThreadNumber(document: SceneDocumentV1): number {
  return freeThreadNumber(takenNumbers(document));
}

export interface NewComment {
  readonly id: string;
  readonly author: SceneCommentAuthor;
  readonly body: string;
  readonly createdAt: string;
}

function comment(input: NewComment): SceneComment {
  const { name } = input.author;
  if (!name.trim() || name.length > COMMENT_AUTHOR_MAX) {
    throw new ThreadError(`An author's name is 1 to ${COMMENT_AUTHOR_MAX} characters.`);
  }
  return { id: input.id, author: input.author, body: commentBody(input.body), createdAt: timestamp(input.createdAt) };
}

function timestamp(value: string): string {
  if (!isIsoTimestamp(value)) throw new ThreadError(`"${value}" is not an ISO 8601 timestamp.`);
  return value;
}

export function addThread(
  document: SceneDocumentV1,
  input: {
    readonly pageId: string;
    readonly threadId: string;
    readonly nodeId: string | null;
    readonly point: Point2d;
    readonly comment: NewComment;
  }
): SceneDocumentV1 {
  if (findThread(document, input.threadId)) throw new ThreadError(`Thread "${input.threadId}" already exists.`);
  const number = nextThreadNumber(document);
  return updatePageThreads(document, input.pageId, (threads, page) => [
    ...threads,
    {
      id: input.threadId,
      number,
      anchor: createAnchor(page, input.nodeId, input.point),
      resolved: false,
      comments: [comment(input.comment)],
    },
  ]);
}

/** A reply also reopens a resolved thread, as it does in Figma. */
export function addComment(document: SceneDocumentV1, threadId: string, reply: NewComment): SceneDocumentV1 {
  return replaceThread(document, threadId, (thread) => ({
    ...thread,
    resolved: false,
    comments: [...thread.comments, comment(reply)],
  }));
}

export function editComment(
  document: SceneDocumentV1,
  threadId: string,
  commentId: string,
  body: string,
  editedAt: string
): SceneDocumentV1 {
  return replaceThread(document, threadId, (thread) => {
    const edited = requireComment(thread, commentId);
    const next = commentBody(body);
    if (next === edited.body) return thread;
    const at = timestamp(editedAt);
    return {
      ...thread,
      comments: thread.comments.map((candidate) => (candidate === edited ? { ...candidate, body: next, editedAt: at } : candidate)),
    };
  });
}

/** Deleting the opening comment deletes the thread. */
export function removeComment(document: SceneDocumentV1, threadId: string, commentId: string): SceneDocumentV1 {
  return replaceThread(document, threadId, (thread) => {
    const removed = requireComment(thread, commentId);
    if (removed === thread.comments[0]) return null;
    return { ...thread, comments: thread.comments.filter((candidate) => candidate !== removed) };
  });
}

export function setThreadResolved(document: SceneDocumentV1, threadId: string, resolved: boolean): SceneDocumentV1 {
  return replaceThread(document, threadId, (thread) => (thread.resolved === resolved ? thread : { ...thread, resolved }));
}

export function removeThread(document: SceneDocumentV1, threadId: string): SceneDocumentV1 {
  return replaceThread(document, threadId, () => null);
}

/**
 * Moves a thread's pin to `point` on its page: onto `nodeId` (it then follows that node) or, with null or a node
 * the page does not have, onto the page itself. Comments, number and state stay as they are.
 */
export function moveThread(document: SceneDocumentV1, threadId: string, nodeId: string | null, point: Point2d): SceneDocumentV1 {
  const { page } = requireThread(document, threadId);
  const anchor = createAnchor(page, nodeId, point);
  return replaceThread(document, threadId, (thread) => (sameAnchor(thread.anchor, anchor) ? thread : { ...thread, anchor }));
}

function sameAnchor(a: SceneThreadAnchor, b: SceneThreadAnchor): boolean {
  return a.nodeId === b.nodeId && a.offset?.x === b.offset?.x && a.offset?.y === b.offset?.y && a.point.x === b.point.x && a.point.y === b.point.y;
}
