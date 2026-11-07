import { describe, expect, it } from 'vitest';
import { compile } from '../../../dsl/compile';
import { applyDocumentCommand } from '../../domain/commands/execute';
import { createEmptyV2Document, createEmptyV2Page } from '../../presentation/v2/v2Document';
import type { SceneDocumentV1, ScenePage } from '../../domain/document/types';
import { moveNodes, styleNodes, deleteShapes } from '../../../agent/ops/sceneOps';
import { applyCommand, createProposal, StaleProposalError } from './proposalSession';
import { createShapeNode } from '../../domain/nodes/shapeNode';
import { buildDslPageCommand } from '../dsl/dslPageCommand';
import { chainAssistantChanges } from './assistantChanges';

const docOf = (page: ScenePage): SceneDocumentV1 => ({ ...createEmptyV2Document('doc'), pages: [page] });
const pageAfter = (page: ScenePage, changes: Awaited<ReturnType<typeof chainAssistantChanges>>, skip: ReadonlySet<string> = new Set()): ScenePage => {
  let document: SceneDocumentV1 = { ...createEmptyV2Document('doc'), pages: [page] };
  for (const { id, command } of changes) if (!skip.has(id)) document = applyDocumentCommand(document, command).document;
  return document.pages[0]!;
};
const frames = (page: ScenePage) => page.nodes.filter((node) => node.kind === 'frame');

