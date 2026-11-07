import { describe, expect, it, vi } from 'vitest';
import { commitDocumentCommand, createDocumentHistory, redoDocumentCommand, undoDocumentCommand } from '../../application/history/history';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import type { DocumentCommand } from '../commands/types';
import type { SceneDocumentV1, ScenePage } from '../document/types';
import { addThread } from './threads';

// The seam: every world-matrix rebuild is recorded with the page it was made for.
const rebuilt = vi.hoisted(() => [] as string[]);
vi.mock('../scene/worldGeometry', async (importOriginal) => {
  const original = await importOriginal<typeof import('../scene/worldGeometry')>();
  return {
    ...original,
    buildNodeWorldMatrices: (page: ScenePage) => {
      rebuilt.push(page.id);
      return original.buildNodeWorldMatrices(page);
    },
  };
});

const author = { kind: 'human' as const, name: 'Ada' };
const at = '2026-10-26T12:00:00.000Z';

// Two pages, each with a pin on its node.
function twoPinnedPages(): SceneDocumentV1 {
  const base = createTestDocument({ nodes: [createTestNode('a')] });
  let document: SceneDocumentV1 = { ...base, pages: [base.pages[0]!, { ...base.pages[0]!, id: 'page-2', name: 'Page 2' }] };
  for (const pageId of ['page-1', 'page-2']) {
    document = addThread(document, { pageId, threadId: `t-${pageId}`, nodeId: 'a', point: { x: 5, y: 5 }, comment: { id: `m-${pageId}`, author, body: 'x', createdAt: at } });
  }
  return document;
}

describe('carrying threads through history', () => {
  it('rebuilds anchors only on the page an edit touched', () => {
    const document = twoPinnedPages();
    const before = document.pages[0]!.nodes[0]!;
    const move: DocumentCommand = {
      kind: 'set-node', id: 'move', label: 'Move', pageId: 'page-1', before,
      after: { ...before, transform: { ...before.transform, translation: { x: 50, y: 50 } } },
    };
    rebuilt.length = 0;
    let history = commitDocumentCommand(createDocumentHistory(document), move);
    expect(rebuilt).toContain('page-1');
    expect(rebuilt).not.toContain('page-2');
    expect(history.present.pages[0]!.threads![0]!.anchor.point).toEqual({ x: 55, y: 55 });

    rebuilt.length = 0;
    history = redoDocumentCommand(undoDocumentCommand(history));
    expect(rebuilt).not.toContain('page-2');
  });
});
