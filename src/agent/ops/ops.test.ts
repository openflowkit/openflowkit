import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyDocumentCommand } from '@/opencanvas/domain/commands/execute';
import { buildDeleteSelectionCommand, buildMoveNodesCommand } from '@/opencanvas/domain/commands/sceneEdits';
import { createShapeNode } from '../../opencanvas/domain/nodes/shapeNode';
import { buildStyleNodesCommand } from '@/opencanvas/domain/commands/styleNodes';
import type { SceneDocumentV1, ScenePage } from '@/opencanvas/domain/document/types';
import { createAgentDocument } from '../index';
import { resolveAgentOpCommand } from '../runAction';
import { AGENT_OPS } from './index';
import type { AgentOp, OpContext } from './types';
import type { CompileOptions } from '../../dsl/compile';
import { createTestCapabilities } from './testHost';
import { lintDsl } from '../lint';
import { MERMAID_COMPAT_FIXTURES } from '../../../scripts/mermaid-compat-fixtures.mjs';

const FLOW = '%% ofk 1\nflowchart\n\n  Client [blue] -> API [emerald]\n  API -> Store [cylinder, red]';

function op(name: string) {
  const found = AGENT_OPS.find((candidate) => candidate.name === name);
  if (!found) throw new RangeError(`missing op ${name}`);
  return found as AgentOp<unknown, unknown>;
}

/**
 * A test host that owns the document like a session would: each mutating run
 * applies its command and hands the next run the new document.
 */
async function host(document: SceneDocumentV1 = createAgentDocument('Ops fixture', 'doc-ops')) {
  const capabilities = createTestCapabilities();
  let current = document;
  const context = (): OpContext => ({ document: current, pageId: current.pages[0]!.id, capabilities });
  return {
    context,
    capabilities,
    document: () => current,
    page: (): ScenePage => current.pages[0]!,
    frame: (index = 0) => current.pages[0]!.nodes.filter((node) => node.kind === 'frame')[index]!,
    dataIds: () => current.pages[0]!.nodes.filter((node) => node.kind !== 'frame').map((node) => node.id),
    async run(name: string, input: unknown) {
      const outcome = await op(name).run(op(name).schema.parse(input), context());
      if (outcome.command) current = applyDocumentCommand(current, outcome.command).document;
      return outcome;
    },
  };
}

