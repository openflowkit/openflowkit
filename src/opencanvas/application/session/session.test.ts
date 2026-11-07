import { describe, expect, it } from 'vitest';
import type { DocumentCommand } from '../../domain/commands/types';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import {
  StaleSessionRevisionError,
  commitSessionCommand,
  createDocumentSession,
  forgetSessionHistory,
  redoSessionCommand,
  undoSessionCommand,
} from './session';

function renameCommand(previousLabel = 'node-1', nextLabel = 'Renamed'): DocumentCommand {
  const before = createTestNode('node-1', { content: { label: previousLabel } });
  return {
    kind: 'set-node',
    id: 'rename-node:node-1',
    label: 'Rename node',
    pageId: 'page-1',
    before,
    after: { ...before, content: { label: nextLabel } },
  };
}

function session() {
  return createDocumentSession(createTestDocument({ nodes: [createTestNode('node-1')] }));
}

describe('revisioned document session', () => {
  it('starts at revision zero', () => {
    const initial = session();
    expect(initial.revision).toBe(0);
    expect(initial.document).toBe(initial.history.present);
  });

  it('increments the revision on every commit', () => {
    const committed = commitSessionCommand(session(), renameCommand(), 0);
    expect(committed.revision).toBe(1);
    expect(committed.document.pages[0].nodes[0].content.label).toBe('Renamed');
    const again = commitSessionCommand(committed, renameCommand('Renamed', 'Renamed again'), 1);
    expect(again.revision).toBe(2);
  });

  it('rejects a stale commit without touching the session', () => {
    const committed = commitSessionCommand(session(), renameCommand(), 0);
    expect(() => commitSessionCommand(committed, renameCommand('Renamed', 'Again'), 0)).toThrow(
      StaleSessionRevisionError
    );
    try {
      commitSessionCommand(committed, renameCommand('Renamed', 'Again'), 0);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(StaleSessionRevisionError);
      expect((error as StaleSessionRevisionError).expectedRevision).toBe(0);
      expect((error as StaleSessionRevisionError).actualRevision).toBe(1);
    }
    expect(committed.revision).toBe(1);
    expect(committed.document.pages[0].nodes[0].content.label).toBe('Renamed');
  });

  it('treats undo and redo as new commits that move the revision forward', () => {
    const initial = session();
    const committed = commitSessionCommand(initial, renameCommand(), 0);
    const undone = undoSessionCommand(committed, 1);
    expect(undone.revision).toBe(2);
    expect(undone.document).toEqual(initial.document);
    const redone = redoSessionCommand(undone, 2);
    expect(redone.revision).toBe(3);
    expect(redone.document).toEqual(committed.document);
  });

  it('rejects stale undo and redo', () => {
    const committed = commitSessionCommand(session(), renameCommand(), 0);
    expect(() => undoSessionCommand(committed, 0)).toThrow(StaleSessionRevisionError);
    const undone = undoSessionCommand(committed, 1);
    expect(() => redoSessionCommand(undone, 1)).toThrow(StaleSessionRevisionError);
  });

  it('leaves the session untouched when undo or redo has nothing to do', () => {
    const initial = session();
    expect(undoSessionCommand(initial, 0)).toBe(initial);
    expect(redoSessionCommand(initial, 0)).toBe(initial);
  });

  it('forgets history without moving the document or revision: a template is where the document starts', () => {
    const committed = commitSessionCommand(session(), renameCommand(), 0);
    const started = forgetSessionHistory(committed);
    expect(started.document).toBe(committed.document);
    expect(started.revision).toBe(committed.revision);
    expect(undoSessionCommand(started, started.contentRevision)).toBe(started);
  });

  it('keeps history when another step landed beside the template (an edit while it generated)', () => {
    const edited = commitSessionCommand(session(), renameCommand(), 0);
    const both = commitSessionCommand(edited, renameCommand('Renamed', 'Again'), edited.contentRevision);
    expect(forgetSessionHistory(both)).toBe(both);
  });
});
