import { describe, expect, it, vi } from 'vitest';
import { createTestConnector, createTestDocument, createTestNode } from '../opencanvas/testing/builders/documentBuilder';
import { CAPABILITY_MANIFEST } from './manifest';
import { AGENT_OPS, MAX_IMAGE_KB, PAGELESS_OPS } from './ops';
import { webMcpTools, type WebMcpEditor, type WebMcpEditorView } from './webMcpTools';

const document = createTestDocument({
  nodes: [createTestNode('a'), createTestNode('b'), createTestNode('hid', { content: { label: 'hid', sectionHidden: true } })],
  connectors: [createTestConnector('ab', 'a', 'b'), createTestConnector('ah', 'a', 'hid'), createTestConnector('off', 'a', 'b', { metadata: { hidden: true } })],
});
const view: WebMcpEditorView = {
  document, pageId: 'page-1', scene: document.pages[0]!, mode: 'canvas', readOnly: false,
  selection: ['a', 'ab'], camera: { x: 10, y: 20, zoom: 1.5 }, onScreen: ['a'],
};
const editor = (overrides: Partial<WebMcpEditor> = {}): WebMcpEditor => ({
  run: vi.fn(async () => ({ ran: true })), view: () => view, select: vi.fn(), ...overrides,
});
const tool = (tools: ReturnType<typeof webMcpTools>, name: string) => tools.find((candidate) => candidate.name === name)!;

