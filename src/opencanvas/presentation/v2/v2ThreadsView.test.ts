import { describe, expect, it } from 'vitest';
import type { SceneComment, SceneDocumentV1, SceneThread } from '../../domain/document/types';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import {
  UNREAD, collectThreads, isOwnComment, isUnanswered, isUnread, lastActivity, matchesQuery, nodeLabelText, openThreadTotal, parseReads,
  readKey, replyCount, selectThreads, threadLinkText, threadParam, threadUrl, unreadIds, withRead, withUnread, type ThreadFilters,
} from './v2ThreadsView';

const me = { kind: 'human' as const, name: 'User' };
const ana = { kind: 'human' as const, name: 'Ana' };
const bot = { kind: 'agent' as const, name: 'Claude Code' };
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 26, 12, minutes)).toISOString();
const NOW = Date.UTC(2026, 9, 26, 13, 0);

let counter = 0;
const comment = (author: SceneComment['author'], body: string, minutes: number): SceneComment =>
  ({ id: `c${++counter}`, author, body, createdAt: at(minutes) });
function thread(id: string, number: number, comments: SceneComment[], extra: Partial<SceneThread> = {}): SceneThread {
  return { id, number, anchor: { nodeId: null, offset: null, point: { x: 0, y: 0 } }, resolved: false, comments, ...extra };
}

/** Two pages: Page 1 (a, b, c) and Page 2 (d). */
function fixture(): SceneDocumentV1 {
  const base = createTestDocument({ nodes: [createTestNode('n1', { content: { label: 'Session updateComments' } } as never)] });
  const [first] = base.pages;
  return {
    ...base,
    pages: [
      { ...first!, threads: [
        thread('a', 1, [comment(me, 'Why a queue?', 0), comment(bot, 'Latency.', 5)]),
        thread('b', 2, [comment(ana, 'Rename this', 10)]),
        thread('c', 3, [comment(me, 'Old question', 1), comment(bot, 'Old answer', 2)], { resolved: true }),
      ] },
      { ...first!, id: 'page-2', name: 'Page 2', nodes: [], threads: [
        thread('d', 4, [comment(me, 'Unanswered on page two', 20)]),
      ] },
    ],
  };
}
const ids = (entries: { thread: SceneThread }[]) => entries.map(({ thread: t }) => t.id);
const filters = (patch: Partial<ThreadFilters> = {}): ThreadFilters => ({ showResolved: false, unansweredOnly: false, ...patch });

describe('collecting', () => {
  it('lists every page, with its page name, in page order', () => {
    const entries = collectThreads(fixture());
    expect(ids(entries)).toEqual(['a', 'b', 'c', 'd']);
    expect(entries.map(({ pageName }) => pageName)).toEqual(['Page 1', 'Page 1', 'Page 1', 'Page 2']);
  });

  it('counts open threads on every page', () => {
    expect(openThreadTotal(fixture())).toBe(3);
    expect(openThreadTotal(createTestDocument())).toBe(0);
  });

  it('reads the newest comment as the last activity, not the last in the list', () => {
    expect(lastActivity(thread('x', 1, [comment(me, 'late', 30), comment(bot, 'earlier', 3)]))).toBe(Date.parse(at(30)));
    expect(lastActivity(thread('x', 1, [{ ...comment(me, 'bad', 0), createdAt: 'nope' }]))).toBe(0);
  });

  it('counts replies as comments after the first', () => {
    expect(replyCount(thread('x', 1, [comment(me, 'one', 0)]))).toBe(0);
    expect(replyCount(thread('x', 1, [comment(me, 'one', 0), comment(bot, 'two', 1), comment(me, 'three', 2)]))).toBe(2);
  });
});

