import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentCommand } from '../../domain/commands/types';
import { useDocumentSession } from '../../application/session/useDocumentSession';
import { addThread } from '../../domain/threads/threads';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { useV2Pages } from './useV2Pages';

// Page ops are unit-tested as commands at the source (productionPages.test.ts);
// this proves the bar's hook wires them the way a user expects: one command per
// action, selection follows the new page, and the last page cannot be deleted.
function setup() {
  let document = createTestDocument({ nodes: [] });
  const apply = (command: DocumentCommand): void => {
    if (command.kind === 'insert-page') {
      const pages = [...document.pages];
      pages.splice(command.index, 0, command.page);
      document = { ...document, pages };
    } else if (command.kind === 'remove-page') {
      document = { ...document, pages: document.pages.filter(({ id }) => id !== command.page.id) };
    } else if (command.kind === 'set-page') {
      document = { ...document, pages: document.pages.map((page) => (page.id === command.pageId ? command.after : page)) };
    } else if (command.kind === 'batch') {
      for (const child of command.commands) apply(child);
    }
  };
  const commit = vi.fn(apply);
  let counter = 0;
  const selected: string[] = [];
  const announce = vi.fn();
  const toast = vi.fn();
  const undo = vi.fn();
  const hook = renderHook(
    (props: { pageId: string | null }) => useV2Pages({
      document, pageId: props.pageId, readOnly: false, commit,
      onSelect: (pageId) => selected.push(pageId),
      mintId: (prefix) => `${prefix}-new-${++counter}`,
      announce, toast, undo, contentRevision: () => 0,
    }),
    { initialProps: { pageId: document.pages[0]!.id } },
  );
  // Like the editor, each commit re-renders the hook with the new document.
  const act1 = (run: (api: ReturnType<typeof useV2Pages>) => void): void => act(() => {
    run(hook.result.current);
    hook.rerender({ pageId: hook.result.current.activePage?.id ?? null });
  });
  return { hook, commit, selected, announce, toast, undo, document: () => document, act: act1 };
}