describe('agent ops', () => {
  // Frame ids are unique across pages. A C4 workspace puts each view on its own page, and an agent
  // reading view 2 by its frameId got "not found on this page" unless it also passed pageId.
  it('an op naming a frame on another page runs on that page', async () => {
    const run = await host();
    const made = await run.run('create_diagram', { dsl: 'architecture\nmodel {\n  system Shop {\n    container Web\n    container API\n    Web -> API\n  }\n}\nviews {\n  view landscape\n  view container of Shop\n}' });
    const views = (made.output as { views: { pageId: string; frameId: string }[] }).views;
    const other = views.find(({ pageId }) => pageId !== run.context().pageId)!;
    const read = await resolveAgentOpCommand(op('get_diagram'), { frameId: other.frameId }, run.context());
    expect(read.output).toMatchObject({ frameId: other.frameId, pageId: other.pageId });
  });

  it('refuses DSL with nothing drawable instead of leaving an empty frame, and says why', async () => {
    const run = await host();
    const before = run.document();
    await expect(run.run('create_diagram', { dsl: 'flowchart\nA -> [[[ broken' })).rejects.toThrow(/Nothing to draw[\s\S]*line 2:1 W101/);
    expect(run.document()).toBe(before);
    await run.run('create_diagram', { dsl: FLOW });
    await expect(run.run('update_diagram', { frameId: run.frame().id, dsl: 'A -> [[[' })).rejects.toThrow(/Nothing to draw/);
    expect(run.dataIds()).toHaveLength(3);
  });

  it('creates a diagram as one undoable page command and reads its authored text back', async () => {
    const run = await host();
    const created = await run.run('create_diagram', { dsl: FLOW });
    expect(created.command!.kind).toBe('set-page');
    expect(created.output).toMatchObject({ family: 'flowchart', nodes: 3, connectors: 2 });

    const read = await run.run('get_diagram', { frameId: run.frame().id });
    expect(read.output).toMatchObject({ edited: false, losses: [], dsl: FLOW });
    expect(run.page().diagramKind).toBe('flowchart');
  });

  it('lands a C4 workspace as one page per view, and regenerates the same pages', async () => {
    const run = await host();
    const C4 = `architecture
model {
  person Customer
  system Shop { container Web; container API; Web -> API }
  Customer -> Shop.Web : uses
}
views { view context of Shop; view container of Shop }
`;
    const created = await run.run('create_diagram', { dsl: C4 });
    expect(created.command!.kind).toBe('batch');
    expect(created.output).toMatchObject({ family: 'architecture', views: [{ viewId: 'view:context:shop' }, { viewId: 'view:container:shop' }] });
    expect(run.document().pages.map((page) => page.name)).toEqual(['Overview: Shop', 'Services: Shop']); // the empty page it was made on becomes the first view
    const again = await run.run('create_diagram', { dsl: C4 });
    expect(again.command).toBeNull();
    expect(run.document().pages).toHaveLength(2);
    const listed = await run.run('list_diagrams', {});
    expect((listed.output as { diagrams: unknown[] }).diagrams).toHaveLength(2);
  });

  it('returns actual C4 page and frame IDs when generation changes only some views or none', async () => {
    const run = await host();
    const source = 'architecture\nmodel { system Shop { container Web } }\nviews { view context of Shop; view container of Shop }';
    await run.run('create_diagram', { dsl: source });
    for (const dsl of [source, source.replace('view context of Shop; ', '')]) {
      await run.run('create_diagram', { dsl });
      const unchanged = await run.run('create_diagram', { dsl });
      expect(unchanged.command).toBeNull();
      const views = run.document().pages;
      expect(unchanged.output).toMatchObject({
        pageId: views[0]!.id,
        frameId: views[0]!.nodes.find((node) => node.kind === 'frame')!.id,
        views: views.map((page) => ({ pageId: page.id, frameId: page.nodes.find((node) => node.kind === 'frame')!.id })),
      });
    }
  });

  for (const name of ['create_diagram', 'update_diagram']) {
    it(`${name} reconciles a C4 workspace reduced to one view in one undo step`, async () => {
      const run = await host();
      const source = 'architecture\nmodel { system Shop { container Web } }\nviews { view context of Shop; view container of Shop }';
      await run.run('create_diagram', { dsl: source });
      const before = run.document();
      const page = before.pages.find((entry) => entry.name === 'Overview: Shop')!;
      const frame = page.nodes.find((node) => node.kind === 'frame')!;
      const input = { dsl: source.replace('view context of Shop; ', ''), frameId: frame.id };
      const outcome = await op(name).run(op(name).schema.parse(input), { ...run.context(), pageId: page.id });
      expect(outcome.command).not.toBeNull();
      const applied = applyDocumentCommand(before, outcome.command!);
      expect(applied.document.pages.map((entry) => entry.name)).toEqual(['Services: Shop']);
      expect(applyDocumentCommand(applied.document, applied.inverse).document).toEqual(before);
      expect(outcome.output).toMatchObject({ views: [{ viewId: 'view:container:shop' }] });
    });
  }

  it('reports canvas drift and unrepresentable paint through get_diagram', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: FLOW });
    const ids = run.dataIds();

    await run.run('move', { ids: [ids[0]!], delta: { x: 40, y: 0 } });
    const moved = await run.run('get_diagram', { frameId: run.frame().id });
    expect(moved.output).toMatchObject({ edited: true });
    expect((moved.output as { dsl: string }).dsl).toContain('Client -> API');

    await run.run('style', { ids, opacity: 0.4 });
    const styled = await run.run('get_diagram', { frameId: run.frame().id });
    expect((styled.output as { losses: readonly string[] }).losses).toEqual(
      expect.arrayContaining([expect.stringContaining('opacity is not in the language')]));
  });

  // U3 2026-10-11: style → move → get_diagram said `losses: []` and update_diagram then dropped the fill
  // and the move without a word. Regenerate still replaces canvas edits (as the code panel's does, under its
  // "Canvas edited" banner); the agent is now told which ones, before and after.
  it('names canvas edits the text does not carry, and what update_diagram discarded', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: FLOW });
    const fresh = await run.run('get_diagram', { frameId: run.frame().id });
    expect(fresh.output).toMatchObject({ edited: false, canvasEdits: [] });

    const store = run.page().nodes.find((node) => node.content.label === 'Store')!;
    const client = run.page().nodes.find((node) => node.content.label === 'Client')!;
    await run.run('style', { ids: [store.id], fill: '#fde68a', strokeWidth: 3 });
    await run.run('move', { ids: [client.id], delta: { x: 40, y: 0 } });
    const moved = { x: client.transform.translation.x + 40, y: client.transform.translation.y };
    const read = await run.run('get_diagram', { frameId: run.frame().id });
    const edits = (read.output as { canvasEdits: readonly { id: string; changed: Record<string, unknown>; carry: string | null }[] }).canvasEdits;
    expect(edits).toEqual(expect.arrayContaining([
      { id: store.id, label: 'Store', kind: 'node', changed: { fill: '#fde68a', strokeWidth: 3 }, carry: '#fde68a' },
      { id: client.id, label: 'Client', kind: 'node', changed: { position: moved }, carry: `pin: "${moved.x},${moved.y}"` },
    ]));
    expect(edits).toHaveLength(2);

    const updated = await run.run('update_diagram', { frameId: run.frame().id, dsl: `${FLOW}
  Store -> Cache` });
    const discarded = (updated.output as { discarded: readonly { id: string; changed: Record<string, unknown> }[] }).discarded;
    expect(discarded.map(({ id }) => id).sort()).toEqual([client.id, store.id].sort());
    expect(run.page().nodes.find((node) => node.id === store.id)!.appearance.fill).not.toBe('#fde68a');

    // Carried into the text, nothing is discarded.
    await run.run('style', { ids: [store.id], fill: '#fde68a' });
    const kept = await run.run('update_diagram', { frameId: run.frame().id, dsl: '%% ofk 1\nflowchart\n\n  Client [blue] -> API [emerald]\n  API -> Store [cylinder, #fde68a]\n  Store -> Cache' });
    expect((kept.output as { discarded: readonly unknown[] }).discarded).toEqual([]);
  });

  it('returns the canvas edits as a diff of the text with diffOnly', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: FLOW });
    const fresh = await run.run('get_diagram', { frameId: run.frame().id, diffOnly: true });
    expect(fresh.output).toMatchObject({ edited: false, dslDiff: '' });
    expect(fresh.output).not.toHaveProperty('dsl');

    const store = run.page().nodes.find((node) => node.content.label === 'Store')!;
    const client = run.page().nodes.find((node) => node.content.label === 'Client')!;
    await run.run('style', { ids: [store.id], fill: '#fde68a' });
    await run.run('move', { ids: [client.id], delta: { x: 40, y: 0 } });
    const read = await run.run('get_diagram', { frameId: run.frame().id, diffOnly: true });
    // Both sides are serialized, so the palette name the author wrote (emerald) and its regenerated form (green)
    // do not show as a change; the move is not in the text at all and comes only through canvasEdits.
    expect(read.output).toMatchObject({ edited: true, canvasEdits: expect.arrayContaining([expect.objectContaining({ id: client.id })]) });
    expect((read.output as { dslDiff: string }).dslDiff).toBe('@@ -4,5 +4,5 @@\n Client [blue]\n API [green]\n-Store [cylinder, red]\n+Store [cylinder, #fde68a]\n Client -> API\n API -> Store\n');
    expect(read.output).not.toHaveProperty('dsl');

    // No baseline to compare: the whole text, and why.
    const refusing = { ...run.capabilities, compileWorkspace: () => Promise.reject(new RangeError('layout outside the app stops at 1000 shapes')) };
    const fallback = await resolveAgentOpCommand(op('get_diagram'), { diffOnly: true }, { ...run.context(), capabilities: refusing });
    expect(fallback.output).toMatchObject({ dsl: expect.stringContaining('Store [cylinder, #fde68a]'), dslDiffNote: expect.stringMatching(/Not compared: layout outside/) });
    expect(fallback.output).not.toHaveProperty('dslDiff');
  });

  it('names canvas edits on a C4 view frame against that view', async () => {
    const run = await host();
    const made = await run.run('create_diagram', { dsl: 'architecture\nmodel {\n  system Shop {\n    container Web\n    container API\n    Web -> API\n  }\n}\nviews {\n  view landscape\n  view container of Shop\n}' });
    const view = (made.output as { views: { pageId: string; frameId: string }[] }).views[1]!;
    const context = () => ({ ...run.context(), pageId: view.pageId });
    const page = () => run.document().pages.find(({ id }) => id === view.pageId)!;
    expect((await resolveAgentOpCommand(op('get_diagram'), { frameId: view.frameId }, context())).output).toMatchObject({ canvasEdits: [] });
    const web = page().nodes.find((node) => node.content.label === 'Web')!;
    const styled = await resolveAgentOpCommand(op('style'), { ids: [web.id], fill: '#fde68a' }, context());
    const edited = { ...context(), document: applyDocumentCommand(run.document(), styled.command!).document };
    const read = await resolveAgentOpCommand(op('get_diagram'), { frameId: view.frameId }, edited);
    expect((read.output as { canvasEdits: unknown[] }).canvasEdits).toEqual([expect.objectContaining({ id: web.id, changed: { fill: '#fde68a' } })]);
  });

  // Review 2026-10-11 #1: a canvas-edit comparison that cannot run (a diagram over the headless layout caps)
  // made get_diagram and update_diagram throw in file mode.
  it('reads and regenerates when the canvas-edit comparison cannot run, saying so', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: FLOW });
    const store = run.page().nodes.find((node) => node.content.label === 'Store')!;
    await run.run('style', { ids: [store.id], fill: '#fde68a' });
    const refusing = { ...run.capabilities, compileWorkspace: (text: string, options?: CompileOptions) => text === FLOW
      ? Promise.reject(new RangeError('layout outside the app stops at 1000 shapes')) : run.capabilities.compileWorkspace(text, options) };
    const context = { ...run.context(), capabilities: refusing };
    const read = await resolveAgentOpCommand(op('get_diagram'), {}, context);
    expect(read.output).toMatchObject({ edited: true, canvasEdits: null, canvasEditsNote: expect.stringMatching(/Not compared: layout outside/) });
    const updated = await resolveAgentOpCommand(op('update_diagram'), { frameId: run.frame().id, dsl: `${FLOW}\n  Store -> Cache` }, context);
    expect(updated.command).not.toBeNull();
    expect(updated.output).toMatchObject({ discarded: [], discardedNote: expect.stringMatching(/Not compared/) });
  });

  // Review #2: update_diagram on one C4 view redraws every view page; an edit on another view was lost unreported.
  it('reports edits discarded on every view page a workspace regenerate redraws', async () => {
    const run = await host();
    const dsl = 'architecture\nmodel {\n  system Shop {\n    container Web\n    container API\n    Web -> API\n  }\n}\nviews {\n  view landscape\n  view container of Shop\n}';
    const made = await run.run('create_diagram', { dsl });
    const [landscape, container] = (made.output as { views: { pageId: string; frameId: string }[] }).views;
    const page = () => run.document().pages.find(({ id }) => id === container!.pageId)!;
    const web = page().nodes.find((node) => node.content.label === 'Web')!;
    const styled = await resolveAgentOpCommand(op('style'), { ids: [web.id], fill: '#fde68a' }, { ...run.context(), pageId: container!.pageId });
    const edited = { ...run.context(), document: applyDocumentCommand(run.document(), styled.command!).document };
    const updated = await resolveAgentOpCommand(op('update_diagram'), { frameId: landscape!.frameId, dsl }, { ...edited, pageId: landscape!.pageId });
    expect((updated.output as { discarded: unknown[] }).discarded).toEqual([
      expect.objectContaining({ id: web.id, frameId: container!.frameId, changed: { fill: '#fde68a' } }),
    ]);
  });

  // Review #3: a rename, a bent connector or a deleted shape read `edited: true` with nothing listed.
  it('lists renames, connector bends and shapes removed on the canvas', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: FLOW });
    const api = run.page().nodes.find((node) => node.content.label === 'API')!;
    const store = run.page().nodes.find((node) => node.content.label === 'Store')!;
    const edge = run.page().connectors.find((connector) => connector.target.nodeId === api.id)!;
    const document = applyDocumentCommand(run.document(), { kind: 'batch', id: 'edits', label: 'edits', commands: [
      { kind: 'set-node', id: 'rename', label: 'Rename', pageId: run.page().id, before: api, after: { ...api, content: { ...api.content, label: 'Gateway' } } },
      { kind: 'set-connector', id: 'bend', label: 'Bend', pageId: run.page().id, before: edge, after: { ...edge, waypoints: [{ x: 10, y: 10 }] } },
    ] }).document;
    const context = { ...run.context(), document };
    const deleted = applyDocumentCommand(document, (await resolveAgentOpCommand(op('delete'), { ids: [store.id] }, context)).command!).document;
    const read = await resolveAgentOpCommand(op('get_diagram'), {}, { ...context, document: deleted });
    const edits = (read.output as { canvasEdits: { id: string; changed: Record<string, unknown>; carry: string | null }[] }).canvasEdits;
    expect(edits).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: api.id, changed: { label: 'Gateway' }, carry: 'label: Gateway' }),
      expect.objectContaining({ kind: 'connector', changed: { waypoints: [{ x: 10, y: 10 }] }, carry: null }),
      expect.objectContaining({ id: store.id, changed: { removed: true }, carry: null }),
    ]));
  });

  it('moves an icon card\'s icon with style, and carries it as iconpos', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: '%% ofk 1\narchitecture\n\n  API [tabler/server]' });
    const api = run.page().nodes.find((node) => node.content.label === 'API')!;
    await expect(run.run('style', { ids: [api.id], iconPlacement: 'left', opacity: 0.5 })).rejects.toThrow('on its own');
    await run.run('style', { ids: [api.id], iconPlacement: 'left' });
    expect(run.page().nodes.find((node) => node.id === api.id)!.content.contentLayout).toMatchObject({ iconPlacement: 'left' });
    const read = await run.run('get_diagram', { frameId: run.frame().id });
    const edits = (read.output as { canvasEdits: readonly { id: string; carry: string | null }[] }).canvasEdits;
    expect(edits.find((edit) => edit.id === api.id)!.carry).toContain('iconpos: left');
  });

  it('refuses an icon placement that changes nothing, naming why', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: '%% ofk 1\narchitecture\n\n  API [tabler/server]\n  Plain [rect]' });
    const plain = run.page().nodes.find((node) => node.content.label === 'Plain')!;
    await expect(run.run('style', { ids: [plain.id], iconPlacement: 'left' })).rejects.toThrow('icon card');
  });

  it('carries a card put back to top as iconpos: top, without pinning its size', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: '%% ofk 1\narchitecture\n\n  API [tabler/server, iconpos: left]' });
    const api = run.page().nodes.find((node) => node.content.label === 'API')!;
    await run.run('style', { ids: [api.id], iconPlacement: 'top' });
    const read = await run.run('get_diagram', { frameId: run.frame().id });
    const carry = (read.output as { canvasEdits: readonly { id: string; carry: string | null }[] }).canvasEdits.find((edit) => edit.id === api.id)!.carry;
    expect(carry).toContain('iconpos: top');
    expect(carry).not.toContain('width');
  });

  // Review #4: carry appended as a second `[…]` list renamed the node, and the lost edit went unreported.
  it('gives carry as bare attributes, and reports an edit lost to a renamed id', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: '%% ofk 1\nflowchart\n\n  Client [blue] -> API' });
    const client = run.page().nodes.find((node) => node.content.label === 'Client')!;
    await run.run('style', { ids: [client.id], fill: '#fde68a' });
    const read = await run.run('get_diagram', {});
    expect((read.output as { canvasEdits: { carry: string }[] }).canvasEdits[0]!.carry).toBe('#fde68a');
    const renamed = await run.run('update_diagram', { frameId: run.frame().id, dsl: '%% ofk 1\nflowchart\n\n  c2 = Client [blue] -> API' });
    expect((renamed.output as { discarded: { label: string }[] }).discarded).toEqual([expect.objectContaining({ label: 'Client', changed: { fill: '#fde68a' } })]);
  });

  // Review #5: the comparison compiled with the reader's icons setting, not the one the diagram was drawn with.
  it('compares against the icons setting the diagram was drawn with, and never reports a cleared value', async () => {
    const resolveIcon = () => ({ packId: 'developer', shapeId: 'x' });
    const drawn = createTestCapabilities();
    const on = { ...drawn, compileWorkspace: (text: string, options?: CompileOptions) => drawn.compileWorkspace(text, { autoIcons: true, resolveIcon, ...options }) };
    const off = { ...drawn, compileWorkspace: (text: string, options?: CompileOptions) => drawn.compileWorkspace(text, { autoIcons: false, resolveIcon, ...options }) };
    const document = createAgentDocument('Icons', 'doc-icons');
    const context = { document, pageId: document.pages[0]!.id, capabilities: on };
    const made = await resolveAgentOpCommand(op('create_diagram'), { dsl: 'flowchart\nWeb -> Postgres -> Redis' }, context);
    const withDiagram = applyDocumentCommand(document, made.command!).document;
    const web = withDiagram.pages[0]!.nodes.find((node) => node.content.label === 'Web')!;
    const styled = await resolveAgentOpCommand(op('style'), { ids: [web.id], fill: '#fde68a' }, { ...context, document: withDiagram });
    const edited = applyDocumentCommand(withDiagram, styled.command!).document;
    const read = await resolveAgentOpCommand(op('get_diagram'), {}, { ...context, document: edited, capabilities: off });
    expect((read.output as { canvasEdits: { id: string }[] }).canvasEdits.map(({ id }) => id)).toEqual([web.id]);
  });

  it('refuses DSL with no statements: an error, not an empty frame', async () => {
    const run = await host();
    const before = run.document();
    await expect(run.run('create_diagram', { dsl: 'flowchart\n' })).rejects.toThrow(/no statements/);
    await expect(run.run('create_diagram', { dsl: '%% ofk 1\narchitecture\ntitle: Empty\n' })).rejects.toThrow(/no statements/);
    expect(run.document()).toBe(before);
  });

  it('get_document lists what the user has selected on that page, live only', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: FLOW });
    const [first, second] = run.dataIds();
    const pageId = run.page().id;
    const read = (selection?: { pageId: string; ids: readonly string[] }) => resolveAgentOpCommand(op('get_document'), {}, { ...run.context(), ...(selection ? { selection } : {}) });
    expect((await read()).output).toMatchObject({ selection: [] });
    expect((await read({ pageId, ids: [first!, second!, 'elsewhere'] })).output).toMatchObject({ selection: [first, second] });
    // Review #6: C4 view pages share ids; a selection on another page is not this page's.
    expect((await read({ pageId: 'another-page', ids: [first!] })).output).toMatchObject({ selection: [] });
  });

  it('says which colours style accepts instead of a raw pattern error', () => {
    const parsed = op('style').schema.safeParse({ ids: ['a'], fill: 'red' });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toMatch(/#rrggbb.*#e95420/);
    expect(op('style').schema.safeParse({ ids: ['a'], fill: '#E95420' }).success).toBe(true);
  });

  it('regenerates a frame in place, keeping its position and id', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: FLOW, at: { x: 300, y: 120 } });
    const before = run.frame();
    const updated = await run.run('update_diagram', { frameId: before.id, dsl: '%% ofk 1\nflowchart\n\n  Client -> API -> Store -> Cache' });
    const after = run.frame();
    expect(after.id).toBe(before.id);
    expect(after.transform.translation).toEqual({ x: 300, y: 120 });
    expect(updated.output).toMatchObject({ nodes: 4, connectors: 3 });
    expect(run.dataIds()).toHaveLength(4);
  });

  it('lists diagrams across pages with drift flags', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: FLOW });
    const listed = await run.run('list_diagrams', {});
    expect(listed.output).toMatchObject({ diagrams: [{ family: 'flowchart', pageName: 'Page 1', edited: false }] });
  });

  it('serves the grammar section and expands icon concepts', async () => {
    const run = await host();
    const syntax = await run.run('get_syntax', { family: 'sequence' });
    expect(syntax.output).toMatchObject({ family: 'sequence', syntax: '## family sequence' });
    expect(run.capabilities.recording.syntaxCalls).toContain('sequence');
    // An unknown family used to answer the whole grammar, as if it had matched.
    await expect(run.run('get_syntax', { family: 'flowchrt' })).rejects.toThrow(/flowchart.*architecture|architecture.*flowchart/);
    expect((await run.run('get_syntax', { family: ' Sequence ' })).output).toMatchObject({ family: 'sequence' });

    const search = await run.run('search_icons', { query: 'lambda' });
    expect((search.output as { matches: readonly unknown[] }).matches).toHaveLength(1);

    const concept = await run.run('find_icons_for', { concept: 'cache', limit: 8 });
    expect(concept.output).toMatchObject({ concept: 'cache' });
    const slugs = (concept.output as { matches: readonly { slug: string }[] }).matches.map(({ slug }) => slug);
    expect(slugs).toContain('elasticache');
    expect(slugs).toContain('cache-for-redis');
    expect(slugs).not.toContain('lambda');
  });

  it('exports, screenshots and fits the view through host capabilities', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: FLOW });
    const frameId = run.frame().id;

    const exported = await run.run('export', { format: 'svg', scope: 'document' });
    expect(exported.output).toMatchObject({ files: [{ filename: 'diagram.svg', text: '<svg/>' }] });

    // Animated SVG comes from the same host; raster animation asks for an editor.
    const animated = await run.run('export', { format: 'svg-animated', scope: 'page', preset: 'pulse', order: 'code' });
    expect(animated.output).toMatchObject({ files: [{ filename: 'diagram.svg-animated', text: '<svg-animated/>' }] });
    const lastMotion = run.capabilities.recording.exported.at(-1) as { format: string; preset?: string };
    expect(lastMotion).toMatchObject({ format: 'svg-animated', preset: 'pulse' });


    const shot = await run.run('screenshot', { frameId, scale: 2 });
    expect(shot.output).toMatchObject({ frameId, mime: 'image/png', base64: 'UE5H' });
    const lastExport = run.capabilities.recording.exported.at(-1) as { selectedNodeIds: readonly string[] };
    expect(lastExport).toMatchObject({ format: 'png', scale: 2 });
    // The frame id alone: the serializer expands a selected container itself.
    expect(lastExport.selectedNodeIds).toEqual([frameId]);

    await run.run('fit_view', { frameId });
    expect(run.capabilities.recording.fitted.at(-1)).toContain(frameId);
  });

  it('builds the same records the UI builders do', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: FLOW });
    const ids = run.dataIds();

    const moved = await op('move').run(op('move').schema.parse({ ids, delta: { x: 24, y: -8 } }), run.context());
    expect(moved.command).toEqual(buildMoveNodesCommand(run.page(), ids, { x: 24, y: -8 }));

    const styled = await op('style').run(op('style').schema.parse({ ids, fill: '#123456', strokeWidth: 3 }), run.context());
    expect(styled.command).toEqual(buildStyleNodesCommand(run.page(), ids, { fill: '#123456', strokeWidth: 3 }));

    const deleted = await op('delete').run(op('delete').schema.parse({ ids: [ids[0]!] }), run.context());
    expect(deleted.command).toEqual(buildDeleteSelectionCommand(run.page(), [ids[0]!], []));

    // add_shape is the toolbar's create: identical insert record, same ids.
    const added = await op('add_shape').run(
      op('add_shape').schema.parse({ kind: 'rectangle', x: 10, y: 20, id: 'added-1' }), run.context());
    expect(added.command).toEqual({
      kind: 'insert-node', id: 'create-node:added-1', label: 'Create rectangle', pageId: run.page().id, index: run.page().nodes.length,
      node: createShapeNode(run.page(), { kind: 'rectangle', id: 'added-1', at: { x: 10, y: 20 } }),
    });
    await expect(run.run('add_shape', { kind: 'process', x: 0, y: 0 })).rejects.toThrow(/label/);
  });

  it('refuses unknown ids, missing diagrams and unknown palettes with clear errors', async () => {
    const run = await host();
    await expect(run.run('move', { ids: ['nope'], delta: { x: 1, y: 0 } })).rejects.toThrow(/nope/);
    await expect(run.run('delete', { ids: ['nope'] })).rejects.toThrow(/nope/);
    await expect(run.run('style', { ids: ['nope'], fill: '#ffffff' })).rejects.toThrow(/nope/);
    await expect(run.run('get_diagram', {})).rejects.toThrow(/no diagram frames/);
    await expect(run.run('create_diagram', { dsl: FLOW, at: { x: 0, y: 0 }, palette: 'neon' })).rejects.toThrow();
    expect(run.document().pages[0]!.nodes).toHaveLength(0);
  });
});

