import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { buildMoveNodesCommand } from '../../domain/commands/sceneEdits';
import type { SceneDocumentV1 } from '../../domain/document/types';
import { addThread } from '../../domain/threads/threads';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { useDocumentSession } from './useDocumentSession';

const comment = (document: SceneDocumentV1, threadId: string) => addThread(document, {
  pageId: 'page-1', threadId, nodeId: null, point: { x: 0, y: 0 },
  comment: { id: `${threadId}-m`, author: { kind: 'human', name: 'Ada' }, body: 'Why?', createdAt: '2026-10-26T12:00:00.000Z' },
});

function openSession() {
  const onStaleRevision = vi.fn();
  const hook = renderHook(() => useDocumentSession({ onStaleRevision }));
  act(() => hook.result.current.openDocument(createTestDocument({ nodes: [createTestNode('a')] })));
  const moveA = () => buildMoveNodesCommand(hook.result.current.document!.pages[0]!, ['a'], { x: 10, y: 0 });
  return { result: hook.result, onStaleRevision, moveA };
}

describe('useDocumentSession', () => {
  // A comment moves `revision` but not `contentRevision`: an edit checked against `revision` would be refused as
  // stale, and the page would reload and lose it.
  it('takes plain edits, undo and redo after a comment', () => {
    const { result, onStaleRevision, moveA } = openSession();
    act(() => result.current.updateThreads((document) => comment(document, 't1')));
    act(() => result.current.commit(moveA()));
    act(() => result.current.updateThreads((document) => comment(document, 't2')));
    act(() => result.current.amendNewNode('a', moveA()));
    act(() => result.current.updateThreads((document) => comment(document, 't3')));
    act(() => result.current.undo());
    act(() => result.current.updateThreads((document) => comment(document, 't4')));
    act(() => result.current.redo());
    expect(onStaleRevision).not.toHaveBeenCalled();
    expect(result.current.contentRevision).toBe(4);
    expect(result.current.revision).toBe(8);
    expect(result.current.document!.pages[0]!.threads!.map(({ id }) => id)).toEqual(['t1', 't2', 't3', 't4']);
  });
});