describe('search', () => {
  it('is a case-insensitive substring', () => {
    expect(ids(selectThreads(fixture(), 'QUEUE', filters()))).toEqual(['a']);
    expect(ids(selectThreads(fixture(), 'ue', filters()))).toEqual(['a']);
  });

  it('matches any comment of a thread, not only the first, and on every page', () => {
    expect(ids(selectThreads(fixture(), 'latency', filters()))).toEqual(['a']);
    expect(ids(selectThreads(fixture(), 'page two', filters()))).toEqual(['d']);
  });

  it('does nothing for an empty or blank query, and trims a padded one', () => {
    expect(selectThreads(fixture(), '', filters())).toHaveLength(3);
    expect(selectThreads(fixture(), '   ', filters())).toHaveLength(3);
    expect(ids(selectThreads(fixture(), '  rename ', filters()))).toEqual(['b']);
  });

  it('treats the query as text, not a pattern', () => {
    expect(selectThreads(fixture(), '.*', filters())).toEqual([]);
    expect(selectThreads(fixture(), '(', filters())).toEqual([]);
    expect(matchesQuery(thread('x', 1, [comment(me, 'cost (usd)? $5', 0)]), '(usd)? $5')).toBe(true);
  });

  it('finds nothing when nothing matches', () => {
    expect(selectThreads(fixture(), 'zzz', filters({ showResolved: true }))).toEqual([]);
  });
});

describe('filters', () => {
  it('hide resolved threads by default and show them on request', () => {
    expect(ids(selectThreads(fixture(), '', filters()))).not.toContain('c');
    expect(ids(selectThreads(fixture(), '', filters({ showResolved: true })))).toContain('c');
  });

  it('unanswered means the last comment is a person\'s', () => {
    expect(isUnanswered(thread('x', 1, [comment(me, 'q', 0), comment(bot, 'a', 1)]))).toBe(false);
    expect(isUnanswered(thread('x', 1, [comment(me, 'q', 0), comment(bot, 'a', 1), comment(ana, 'thanks', 2)]))).toBe(true);
    expect(isUnanswered(thread('x', 1, [comment(bot, 'I noticed', 0)]))).toBe(false);
  });

  it('unanswered only keeps b and d (a was answered by the agent)', () => {
    expect(ids(selectThreads(fixture(), '', filters({ unansweredOnly: true })))).toEqual(['d', 'b']);
  });

  it('resolved and unanswered combine: a resolved thread whose last comment is a person\'s needs both toggles', () => {
    const document = fixture();
    const [page1, page2] = document.pages;
    const resolvedUnanswered = thread('e', 5, [comment(me, 'q', 0), comment(bot, 'a', 1), comment(ana, 'still?', 2)], { resolved: true });
    const withIt = { ...document, pages: [{ ...page1!, threads: [...page1!.threads!, resolvedUnanswered] }, page2!] };
    expect(ids(selectThreads(withIt, '', filters({ unansweredOnly: true })))).not.toContain('e');
    expect(ids(selectThreads(withIt, '', filters({ unansweredOnly: true, showResolved: true })))).toContain('e');
    // c is resolved and answered: unanswered-only drops it even with resolved shown.
    expect(ids(selectThreads(withIt, '', filters({ unansweredOnly: true, showResolved: true })))).not.toContain('c');
    expect(ids(selectThreads(withIt, 'still', filters({ unansweredOnly: true, showResolved: true })))).toEqual(['e']);
  });

  it('search and filters narrow together', () => {
    expect(selectThreads(fixture(), 'queue', filters({ unansweredOnly: true }))).toEqual([]);
    expect(ids(selectThreads(fixture(), 'old', filters({ showResolved: true })))).toEqual(['c']);
  });
});

