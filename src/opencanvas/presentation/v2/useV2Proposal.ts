// Proposal lifecycle for the v2 editor: propose → ready → apply/stale/failed.
// Holds the proposal, decisions and applied ids; commits only through the
// session with the base content revision. Owns no rendering and no provider.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { CompileResult } from '../../../dsl/compile';
import { chainAssistantChanges, type AssistantDraft } from '../../application/ai/assistantChanges';
import type { AssistantWrite } from '../../application/ai/assistantTools';
import {
  applyCommand, changedRoots, createProposal, decideChange, StaleProposalError, summarizeChanges,
  type Proposal, type ProposalChangeSummary,
} from '../../application/ai/proposalSession';
import { StaleSessionRevisionError } from '../../application/session/session';
import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneDocumentV1 } from '../../domain/document/types';
import type { ChangeDecision } from '../design-system';
import { platformKeys } from './v2Shortcuts';

type V2ProposalPhase = 'idle' | 'working' | 'ready' | 'stale' | 'applied' | 'failed';

/** Writes from one reply, in order: diagram blocks (replace `frameId`, or add when null) and scene ops. */
interface V2ProposalRequest {
  readonly blocks: readonly AssistantWrite[];
  readonly intent: string;
  readonly source?: string;
  readonly scope?: 'selection' | 'page';
}

interface V2ProposalOptions {
  readonly document: SceneDocumentV1 | null;
  /** The session's contentRevision: a proposal is built on the diagram, so a comment thread change leaves it current. */
  readonly contentRevision: number;
  readonly pageId: string | null;
  readonly commit: (command: DocumentCommand, expectedContentRevision?: number) => void;
  readonly readOnly: boolean;
  readonly announce: (message: string) => void;
  /** Compiles generated DSL for the AI path (host layout port, icons). */
  readonly compileDsl?: (text: string) => Promise<CompileResult>;
}

