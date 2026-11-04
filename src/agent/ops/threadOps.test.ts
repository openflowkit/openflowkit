import { describe, expect, it, vi } from 'vitest';
import { applyDocumentCommand } from '@/opencanvas/domain/commands/execute';
import { addComment, pageThreads } from '@/opencanvas/domain/threads/threads';
import type { SceneDocumentV1 } from '@/opencanvas/domain/document/types';
import { createAgentDocument } from '../index';
import { NO_THREADS_REFUSAL, READ_ONLY_REFUSAL, runLiveAgentOp, type LiveAgentSession } from '../liveOp';
import { resolveAgentOpCommand, runAgentOp } from '../runAction';
import { findAgentOp } from './index';
import { createTestCapabilities } from './testHost';
import type { OpContext } from './types';

const FLOW = '%% ofk 1\nflowchart\n\n  Client [blue] -> API [emerald]\n  API -> Store [cylinder, red]';
const capabilities = createTestCapabilities();

const op = (name: string) => findAgentOp(name)!;

async function drawn(): Promise<SceneDocumentV1> {
  const document = createAgentDocument('Comments fixture', 'doc-c');
  const context: OpContext = { document, pageId: document.pages[0]!.id, capabilities };
  const { command } = await resolveAgentOpCommand(op('create_diagram'), { dsl: FLOW }, context);
  return applyDocumentCommand(document, command!).document;
}

const contextOf = (document: SceneDocumentV1, client?: string): OpContext =>
  ({ document, pageId: document.pages[0]!.id, capabilities, ...(client ? { client } : {}) });

/** File mode: the op's result applied to the document, as the MCP server does. */
const file = (document: SceneDocumentV1, name: string, input: unknown, client?: string) =>
  runAgentOp(op(name), input, contextOf(document, client));

