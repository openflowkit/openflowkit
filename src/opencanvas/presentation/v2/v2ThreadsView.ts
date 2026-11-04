// Pure logic of the Threads panel: what it lists (search, filters, order), what is unread for this browser,
// and the text a copied link carries. No React, no storage: the hooks own those.
import type { SceneComment, SceneDocumentV1, SceneThread, ScenePage } from '../../domain/document/types';
import { pageThreads } from '../../domain/threads/threads';
import { HUMAN_AUTHOR_NAME } from './v2CommentsView';

export interface ThreadEntry {
  readonly thread: SceneThread;
  readonly pageId: string;
  readonly pageName: string;
}

export interface ThreadFilters {
  /** Resolved threads are hidden unless this is on. */
  readonly showResolved: boolean;
  /** Only threads whose last comment is a person's: still waiting for an answer. */
  readonly unansweredOnly: boolean;
}

export const DEFAULT_THREAD_FILTERS: ThreadFilters = { showResolved: false, unansweredOnly: false };

/** Every thread of the document, page by page in page order, each page's threads in the order they were started. */
export function collectThreads(document: SceneDocumentV1): ThreadEntry[] {
  return document.pages.flatMap((page) =>
    pageThreads(page).map((thread) => ({ thread, pageId: page.id, pageName: page.name })));
}

/** Threads still open, on every page: the count the toolbar shows. */
export function openThreadTotal(document: SceneDocumentV1): number {
  return collectThreads(document).filter(({ thread }) => !thread.resolved).length;
}

/** When the newest comment was written (ms); 0 when no comment has a readable date. */
export function lastActivity(thread: SceneThread): number {
  let latest = 0;
  for (const comment of thread.comments) {
    const at = Date.parse(comment.createdAt);
    if (!Number.isNaN(at)) latest = Math.max(latest, at);
  }
  return latest;
}

/** The last comment is a person's, so the thread still waits for an answer. */
export function isUnanswered(thread: SceneThread): boolean {
  return thread.comments[thread.comments.length - 1]?.author.kind === 'human';
}

/** Case-insensitive substring over every comment body; an empty (or blank) query matches everything. */
export function matchesQuery(thread: SceneThread, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return thread.comments.some((comment) => comment.body.toLowerCase().includes(needle));
}

/** What the panel lists: filtered, searched, and newest activity first (ties keep document order, so the order is stable). */
export function selectThreads(document: SceneDocumentV1, query: string, filters: ThreadFilters): ThreadEntry[] {
  return collectThreads(document)
    .filter(({ thread }) => (filters.showResolved || !thread.resolved)
      && (!filters.unansweredOnly || isUnanswered(thread))
      && matchesQuery(thread, query))
    .map((entry, index) => ({ entry, index, at: lastActivity(entry.thread) }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .map(({ entry }) => entry);
}

/** Replies under a thread's first comment. */
export function replyCount(thread: SceneThread): number {
  return Math.max(0, thread.comments.length - 1);
}

// ---- Unread, per browser. Nothing here is in the document.

/** Read marks: `documentId:threadId` to the ISO time it was last read, or UNREAD when the viewer asked for it back. */
export type ThreadReads = Readonly<Record<string, string>>;

/** The value of a thread marked unread by hand: it stays unread until the thread is next opened. */
export const UNREAD = 'unread';
const MAX_READS = 1000;

export const readKey = (documentId: string, threadId: string): string => `${documentId}:${threadId}`;

/** Written by the viewer of this browser; every other comment (an agent's, another person's later) can be unread. */
export function isOwnComment(comment: SceneComment): boolean {
  return comment.author.kind === 'human' && comment.author.name === HUMAN_AUTHOR_NAME;
}

/**
 * Unread: marked unread by hand, or holding a comment from someone else newer than the last read.
 * A thread never opened has no last read, so every comment from others counts.
 */
export function isUnread(thread: SceneThread, documentId: string, reads: ThreadReads): boolean {
  const mark = reads[readKey(documentId, thread.id)];
  if (mark === UNREAD) return true;
  const lastRead = mark === undefined ? -Infinity : Date.parse(mark);
  const since = Number.isNaN(lastRead) ? -Infinity : lastRead;
  return thread.comments.some((comment) => !isOwnComment(comment) && Date.parse(comment.createdAt) > since);
}

export function unreadIds(document: SceneDocumentV1, reads: ThreadReads): Set<string> {
  return new Set(collectThreads(document).filter(({ thread }) => isUnread(thread, document.id, reads)).map(({ thread }) => thread.id));
}

/** `reads` with this thread read as of `now`, or of its newest comment when that is later (a clock that runs behind must not leave it unread). */
export function withRead(reads: ThreadReads, documentId: string, thread: SceneThread, now: number): ThreadReads {
  const stamp = new Date(Math.max(now, lastActivity(thread))).toISOString();
  return capReads({ ...reads, [readKey(documentId, thread.id)]: stamp });
}

export function withUnread(reads: ThreadReads, documentId: string, threadId: string): ThreadReads {
  return capReads({ ...reads, [readKey(documentId, threadId)]: UNREAD });
}

/** The oldest marks go first (insertion order) so the store never grows without bound. */
function capReads(reads: ThreadReads): ThreadReads {
  const keys = Object.keys(reads);
  if (keys.length <= MAX_READS) return reads;
  return Object.fromEntries(keys.slice(keys.length - MAX_READS).map((key) => [key, reads[key]!]));
}

/** Stored reads, keeping only well-formed entries. */
export function parseReads(value: unknown): ThreadReads {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string' && (entry[1] === UNREAD || !Number.isNaN(Date.parse(entry[1]))));
  return capReads(Object.fromEntries(entries));
}

// ---- Links

const LABEL_MAX = 60;

/** A node's label on one line, cut at LABEL_MAX; null when it has none. */
export function nodeLabelText(page: ScenePage | undefined, nodeId: string | null): string | null {
  if (!page || nodeId === null) return null;
  const label = page.nodes.find((node) => node.id === nodeId)?.content?.label;
  if (typeof label !== 'string') return null;
  const flat = label.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX - 1).trimEnd()}…` : flat;
}

/** `base` is the app's address up to the hash (origin and path); the route is the hash router's. */
export function threadUrl(base: string, documentId: string, threadId: string): string {
  return `${base}#/d/${encodeURIComponent(documentId)}?thread=${encodeURIComponent(threadId)}`;
}

/** `#3 · Page 1 · on "Session updateComments" — <url>`; the `on "…"` part is left out for a page pin or a node that is gone. */
export function threadLinkText(document: SceneDocumentV1, entry: ThreadEntry, base: string): string {
  const page = document.pages.find((candidate) => candidate.id === entry.pageId);
  const label = nodeLabelText(page, entry.thread.anchor.nodeId);
  const where = label ? ` · on "${label}"` : '';
  return `#${entry.thread.number} · ${entry.pageName}${where} — ${threadUrl(base, document.id, entry.thread.id)}`;
}

/** The thread a deep link names (`?thread=<id>`), or null. */
export function threadParam(search: string): string | null {
  const value = new URLSearchParams(search).get('thread');
  return value && value.trim() ? value : null;
}