export function useV2Proposal(options: V2ProposalOptions) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [phase, setPhase] = useState<V2ProposalPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<string | null>(null);
  const [highlightedChangeId, setHighlightedChangeId] = useState<string | null>(null);
  const [appliedSummary, setAppliedSummary] = useState('');
  // The content revision the Apply produced: once the diagram moves past it, Undo would undo something else.
  const [appliedRevision, setAppliedRevision] = useState<number | null>(null);
  const appliedIds = useRef(new Set<string>());
  const baseDocument = useRef<SceneDocumentV1 | null>(null);
  const drafts = useRef<readonly AssistantDraft[]>([]);
  // decide() awaits the rebuilt chain, so it reads and writes the proposal here, one decision at a time.
  const current = useRef<Proposal | null>(null);
  const deciding = useRef<Promise<void>>(Promise.resolve());
  const show = (next: Proposal | null): void => { current.current = next; setProposal(next); };
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const stale = phase === 'ready' && proposal !== null && proposal.baseRevision !== options.contentRevision;

  /**
   * Compiles every block, then chains them into rows that compose. Resolves to
   * the proposal id, or to why nothing was proposed — compile errors name their
   * lines, so the caller can hand them back to the model.
   */
  const propose = useCallback(async (request: V2ProposalRequest): Promise<{ readonly id: string } | { readonly error: string; readonly compile: boolean }> => {
    const { document, contentRevision, pageId, compileDsl, announce } = optionsRef.current;
    if (!document || !pageId) return { error: 'No page is open.', compile: false };
    let compileFailed = false;
    setPhase('working');
    setIntent(request.intent);
    setError(null);
    setHighlightedChangeId(null);
    try {
      if (!compileDsl) throw new Error('This editor has no DSL compiler wired.');
      const currentPage = document.pages.find((page) => page.id === pageId);
      if (!currentPage) throw new RangeError(`Page "${pageId}" was not found.`);
      const next: AssistantDraft[] = [];
      for (const [index, block] of request.blocks.entries()) {
        if ('op' in block) { next.push({ id: `op:${index}`, ...block }); continue; }
        const compiled = await compileDsl(block.dsl);
        const errors = compiled.diagnostics.filter(({ severity }) => severity === 'error');
        if (errors.length) {
          compileFailed = true;
          throw new Error(errors.slice(0, 5).map(({ line, message }) => `Diagram ${index + 1}, line ${line}: ${message}`).join('\n'));
        }
        next.push({ id: `diagram:${index}:${block.frameId ?? compiled.frame.id}`, compiled, ...(block.frameId ? { frameId: block.frameId } : {}) });
      }
      const changes = await chainAssistantChanges(document, pageId, next);
      if (!changes.length) throw new Error('The diagram already matches this request.');
      const bound = next.flatMap((draft) => ('frameId' in draft && draft.frameId ? [draft.frameId] : []));
      const proposal = createProposal({
        document, revision: contentRevision, source: request.source ?? 'byok', intent: request.intent,
        scope: { kind: request.scope ?? (bound.length ? 'selection' : 'page'), pageId, objectIds: bound },
        changes,
      });
      if (proposal.error) throw new Error(proposal.error.message);
      drafts.current = next;
      baseDocument.current = document;
      show(proposal);
      setPhase('ready');
      announce('Proposal ready. Review it, then apply.');
      return { id: proposal.id };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      show(null);
      setError(message);
      setPhase('failed');
      return { error: message, compile: compileFailed };
    }
  }, []);

  const decide = useCallback((changeId: string, decision: ChangeDecision): Promise<void> => {
    deciding.current = deciding.current.then(async () => {
      const proposal = current.current;
      const base = baseDocument.current;
      if (!proposal || !base) return;
      // The review toggles back to 'pending'; the preview and the batch both
      // treat undecided as accepted, so record it that way.
      const status = decision === 'rejected' ? 'rejected' : 'accepted';
      const rejected = new Set(proposal.changes.filter(({ id, status: was }) => (id === changeId ? status : was) === 'rejected').map(({ id }) => id));
      // Later rows were built on earlier ones; rebuild the chain around the rejections.
      const rebuilt = await chainAssistantChanges(base, proposal.scope.pageId, drafts.current, rejected);
      if (current.current !== proposal) return;
      // A row that no longer resolves (styling a shape whose add was rejected) is rejected with it.
      const changes = proposal.changes.map((change) => {
        const row = rebuilt.find(({ id }) => id === change.id);
        return row ? { ...change, command: row.command } : { ...change, status: 'rejected' as const };
      });
      show(decideChange({ ...proposal, changes }, changeId, status, base));
    }).catch(() => undefined);
    return deciding.current;
  }, []);

  /** Resolves true once the accepted rows are committed. */
  /** Commits the accepted changes; resolves to the diagrams they touched (for the camera), or null when nothing applied. */
  const apply = useCallback(async (): Promise<readonly string[] | null> => {
    const { document, contentRevision, commit, readOnly, announce } = optionsRef.current;
    if (!proposal || !document || readOnly || appliedIds.current.has(proposal.id)) return null;
    try {
      const command = applyCommand(proposal, contentRevision, document);
      if (!command) { setPhase('idle'); show(null); return null; }
      const { pageId } = proposal.scope;
      const touched = changedRoots(document.pages.find(({ id }) => id === pageId), proposal.preview.pages.find(({ id }) => id === pageId)!);
      commit(command, proposal.baseRevision);
      setAppliedRevision(proposal.baseRevision + 1);
      appliedIds.current.add(proposal.id);
      const count = command.commands.length;
      const summary = `Applied ${count} ${count === 1 ? 'change' : 'changes'}.`;
      setAppliedSummary(summary);
      announce(`${summary} Press ${platformKeys('⌘Z')} to undo.`);
      setPhase('applied');
      setHighlightedChangeId(null);
      return touched;
    } catch (caught) {
      if (caught instanceof StaleProposalError || caught instanceof StaleSessionRevisionError) {
        setPhase('stale');
        setHighlightedChangeId(null);
        return null;
      }
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase('failed');
      return null;
    }
  }, [proposal]);

  const discard = useCallback(() => {
    show(null);
    setPhase('idle');
    setIntent(null);
    setError(null);
    setHighlightedChangeId(null);
  }, []);

  const changes = useMemo<readonly ProposalChangeSummary[]>(
    () => (proposal ? summarizeChanges(proposal.changes, proposal.preview.pages.find((page) => page.id === proposal.scope.pageId)) : []),
    [proposal]);
  const decisions = useMemo<Readonly<Record<string, ChangeDecision>>>(
    () => Object.fromEntries((proposal?.changes ?? []).map(({ id, status }) => [id, status])), [proposal]);

  return {
    proposal, phase, intent, stale, error, changes, decisions, appliedSummary,
    canApply: phase === 'ready' && !stale && !options.readOnly,
    /** Applied and nothing since: the bar's Undo still undoes exactly this. */
    undoable: phase === 'applied' && options.contentRevision === appliedRevision,
    highlightedChangeId, highlight: setHighlightedChangeId,
    propose, decide, apply, discard,
  };
}