describe('add_shape chart', () => {
  it('inserts a bar chart with the given data as one node', async () => {
    const run = await host();
    const parsed = op('add_shape').schema.parse({
      kind: 'chart', label: 'Revenue', x: 20, y: 30,
      chart: { kind: 'bar', categories: ['Jan', 'Feb'], series: [{ name: 'Rev', values: [1, 2] }] },
    });
    const result = await op('add_shape').run(parsed, run.context());
    const node = (result.command as unknown as { node: {
      kind: string; content: { chart: string; categories: string[] };
    } }).node;
    expect(node.kind).toBe('chart');
    expect(node.content.chart).toBe('bar');
    expect(node.content.categories).toEqual(['Jan', 'Feb']);
  });
});

describe('add_shape wireframe', () => {
  it('adds a phone frame and a widget inside it, as the rail would', async () => {
    const run = await host();
    await run.run('add_shape', { kind: 'frame', preset: 'phone', id: 'phone', x: 0, y: 0, label: 'Login' });
    await run.run('add_shape', {
      kind: 'widget', id: 'remember', parentId: 'phone', x: 16, y: 60, label: 'Remember me',
      widget: { kind: 'checkbox', checked: false },
    });
    const [frame, widget] = run.document().pages[0]!.nodes;
    expect(frame).toMatchObject({ kind: 'frame', content: { preset: 'phone', label: 'Login' } });
    expect(widget).toMatchObject({ kind: 'widget', parentId: 'phone', content: { widget: 'checkbox', label: 'Remember me', checked: false } });
  });

  it('refuses a widget without a control or with a missing parent', async () => {
    const run = await host();
    await expect(run.run('add_shape', { kind: 'widget', x: 0, y: 0 })).rejects.toThrow(/widget/);
    await expect(run.run('add_shape', { kind: 'widget', parentId: 'nope', x: 0, y: 0, widget: { kind: 'button' } })).rejects.toThrow(/nope/);
  });
});