describe('order', () => {
  it('is newest activity first across pages', () => {
    // d: 20, b: 10, a: 5 (its reply), c: 2 (resolved, hidden)
    expect(ids(selectThreads(fixture(), '', filters()))).toEqual(['d', 'b', 'a']);
    expect(ids(selectThreads(fixture(), '', filters({ showResolved: true })))).toEqual(['d', 'b', 'a', 'c']);
  });

  it('puts a thread that just got a reply on top', () => {
    const document = fixture();
    const [page1, page2] = document.pages;
    const replied = page1!.threads!.map((t) => (t.id === 'a' ? { ...t, comments: [...t.comments, comment(bot, 'new', 40)] } : t));
    expect(ids(selectThreads({ ...document, pages: [{ ...page1!, threads: replied }, page2!] }, '', filters()))[0]).toBe('a');
  });

  it('keeps document order for equal times', () => {
    const same = [comment(me, 'x', 3), comment(me, 'y', 3)];
    const document = fixture();
    const [page1] = document.pages;
    const tied = { ...document, pages: [{ ...page1!, threads: [thread('p', 1, [same[0]!]), thread('q', 2, [same[1]!])] }] };
    expect(ids(selectThreads(tied, '', filters()))).toEqual(['p', 'q']);
  });

  it('does not mutate the document', () => {
    const document = fixture();
    const before = JSON.stringify(document);
    selectThreads(document, 'a', filters({ showResolved: true }));
    expect(JSON.stringify(document)).toBe(before);
  });
});

describe('unread', () => {
  const doc = 'document-1';
  const mine = thread('m', 1, [comment(me, 'my own question', 0)]);
  const answered = thread('r', 2, [comment(me, 'q', 0), comment(bot, 'a', 5)]);

  it('a thread I wrote and never opened is read', () => {
    expect(isOwnComment(mine.comments[0]!)).toBe(true);
    expect(isUnread(mine, doc, {})).toBe(false);
  });

  it('a thread never opened counts comments from others as unread: an agent, or another person', () => {
    expect(isUnread(answered, doc, {})).toBe(true);
    expect(isUnread(thread('x', 3, [comment(ana, 'hi', 0)]), doc, {})).toBe(true);
    expect(isOwnComment(comment(ana, 'x', 0))).toBe(false);
    expect(isOwnComment({ ...comment(bot, 'x', 0), author: { kind: 'agent', name: 'User' } })).toBe(false);
  });

  it('opening marks it read; a later comment from others makes it unread again; my own later comment does not', () => {
    const reads = withRead({}, doc, answered, NOW);
    expect(isUnread(answered, doc, reads)).toBe(false);
    const later = { ...answered, comments: [...answered.comments, { ...comment(bot, 'one more', 0), createdAt: new Date(NOW + 60_000).toISOString() }] };
    expect(isUnread(later, doc, reads)).toBe(true);
    const mineLater = { ...answered, comments: [...answered.comments, { ...comment(me, 'thanks', 0), createdAt: new Date(NOW + 60_000).toISOString() }] };
    expect(isUnread(mineLater, doc, reads)).toBe(false);
  });

  it('a comment exactly at the read time is read; one a millisecond later is not', () => {
    const edge = thread('e', 1, [comment(bot, 'x', 0)]);
    const stamp = { [readKey(doc, 'e')]: at(0) };
    expect(isUnread(edge, doc, stamp)).toBe(false);
    expect(isUnread(edge, doc, { [readKey(doc, 'e')]: new Date(Date.parse(at(0)) - 1).toISOString() })).toBe(true);
  });

  it('a read stamp never falls behind the newest comment, even with a slow clock', () => {
    const future = thread('f', 1, [{ ...comment(bot, 'x', 0), createdAt: new Date(NOW + 3_600_000).toISOString() }]);
    expect(isUnread(future, doc, withRead({}, doc, future, NOW))).toBe(false);
  });

  it('mark as unread sticks until the thread is next opened', () => {
    let reads = withRead({}, doc, mine, NOW);
    reads = withUnread(reads, doc, mine.id);
    expect(reads[readKey(doc, mine.id)]).toBe(UNREAD);
    // Even a thread made only of my comments, and whatever the clock does.
    expect(isUnread(mine, doc, reads)).toBe(true);
    expect(isUnread(mine, doc, reads)).toBe(true);
    reads = withRead(reads, doc, mine, NOW + 1000);
    expect(isUnread(mine, doc, reads)).toBe(false);
  });

  it('keys by document: the same thread id in another document is not read', () => {
    const reads = withRead({}, doc, answered, NOW);
    expect(isUnread(answered, 'document-2', reads)).toBe(true);
  });

  it('unreadIds lists the unread threads of a document', () => {
    const document = fixture();
    expect(unreadIds(document, {})).toEqual(new Set(['a', 'b', 'c']));
    const [page1] = document.pages;
    const reads = withRead({}, document.id, page1!.threads![0]!, NOW);
    expect(unreadIds(document, reads)).toEqual(new Set(['b', 'c']));
  });

  it('parses stored marks, dropping anything malformed', () => {
    expect(parseReads(null)).toEqual({});
    expect(parseReads([1, 2])).toEqual({});
    expect(parseReads('x')).toEqual({});
    expect(parseReads({ 'a:b': at(1), 'a:c': UNREAD, 'a:d': 'yesterday', 'a:e': 5 })).toEqual({ 'a:b': at(1), 'a:c': UNREAD });
  });

  it('keeps the store bounded, dropping the oldest marks', () => {
    let reads: Record<string, string> = {};
    for (let index = 0; index < 1005; index += 1) reads = { ...withUnread(reads, 'd', `t${index}`) };
    expect(Object.keys(reads)).toHaveLength(1000);
    expect(reads[readKey('d', 't0')]).toBeUndefined();
    expect(reads[readKey('d', 't1004')]).toBe(UNREAD);
  });
});

