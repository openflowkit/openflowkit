// Revision-aware proposal lifecycle: a plain record any client (panel today,
// MCP propose-for-review later) creates, decides on, and turns into ONE batch.
// Owns no React, no provider, no storage; the session commits what it returns.
import { applyDocumentCommand } from '../../domain/commands/execute';
import type { BatchDocumentCommand, DocumentCommand } from '../../domain/commands/types';
import type { SceneDocumentV1, SceneNode, ScenePage } from '../../domain/document/types';
import {
  acceptedAiProposalCommand, buildAiSceneProposal, decideAiProposalChange,
  type AiProposedChange, type AiSceneProposal,
} from './sceneProposal';

type ProposalScope = {
  readonly kind: 'selection' | 'page' | 'document';
  readonly pageId: string;
  readonly objectIds: readonly string[];
};

/** Review-list row; structurally what design-system ProposalReview renders. */
export interface ProposalChangeSummary {
  readonly id: string;
  readonly kind: 'addition' | 'modification' | 'removal';
  readonly label: string;
  readonly reason: string;
}

export interface Proposal extends AiSceneProposal {
  readonly source: string;
  readonly intent: string;
  readonly scope: ProposalScope;
  /** The session's contentRevision it was built on (diagram changes only; comment threads leave it). */
  readonly baseRevision: number;
  readonly status: 'pending';
}

interface CreateProposalInput {
  readonly document: SceneDocumentV1;
  readonly revision: number;
  readonly source: string;
  readonly intent: string;
  readonly scope: ProposalScope;
  readonly changes: readonly Omit<AiProposedChange, 'status'>[];
  readonly id?: string;
}

export class StaleProposalError extends Error {
  readonly baseRevision: number;
  readonly currentRevision: number;

  constructor(baseRevision: number, currentRevision: number) {
    super(`Proposal built on revision ${baseRevision}; document is at ${currentRevision}.`);
    this.name = 'StaleProposalError';
    this.baseRevision = baseRevision;
    this.currentRevision = currentRevision;
  }
}

let proposalCounter = 0;

export function createProposal(input: CreateProposalInput): Proposal {
  proposalCounter += 1;
  const id = input.id ?? `proposal-${input.source}-${input.revision}-${proposalCounter}`;
  const base = buildAiSceneProposal(input.document, id, input.changes);
  return {
    ...base,
    // Agent output is opt-out, like a diff review.
    changes: base.changes.map((change) => ({ ...change, status: 'accepted' })),
    source: input.source, intent: input.intent, scope: input.scope,
    baseRevision: input.revision, status: 'pending',
  };
}

export function decideChange(
  proposal: Proposal, changeId: string, decision: 'accepted' | 'rejected', baseDocument: SceneDocumentV1
): Proposal {
  return { ...proposal, ...decideAiProposalChange(proposal, changeId, decision, baseDocument) };
}

/** One flat batch of the non-rejected changes, or null when nothing survives.
 * Throws StaleProposalError before touching the document precondition. */
export function applyCommand(
  proposal: Proposal, currentRevision: number, currentDocument: SceneDocumentV1
): BatchDocumentCommand | null {
  if (currentRevision !== proposal.baseRevision) {
    throw new StaleProposalError(proposal.baseRevision, currentRevision);
  }
  const batch = acceptedAiProposalCommand(proposal, currentDocument);
  if (!batch || batch.kind !== 'batch') return null;
  // Actions may hand back their own batch (connect adds ports, delete drops
  // connectors); the executor forbids nesting, so unwrap one level.
  const commands = batch.commands.flatMap((command) =>
    command.kind === 'batch' ? command.commands : [command]);
  const count = batch.commands.length;
  return {
    kind: 'batch', id: batch.id,
    label: `Apply agent proposal (${count} ${count === 1 ? 'change' : 'changes'})`,
    commands,
    attribution: { kind: 'agent', source: proposal.source, proposalId: proposal.id },
  };
}

function leaf(command: DocumentCommand): DocumentCommand {
  return command.kind === 'batch' ? command.commands[command.commands.length - 1] ?? command : command;
}

function nodeLabel(node: SceneNode): string {
  return typeof node.content.label === 'string' && node.content.label ? node.content.label : node.id;
}

function changeLabel(command: DocumentCommand, page: ScenePage | undefined): string {
  const endpoint = (nodeId: string | null) => {
    const node = nodeId ? page?.nodes.find((candidate) => candidate.id === nodeId) : undefined;
    return node ? nodeLabel(node) : nodeId ?? '·';
  };
  switch (command.kind) {
    case 'insert-node': case 'remove-node': return nodeLabel(command.node);
    case 'set-node': return nodeLabel(command.after);
    case 'insert-connector': case 'remove-connector':
      return `${endpoint(command.connector.source.nodeId)} → ${endpoint(command.connector.target.nodeId)}`;
    case 'set-connector':
      return `${endpoint(command.after.source.nodeId)} → ${endpoint(command.after.target.nodeId)}`;
    default: return command.label;
  }
}

/** Rows for the review list; `page` (usually the preview) resolves endpoint labels. */
export function summarizeChanges(
  changes: readonly Omit<AiProposedChange, 'status'>[], page?: ScenePage
): ProposalChangeSummary[] {
  return changes.map(({ id, explanation, command }) => {
    const last = leaf(command);
    return {
      id,
      kind: last.kind.startsWith('insert-') ? 'addition'
        : last.kind.startsWith('remove-') ? 'removal' : 'modification',
      label: changeLabel(last, page),
      reason: explanation,
    };
  });
}

/** Top-level nodes on `pageId` that `command` adds or changes, for bringing an applied edit into view. */
export function commandTouchedRoots(document: SceneDocumentV1, command: DocumentCommand, pageId: string): string[] {
  const after = applyDocumentCommand(document, command).document.pages.find(({ id }) => id === pageId);
  return after ? changedRoots(document.pages.find(({ id }) => id === pageId), after) : [];
}

/**
 * The top-level nodes (a diagram's frame, or a loose shape) that `after` adds or changes on the page,
 * so the camera lands on what was just drawn rather than on the whole page. Removals land nowhere.
 */
export function changedRoots(before: ScenePage | undefined, after: ScenePage): string[] {
  const was = new Map((before?.nodes ?? []).map((node) => [node.id, JSON.stringify(node)]));
  const byId = new Map(after.nodes.map((node) => [node.id, node]));
  const roots = new Set<string>();
  for (const node of after.nodes) {
    if (was.get(node.id) === JSON.stringify(node)) continue;
    let root = node;
    while (root.parentId && byId.has(root.parentId)) root = byId.get(root.parentId)!;
    roots.add(root.id);
  }
  return [...roots];
}