describe('Mermaid input', () => {
  const CONVERTIBLE = new Set(['flowchart', 'sequence', 'stateDiagram', 'erDiagram', 'classDiagram', 'mindmap', 'gitGraph', 'architecture']);
  const corpus = (MERMAID_COMPAT_FIXTURES as Array<{ name: string; source: string; family?: string; bucket?: string }>)
    .filter((fixture) => CONVERTIBLE.has(fixture.family ?? '') && (fixture.bucket?.startsWith('editable_') || fixture.family === 'gitGraph'));

  it('every convertible corpus family lands as a diagram and reads back as DSL', async () => {
    expect(new Set(corpus.map((fixture) => fixture.family))).toEqual(CONVERTIBLE);
    let converted = 0;
    for (const fixture of corpus) {
      const run = await host();
      const created = await run.run('create_diagram', { dsl: fixture.source });
      const output = created.output as { nodes: number; converted?: { from: string; dsl: string } };
      expect(output.nodes, fixture.name).toBeGreaterThan(0);
      // A plain indented `mindmap` is valid DSL as well, and lands as DSL.
      if (!output.converted) continue;
      expect(output.converted.from).toBe('mermaid');
      converted++;
      const read = await run.run('get_diagram', {});
      expect((read.output as { dsl: string }).dsl, fixture.name).toBe(output.converted.dsl);
    }
    expect(converted).toBe(corpus.length - 1);
  });

  it('unwraps a fenced block, and update_diagram takes Mermaid too', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: '```mermaid\nflowchart TD\n  A[Start] --> B{Ok?}\n```' });
    expect(run.dataIds()).toHaveLength(2);
    const updated = await run.run('update_diagram', { frameId: run.frame().id, dsl: 'graph LR; A-->B; B-->C' });
    expect(updated.output).toMatchObject({ nodes: 3, connectors: 2, converted: { from: 'mermaid', losses: [] } });
  });

  it('finds the fence inside prose and front matter, and counts lines as the agent sent them', async () => {
    const sent = 'Here is the flow:\n\n```mermaid\n---\ntitle: Checkout\n---\nflowchart LR\n  A --> B\n  A[Start --> C\n```\nIt shows checkout.';
    // Line 9 is the broken edge as the agent sent it (prose and fence counted); like the code panel,
    // nothing converts around it — drawing past it would drop or invent nodes.
    const report = lintDsl(sent);
    expect(report.ok).toBe(false);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'E004', line: 9, message: expect.stringMatching(/edge syntax/i) }));
    const run = await host();
    await expect(run.run('create_diagram', { dsl: sent })).rejects.toThrow(/line 9/);
    await run.run('create_diagram', { dsl: sent.replace('A[Start --> C', 'A[Start] --> C') });
    expect(run.frame().content.label).toBe('Checkout');
  });

  it('a fenced DSL block is stored as written, and lint counts the prose lines', async () => {
    const run = await host();
    await run.run('create_diagram', { dsl: 'Sure:\n```\nflowchart\n  A -> B\n```' });
    expect((await run.run('get_diagram', {})).output).toMatchObject({ dsl: 'flowchart\n  A -> B' });
    expect(lintDsl('Sure:\n```\nflowchart\n  A -> B\n```').diagnostics).toContainEqual(expect.objectContaining({ code: 'I002', line: 3 }));
  });

  it('our DSL with brackets inside quoted labels stays DSL', () => {
    expect(lintDsl('mindmap\ncentral: "Product(v2)"\n- Growth')).not.toHaveProperty('converted');
    expect(lintDsl('architecture\nmodel {\n  container api "call foo()"\n}')).toMatchObject({ ok: true });
  });

  it('keeps DSL as DSL, even when it starts with a Mermaid-looking header', async () => {
    const run = await host();
    const created = await run.run('create_diagram', { dsl: 'flowchart\n  A -> B' });
    expect(created.output).not.toHaveProperty('converted');
  });

  it('broken Mermaid reports the Mermaid line as an error', () => {
    const report = lintDsl('flowchart TD\n  A --> B\n  A[Start --> C');
    expect(report).toMatchObject({ ok: false });
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'E004', line: 3, message: expect.stringMatching(/edge syntax/i) }));
  });

  it('an unconvertible family names what converts, in lint and in create', async () => {
    const report = lintDsl('gantt\n  title Plan\n  section A\n  Task :a1, 2024-01-01, 3d');
    expect(report).toMatchObject({ ok: false, diagnostics: [{ code: 'E003', line: 1, message: expect.stringMatching(/"gantt".*flowchart/) }] });
    await expect((await host()).run('create_diagram', { dsl: 'pie\n  "a" : 1' })).rejects.toThrow(/"pie" cannot be converted/);
  });
});

describe('Structurizr and D2 in', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it('a Structurizr workspace lands as one page per view, with what it became', async () => {
    const run = await host();
    const created = await run.run('create_diagram', { dsl: read('src/services/dsl/fixtures/structurizr-real/big-bank-plc.dsl') });
    const output = created.output as { views: unknown[]; converted: { from: string; dsl: string; losses: unknown[] } };
    expect(output.converted.from).toBe('structurizr');
    expect(output.views).toHaveLength(6);
    expect(output.converted.losses.length).toBeGreaterThan(0);
  });

  it('a D2 file lands as a diagram; lint names the D2 line a construct came from', async () => {
    const run = await host();
    const created = await run.run('create_diagram', { dsl: read('src/services/dsl/fixtures/d2/d2-examples/chess_dia.d2') });
    // The connection to the `defendants` container ends on its group, not a stand-in box.
    expect(created.output).toMatchObject({ nodes: 6, connectors: 7, converted: { from: 'd2', losses: [] } });
    expect(lintDsl('a -> b\nx: { shape: cylinder; near: top-center }')).toMatchObject({ ok: true, converted: { from: 'd2', losses: [{ line: 2, message: 'near dropped' }] } });
  });
});