describe('links', () => {
  const base = 'http://localhost:3000/';

  it('builds the hash route with the thread param', () => {
    expect(threadUrl(base, 'doc-1', 'thread-9')).toBe('http://localhost:3000/#/d/doc-1?thread=thread-9');
  });

  it('reads: number, page, node label, link', () => {
    const document = fixture();
    const [entry] = collectThreads(document);
    const pinned = { ...entry!, thread: { ...entry!.thread, anchor: { nodeId: 'n1', offset: { x: 0, y: 0 }, point: { x: 0, y: 0 } } } };
    expect(threadLinkText(document, pinned, base))
      .toBe('#1 · Page 1 · on "Session updateComments" — http://localhost:3000/#/d/document-1?thread=a');
  });

  it('drops the node part for a page pin or a node that is gone', () => {
    const document = fixture();
    const [entry] = collectThreads(document);
    expect(threadLinkText(document, entry!, base)).toBe('#1 · Page 1 — http://localhost:3000/#/d/document-1?thread=a');
    const gone = { ...entry!, thread: { ...entry!.thread, anchor: { nodeId: 'deleted', offset: { x: 0, y: 0 }, point: { x: 0, y: 0 } } } };
    expect(threadLinkText(document, gone, base)).toBe('#1 · Page 1 — http://localhost:3000/#/d/document-1?thread=a');
  });

  it('uses the page name of a thread on another page', () => {
    const document = fixture();
    const d = collectThreads(document).find(({ thread: t }) => t.id === 'd')!;
    expect(threadLinkText(document, d, base)).toMatch(/^#4 · Page 2 — /);
  });

  it('flattens and cuts a long or multi-line label, and ignores a blank one', () => {
    const page = (label: unknown) => ({ ...fixture().pages[0]!, nodes: [createTestNode('n1', { content: { label } } as never)] });
    expect(nodeLabelText(page('Line one\n  line   two'), 'n1')).toBe('Line one line two');
    expect(nodeLabelText(page('x'.repeat(100)), 'n1')).toHaveLength(60);
    expect(nodeLabelText(page('x'.repeat(100)), 'n1')!.endsWith('…')).toBe(true);
    expect(nodeLabelText(page('   '), 'n1')).toBeNull();
    expect(nodeLabelText(page(42), 'n1')).toBeNull();
    expect(nodeLabelText(page('x'), null)).toBeNull();
    expect(nodeLabelText(undefined, 'n1')).toBeNull();
  });

  it('reads the thread param of a deep link', () => {
    expect(threadParam('?thread=abc')).toBe('abc');
    expect(threadParam('?connect&thread=abc')).toBe('abc');
    expect(threadParam('?thread=')).toBeNull();
    expect(threadParam('?thread=%20')).toBeNull();
    expect(threadParam('')).toBeNull();
  });
});