describe('assistant change chain', () => {
  it('adds two diagrams side by side, never on top of each other', async () => {
    const page = createEmptyV2Page();
    const changes = await chainAssistantChanges(docOf(page), page.id, [
      { id: 'one', compiled: await compile('flowchart\nA -> B') },
      { id: 'two', compiled: await compile('flowchart\nC -> D') },
    ]);
    expect(changes.map(({ command }) => command.label)).toEqual(['Add flowchart diagram', 'Add flowchart diagram']);
    const [first, second] = frames(pageAfter(page, changes));
    expect(second!.transform.translation.x).toBeGreaterThan(first!.transform.translation.x + first!.size.width);
  });

  it('replaces a diagram in place, keeping its id and position', async () => {
    const seed = await compile('flowchart\nA -> B', { origin: { x: 400, y: 300 } });
    const page = (buildDslPageCommand(createEmptyV2Page(), seed) as { after: ScenePage }).after;
    const changes = await chainAssistantChanges(docOf(page), page.id, [{ id: 'edit', compiled: await compile('flowchart\nA -> B\nB -> C'), frameId: seed.frame.id }]);
    expect(changes[0]!.command.label).toBe('Update diagram');
    const [frame] = frames(pageAfter(page, changes));
    expect(frame!.id).toBe(seed.frame.id);
    expect(frame!.transform.translation).toEqual({ x: 400, y: 300 });
  });

  it('rebuilds the chain around a rejected row', async () => {
    const page = createEmptyV2Page();
    const drafts = [
      { id: 'one', compiled: await compile('flowchart\nA -> B') },
      { id: 'two', compiled: await compile('flowchart\nC -> D') },
    ];
    const rejected = new Set(['one']);
    const after = pageAfter(page, await chainAssistantChanges(docOf(page), page.id, drafts, rejected), rejected);
    expect(frames(after)).toHaveLength(1);
    expect(after.nodes.some((node) => node.id === 'c')).toBe(true);
  });

  it('treats an unknown frame id as a new diagram and drops no-op rows', async () => {
    const seed = await compile('flowchart\nA -> B');
    const page = (buildDslPageCommand(createEmptyV2Page(), seed) as { after: ScenePage }).after;
    const same = { ...seed, frame: { ...seed.frame, transform: page.nodes.find((node) => node.id === seed.frame.id)!.transform } };
    expect(await chainAssistantChanges(docOf(page), page.id, [{ id: 'noop', compiled: same, frameId: seed.frame.id }])).toEqual([]);
    const added = await chainAssistantChanges(docOf(page), page.id, [{ id: 'ghost', compiled: await compile('flowchart\nX -> Y'), frameId: 'gone' }]);
    expect(added[0]!.command.label).toBe('Add flowchart diagram');
  });

  const withBox = (page: ScenePage): ScenePage => ({ ...page, nodes: [...page.nodes, createShapeNode(page, { kind: 'rectangle', id: 'box', at: { x: 0, y: 600 }, label: 'Box' })] });
  const move = (id: string, dx: number) => ({ id, op: moveNodes, input: { ids: ['box'], delta: { x: dx, y: 0 } }, label: 'Move' });
  const box = (page: ScenePage) => page.nodes.find((node) => node.id === 'box');

  it('runs scene ops after a diagram write, each on the page the rows before it made', async () => {
    const page = withBox(createEmptyV2Page());
    const changes = await chainAssistantChanges(docOf(page), page.id, [
      { id: 'diagram', compiled: await compile('flowchart\nA -> B') },
      move('one', 100),
      move('two', 50),
      { id: 'red', op: styleNodes, input: { ids: ['box'], fill: '#ff0000' }, label: 'Style “Box”' },
    ]);
    expect(changes.map(({ id }) => id)).toEqual(['diagram', 'one', 'two', 'red']);
    expect(changes[3]).toMatchObject({ explanation: 'Style “Box”', command: { label: 'Style “Box”' } });
    const after = pageAfter(page, changes);
    expect(box(after)?.transform.translation.x).toBe(150);
    expect(box(after)?.appearance.fill).toBe('#ff0000');
    expect(frames(after)).toHaveLength(1);
  });

  it('rejecting a middle op rebuilds the rows after it', async () => {
    const page = withBox(createEmptyV2Page());
    const drafts = [move('one', 100), move('two', 50), move('three', 25)];
    const rejected = new Set(['two']);
    const after = pageAfter(page, await chainAssistantChanges(docOf(page), page.id, drafts, rejected), rejected);
    expect(box(after)?.transform.translation.x).toBe(125);
  });

  it('drops an op whose shape an earlier row removed', async () => {
    const page = withBox(createEmptyV2Page());
    const changes = await chainAssistantChanges(docOf(page), page.id, [
      { id: 'gone', op: deleteShapes, input: { ids: ['box'] }, label: 'Delete' },
      move('late', 10),
    ]);
    expect(changes.map(({ id }) => id)).toEqual(['gone']);
    // Rejecting the delete brings the move back.
    const rebuilt = await chainAssistantChanges(docOf(page), page.id, [
      { id: 'gone', op: deleteShapes, input: { ids: ['box'] }, label: 'Delete' },
      move('late', 10),
    ], new Set(['gone']));
    expect(rebuilt.map(({ id }) => id)).toEqual(['gone', 'late']);
  });

  it('two ops on one shape apply as one batch, and a stale revision refuses it', async () => {
    const page = withBox(createEmptyV2Page());
    const document = docOf(page);
    const changes = await chainAssistantChanges(document, page.id, [
      { id: 'red', op: styleNodes, input: { ids: ['box'], fill: '#ff0000' }, label: 'Style' },
      { id: 'blue', op: styleNodes, input: { ids: ['box'], stroke: '#0000ff' }, label: 'Style' },
      move('right', 40),
    ]);
    const proposal = createProposal({ document, contentRevision: 3, source: 'test', intent: 'red', scope: { kind: 'page', pageId: page.id, objectIds: [] }, changes });
    expect(proposal.error).toBeUndefined();
    const batch = applyCommand(proposal, 3, document)!;
    const after = applyDocumentCommand(document, batch).document.pages[0]!;
    expect(box(after)?.appearance).toMatchObject({ fill: '#ff0000', stroke: '#0000ff' });
    expect(box(after)?.transform.translation.x).toBe(40);
    // Undo is the inverse of that one batch.
    const undone = applyDocumentCommand(applyDocumentCommand(document, batch).document, applyDocumentCommand(document, batch).inverse).document;
    expect(box(undone.pages[0]!)).toEqual(box(page));
    expect(() => applyCommand(proposal, 4, document)).toThrow(StaleProposalError);
  });
});
