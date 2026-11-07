import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneDocumentV1 } from '../../domain/document/types';
import { canRedoDocument, canUndoDocument } from '../history/history';
import {
  amendSessionNewNode,
  commitSessionCommand,
  createDocumentSession,
  forgetSessionHistory,
  redoSessionCommand,
  StaleSessionRevisionError,
  undoSessionCommand,
  updateSessionThreads,
} from './session';
import type { DocumentSession } from './types';

interface DocumentSessionCallbacks {
  readonly onStaleRevision: () => void;
}

// Every edit in the v2 route goes through this hook. A stale revision cannot
// happen with one tab; when it does (a second writer), the page reloads from
// the repository instead of swallowing the edit.
export function useDocumentSession(callbacks: DocumentSessionCallbacks) {
  const [session, setSession] = useState<DocumentSession | null>(null);
  const sessionRef = useRef<DocumentSession | null>(null);
  const staleRef = useRef(callbacks.onStaleRevision);
  useEffect(() => {
    staleRef.current = callbacks.onStaleRevision;
  }, [callbacks.onStaleRevision]);

  const openDocument = useCallback((document: SceneDocumentV1) => {
    const next = createDocumentSession(document);
    sessionRef.current = next;
    setSession(next);
  }, []);

  const advance = useCallback(
    (
      step: (current: DocumentSession) => DocumentSession,
      ready: (current: DocumentSession) => boolean = () => true,
      rethrowStale = false
    ) => {
      const current = sessionRef.current;
      if (!current || !ready(current)) return;
      try {
        const next = step(current);
        sessionRef.current = next;
        setSession(next);
      } catch (error) {
        if (error instanceof StaleSessionRevisionError && !rethrowStale) staleRef.current();
        else throw error;
      }
    },
    []
  );

  // With an explicit expectedContentRevision the caller owns staleness (a proposal
  // built on an older diagram) and receives StaleSessionRevisionError.
  const commit = useCallback(
    (command: DocumentCommand, expectedContentRevision?: number) =>
      advance(
        (current) => commitSessionCommand(current, command, expectedContentRevision ?? current.contentRevision),
        () => true,
        expectedContentRevision !== undefined
      ),
    [advance]
  );
  const amendNewNode = useCallback(
    (nodeId: string, command: DocumentCommand) =>
      advance((current) => amendSessionNewNode(current, nodeId, command, current.contentRevision)),
    [advance]
  );
  // Threads change outside undo history (domain/threads). `change` throws ThreadError on bad input.
  const updateThreads = useCallback(
    (change: (document: SceneDocumentV1) => SceneDocumentV1) =>
      advance((current) => updateSessionThreads(current, change)),
    [advance]
  );
  const forgetHistory = useCallback(() => advance(forgetSessionHistory), [advance]);
  // The contentRevision at the time of the call, for an action offered now and run later (a toast's Undo).
  const currentContentRevision = useCallback(() => sessionRef.current?.contentRevision ?? 0, []);
  const undo = useCallback(
    () =>
      advance(
        (current) => undoSessionCommand(current, current.contentRevision),
        (current) => canUndoDocument(current.history)
      ),
    [advance]
  );
  const redo = useCallback(
    () =>
      advance(
        (current) => redoSessionCommand(current, current.contentRevision),
        (current) => canRedoDocument(current.history)
      ),
    [advance]
  );

  return {
    session,
    document: session?.document ?? null,
    revision: session?.revision ?? 0,
    contentRevision: session?.contentRevision ?? 0,
    currentContentRevision,
    canUndo: session ? canUndoDocument(session.history) : false,
    canRedo: session ? canRedoDocument(session.history) : false,
    openDocument,
    commit,
    amendNewNode,
    updateThreads,
    forgetHistory,
    undo,
    redo,
  };
}
