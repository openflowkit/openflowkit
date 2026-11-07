import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneDocumentV1 } from '../../domain/document/types';
import { validateSceneDocumentV1 } from '../../domain/document/validation';
import { ThreadError } from '../../domain/threads/threads';
import {
  amendNewNode,
  commitDocumentCommand,
  createDocumentHistory,
  redoDocumentCommand,
  undoDocumentCommand,
} from '../history/history';
import type { DocumentHistoryState } from '../history/types';
import type { DocumentSession } from './types';

export class StaleSessionRevisionError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `Stale content revision: expected ${expectedRevision}, the diagram is at ${actualRevision}.`
    );
    this.name = 'StaleSessionRevisionError';
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

// A diagram step is built on the diagram: a thread change since it was built is no conflict (history steps keep
// the threads they start from, see carryThreads), a diagram change is.
function requireCurrentContent(session: DocumentSession, expectedContentRevision: number): void {
  if (expectedContentRevision !== session.contentRevision) {
    throw new StaleSessionRevisionError(expectedContentRevision, session.contentRevision);
  }
}

function advance(
  session: DocumentSession,
  history: DocumentHistoryState
): DocumentSession {
  if (history === session.history) return session;
  return {
    document: history.present, revision: session.revision + 1, contentRevision: session.contentRevision + 1, history,
  };
}

export function createDocumentSession(
  document: SceneDocumentV1,
  limit?: number
): DocumentSession {
  const history = createDocumentHistory(document, limit);
  return { document: history.present, revision: 0, contentRevision: 0, history };
}

export function commitSessionCommand(
  session: DocumentSession,
  command: DocumentCommand,
  expectedContentRevision: number
): DocumentSession {
  requireCurrentContent(session, expectedContentRevision);
  return advance(session, commitDocumentCommand(session.history, command));
}

/** See amendNewNode: a new node's first label (or its removal when left blank) joins the step that made it. */
export function amendSessionNewNode(
  session: DocumentSession,
  nodeId: string,
  command: DocumentCommand,
  expectedContentRevision: number
): DocumentSession {
  requireCurrentContent(session, expectedContentRevision);
  return advance(session, amendNewNode(session.history, nodeId, command));
}

/**
 * A template's step becomes the document's start: nothing to undo back to "Untitled". Only when it is the one step:
 * an edit made while the template generated keeps its undo, and so does the template's.
 */
export function forgetSessionHistory(session: DocumentSession): DocumentSession {
  if (session.history.past.length !== 1) return session;
  return { ...session, history: createDocumentHistory(session.document, session.history.limit) };
}

/**
 * A thread change (domain/threads): a new revision, so autosave and the agent bridge see it, but no undo
 * step and no content revision, and undo/redo of the steps around it keep it. It needs no expected revision:
 * `change` reads the session's document of now, so it can never be built on an older one.
 */
export function updateSessionThreads(
  session: DocumentSession,
  change: (document: SceneDocumentV1) => SceneDocumentV1
): DocumentSession {
  const document = change(session.document);
  if (document === session.document) return session;
  const valid = validateSceneDocumentV1(document);
  if (valid.success === false) throw new ThreadError(`Invalid thread change: ${valid.issues[0]!.message}`);
  return { ...session, document, revision: session.revision + 1, history: { ...session.history, present: document } };
}

export function undoSessionCommand(
  session: DocumentSession,
  expectedContentRevision: number
): DocumentSession {
  requireCurrentContent(session, expectedContentRevision);
  // Revisions count commits, so undo/redo move them forward like any other
  // commit instead of rewinding them; history holds the inverse, not the counter.
  return advance(session, undoDocumentCommand(session.history));
}

export function redoSessionCommand(
  session: DocumentSession,
  expectedContentRevision: number
): DocumentSession {
  requireCurrentContent(session, expectedContentRevision);
  return advance(session, redoDocumentCommand(session.history));
}
