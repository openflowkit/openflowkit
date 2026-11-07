import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectLegacyDocument } from './legacyProjection';
import { migrateSceneDocument } from './migration';
import { THREAD_NUMBER_MAX } from './types';
import { withoutInvalidThreads } from './validation';

function createDocument() {
  return projectLegacyDocument(
    { nodes: [{ id: 'node-1', position: { x: 0, y: 0 }, data: { label: 'Node' } }], edges: [] },
    { documentId: 'document-1', pageId: 'page-1', now: '2026-08-07T00:00:00.000Z' }
  );
}

describe('migrateSceneDocument', () => {
  it('clones and validates V1 without mutating its input', () => {
    const input = createDocument();
    const before = structuredClone(input);
    const result = migrateSceneDocument(input);

    expect(result).toEqual({ success: true, document: input, migrated: false });
    expect(input).toEqual(before);
    if (result.success) {
      expect(result.document).not.toBe(input);
      expect(result.document.pages[0]).not.toBe(input.pages[0]);
    }
  });

  it('is idempotent', () => {
    const first = migrateSceneDocument(createDocument());
    expect(first.success).toBe(true);
    if (first.success === false) return;

    const second = migrateSceneDocument(first.document);
    expect(second).toEqual(first);
  });

  it('opens newer schemas read-only with preserved bytes instead of corrupting them', () => {
    const input = { ...createDocument(), schemaVersion: 99, futureNode: { kept: true } };
    const before = structuredClone(input);
    const result = migrateSceneDocument(input);

    expect(input).toEqual(before);
    expect(result).toEqual({
      success: false,
      reason: 'newer-schema',
      schemaVersion: 99,
      preserved: input,
      issues: [
        { path: '$.schemaVersion', message: 'Document uses a newer unsupported schema version.' },
      ],
    });
  });

  it('preserves unknown fields opaquely across migrate, serialize, and re-migrate', () => {
    const input = createDocument();
    const annotated = {
      ...input,
      futureDocumentFlag: true,
      pages: input.pages.map((page, pageIndex) => ({
        ...page,
        ...(pageIndex === 0 ? { futurePageNote: 'keep' } : {}),
        nodes: page.nodes.map((node, nodeIndex) => ({
          ...node,
          ...(nodeIndex === 0 ? { futureNodeBlob: { nested: [1, 2] } } : {}),
        })),
      })),
    };
    const first = migrateSceneDocument(annotated);
    expect(first.success).toBe(true);
    if (first.success === false) return;
    expect(first.document).toMatchObject({ futureDocumentFlag: true });

    const second = migrateSceneDocument(JSON.parse(JSON.stringify(first.document)));
    expect(second.success).toBe(true);
    if (second.success === false) return;
    expect(second.document).toMatchObject({
      futureDocumentFlag: true,
      pages: [{ futurePageNote: 'keep' }],
    });
    expect(second.document.pages[0]?.nodes[0]).toMatchObject({
      futureNodeBlob: { nested: [1, 2] },
    });
  });

  it('rejects non-JSON values', () => {
    expect(
      migrateSceneDocument({ ...createDocument(), metadata: { value: undefined } }).success
    ).toBe(false);
  });

  describe('comment threads', () => {
    afterEach(() => vi.restoreAllMocks());
    const comment = (id: string) => ({ id, author: { kind: 'human', name: 'Ada' }, body: 'hi', createdAt: '2026-10-26T12:00:00.000Z' });
    const thread = (id: string, number: number, overrides: Record<string, unknown> = {}) => ({
      id, number, anchor: { nodeId: null, offset: null, point: { x: 0, y: 0 } }, resolved: false, comments: [comment(`${id}-m`)], ...overrides,
    });

    const loadThreads = (pages: readonly (readonly unknown[])[]) => {
      const document = createDocument();
      const result = migrateSceneDocument({
        ...document,
        pages: pages.map((threads, index) => ({ ...document.pages[0]!, id: `page-${index + 1}`, name: `Page ${index + 1}`, threads })),
      });
      expect(result.success).toBe(true);
      return result.success ? result.document.pages.map((page) => page.threads?.map(({ id, number }) => [id, number])) : [];
    };

    it('drops a broken thread with a warning and loads the rest', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(loadThreads([[thread('good', 1), thread('empty', 2, { comments: [] }), thread('no-pin', 3, { anchor: null })]])).toEqual([[['good', 1]]]);
      expect(warn).toHaveBeenCalledTimes(2);
      const fine = { ...createDocument(), pages: [{ ...createDocument().pages[0]!, threads: [thread('good', 1)] }] };
      expect(withoutInvalidThreads(fine)).toBe(fine);
    });

    // A save after loading makes a dropped thread lost for good: a clash or a number out of range costs nothing to repair.
    it('renumbers a thread whose number is taken or out of range, to the lowest free one', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(loadThreads([
        [thread('a', 1), thread('twin', 1), thread('huge', THREAD_NUMBER_MAX + 1)],
        [thread('b', 2), thread('zero', 0)],
      ])).toEqual([[['a', 1], ['twin', 3], ['huge', 4]], [['b', 2], ['zero', 5]]]);
      expect(warn).toHaveBeenCalledTimes(3);
    });

    it('gives a thread whose id another thread has, on any page, a free one', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(loadThreads([[thread('same', 1)], [thread('same', 2), thread('same', 3)]])).toEqual([[['same', 1]], [['same-2', 2], ['same-3', 3]]]);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('drops only the bad reply, and gives a reply whose id is taken a free one', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const replies = thread('t', 1, { comments: [comment('m1'), { ...comment('m2'), createdAt: 'last week' }, comment('m1'), comment('m3')] });
      const document = createDocument();
      const result = migrateSceneDocument({ ...document, pages: [{ ...document.pages[0]!, threads: [replies] }] });
      expect(result.success && result.document.pages[0]!.threads![0]!.comments.map(({ id }) => id)).toEqual(['m1', 'm1-2', 'm3']);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('drops a thread whose opening comment has no real timestamp, or an author name past the cap', () => {
      const document = createDocument();
      const badTime = thread('bad-time', 2, { comments: [{ ...comment('m'), createdAt: 'last week' }] });
      const longName = thread('long-name', 3, { comments: [{ ...comment('n'), author: { kind: 'agent', name: 'x'.repeat(41) } }] });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const result = migrateSceneDocument({ ...document, pages: [{ ...document.pages[0]!, threads: [thread('good', 1), badTime, longName] }] });
      expect(result.success && result.document.pages[0]!.threads!.map(({ id }) => id)).toEqual(['good']);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('leaves a page with no valid thread without the key', () => {
      const document = createDocument();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const result = migrateSceneDocument({ ...document, pages: [{ ...document.pages[0]!, threads: [thread('bad', 1, { comments: [] })] }] });
      expect(result.success && 'threads' in result.document.pages[0]!).toBe(false);
      expect(result.success).toBe(true);
    });
  });
});
