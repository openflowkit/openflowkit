import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createTestDocument, createTestNode } from '@/opencanvas/testing/builders/documentBuilder';
import { useDocumentSession } from '../../application/session/useDocumentSession';
import { addThread } from '../../domain/threads/threads';
import { FLOW_PERSISTENCE_DB_NAME } from '../../../services/storage/indexedDbSchema';
import { V2DocumentInvalidError, V2StorageQuotaError } from '../../../services/storage/v2/v2Errors';
import { createV2Repository, type LoadV2DocumentResult, type V2DocumentRepository } from '../../../services/storage/v2/v2Repository';
import { useV2Autosave } from './useV2Autosave';

function fakeRepository() {
  const saveDocument = vi.fn(async (id: string, document: ReturnType<typeof createTestDocument>, revision: number, _expected?: number) =>
    ({ status: 'saved' as const, record: { id, revision, schemaVersion: 1, document, savedAt: '' } }));
  return { saveDocument, loadDocument: vi.fn(), listDocuments: vi.fn(), deleteDocument: vi.fn() } as unknown as V2DocumentRepository & { saveDocument: typeof saveDocument };
}

const options = (repository: V2DocumentRepository, revision: number) => ({
  repository, documentId: 'doc-1', document: createTestDocument(), revision, baseRevision: 0, onConflict: () => undefined,
});

const labeled = (label: string) => createTestDocument({ nodes: [createTestNode('n1', { content: { label } })] });
const labelOf = (loaded: LoadV2DocumentResult) => (loaded.status === 'ok' ? loaded.record.document.pages[0].nodes[0]?.content.label : loaded.status);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useV2Autosave', () => {
  it('never saves a new document nobody touched', async () => {
    const repository = fakeRepository();
    renderHook(() => useV2Autosave(options(repository, 0)));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(repository.saveDocument).not.toHaveBeenCalled();
  });

  it('saves a pending edit at once when the editor goes away', async () => {
    const repository = fakeRepository();
    const { unmount } = renderHook(() => useV2Autosave(options(repository, 1)));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(repository.saveDocument).toHaveBeenCalledWith('doc-1', expect.anything(), 1, 0);
  });

  it('saves a pending edit at once when the tab is hidden or closed, and only once', async () => {
    const repository = fakeRepository();
    renderHook(() => useV2Autosave(options(repository, 1)));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(repository.saveDocument).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(repository.saveDocument).toHaveBeenCalledTimes(1);
  });

  it('asks before the page unloads only while an edit is unsaved', async () => {
    const repository = fakeRepository();
    const { rerender } = renderHook((revision: number) => useV2Autosave(options(repository, revision)), { initialProps: 1 });
    const unload = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
    expect(unload()).toBe(true); // the save it starts has not committed yet
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(unload()).toBe(false);
    rerender(1);
    expect(repository.saveDocument).toHaveBeenCalledTimes(1);
  });

  it('a failed save says so, with its reason, until a save succeeds; editing on does not hide it', async () => {
    const repository = fakeRepository();
    repository.saveDocument.mockRejectedValue(new V2StorageQuotaError());
    const { result, rerender } = renderHook((revision: number) => useV2Autosave(options(repository, revision)), { initialProps: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(result.current.status).toEqual({ state: 'failed', reason: 'quota' });
    rerender(2);
    expect(result.current.status).toEqual({ state: 'failed', reason: 'quota' });
    repository.saveDocument.mockRestore?.();
    repository.saveDocument.mockImplementation(async (id, document, revision) => ({ status: 'saved', record: { id, revision, schemaVersion: 1, document, savedAt: '' } }));
    act(() => result.current.retry());
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(result.current.status).toEqual({ state: 'saved' });
  });

  it('a document the repository refuses as invalid says what is wrong, not just "failed"', async () => {
    const repository = fakeRepository();
    repository.saveDocument.mockRejectedValue(new V2DocumentInvalidError({ path: '$.name', message: 'Expected a non-empty string.' }));
    const { result } = renderHook(() => useV2Autosave(options(repository, 1)));
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(result.current.status).toEqual({
      state: 'failed', reason: 'invalid', message: 'This diagram has a problem we can’t save: Expected a non-empty string. ($.name)',
    });
  });
});

