import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectLegacyDocument } from './legacyProjection';
import { migrateSceneDocument } from './migration';

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

    it('drops a bad thread with a warning and loads the rest', () => {
      const document = createDocument();
      const input = {
        ...document,
        pages: [{ ...document.pages[0]!, threads: [thread('good', 1), thread('empty', 2, { comments: [] }), thread('twin', 1), thread('same-id', 3, { id: 'good' })] }],
      };
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const result = migrateSceneDocument(input);
      expect(result.success).toBe(true);
      if (result.success) expect(result.document.pages[0]!.threads!.map(({ id }) => id)).toEqual(['good']);
      expect(warn).toHaveBeenCalledTimes(3);
    });

    it('leaves a page with no valid thread without the key', () => {
      const document = createDocument();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const result = migrateSceneDocument({ ...document, pages: [{ ...document.pages[0]!, threads: [thread('bad', 0)] }] });
      expect(result.success && 'threads' in result.document.pages[0]!).toBe(false);
      expect(result.success).toBe(true);
    });
  });
});