describe('thread ops, file mode', () => {
  it('start_thread on a node pins at its top-right corner and signs with the agent name', async () => {
    const document = await drawn();
    const node = document.pages[0]!.nodes.find((candidate) => candidate.kind !== 'frame')!;
    const { document: next, output, changed } = await file(document, 'start_thread', { nodeId: node.id, body: ' Check this ' }, 'claude-code');
    expect(changed).toBe(true);
    const [thread] = pageThreads(next.pages[0]!);
    expect(thread!.anchor.nodeId).toBe(node.id);
    expect(thread!.anchor.point.x).toBeGreaterThan(node.transform.translation.x);
    expect(thread!.comments).toHaveLength(1);
    expect(thread!.comments[0]).toMatchObject({ author: { kind: 'agent', name: 'Claude Code' }, body: 'Check this' });
    expect(thread!.number).toBe(1);
    expect(output).toMatchObject({ threadId: thread!.id, number: 1, commentId: thread!.comments[0]!.id });
  });

  it('start_thread on a point pins to the page; point wins over the node corner', async () => {
    const document = await drawn();
    const node = document.pages[0]!.nodes.find((candidate) => candidate.kind !== 'frame')!;
    const onPage = (await file(document, 'start_thread', { point: { x: 5, y: 6 }, body: 'here' })).document;
    expect(pageThreads(onPage.pages[0]!)[0]!.anchor).toEqual({ nodeId: null, offset: null, point: { x: 5, y: 6 } });
    const both = (await file(document, 'start_thread', { nodeId: node.id, point: { x: 1, y: 2 }, body: 'there' })).document;
    expect(pageThreads(both.pages[0]!)[0]!.anchor).toMatchObject({ nodeId: node.id, point: { x: 1, y: 2 } });
  });

  it('start_thread refuses with neither a node nor a point, an unknown node, or an empty body', async () => {
    const document = await drawn();
    await expect(file(document, 'start_thread', { body: 'x' })).rejects.toThrow(/nodeId.*point/);
    await expect(file(document, 'start_thread', { nodeId: 'ghost', body: 'x' })).rejects.toThrow(/ghost/);
    await expect(file(document, 'start_thread', { point: { x: 0, y: 0 }, body: '   ' })).rejects.toThrow(/empty/);
  });

  it('reply_to_thread and resolve_thread change the thread; reply reopens; unknown ids refuse', async () => {
    const started = (await file(await drawn(), 'start_thread', { point: { x: 0, y: 0 }, body: 'first' }, 'cursor')).document;
    const threadId = pageThreads(started.pages[0]!)[0]!.id;
    const resolved = (await file(started, 'resolve_thread', { threadId })).document;
    expect(pageThreads(resolved.pages[0]!)[0]!.resolved).toBe(true);
    const replied = (await file(resolved, 'reply_to_thread', { threadId, body: 'again' }, 'cursor')).document;
    const thread = pageThreads(replied.pages[0]!)[0]!;
    expect(thread.resolved).toBe(false);
    expect(thread.comments.map(({ body }) => body)).toEqual(['first', 'again']);
    expect(thread.comments[1]!.author).toEqual({ kind: 'agent', name: 'Cursor' });
    const reopened = (await file(resolved, 'resolve_thread', { threadId, resolved: false })).document;
    expect(pageThreads(reopened.pages[0]!)[0]!.resolved).toBe(false);
    await expect(file(started, 'reply_to_thread', { threadId: 'ghost', body: 'x' })).rejects.toThrow(/ghost/);
    await expect(file(started, 'resolve_thread', { threadId: 'ghost' })).rejects.toThrow(/ghost/);
  });

  it('list_threads hides resolved threads by default, labels live nodes, and survives a deleted node', async () => {
    let document = await drawn();
    const node = document.pages[0]!.nodes.find((candidate) => candidate.kind !== 'frame' && typeof candidate.content.label === 'string')!;
    document = (await file(document, 'start_thread', { nodeId: node.id, body: 'one' })).document;
    document = (await file(document, 'start_thread', { point: { x: 1, y: 1 }, body: 'two' })).document;
    const [first] = pageThreads(document.pages[0]!);
    document = (await file(document, 'resolve_thread', { threadId: first!.id })).document;
    const open = (await file(document, 'list_threads', {})).output as { threads: { id: string; number: number; nodeLabel?: string; pageId: string }[] };
    expect(open.threads.map(({ id }) => id)).not.toContain(first!.id);
    const all = (await file(document, 'list_threads', { includeResolved: true })).output as typeof open;
    expect(all.threads).toHaveLength(2);
    expect(all.threads.find(({ id }) => id === first!.id)).toMatchObject({ number: 1, nodeLabel: node.content.label, pageId: document.pages[0]!.id });
    expect(all.threads.map(({ number }) => number).sort()).toEqual([1, 2]);
    const gone = { ...document, pages: [{ ...document.pages[0]!, nodes: document.pages[0]!.nodes.filter(({ id }) => id !== node.id) }] };
    const afterDelete = (await file(gone, 'list_threads', { includeResolved: true })).output as typeof open;
    const orphan = afterDelete.threads.find(({ id }) => id === first!.id)!;
    expect(orphan.nodeLabel).toBeUndefined();
    await expect(file(document, 'list_threads', { pageId: 'nope' })).rejects.toThrow(/nope/);
  });

  it('list_threads filters by threadId (even resolved) and by unanswered, and refuses an unknown threadId', async () => {
    let document = await drawn();
    document = (await file(document, 'start_thread', { point: { x: 1, y: 1 }, body: 'agent asks' }, 'claude-code')).document;
    document = (await file(document, 'start_thread', { point: { x: 2, y: 2 }, body: 'agent asks too' }, 'claude-code')).document;
    const [first, second] = pageThreads(document.pages[0]!);
    // A person answers the second thread, so its last comment is human; the first still ends on the agent.
    document = addComment(document, second!.id, { id: 'h1', author: { kind: 'human', name: 'User' }, body: 'my answer', createdAt: '2026-10-26T12:00:00.000Z' });
    type Listed = { threads: { id: string }[] };
    const ids = async (input: object) => ((await file(document, 'list_threads', input)).output as Listed).threads.map(({ id }) => id);
    expect(await ids({ unanswered: true })).toEqual([second!.id]);
    expect(await ids({})).toEqual([first!.id, second!.id]);
    expect(await ids({ threadId: first!.id })).toEqual([first!.id]);
    expect(await ids({ threadId: first!.id, unanswered: true })).toEqual([]);
    document = (await file(document, 'resolve_thread', { threadId: first!.id })).document;
    expect(await ids({ threadId: first!.id })).toEqual([first!.id]);
    expect(await ids({ unanswered: true, includeResolved: true })).toEqual([second!.id]);
    await expect(file(document, 'list_threads', { threadId: 'ghost' })).rejects.toThrow(/Unknown thread "ghost"/);
  });

  it('get_document and list_pages count open threads', async () => {
    let document = await drawn();
    document = (await file(document, 'start_thread', { point: { x: 0, y: 0 }, body: 'a' })).document;
    document = (await file(document, 'start_thread', { point: { x: 0, y: 0 }, body: 'b' })).document;
    document = (await file(document, 'resolve_thread', { threadId: pageThreads(document.pages[0]!)[0]!.id })).document;
    expect((await file(document, 'get_document', {})).output).toMatchObject({ openThreads: 1 });
    expect((await file(document, 'list_pages', {})).output).toMatchObject({ pages: [{ openThreads: 1 }] });
  });

  it('comments never reach the DSL: get_diagram is identical with and without them', async () => {
    const document = await drawn();
    const frameId = document.pages[0]!.nodes.find((node) => node.kind === 'frame')!.id;
    const node = document.pages[0]!.nodes.find((candidate) => candidate.kind !== 'frame')!;
    const commented = (await file(document, 'start_thread', { nodeId: node.id, body: 'noted' })).document;
    expect(pageThreads(commented.pages[0]!)).toHaveLength(1);
    for (const input of [{ frameId }]) {
      const plain = await runAgentOp(op('get_diagram'), input, contextOf(document));
      const withComments = await runAgentOp(op('get_diagram'), input, contextOf(commented));
      expect(withComments.output).toEqual(plain.output);
    }
    const listed = (id: SceneDocumentV1) => runAgentOp(op('list_diagrams'), {}, contextOf(id));
    expect((await listed(commented)).output).toEqual((await listed(document)).output);
  });
});