describe('useV2Autosave with the document session', () => {
  // A comment is no undo step, but it is a change to keep: the session's revision moves, and that is what autosave saves by.
  it('saves a comment thread change', async () => {
    const repository = fakeRepository();
    const ignore = () => undefined;
    const { result } = renderHook(() => {
      const session = useDocumentSession({ onStaleRevision: ignore });
      useV2Autosave({ repository, documentId: 'doc-1', document: session.document, revision: session.revision, baseRevision: 0, onConflict: ignore });
      return session;
    });
    act(() => result.current.openDocument(createTestDocument()));
    act(() => result.current.updateThreads((document) => addThread(document, {
      pageId: 'page-1', threadId: 't1', nodeId: null, point: { x: 0, y: 0 },
      comment: { id: 'm1', author: { kind: 'human', name: 'Ada' }, body: 'Keep me', createdAt: '2026-10-26T12:00:00.000Z' },
    })));
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(repository.saveDocument).toHaveBeenCalledTimes(1);
    const [, saved, revision] = repository.saveDocument.mock.calls[0]!;
    expect(revision).toBe(1);
    expect(saved.pages[0]!.threads!.map(({ id }) => id)).toEqual(['t1']);
  });
});

describe('useV2Autosave against IndexedDB', () => {
  // fake-indexeddb runs on setImmediate: fake only the debounce timer.
  beforeEach(async () => {
    vi.useRealTimers();
    await new Promise<void>((resolve) => { indexedDB.deleteDatabase(FLOW_PERSISTENCE_DB_NAME).onsuccess = () => resolve(); });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  const settle = async () => {
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    for (let i = 0; i < 30; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
  };
  const edit = (repository: V2DocumentRepository, onConflict: () => void, baseRevision: number) =>
    renderHook((props: { revision: number; label: string }) => useV2Autosave({
      repository, documentId: 'd', document: labeled(props.label), revision: props.revision, baseRevision, onConflict,
    }), { initialProps: { revision: 1, label: 'mine 1' } });

  it('two tabs from the same revision: the second never overwrites the first, however many edits it has', async () => {
    const repository = createV2Repository(indexedDB);
    await repository.saveDocument('d', labeled('base'), 5);
    expect((await repository.saveDocument('d', labeled('other tab'), 6, 5)).status).toBe('saved');
    const onConflict = vi.fn();
    const tab = edit(repository, onConflict, 5);
    tab.rerender({ revision: 3, label: 'mine 3' }); // 5 + 3 = 8, past the other tab's 6
    await settle();
    expect(tab.result.current.status).toEqual({ state: 'conflict', storedRevision: 6 });
    expect(onConflict).toHaveBeenCalledTimes(1);
    tab.rerender({ revision: 4, label: 'mine 4' });
    await settle();
    tab.unmount(); // nothing pending is flushed over the other tab either
    await settle();
    expect(labelOf(await repository.loadDocument('d'))).toBe('other tab');
    expect(tab.result.current.status.state).toBe('conflict');
  });

  it('a rename on Home is a write the open editor must not clobber', async () => {
    const repository = createV2Repository(indexedDB);
    await repository.saveDocument('d', labeled('base'), 1);
    const loaded = await repository.loadDocument('d');
    if (loaded.status !== 'ok') throw new Error('expected ok');
    // V2HomePage's rename: one step on from what it loaded.
    await repository.saveDocument('d', { ...loaded.record.document, name: 'Renamed' }, loaded.record.revision + 1);
    const tab = edit(repository, vi.fn(), 1);
    tab.rerender({ revision: 2, label: 'mine 2' }); // 1 + 2 = 3, past the rename's 2
    await settle();
    expect(tab.result.current.status.state).toBe('conflict');
    const after = await repository.loadDocument('d');
    expect(after.status === 'ok' && after.record.document.name).toBe('Renamed');
  });

  it('saves in a row from its own last write', async () => {
    const repository = createV2Repository(indexedDB);
    const tab = edit(repository, vi.fn(), 0);
    await settle();
    tab.rerender({ revision: 2, label: 'mine 2' });
    await settle();
    expect(tab.result.current.status).toEqual({ state: 'saved' });
    expect(labelOf(await repository.loadDocument('d'))).toBe('mine 2');
  });
});