describe('webMcpTools', () => {
  const tools = webMcpTools(editor(), { readOnly: false });

  it('offers every op, then the two only a browser can answer', () => {
    expect(tools.map(({ name }) => name)).toEqual([...AGENT_OPS.map(({ name }) => name), 'get_view', 'select']);
  });

  it('advertises plain JSON Schema objects with no $ref (strict clients drop those)', () => {
    for (const { name, inputSchema } of tools) {
      expect(JSON.stringify(inputSchema), name).not.toContain('$ref');
      expect(inputSchema, name).toMatchObject({ type: 'object' });
    }
    expect(tool(tools, 'create_diagram').inputSchema).toMatchObject({ properties: { dsl: { type: 'string' }, pageId: { type: 'string' }, at: { type: 'object' } }, required: ['dsl'] });
    // Ops that read no page take no pageId, from the one list the MCP server reads too.
    for (const op of AGENT_OPS) {
      const own = Object.keys((op.schema as { shape?: object }).shape ?? {}).includes('pageId');
      expect(Object.keys((tool(tools, op.name).inputSchema as { properties: object }).properties).includes('pageId'), op.name).toBe(own || !PAGELESS_OPS.has(op.name));
    }
  });

  it('marks reads read-only from the manifest, and document text as untrusted', () => {
    for (const row of CAPABILITY_MANIFEST) expect(tool(tools, row.action).annotations?.readOnlyHint, row.action).toBe(!row.mutates);
    expect(tool(tools, 'get_document').annotations?.untrustedContentHint).toBe(true);
    expect(tool(tools, 'get_diagram').annotations?.untrustedContentHint).toBe(true);
    // A picture of the page carries its labels too.
    expect(tool(tools, 'screenshot').annotations?.untrustedContentHint).toBe(true);
    expect(tool(tools, 'create_diagram').annotations?.untrustedContentHint).toBe(false);
    expect(tool(tools, 'get_view').annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(tool(tools, 'select').annotations?.readOnlyHint).toBe(true);
  });

  it('a read-only document offers the reads only', () => {
    const reads = webMcpTools(editor(), { readOnly: true }).map(({ name }) => name);
    expect(reads).toEqual([...CAPABILITY_MANIFEST.filter(({ mutates }) => !mutates).map(({ action }) => action), 'get_view', 'select']);
    expect(reads).toContain('list_threads');
    expect(reads).not.toContain('start_thread');
    expect(tool(tools, 'list_threads').annotations?.untrustedContentHint).toBe(true);
  });

  it('an op runs through the editor with the page it names', async () => {
    const run = vi.fn(async () => ({ id: 'n1' }));
    const own = webMcpTools(editor({ run }), { readOnly: false });
    await expect(tool(own, 'add_shape').execute({ kind: 'rectangle', pageId: 'page-2' })).resolves.toEqual({ id: 'n1' });
    expect(run).toHaveBeenCalledWith('add_shape', { kind: 'rectangle', pageId: 'page-2' }, 'page-2', undefined);
    // The browser's per-call signal reaches the runner, so a cancelled call stops before it commits.
    const signal = new AbortController().signal;
    await tool(own, 'add_shape').execute({ kind: 'rectangle' }, { signal });
    expect(run).toHaveBeenLastCalledWith('add_shape', { kind: 'rectangle' }, undefined, signal);
  });

  it('an image too large to hand back says so instead of carrying the bytes', async () => {
    const big = 'A'.repeat(Math.ceil((MAX_IMAGE_KB + 1) * 1024 / 0.75));
    const own = webMcpTools(editor({ run: async (name) => (name === 'screenshot'
      ? { mime: 'image/png', filename: 'page.png', base64: big }
      : { files: [{ filename: 'a.png', mime: 'image/png', base64: big }, { filename: 'b.png', mime: 'image/png', base64: 'iVBORw0K' }] }) }), { readOnly: false });
    const shot = await tool(own, 'screenshot').execute({}) as Record<string, unknown>;
    expect(shot.base64).toBeUndefined();
    expect(shot.tooLarge).toMatch(/too large .* lower scale/);
    const files = (await tool(own, 'export').execute({ format: 'png' }) as { files: Record<string, unknown>[] }).files;
    expect(files[0]!.base64).toBeUndefined();
    expect(files[0]!.tooLarge).toBeTruthy();
    expect(files[1]!.base64).toBe('iVBORw0K');
  });

  it('refuses raster animation, which is far over what a tool result carries', async () => {
    const run = vi.fn();
    const own = webMcpTools(editor({ run }), { readOnly: false });
    for (const format of ['gif', 'mp4', 'webm']) {
      await expect(tool(own, 'export').execute({ format })).resolves.toEqual({ error: expect.stringContaining('svg-animated') });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('a failure comes back as the result, with its message', async () => {
    const own = webMcpTools(editor({ run: async () => { throw new Error('This document is read-only, so the editor did not apply the change.'); } }), { readOnly: false });
    await expect(tool(own, 'delete').execute({ ids: ['a'] })).resolves.toEqual({ error: 'This document is read-only, so the editor did not apply the change.' });
  });

  it('get_view says what the person sees, with labels', async () => {
    await expect(tool(tools, 'get_view').execute({})).resolves.toMatchObject({
      documentId: 'document-1', pageId: 'page-1', pageName: 'Page 1', pageIndex: 0, pages: 1, mode: 'canvas', readOnly: false,
      selection: [{ id: 'a', kind: 'process', label: 'a' }, { id: 'ab', kind: 'connector', label: '' }],
      camera: { x: 10, y: 20, zoom: 1.5 }, onScreen: [{ id: 'a', label: 'a' }], onScreenCount: 1,
    });
    const empty = webMcpTools(editor({ view: () => null }), { readOnly: false });
    await expect(tool(empty, 'get_view').execute({})).resolves.toEqual({ error: 'The editor has no document open.' });
  });

  it('select picks shapes and connectors on the page in view, and refuses ids it cannot see', async () => {
    const select = vi.fn();
    const own = webMcpTools(editor({ select }), { readOnly: false });
    await expect(tool(own, 'select').execute({ ids: ['b', 'ab'] })).resolves.toEqual({ pageId: 'page-1', selected: ['b', 'ab'] });
    expect(select).toHaveBeenCalledWith(['b'], ['ab'], true);
    await expect(tool(own, 'select').execute({ ids: ['zzz'] })).resolves.toMatchObject({ error: expect.stringContaining('zzz') });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('select refuses what is hidden, by name, as Layers does: a hidden shape, a hidden connector, one to a hidden shape', async () => {
    const select = vi.fn();
    const own = webMcpTools(editor({ select }), { readOnly: false });
    const answer = await tool(own, 'select').execute({ ids: ['a', 'hid', 'ah', 'off'] }) as { error?: string };
    expect(answer.error).toMatch(/hidden/i);
    for (const id of ['hid', 'ah', 'off']) expect(answer.error).toContain(id);
    expect(answer.error).not.toMatch(/\ba\b,/);
    expect(select).not.toHaveBeenCalled();
  });
});
