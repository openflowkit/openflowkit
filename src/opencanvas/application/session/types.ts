import type { SceneDocumentV1 } from '../../domain/document/types';
import type { DocumentHistoryState } from '../history/types';

export interface DocumentSession {
  readonly document: SceneDocumentV1;
  /** Counts every change, comment threads included: autosave saves by it and the agent bridge reports it. */
  readonly revision: number;
  /**
   * Counts diagram changes only, the steps undo history holds. A step or an AI proposal is built on the diagram, so it
   * checks this one: a comment added or resolved meanwhile does not make it stale.
   */
  readonly contentRevision: number;
  readonly history: DocumentHistoryState;
}
