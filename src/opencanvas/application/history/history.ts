import { carryThreads } from '../../domain/threads/threads';
import { applyDocumentCommand as applyCommand } from '../../domain/commands/execute';
import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneDocumentV1 } from '../../domain/document/types';
import type { DocumentHistoryEntry, DocumentHistoryState } from './types';

const DEFAULT_HISTORY_LIMIT = 100;

/** A history step changes shapes only: the threads of the document it starts from stay (see carryThreads). */
function applyDocumentCommand(present: SceneDocumentV1, command: DocumentCommand) {
  const applied = applyCommand(present, command);
  return { ...applied, document: carryThreads(applied.document, present) };
}

function requireHistoryLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('Document history limit must be a positive integer.');
  }
  return limit;
}

function appendBounded<T>(values: readonly T[], value: T, limit: number): readonly T[] {
  const appended = [...values, value];
  return appended.length > limit ? appended.slice(appended.length - limit) : appended;
}

export function createDocumentHistory(
  document: SceneDocumentV1,
  limit = DEFAULT_HISTORY_LIMIT
): DocumentHistoryState {
  return { present: document, past: [], future: [], limit: requireHistoryLimit(limit) };
}

export function commitDocumentCommand(
  history: DocumentHistoryState,
  command: DocumentCommand
): DocumentHistoryState {
  const applied = applyDocumentCommand(history.present, command);
  const entry: DocumentHistoryEntry = { command, inverse: applied.inverse };
  return {
    ...history,
    present: applied.document,
    past: appendBounded(history.past, entry, history.limit),
    future: [],
  };
}

const steps = (command: DocumentCommand): readonly DocumentCommand[] => (command.kind === 'batch' ? command.commands : [command]);
const inserts = (command: DocumentCommand, nodeId: string): boolean =>
  steps(command).some((step) => step.kind === 'insert-node' && step.node.id === nodeId);

/**
 * A node made for a label edit and its first label are one user intent, so one undo step: when the last step
 * inserted `nodeId`, `command` folds into it, and a command that removes the node again (left blank) drops
 * the step altogether. Otherwise `command` commits as its own step.
 */
export function amendNewNode(
  history: DocumentHistoryState,
  nodeId: string,
  command: DocumentCommand
): DocumentHistoryState {
  const last = history.past[history.past.length - 1];
  if (!last || !inserts(last.command, nodeId)) return commitDocumentCommand(history, command);
  const applied = applyDocumentCommand(history.present, command);
  const kept = applied.document.pages.some((page) => page.nodes.some((node) => node.id === nodeId));
  const entry: DocumentHistoryEntry = {
    command: { kind: 'batch', id: last.command.id, label: last.command.label, commands: [...steps(last.command), ...steps(command)] },
    inverse: { kind: 'batch', id: last.inverse.id, label: last.inverse.label, commands: [...steps(applied.inverse), ...steps(last.inverse)] },
  };
  return { ...history, present: applied.document, past: [...history.past.slice(0, -1), ...(kept ? [entry] : [])], future: [] };
}

export function undoDocumentCommand(history: DocumentHistoryState): DocumentHistoryState {
  const entry = history.past[history.past.length - 1];
  if (!entry) return history;
  const applied = applyDocumentCommand(history.present, entry.inverse);
  return {
    ...history,
    present: applied.document,
    past: history.past.slice(0, -1),
    // What redo does is what undoing this step did, seen from here: a page it brings back holds the threads
    // it has now, not the ones it had when the step was first made.
    future: [{ command: { ...applied.inverse, id: entry.command.id, label: entry.command.label }, inverse: entry.inverse }, ...history.future].slice(0, history.limit),
  };
}

export function redoDocumentCommand(history: DocumentHistoryState): DocumentHistoryState {
  const entry = history.future[0];
  if (!entry) return history;
  const applied = applyDocumentCommand(history.present, entry.command);
  return {
    ...history,
    present: applied.document,
    // Likewise for what the next undo does.
    past: appendBounded(history.past, { command: entry.command, inverse: { ...applied.inverse, id: entry.inverse.id, label: entry.inverse.label } }, history.limit),
    future: history.future.slice(1),
  };
}

export function canUndoDocument(history: DocumentHistoryState): boolean {
  return history.past.length > 0;
}

export function canRedoDocument(history: DocumentHistoryState): boolean {
  return history.future.length > 0;
}