describe('comment ops, live', () => {
  const live = async (overrides: Partial<LiveAgentSession> = {}) => {
    let document = await drawn();
    const threadChange = vi.fn((change: (doc: SceneDocumentV1) => SceneDocumentV1) => { document = change(document); });
    const commit = vi.fn();
    const session = (): LiveAgentSession => ({
      document, pageId: document.pages[0]!.id, capabilities, commit, threadChange, ...overrides,
    });
    return { session, threadChange, commit, document: () => document };
  };

  it('a comment write goes through threadChange only: no commit, no undo step, no camera or page move', async () => {
    const onApplied = vi.fn();
    const showPage = vi.fn();
    const host = await live({ onApplied, showPage });
    const result = await runLiveAgentOp(host.session, 'start_thread', { point: { x: 3, y: 4 }, body: 'hi' }, undefined, undefined, 'claude-code');
    expect(result.command).toBeNull();
    expect(host.commit).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    expect(showPage).not.toHaveBeenCalled();
    expect(host.threadChange).toHaveBeenCalledTimes(1);
    const [thread] = pageThreads(host.document().pages[0]!);
    expect(thread!.comments[0]!.author).toEqual({ kind: 'agent', name: 'Claude Code' });
    const threadId = thread!.id;
    await runLiveAgentOp(host.session, 'reply_to_thread', { threadId, body: 'more' });
    await runLiveAgentOp(host.session, 'resolve_thread', { threadId });
    expect(pageThreads(host.document().pages[0]!)[0]).toMatchObject({ resolved: true });
    expect(host.commit).not.toHaveBeenCalled();
    const listed = await runLiveAgentOp(host.session, 'list_threads', { includeResolved: true });
    expect((listed.output as { threads: unknown[] }).threads).toHaveLength(1);
  });

  it('start_thread reports the number the thread got, not the one it expected', async () => {
    const host = await live({});
    // The op resolves against an empty document (it expects #1), but by the time its change lands someone
    // in the editor has started #1: the change applies to that document and the output says #2.
    const withOne = (await file(host.document(), 'start_thread', { point: { x: 0, y: 0 }, body: 'first' })).document;
    const late = (): LiveAgentSession => ({ ...host.session(), threadChange: (change) => host.threadChange(() => change(withOne)) });
    const result = await runLiveAgentOp(late, 'start_thread', { point: { x: 1, y: 1 }, body: 'second' });
    expect((result.output as { number: number }).number).toBe(2);
    expect(pageThreads(host.document().pages[0]!).map(({ number }) => number)).toEqual([1, 2]);
  });

  it('a read-only document refuses comment writes but lists comments', async () => {
    const host = await live({ readOnly: true });
    for (const [name, input] of [['start_thread', { point: { x: 0, y: 0 }, body: 'x' }], ['reply_to_thread', { threadId: 't', body: 'x' }], ['resolve_thread', { threadId: 't' }]] as const) {
      await expect(runLiveAgentOp(host.session, name, input)).rejects.toThrow(READ_ONLY_REFUSAL);
    }
    expect(host.threadChange).not.toHaveBeenCalled();
    await expect(runLiveAgentOp(host.session, 'list_threads', {})).resolves.toMatchObject({ command: null });
  });

  it('a repo-map (locked) page takes comments without redirecting to the drawing', async () => {
    const openDrawing = vi.fn(() => true);
    const host = await live({ lockedPageId: (await drawn()).pages[0]!.id, openDrawing });
    const pageId = host.session().pageId!;
    await runLiveAgentOp(host.session, 'start_thread', { pageId, point: { x: 0, y: 0 }, body: 'on the map' }, pageId);
    expect(openDrawing).not.toHaveBeenCalled();
    expect(host.threadChange).toHaveBeenCalledTimes(1);
  });

  it('a host without threadChange refuses writes', async () => {
    const host = await live({ threadChange: undefined });
    await expect(runLiveAgentOp(host.session, 'start_thread', { point: { x: 0, y: 0 }, body: 'x' })).rejects.toThrow(NO_THREADS_REFUSAL);
    // The refusal comes before the op resolves, so an unknown id does not hide it.
    await expect(runLiveAgentOp(host.session, 'resolve_thread', { threadId: 'ghost' })).rejects.toThrow(NO_THREADS_REFUSAL);
  });

  it('a bad thread id surfaces as an error for the agent', async () => {
    const host = await live();
    await expect(runLiveAgentOp(host.session, 'reply_to_thread', { threadId: 'ghost', body: 'x' })).rejects.toThrow(/ghost/);
    expect(host.threadChange).not.toHaveBeenCalled();
  });
});
