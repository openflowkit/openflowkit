import { describe, expect, it } from 'vitest';
import type { DocumentCommand } from '../../domain/commands/types';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import {
  amendNewNode,
  canRedoDocument,
  canUndoDocument,
  commitDocumentCommand,
  createDocumentHistory,
  redoDocumentCommand,
  undoDocumentCommand,
} from './history';

function editLabelCommand(label: string, previousLabel = 'node-1'): DocumentCommand {
  const before = createTestNode('node-1', { content: { label: previousLabel } });
  return {
    kind: 'set-node',
    id: `label-${label}`,
    label: 'Edit label',
    pageId: 'page-1',
    before,
    after: { ...before, content: { label } },
  };
}

describe('canonical document history', () => {
  it('commits, undoes, and redoes exact documents', () => {
    const document = createTestDocument({ nodes: [createTestNode('node-1')] });
    const committed = commitDocumentCommand(
      createDocumentHistory(document),
      editLabelCommand('Edited')
    );
    const undone = undoDocumentCommand(committed);
    const redone = redoDocumentCommand(undone);

    expect(committed.present.pages[0].nodes[0].content.label).toBe('Edited');
    expect(undone.present).toEqual(document);
    expect(redone.present).toEqual(committed.present);
    expect(canUndoDocument(committed)).toBe(true);
    expect(canRedoDocument(undone)).toBe(true);
  });

  it('returns the same state when undo or redo is unavailable', () => {
    const history = createDocumentHistory(createTestDocument());
    expect(undoDocumentCommand(history)).toBe(history);
    expect(redoDocumentCommand(history)).toBe(history);
  });

  it('bounds history and clears future entries after a new commit', () => {
    const document = createTestDocument({ nodes: [createTestNode('node-1')] });
    let history = createDocumentHistory(document, 2);
    history = commitDocumentCommand(history, editLabelCommand('one'));
    history = commitDocumentCommand(history, editLabelCommand('two', 'one'));
    history = commitDocumentCommand(history, editLabelCommand('three', 'two'));
    expect(history.past).toHaveLength(2);

    history = undoDocumentCommand(history);
    expect(history.future).toHaveLength(1);
    history = commitDocumentCommand(history, editLabelCommand('replacement', 'two'));
    expect(history.future).toEqual([]);
  });

  it('records a batch as one transaction', () => {
    const a = createTestNode('a');
    const b = createTestNode('b');
    const document = createTestDocument({ nodes: [a, b] });
    const history = commitDocumentCommand(createDocumentHistory(document), {
      kind: 'batch',
      id: 'move-both',
      label: 'Move both',
      commands: [a, b].map((node, index) => ({
        kind: 'set-node' as const,
        id: `move-${node.id}`,
        label: 'Move',
        pageId: 'page-1',
        before: node,
        after: {
          ...node,
          transform: {
            ...node.transform,
            translation: { x: (index + 1) * 10, y: (index + 1) * 20 },
          },
        },
      })),
    });

    expect(history.past).toHaveLength(1);
    expect(undoDocumentCommand(history).present).toEqual(document);
  });

  it('rejects invalid limits', () => {
    expect(() => createDocumentHistory(createTestDocument(), 0)).toThrow(/positive integer/);
    expect(() => createDocumentHistory(createTestDocument(), 1.5)).toThrow(/positive integer/);
  });
});

describe('a new node and its first label', () => {
  const created = createTestNode('new', { content: { label: '' } });
  const insert: DocumentCommand = { kind: 'insert-node', id: 'insert-new', label: 'Add text', pageId: 'page-1', index: 1, node: created };
  const labelled: DocumentCommand = {
    kind: 'set-node', id: 'label-new', label: 'Edit label', pageId: 'page-1', before: created, after: { ...created, content: { label: 'Hello' } },
  };
  const removed: DocumentCommand = { kind: 'remove-node', id: 'remove-new', label: 'Delete', pageId: 'page-1', index: 1, node: created };
  const start = () => createDocumentHistory(createTestDocument({ nodes: [createTestNode('node-1')] }));

  it('the label folds into the step that created the node: one undo removes both', () => {
    const history = amendNewNode(commitDocumentCommand(start(), insert), 'new', labelled);
    expect(history.past).toHaveLength(1);
    expect(history.present.pages[0].nodes.find((node) => node.id === 'new')?.content.label).toBe('Hello');
    const undone = undoDocumentCommand(history);
    expect(undone.present).toEqual(start().present);
    expect(redoDocumentCommand(undone).present).toEqual(history.present);
  });

  it('a new node left blank leaves no undo step behind', () => {
    const history = amendNewNode(commitDocumentCommand(start(), insert), 'new', removed);
    expect(history.past).toHaveLength(0);
    expect(history.future).toHaveLength(0);
    expect(history.present).toEqual(start().present);
  });

  it('commits on its own when the last step did not create that node', () => {
    const before = commitDocumentCommand(start(), editLabelCommand('Edited'));
    const history = amendNewNode(commitDocumentCommand(before, insert), 'other', labelled);
    expect(history.past).toHaveLength(3);
  });

  it('keeps a batch\'s identity through undo and redo', () => {
    const batch: DocumentCommand = { kind: 'batch', id: 'agent-1', label: 'Agent change', commands: [editLabelCommand('Edited')] };
    let history = commitDocumentCommand(createDocumentHistory(createTestDocument({ nodes: [createTestNode('node-1')] })), batch);
    history = redoDocumentCommand(undoDocumentCommand(history));
    history = redoDocumentCommand(undoDocumentCommand(history));
    expect(history.past.at(-1)!.command).toMatchObject({ id: 'agent-1', label: 'Agent change' });
  });
});
