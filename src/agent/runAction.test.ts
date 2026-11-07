import { describe, expect, it } from 'vitest';
import { addThread } from '../opencanvas/domain/threads/threads';
import { createTestDocument, createTestNode } from '../opencanvas/testing/builders/documentBuilder';
import { findAgentOp } from './ops';
import { createTestCapabilities } from './ops/testHost';
import { runAgentOp } from './runAction';

describe('runAgentOp', () => {
  // The file path (openflow_save, the CLI's --doc) writes what this returns: a comment pinned to a node moves with it.
  it('moves a comment pinned to a node along with the node', async () => {
    const node = createTestNode('a', { transform: { translation: { x: 100, y: 100 }, rotationRadians: 0, scale: { x: 1, y: 1 } } });
    const document = addThread(createTestDocument({ nodes: [node] }), {
      pageId: 'page-1', threadId: 't1', nodeId: 'a', point: { x: 110, y: 120 },
      comment: { id: 'm1', author: { kind: 'human', name: 'Ada' }, body: 'Why here?', createdAt: '2026-10-26T12:00:00.000Z' },
    });
    const result = await runAgentOp(findAgentOp('move')!, { ids: ['a'], delta: { x: 500, y: 0 } }, { document, pageId: 'page-1', capabilities: createTestCapabilities() });
    expect(result.document.pages[0]!.threads![0]!.anchor.point).toEqual({ x: 610, y: 120 });
  });
});
