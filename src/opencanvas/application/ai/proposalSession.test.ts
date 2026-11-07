import { describe, expect, it } from 'vitest';
import { findAgentOp } from '../../../agent/ops';
import { createTestCapabilities } from '../../../agent/ops/testHost';
import { resolveAgentOpCommand } from '../../../agent/runAction';
import { applyDocumentCommand } from '../../domain/commands/execute';
import type { BatchDocumentCommand, DocumentCommand } from '../../domain/commands/types';
import type { SceneDocumentV1 } from '../../domain/document/types';
import { addThread } from '../../domain/threads/threads';
import { createTestConnector, createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { commitSessionCommand, createDocumentSession, redoSessionCommand, undoSessionCommand, updateSessionThreads } from '../session/session';
import {
  applyCommand, changedRoots, commandTouchedRoots, createProposal, decideChange, StaleProposalError, summarizeChanges,
} from './proposalSession';

const PAGE = { kind: 'page', pageId: 'page-1', objectIds: [] } as const;

function fixture(): SceneDocumentV1 {
  return createTestDocument({
    nodes: [createTestNode('a'), createTestNode('b', { content: { label: '' } })],
    connectors: [createTestConnector('ab', 'a', 'b')],
  });
}

/** Commands the way an agent op or the canvas would build them. */
async function agent(name: string, input: unknown, document: SceneDocumentV1): Promise<DocumentCommand> {
  const { command } = await resolveAgentOpCommand(findAgentOp(name)!, input, { document, pageId: 'page-1', capabilities: createTestCapabilities() });
  if (!command) throw new Error(`${name} produced no command`);
  return command;
}

function setLabel(document: SceneDocumentV1, id: string, label: string): DocumentCommand {
  const before = document.pages[0]!.nodes.find((node) => node.id === id)!;
  return { kind: 'set-node', id: `rename-node:${id}`, label: 'Rename node', pageId: 'page-1', before, after: { ...before, content: { ...before.content, label } } };
}

function connect(document: SceneDocumentV1, id: string, source: string, target: string): DocumentCommand {
  const page = document.pages[0]!;
  return { kind: 'insert-connector', id: `connect:${id}`, label: 'Connect', pageId: 'page-1', index: page.connectors.length, connector: createTestConnector(id, source, target) };
}

async function threeChanges(document: SceneDocumentV1) {
  return [
    { id: 'c1', explanation: 'Add a step.', command: await agent('add_shape', { id: 'c', kind: 'rectangle', label: 'C', x: 200, y: 0 }, document) },
    { id: 'c2', explanation: 'Name it.', command: setLabel(document, 'b', 'B') },
    { id: 'c3', explanation: 'Line it up.', command: await agent('move', { ids: ['a'], to: { x: 0, y: 100 } }, document) },
  ];
}

async function build(document = fixture(), revision = 4) {
  return createProposal({ document, revision, source: 'byok', scope: { kind: 'selection', pageId: 'page-1', objectIds: ['a'] },
    intent: 'add-step-after-selection', changes: await threeChanges(document) });
}

describe('proposal session', () => {
  it('rejects empty and duplicate change sets', async () => {
    const document = fixture();
    expect(createProposal({ document, revision: 0, source: 's', scope: PAGE, intent: 'test', changes: [] }).error?.code)
      .toBe('INVALID_PROPOSAL');
    const [change] = await threeChanges(document);
    expect(createProposal({ document, revision: 0, source: 's', scope: PAGE, intent: 'test', changes: [change, change] })
      .error?.code).toBe('INVALID_PROPOSAL');
  });

  it('accepts every change by default and previews their sequential application', async () => {
    const document = fixture();
    const proposal = await build(document);
    expect(proposal.baseRevision).toBe(4);
    expect(proposal.status).toBe('pending');
    expect(proposal.intent).toBe('add-step-after-selection');
    expect(proposal.scope.objectIds).toEqual(['a']);
    expect(proposal.error).toBeUndefined();
    expect(proposal.changes.map(({ status }) => status)).toEqual(['accepted', 'accepted', 'accepted']);
    let expected = document;
    for (const change of await threeChanges(document)) expected = applyDocumentCommand(expected, change.command).document;
    expect(proposal.preview).toEqual(expected);
  });

  it('drops a rejected change from the preview and from the applied batch', async () => {
    const document = fixture();
    const proposal = decideChange(await build(document), 'c2', 'rejected', document);
    expect(proposal.preview.pages[0].nodes.find(({ id }) => id === 'b')?.content.label).toBe('');
    expect(proposal.preview.pages[0].nodes.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    const command = applyCommand(proposal, 4, document) as BatchDocumentCommand;
    expect(command.kind).toBe('batch');
    expect(command.commands.map(({ kind }) => kind)).toEqual(['insert-node', 'set-node']);
    expect(command.label).toBe('Apply agent proposal (2 changes)');
    expect(command.attribution).toEqual({ kind: 'agent', source: 'byok', proposalId: proposal.id });
    expect(applyDocumentCommand(document, command).inverse).toMatchObject({ attribution: command.attribution });
    const applied = applyDocumentCommand(document, command);
    expect(applied.document).toEqual(proposal.preview);
    expect(applyDocumentCommand(applied.document, applied.inverse).document).toEqual(document);
  });

  it('returns null when nothing is accepted', async () => {
    const document = fixture();
    let proposal = await build(document);
    for (const id of ['c1', 'c2', 'c3']) proposal = decideChange(proposal, id, 'rejected', document);
    expect(applyCommand(proposal, 4, document)).toBeNull();
  });

  it('refuses to apply at any revision other than the base', async () => {
    const document = fixture();
    const proposal = await build(document);
    expect(() => applyCommand(proposal, 5, document)).toThrow(StaleProposalError);
    try { applyCommand(proposal, 5, document); } catch (error) {
      expect((error as StaleProposalError).name).toBe('StaleProposalError');
      expect((error as StaleProposalError).baseRevision).toBe(4);
      expect((error as StaleProposalError).currentRevision).toBe(5);
    }
    expect(applyCommand(proposal, 4, document)).not.toBeNull();
  });

  // A comment is not a diagram change: the proposal stays current, and applying it keeps the comment, through undo and redo.
  it('applies after a comment made while it waited, and keeps the comment', async () => {
    let session = createDocumentSession(fixture());
    const proposal = await build(session.document, session.contentRevision);
    session = updateSessionThreads(session, (document) => addThread(document, {
      pageId: 'page-1', threadId: 't1', nodeId: 'a', point: { x: 5, y: 5 },
      comment: { id: 'm1', author: { kind: 'human', name: 'Ada' }, body: 'Is this right?', createdAt: '2026-10-26T12:00:00.000Z' },
    }), session.revision);
    const command = applyCommand(proposal, session.contentRevision, session.document)!;
    session = commitSessionCommand(session, command, proposal.baseRevision);
    const nodeIds = (document: SceneDocumentV1) => document.pages[0]!.nodes.map(({ id }) => id);
    expect(nodeIds(session.document)).toEqual(['a', 'b', 'c']);
    expect(session.document.pages[0]!.threads!.map(({ id }) => id)).toEqual(['t1']);
    session = undoSessionCommand(session, session.contentRevision);
    expect(nodeIds(session.document)).toEqual(['a', 'b']);
    expect(session.document.pages[0]!.threads).toHaveLength(1);
    session = redoSessionCommand(session, session.contentRevision);
    expect(nodeIds(session.document)).toEqual(['a', 'b', 'c']);
    expect(session.document.pages[0]!.threads).toHaveLength(1);
  });

  it('flattens action batches so the applied command is one level deep', async () => {
    const document = createTestDocument({ nodes: [createTestNode('a'), createTestNode('b'), createTestNode('z')] });
    const changes = [
      { id: 'k', explanation: 'Link.', command: connect(document, 'ab', 'a', 'b') },
      { id: 'd', explanation: 'Drop.', command: await agent('delete', { ids: ['z'] }, document) },
    ];
    const proposal = createProposal({ document, revision: 0, source: 's', scope: PAGE, intent: 'test', changes });
    expect(proposal.error).toBeUndefined();
    const command = applyCommand(proposal, 0, document) as BatchDocumentCommand;
    expect(command.commands.every(({ kind }) => kind !== 'batch')).toBe(true);
    const applied = applyDocumentCommand(document, command);
    expect(applied.document).toEqual(proposal.preview);
    expect(applyDocumentCommand(applied.document, applied.inverse).document).toEqual(document);
  });

  it('summarizes every action kind for the review list', async () => {
    const document = fixture();
    const changes = [
      { id: '1', explanation: 'add', command: await agent('add_shape', { id: 'c', kind: 'rectangle', label: 'Étape ✓', x: 0, y: 0 }, document) },
      { id: '2', explanation: 'connect', command: connect(document, 'ac', 'a', 'b') },
      { id: '3', explanation: 'label', command: setLabel(document, 'b', 'B') },
      { id: '4', explanation: 'move', command: await agent('move', { ids: ['a'], to: { x: 9, y: 9 } }, document) },
      { id: '5', explanation: 'delete', command: await agent('delete', { ids: ['b'] }, document) },
    ];
    const page = { ...document.pages[0], nodes: document.pages[0].nodes.map((node) =>
      node.id === 'b' ? { ...node, content: { label: 'Bee' } } : node) };
    expect(summarizeChanges(changes, page)).toEqual([
      { id: '1', kind: 'addition', label: 'Étape ✓', reason: 'add' },
      { id: '2', kind: 'addition', label: 'a → Bee', reason: 'connect' },
      { id: '3', kind: 'modification', label: 'B', reason: 'label' },
      { id: '4', kind: 'modification', label: 'a', reason: 'move' },
      { id: '5', kind: 'removal', label: 'b', reason: 'delete' },
    ]);
  });
});

describe('changedRoots', () => {
  it('names the top-level node of each added or changed shape, and nothing for a removal', () => {
    const page = fixture().pages[0]!;
    const frame = createTestNode('frame', { kind: 'frame' });
    const child = createTestNode('child', { parentId: 'frame' });
    const added = { ...page, nodes: [...page.nodes, frame, child] };
    expect(changedRoots(page, added)).toEqual(['frame']);
    const edited = { ...added, nodes: added.nodes.map((node) => (node.id === 'child' ? { ...node, content: { ...node.content, label: 'New' } } : node)) };
    expect(changedRoots(added, edited)).toEqual(['frame']);
    expect(changedRoots(added, page)).toEqual([]);
    expect(changedRoots(undefined, page)).toEqual(['a', 'b']);
  });
});

describe('commandTouchedRoots', () => {
  it('names the nodes a command changes on that page, and nothing for another page', () => {
    const document = fixture();
    const command = setLabel(document, 'b', 'Renamed');
    expect(commandTouchedRoots(document, command, 'page-1')).toEqual(['b']);
    expect(commandTouchedRoots(document, command, 'elsewhere')).toEqual([]);
  });
});