describe('useV2Pages', () => {
  it('adds, duplicates, renames, reorders and removes one command per action', () => {
    const { commit, selected, document, act: act1 } = setup();

    act1((api) => api.add());
    expect(commit.mock.calls[0]![0]).toMatchObject({ kind: 'insert-page', index: 1, page: { name: 'Page 2' } });
    expect(selected).toEqual(['page-new-1']);

    const second = document().pages[1]!;
    act1((api) => api.duplicate(second.id));
    expect(commit.mock.calls[1]![0]).toMatchObject({ kind: 'insert-page', index: 2, page: { name: 'Page 2 Copy' } });

    act1((api) => api.rename(second.id, '  Checkout  '));
    expect(commit.mock.calls[2]![0]).toMatchObject({ kind: 'set-page', pageId: second.id, after: { name: 'Checkout' } });

    act1((api) => api.move(second.id, 'left'));
    expect(commit.mock.calls[3]![0]).toMatchObject({ kind: 'batch', id: `reorder-page:${second.id}:left` });

    act1((api) => api.remove(second.id));
    expect(commit.mock.calls[4]![0]).toMatchObject({ kind: 'remove-page', page: { id: second.id } });
    expect(document().pages.map(({ name }) => name)).toEqual(['Page 1', 'Page 2 Copy']);
  });

  it('add hands back the new page so the menu can open its rename', () => {
    const { hook } = setup();
    let added: { id: string; name: string } | undefined;
    act(() => { added = hook.result.current.add(); });
    expect(added).toEqual({ id: 'page-new-1', name: 'Page 2' });
  });

  it('deleting a page with content offers Undo; an empty page just goes', () => {
    const { toast, undo, selected, document, act: act1 } = setup();
    act1((api) => api.add());
    const empty = document().pages[1]!;
    act1((api) => api.remove(empty.id));
    expect(toast).not.toHaveBeenCalled();
    const withContent = createTestDocument({ nodes: [createTestNode('n1')] });
    expect(withContent.pages[0]!.nodes.length).toBeGreaterThan(0);
    let revision = 4;
    const commit = vi.fn(() => { revision += 1; });
    const pages = { ...withContent, pages: [withContent.pages[0]!, { ...withContent.pages[0]!, id: 'second', name: 'Second' }] };
    const hook = renderHook(() => useV2Pages({
      document: pages, pageId: 'second', readOnly: false, commit,
      onSelect: (id) => selected.push(id), mintId: (prefix) => `${prefix}-x`, announce: vi.fn(), toast, undo, contentRevision: () => revision,
    }));
    act(() => hook.result.current.remove('second'));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Deleted Second', action: expect.objectContaining({ label: 'Undo' }) }));
    toast.mock.calls[0]![0].action.onClick();
    expect(undo).toHaveBeenCalledOnce();
    expect(selected.at(-1)).toBe('second');
  });

  // The toast's Undo is the editor's undo: after any later edit it would revert that edit instead.
  it('the delete toast undoes nothing once another edit has landed', () => {
    const withContent = createTestDocument({ nodes: [createTestNode('n1')] });
    const pages = { ...withContent, pages: [withContent.pages[0]!, { ...withContent.pages[0]!, id: 'second', name: 'Second' }] };
    let revision = 0;
    const toast = vi.fn();
    const undo = vi.fn();
    const hook = renderHook(() => useV2Pages({
      document: pages, pageId: 'second', readOnly: false, commit: () => { revision += 1; },
      onSelect: vi.fn(), mintId: (prefix) => `${prefix}-x`, announce: vi.fn(), toast, undo, contentRevision: () => revision,
    }));
    act(() => hook.result.current.remove('second'));
    revision += 1; // the user moved a shape while the toast was up
    toast.mock.calls[0]![0].action.onClick();
    expect(undo).not.toHaveBeenCalled();
  });

  // As the editor wires it: a comment is no diagram change, so the delete is still the step Undo undoes.
  it('the delete toast still undoes the delete after a comment', () => {
    const withContent = createTestDocument({ nodes: [createTestNode('n1')] });
    const pages = { ...withContent, pages: [withContent.pages[0]!, { ...withContent.pages[0]!, id: 'second', name: 'Second' }] };
    const toast = vi.fn();
    const { result } = renderHook(() => {
      const session = useDocumentSession({ onStaleRevision: vi.fn() });
      const bar = useV2Pages({
        document: session.document, pageId: 'second', readOnly: false, commit: session.commit,
        onSelect: vi.fn(), mintId: (prefix) => `${prefix}-x`, announce: vi.fn(), toast,
        undo: session.undo, contentRevision: session.currentContentRevision,
      });
      return { session, bar };
    });
    act(() => result.current.session.openDocument(pages));
    act(() => result.current.bar.remove('second'));
    act(() => result.current.session.updateThreads((document) => addThread(document, {
      pageId: 'page-1', threadId: 't1', nodeId: null, point: { x: 0, y: 0 },
      comment: { id: 'm1', author: { kind: 'human', name: 'Ada' }, body: 'Where did it go?', createdAt: '2026-10-26T12:00:00.000Z' },
    })));
    act(() => toast.mock.calls[0]![0].action.onClick());
    expect(result.current.session.document!.pages.map(({ id }) => id)).toEqual(['page-1', 'second']);
    expect(result.current.session.document!.pages[0]!.threads!.map(({ id }) => id)).toEqual(['t1']);
  });

  it('never removes the last page and says why', () => {
    const { commit, announce, document, act: act1 } = setup();
    const only = document().pages[0]!;
    act1((api) => api.remove(only.id));
    expect(commit).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/at least one page/));
  });

  it('does nothing while the document is read-only', () => {
    const document = createTestDocument({ nodes: [] });
    const commit = vi.fn();
    const hook = renderHook(() => useV2Pages({
      document, pageId: document.pages[0]!.id, readOnly: true, commit,
      onSelect: vi.fn(), mintId: (prefix) => `${prefix}-new-1`, announce: vi.fn(), toast: vi.fn(), undo: vi.fn(), contentRevision: () => 0,
    }));
    act(() => hook.result.current.add());
    act(() => hook.result.current.rename(document.pages[0]!.id, 'Nope'));
    expect(commit).not.toHaveBeenCalled();
  });

  it('a locked page cannot be renamed, duplicated, moved, swapped with or removed; the others can', () => {
    let document = createTestDocument({ nodes: [] });
    document = { ...document, pages: [document.pages[0]!, { ...document.pages[0]!, id: 'pinned', name: 'Pinned' }] };
    const commit = vi.fn();
    const locked = document.pages[0]!.id;
    const hook = renderHook(() => useV2Pages({
      document, pageId: 'pinned', readOnly: false, lockedPageId: locked, commit,
      onSelect: vi.fn(), mintId: (prefix) => `${prefix}-new-1`, announce: vi.fn(), toast: vi.fn(), undo: vi.fn(), contentRevision: () => 0,
    }));
    const api = hook.result.current;
    expect(api.isLocked(locked)).toBe(true);
    expect(api.isLocked('pinned')).toBe(false);
    act(() => { api.rename(locked, 'No'); api.duplicate(locked); api.remove(locked); api.move(locked, 'right'); api.move('pinned', 'left'); });
    expect(commit).not.toHaveBeenCalled();
    act(() => api.rename('pinned', 'Renamed'));
    act(() => api.remove('pinned'));
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
