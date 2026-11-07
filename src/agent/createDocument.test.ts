import { afterEach, describe, expect, it, vi } from 'vitest';
import { addThread } from '../opencanvas/domain/threads/threads';
import { createAgentDocument, parseAgentDocument } from './index';

describe('createAgentDocument', () => {
  it('is a plain empty document: no v1 snapshot rides on the document or its page', () => {
    const document = createAgentDocument('Checkout', 'doc-1');
    expect(parseAgentDocument(document)).toEqual(document);
    expect(document).toMatchObject({ id: 'doc-1', name: 'Checkout', pages: [{ id: 'doc-1:page-1', name: 'Page 1', nodes: [], connectors: [] }] });
    expect(JSON.stringify(document)).not.toContain('openflowkit.legacy');
  });
});

describe('parseAgentDocument', () => {
  afterEach(() => vi.restoreAllMocks());

  // The agent opens a file the way the app does: one bad thread is dropped, never the whole diagram.
  it('drops a bad thread with a warning and opens the rest, as the app does', () => {
    const at = '2026-10-26T12:00:00.000Z';
    const document = addThread(createAgentDocument('Checkout', 'doc-1'), {
      pageId: 'doc-1:page-1', threadId: 'good', nodeId: null, point: { x: 0, y: 0 },
      comment: { id: 'm1', author: { kind: 'human', name: 'Ada' }, body: 'Keep me', createdAt: at },
    });
    const [page] = document.pages;
    const good = page!.threads![0]!;
    const file = JSON.parse(JSON.stringify({ ...document, pages: [{ ...page, threads: [good, { ...good, id: 'empty', number: 2, comments: [] }] }] }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const opened = parseAgentDocument(file);
    expect(opened.pages[0]!.threads!.map(({ id }) => id)).toEqual(['good']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('refuses a file that is not a diagram, and one from a newer schema', () => {
    expect(() => parseAgentDocument({ format: 'nope' })).toThrow(/Invalid OpenCanvas document/);
    expect(() => parseAgentDocument({ ...createAgentDocument('Next'), schemaVersion: 99 })).toThrow(/newer/);
  });
});
