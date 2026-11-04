import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServerWithDeps } from '../src/server.js';
import { AGENT_OPS, type LiveBridge } from '../src/lib/agent.js';

// The MCP tool surface in file mode: document tools, the op tools generated
// from the shared manifest, and whoami. No browser, no network.

const tempDirs: string[] = [];
afterAll(async () => { await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))); });

async function client(): Promise<Client> {
  const { server } = createServerWithDeps({ log: () => undefined });
  const instance = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), instance.connect(clientTransport)]);
  return instance;
}

async function call(target: Client, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await target.callTool({ name, arguments: args });
  const [content] = (result.content ?? []) as { type: string; text?: string }[];
  const raw = content?.text ?? 'null';
  if (result.isError) throw new Error(raw);
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Op tools wrap their output with {documentId, changed, output}. */
async function run(target: Client, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await call(target, name, args);
  return (result.output ?? {}) as Record<string, unknown>;
}

describe('op tools', () => {
  it('comment ops work in file mode, signed with the MCP client name, and stay out of the diagram', async () => {
    const target = await client();
    const made = await call(target, 'openflow_create', { name: 'Commented' });
    const documentId = made.id as string;
    const added = await run(target, 'start_thread', { documentId, point: { x: 10, y: 20 }, body: 'Look here' });
    const threadId = added.threadId as string;
    await run(target, 'reply_to_thread', { documentId, threadId, body: 'And here' });
    const listed = await run(target, 'list_threads', { documentId }) as { threads: { id: string; comments: { author: { kind: string; name: string }; body: string }[] }[] };
    expect(listed.threads).toHaveLength(1);
    expect(listed.threads[0]!.comments.map(({ body }) => body)).toEqual(['Look here', 'And here']);
    expect(listed.threads[0]!.comments[0]!.author).toEqual({ kind: 'agent', name: 'test' });
    expect(await run(target, 'get_document', { documentId })).toMatchObject({ openThreads: 1 });
    await run(target, 'resolve_thread', { documentId, threadId });
    expect(((await run(target, 'list_threads', { documentId })) as { threads: unknown[] }).threads).toHaveLength(0);
    await expect(call(target, 'start_thread', { documentId, body: 'nowhere' })).rejects.toThrow(/nodeId.*point/);
  });

  it('exposes every op in the manifest with a title and description', async () => {
    const target = await client();
    const { tools } = await target.listTools();
    const names = tools.map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining(AGENT_OPS.map(({ name }) => name)));
    expect(names).toEqual(expect.arrayContaining(['openflow_create', 'openflow_open', 'openflow_save', 'whoami']));
    expect(names).not.toContain('diagram_create');
    for (const op of AGENT_OPS) {
      const tool = tools.find(({ name }) => name === op.name)!;
      expect(tool.description, op.name).toBe(op.description);
      expect(tool.inputSchema, op.name).toBeTruthy();
    }
  });

  // U3 2026-10-11: one schema shared by two fields (move.to/delta, style.fill/stroke) became a `$ref`,
  // which strict tool-calling clients drop or reject. Lookups read no document, so they take no documentId.
  it('advertises self-contained input schemas: no $ref, and no documentId on lookups', async () => {
    const { tools } = await (await client()).listTools();
    expect(tools).toHaveLength(33);
    for (const tool of tools) expect(JSON.stringify(tool.inputSchema), tool.name).not.toContain('$ref');
    const props = (name: string) => Object.keys((tools.find((tool) => tool.name === name)!.inputSchema as { properties: object }).properties);
    for (const name of ['get_syntax', 'search_icons', 'find_icons_for']) expect(props(name), name).not.toContain('documentId');
    expect(props('move')).toEqual(expect.arrayContaining(['to', 'delta', 'documentId']));
  });

  it('server_info lists exactly the tools the server registers', async () => {
    const target = await client();
    const { tools } = await target.listTools();
    const info = await call(target, 'server_info', {});
    expect(info.tools).toEqual(tools.map(({ name }) => name).sort());
    expect(tools.find(({ name }) => name === 'server_info')!.description).not.toMatch(/self-test/);
  });

  it('ships the grammar without the internal prior-art notes', async () => {
    const target = await client();
    const { contents } = await target.readResource({ uri: 'openflowkit://docs/grammar' });
    const grammar = String((contents[0] as { text?: string }).text);
    expect(grammar).toContain('## 1. Goals');
    expect(grammar).not.toContain('## 0. Prior art');
    expect(grammar).not.toContain('§0');
    expect(await run(target, 'get_syntax', {})).toMatchObject({ syntax: expect.not.stringContaining('## 0. Prior art') });
  });

  it('advertises the input fields of an op whose schema carries a cross-field rule', async () => {
    // add_shape's schema is refined (catalog kinds need a label), which hid every field from MCP clients.
    const { tools } = await (await client()).listTools();
    const properties = Object.keys(tools.find(({ name }) => name === 'add_shape')!.inputSchema.properties ?? {});
    expect(properties).toEqual(expect.arrayContaining(['kind', 'label', 'x', 'y', 'documentId']));
  });

  it('runs add_shape with the fields an agent sends', async () => {
    const target = await client();
    const { documentId } = await call(target, 'openflow_create', { name: 'Shapes' });
    const added = await call(target, 'add_shape', { documentId, kind: 'process', label: 'Charge card', x: 40, y: 80 });
    expect(added).toMatchObject({ changed: true });
  });

  it('creates, reads, updates and exports a diagram in file mode', async () => {
    const target = await client();
    const created = await call(target, 'openflow_create', { name: 'Eval doc' });
    const documentId = created.id as string;

    const diagram = await run(target, 'create_diagram', {
      documentId, dsl: '%% ofk 1\nflowchart\n\n  Client [blue] -> API [emerald]\n  API -> Store [cylinder, red]',
    });
    expect(diagram).toMatchObject({ family: 'flowchart', nodes: 3, connectors: 2 });
    const frameId = diagram.frameId as string;

    const read = await run(target, 'get_diagram', { documentId, frameId });
    expect(read).toMatchObject({ edited: false });
    expect(String(read.dsl)).toContain('Client [blue]');

    const updated = await run(target, 'update_diagram', {
      documentId, frameId, dsl: '%% ofk 1\nflowchart\n\n  Client -> API -> Store -> Cache',
    });
    expect(updated).toMatchObject({ frameId, nodes: 4, connectors: 3 });

    const exported = await run(target, 'export', { documentId, format: 'svg', scope: 'document' });
    const [file] = exported.files as { filename: string; text: string }[];
    // Animated SVG is a file-mode format too; raster animation is not.
    const animated = await run(target, 'export', { documentId, format: 'svg-animated', scope: 'page', preset: 'walkthrough' });
    expect((animated.files as { text: string }[])[0]?.text).toContain('@keyframes');
    const refused = await target.callTool({ name: 'export', arguments: { documentId, format: 'mp4', scope: 'page' } });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain('live editor');
    expect(file?.text).toContain('<svg');
    expect(file?.text).toContain('Cache');

    // PNG needs a live editor; the tool says so instead of failing silently.
    expect(await call(target, 'screenshot', { documentId, frameId }).catch((error: Error) => error.message))
      .toMatch(/live editor/);

    const pages = await run(target, 'list_pages', { documentId });
    expect((pages.pages as unknown[]).length).toBe(1);
  });

  it('persists a document through openflow_open and openflow_save', async () => {
    const target = await client();
    const dir = await mkdtemp(join(process.cwd(), '.tmp-ops-'));
    tempDirs.push(dir);
    const path = join(dir, 'eval.openflow.json');

    const created = await call(target, 'openflow_create', { name: 'Round trip' });
    await run(target, 'create_diagram', { documentId: created.id, dsl: 'sequence\n  A -> B : hello' });
    const saved = await call(target, 'openflow_save', { documentId: created.id, path });
    expect(saved).toMatchObject({ documentId: created.id });

    const onDisk = JSON.parse(await readFile(path, 'utf8')) as { name: string; pages: unknown[] };
    expect(onDisk.name).toBe('Round trip');
    expect(onDisk.pages).toHaveLength(1);

    const reopened = await call(target, 'openflow_open', { path });
    expect(reopened).toMatchObject({ documentId: created.id, name: 'Round trip' });
    const read = await run(target, 'get_diagram', { documentId: reopened.documentId as string });
    expect(String(read.dsl)).toContain('A -> B');
  });

  it('openflow_save writes the SVG beside the file only when svg is true', async () => {
    const target = await client();
    const dir = await mkdtemp(join(process.cwd(), '.tmp-ops-'));
    tempDirs.push(dir);
    const created = await call(target, 'openflow_create', { name: 'Pictured' });
    await run(target, 'create_diagram', { documentId: created.id, dsl: 'flowchart\n  A -> B' });

    const plain = await call(target, 'openflow_save', { documentId: created.id, path: join(dir, 'plain.openflow.json') });
    expect(plain.svg).toBeUndefined();
    expect(existsSync(join(dir, 'plain.openflow.json'))).toBe(true);
    expect(existsSync(join(dir, 'plain.svg'))).toBe(false);

    const withSvg = await call(target, 'openflow_save', { documentId: created.id, path: join(dir, 'pic.openflow.json'), svg: true });
    expect(withSvg.svg).toBe(join(dir, 'pic.svg'));
    expect(existsSync(join(dir, 'pic.openflow.json'))).toBe(true);
    expect(await readFile(join(dir, 'pic.svg'), 'utf8')).toMatch(/^<svg /);
  });

  it('openflow_save keeps the saved file and returns svgError when the SVG cannot be written', async () => {
    const target = await client();
    const dir = await mkdtemp(join(process.cwd(), '.tmp-ops-'));
    tempDirs.push(dir);
    const created = await call(target, 'openflow_create', { name: 'Blocked' });
    await run(target, 'create_diagram', { documentId: created.id, dsl: 'flowchart\n  A -> B' });
    await mkdir(join(dir, 'blocked.svg'));
    const saved = await call(target, 'openflow_save', { documentId: created.id, path: join(dir, 'blocked.openflow.json'), svg: true });
    expect(saved).toMatchObject({ saved: join(dir, 'blocked.openflow.json') });
    expect(String(saved.svgError)).not.toBe('');
    expect(saved.svg).toBeUndefined();
    expect(existsSync(join(dir, 'blocked.openflow.json'))).toBe(true);
  });

  it('openflow_save stays inside the working directory, follows no symlink out, and writes only document files', async () => {
    const target = await client();
    const created = await call(target, 'openflow_create', { name: 'Confined' });
    const dir = await mkdtemp(join(process.cwd(), '.tmp-ops-'));
    tempDirs.push(dir);
    const outside = await mkdtemp(join(tmpdir(), 'openflowkit-outside-'));
    tempDirs.push(outside);
    await symlink(outside, join(dir, 'link'));

    await expect(call(target, 'openflow_save', { documentId: created.id, path: join(outside, 'x.openflow.json') }))
      .rejects.toThrow(/inside the server's working directory/);
    await expect(call(target, 'openflow_save', { documentId: created.id, path: join(dir, 'link', 'x.openflow.json') }))
      .rejects.toThrow(/inside the server's working directory/);
    expect(existsSync(join(outside, 'x.openflow.json'))).toBe(false);
    await expect(call(target, 'openflow_save', { documentId: created.id, path: join(dir, '.zshrc') }))
      .rejects.toThrow(/\.openflow\.json, \.ofk or \.json/);
    expect(existsSync(join(dir, '.zshrc'))).toBe(false);
    for (const name of ['a.openflow.json', 'b.ofk', 'c.json']) {
      await call(target, 'openflow_save', { documentId: created.id, path: join(dir, name) });
      expect(existsSync(join(dir, name))).toBe(true);
    }
  });

  it('export path refuses a symlink that leads outside the working directory', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.tmp-ops-'));
    tempDirs.push(dir);
    const outside = await mkdtemp(join(tmpdir(), 'openflowkit-outside-'));
    tempDirs.push(outside);
    await symlink(outside, join(dir, 'link'));
    const bridge = {
      connected: true, health: () => ({ pages: [] }),
      call: async () => ({ files: [{ mime: 'image/svg+xml', text: '<svg/>' }] }),
    } as unknown as LiveBridge;
    const { server } = createServerWithDeps({ log: () => undefined, bridge });
    const live = new Client({ name: 'test', version: '0.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), live.connect(a)]);
    const result = await live.callTool({ name: 'export', arguments: { format: 'svg', path: join(dir, 'link', 'x.svg') } });
    expect(result.isError).toBe(true);
    expect(existsSync(join(outside, 'x.svg'))).toBe(false);
  });

  it('openflow_save in live mode asks the editor for the first page', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.tmp-ops-'));
    tempDirs.push(dir);
    const calls: { input: { format: string }; pageId?: string }[] = [];
    const bridge = {
      connected: true,
      health: () => ({ pages: [{ pageId: 'p-first' }, { pageId: 'p-second' }] }),
      call: async (_op: string, input: { format: string }, pageId?: string) => {
        calls.push({ input, ...(pageId ? { pageId } : {}) });
        return { files: [{ text: input.format === 'svg' ? '<svg live/>' : '{}' }] };
      },
    } as unknown as LiveBridge;
    const { server } = createServerWithDeps({ log: () => undefined, bridge });
    const live = new Client({ name: 'test', version: '0.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), live.connect(a)]);
    const saved = await call(live, 'openflow_save', { path: join(dir, 'live.openflow.json'), svg: true });
    expect(saved).toMatchObject({ svg: join(dir, 'live.svg') });
    expect(calls.find(({ input }) => input.format === 'svg')?.pageId).toBe('p-first');
    expect(await readFile(join(dir, 'live.svg'), 'utf8')).toBe('<svg live/>');
  });

  it('validates DSL with the real parser and reports diagnostics', async () => {
    const target = await client();
    const good = await call(target, 'validate_openflow_dsl', { dsl: '%% ofk 1\nflowchart\n\n  A -> B\n' });
    expect(good).toMatchObject({ ok: true, family: 'flowchart', reservedFamily: false, statements: 1 });

    const empty = await call(target, 'validate_openflow_dsl', { dsl: '   ' });
    expect(empty.ok).toBe(false);
    expect((empty.diagnostics as { code: string }[]).some(({ code }) => code === 'E001')).toBe(true);

    // Reserved families parse as graph syntax today: honest warning, not an error.
    const reserved = await call(target, 'validate_openflow_dsl', { dsl: 'bpmn\n  A -> B\n' });
    expect(reserved).toMatchObject({ ok: true, family: 'bpmn', reservedFamily: true });
    expect((reserved.diagnostics as { code: string }[]).some(({ code }) => code === 'W105')).toBe(true);
  });

  it('validate_openflow_dsl reports what compiling finds, as the CLI validate does', async () => {
    const target = await client();
    // U3 2026-10-11: dropped lines passed as warnings, so an agent shipped a diagram missing edges. A line the
    // parser cannot read now fails validation, with its line and a fix; generating still draws the rest.
    const partly = await call(target, 'validate_openflow_dsl', { dsl: 'flowchart\nA -> B\nA -> \nB -->' });
    expect(partly).toMatchObject({ ok: false, hint: expect.stringMatching(/Fix the errors/) });
    expect(partly.diagnostics).toEqual([
      expect.objectContaining({ code: 'W101', line: 3, severity: 'error', hint: expect.stringMatching(/delete it/) }),
      expect.objectContaining({ code: 'W101', line: 4, severity: 'error' }),
    ]);
    const { id: drawn } = await call(target, 'openflow_create', { name: 'Partly' });
    expect(await run(target, 'create_diagram', { documentId: drawn, dsl: 'flowchart\nA -> B\nA -> \nB -->' })).toMatchObject({ nodes: 2 });
    // An unknown attribute word is kept and only warned about: still ok.
    expect(await call(target, 'validate_openflow_dsl', { dsl: 'flowchart\nA [sparkly] -> B' })).toMatchObject({ ok: true });
    // Every line dropped: nothing would be drawn, so it is not ok.
    const dropped = await call(target, 'validate_openflow_dsl', { dsl: 'flowchart\nA -> [[[ broken' });
    expect(dropped).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: 'W101', line: 2, hint: expect.stringContaining('(get_syntax shows') }), expect.objectContaining({ code: 'E001' })] });
    const { id: documentId } = await call(target, 'openflow_create', { name: 'Broken' });
    await expect(call(target, 'create_diagram', { documentId, dsl: 'flowchart\nA -> [[[ broken' })).rejects.toThrow(/Nothing to draw[\s\S]*W101/);
    expect(await run(target, 'list_diagrams', { documentId })).toEqual({ diagrams: [] });
    const typo = await call(target, 'validate_openflow_dsl', { dsl: 'flowchrt\nA -> B' });
    expect(typo.diagnostics).toContainEqual(expect.objectContaining({ code: 'W110', message: expect.stringContaining('`flowchart`') }));
  });

  it('reports the mode and local documents through whoami', async () => {
    const target = await client();
    const before = await call(target, 'whoami', {});
    expect(before).toMatchObject({ mode: 'file', editor: null, cloud: expect.stringContaining('local') });
    await call(target, 'openflow_create', { name: 'Listed doc' });
    const after = await call(target, 'whoami', {});
    expect(after.documents).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Listed doc' })]));
  });

  it('routes op calls to a paired editor instead of the file store', async () => {
    const calls: { op: string; input: unknown }[] = [];
    const bridge = {
      connected: true,
      health: () => ({ ok: true, protocol: 1, name: 'openflowkit', version: '0.0.0', connected: true, documentId: 'live-doc', documentName: 'Live', pageId: 'p1', pages: [{ pageId: 'p1', name: 'Page 1', nodes: 1, connectors: 0 }], lastSeenMs: 5 }),
      status: () => ({ port: 43119, state: 'paired' }),
      retryPort: async () => undefined,
      call: async (op: string, input: unknown) => { calls.push({ op, input }); return { frameId: 'dsl-live' }; },
    } as unknown as LiveBridge;
    const { server } = createServerWithDeps({ bridge, log: () => undefined });
    const instance = new Client({ name: 'test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), instance.connect(clientTransport)]);

    const result = await call(instance, 'create_diagram', { dsl: 'flowchart\n  A -> B' });
    expect(result).toMatchObject({ frameId: 'dsl-live' });
    expect(calls).toEqual([{ op: 'create_diagram', input: { dsl: 'flowchart\n  A -> B' } }]);

    const status = await call(instance, 'whoami', {});
    expect(status).toMatchObject({ mode: 'live-editor', editor: { documentId: 'live-doc' }, bridge: { state: 'paired' } });
  });
});

describe('pictures', () => {
  it('screenshot and PNG export come back as MCP image blocks, not base64 inside the JSON', async () => {
    const png = 'iVBORw0KGgo'.padEnd(4000, 'A');
    const bridge = {
      connected: true,
      health: () => ({ connected: true, pages: [] }),
      call: async (op: string) => op === 'screenshot'
        ? { frameId: 'f1', pageId: 'p1', filename: 'f1.png', mime: 'image/png', base64: png }
        : { files: [{ filename: 'd.png', mime: 'image/png', base64: png }, { filename: 'd.svg', mime: 'image/svg+xml', text: '<svg/>' }] },
    } as unknown as LiveBridge;
    const { server } = createServerWithDeps({ bridge, log: () => undefined });
    const live = new Client({ name: 'test', version: '0.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), live.connect(a)]);
    for (const name of ['screenshot', 'export']) {
      const result = await live.callTool({ name, arguments: {} });
      const [summary, ...rest] = result.content as { type: string; text?: string; data?: string; mimeType?: string }[];
      expect(summary!.type, name).toBe('text');
      expect(summary!.text!.length, name).toBeLessThan(1000);
      expect(summary!.text, name).not.toContain(png);
      expect(rest, name).toEqual([{ type: 'image', data: png, mimeType: 'image/png' }]);
    }
  });
});

describe('export to a file', () => {
  const big = 'iVBORw0KGgo'.padEnd(1_500_000, 'A');
  async function live(png: string) {
    const bridge = {
      connected: true, health: () => ({ connected: true, pages: [] }), status: () => ({ port: 1, state: 'paired' }),
      call: async (op: string) => op === 'screenshot'
        ? { frameId: 'f1', pageId: 'p1', filename: 'f1.png', mime: 'image/png', base64: png }
        : { files: [{ filename: 'd.png', mime: 'image/png', base64: png }] },
    } as unknown as LiveBridge;
    const { server } = createServerWithDeps({ bridge, log: () => undefined });
    const target = new Client({ name: 'test', version: '0.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), target.connect(a)]);
    return target;
  }

  it('export takes a path inside the working directory and writes the file there', async () => {
    const target = await live('iVBORw0KGgoAAAA');
    const dir = await mkdtemp(join(process.cwd(), '.tmp-export-'));
    tempDirs.push(dir);
    const result = await target.callTool({ name: 'export', arguments: { format: 'png', path: join(dir, 'docs/arch.png') } });
    expect(result.content).toHaveLength(1);
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toMatchObject({ saved: join(dir, 'docs/arch.png'), bytes: 11, mime: 'image/png' });
    expect((await readFile(join(dir, 'docs/arch.png'))).subarray(0, 4).toString('hex')).toBe('89504e47');
    const outside = await target.callTool({ name: 'export', arguments: { format: 'png', path: join(tmpdir(), 'escape.png') } });
    expect(outside.isError).toBe(true);
    expect((outside.content as { text: string }[])[0]!.text).toMatch(/inside the server's working directory/);
  });

  it('an image over ~1 MB is not sent as a block; the summary says to pass path or a lower scale', async () => {
    const target = await live(big);
    for (const name of ['export', 'screenshot']) {
      const result = await target.callTool({ name, arguments: {} });
      expect(result.content, name).toHaveLength(1);
      const text = (result.content as { text: string }[])[0]!.text;
      expect(text.length, name).toBeLessThan(2000);
      expect(text, name).toMatch(/lower scale/);
    }
  });
});

describe('which document a call means', () => {
  it('targets the document opened or created last when documentId is omitted, and names real tools when there is none', async () => {
    const target = await client();
    await expect(call(target, 'list_pages', {})).rejects.toThrow(/openflow_create/);
    await call(target, 'openflow_create', { name: 'First' });
    const { id: second } = await call(target, 'openflow_create', { name: 'Second' });
    expect(await call(target, 'list_pages', {})).toMatchObject({ documentId: second });
    await expect(call(target, 'list_pages', { documentId: 'nope' })).rejects.toThrow(/Use openflow_create or openflow_open/);
  });
});

describe('page targeting', () => {
  const C4 = 'architecture\nmodel {\n  person Customer\n  system Shop { container Web; container API; Web -> API }\n  Customer -> Shop.Web : uses\n}\nviews { view context of Shop; view container of Shop }\n';
  type Page = { pageId: string; nodes: { id: string; kind: string; x: number; label: string }[] };

  it('every page-scoped op takes a pageId in file mode', async () => {
    const target = await client();
    const { id: documentId } = await call(target, 'openflow_create', { name: 'Two pages' });
    const created = await run(target, 'create_diagram', { documentId, dsl: C4 });
    const second = (created.views as { pageId: string; frameId: string }[])[1]!;
    const page = async () => await run(target, 'get_document', { documentId, pageId: second.pageId }) as Page;
    const shape = (await page()).nodes.find(({ kind }) => kind !== 'frame')!;

    await call(target, 'move', { documentId, pageId: second.pageId, ids: [shape.id], delta: { x: 40, y: 0 } });
    expect((await page()).nodes.find(({ id }) => id === shape.id)!.x).toBe(shape.x + 40);
    await call(target, 'style', { documentId, pageId: second.pageId, ids: [shape.id], fill: '#112233' });
    const added = await run(target, 'add_shape', { documentId, pageId: second.pageId, kind: 'rectangle', label: 'Note' });
    expect((await page()).nodes.map(({ id }) => id)).toContain(added.id);
    await call(target, 'delete', { documentId, pageId: second.pageId, ids: [added.id] });
    expect((await page()).nodes.map(({ id }) => id)).not.toContain(added.id);
    const updated = await run(target, 'update_diagram', { documentId, pageId: second.pageId, frameId: second.frameId, dsl: C4.replace('container API', 'container Api2') });
    // A workspace update rewrites every view; finding the frame at all needed the pageId.
    expect((updated.views as { pageId: string }[]).map(({ pageId }) => pageId)).toContain(second.pageId);
    // Frame ids are unique across pages: without a pageId the op finds the frame's own page.
    expect(((await run(target, 'update_diagram', { documentId, frameId: second.frameId, dsl: C4 })).views as { pageId: string }[]).map(({ pageId }) => pageId)).toContain(second.pageId);
  });

  it('passes the pageId to the paired editor', async () => {
    const calls: { op: string; pageId?: string }[] = [];
    const bridge = {
      connected: true,
      health: () => ({ connected: true, pages: [] }),
      call: async (op: string, _input: unknown, pageId?: string) => { calls.push({ op, ...(pageId ? { pageId } : {}) }); return {}; },
    } as unknown as LiveBridge;
    const { server } = createServerWithDeps({ bridge, log: () => undefined });
    const live = new Client({ name: 'test', version: '0.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), live.connect(a)]);
    await call(live, 'move', { pageId: 'p2', ids: ['n1'], delta: { x: 1, y: 0 } });
    await call(live, 'move', { ids: ['n1'], delta: { x: 1, y: 0 } });
    expect(calls).toEqual([{ op: 'move', pageId: 'p2' }, { op: 'move' }]);
  });
});

describe('Mermaid in', () => {
  it('create_diagram takes Mermaid, returns the DSL it became, and get_diagram reads that DSL back', async () => {
    const target = await client();
    const { id: documentId } = await call(target, 'openflow_create', { name: 'Mermaid doc' });
    const diagram = await run(target, 'create_diagram', {
      documentId, dsl: '```mermaid\nflowchart LR\n  A[Client] -->|HTTPS| B(API)\n  B --> C[(Postgres)]\n```',
    });
    expect(diagram).toMatchObject({ nodes: 3, connectors: 2, converted: { from: 'mermaid', losses: [] } });
    const read = await run(target, 'get_diagram', { documentId });
    expect(read.dsl).toBe((diagram.converted as { dsl: string }).dsl);
  });

  it('validate_openflow_dsl answers Mermaid with its Mermaid line, and names what converts', async () => {
    const target = await client();
    const broken = await call(target, 'validate_openflow_dsl', { dsl: 'flowchart TD\n  A --> B\n  A[Start --> C' });
    // Not converted around the broken edge: an error on its Mermaid line, so the agent fixes it.
    expect(broken).toMatchObject({ ok: false, diagnostics: [{ code: 'E004', line: 3 }] });
    const gantt = await call(target, 'validate_openflow_dsl', { dsl: 'gantt\n  title Plan' });
    expect(gantt).toMatchObject({ ok: false, diagnostics: [{ code: 'E003', message: expect.stringMatching(/Convertible: flowchart/) }] });
    const { id: documentId } = await call(target, 'openflow_create', { name: 'Pie' });
    await expect(call(target, 'create_diagram', { documentId, dsl: 'pie\n  "a" : 1' })).rejects.toThrow(/"pie" cannot be converted/);
  });

  it('no longer ships the convert-Mermaid prompt', async () => {
    const { prompts } = await (await client()).listPrompts();
    expect(prompts.map(({ name }) => name)).toEqual(['flowchart_from_description', 'architecture_from_codebase']);
  });
});

describe('icon art in file mode', () => {
  it('exports the icons a diagram draws as inline art, explicit and inferred, in SVG and animated SVG', async () => {
    const target = await client();
    const { id: documentId } = await call(target, 'openflow_create', { name: 'Icons' });
    const diagram = await run(target, 'create_diagram', { documentId, dsl: 'architecture\n  API [aws/lambda] -> Orders DB\n  API -> Users [icon: tabler/user]' });
    expect(diagram.inferredIcons).toEqual([expect.objectContaining({ label: 'Orders DB' })]);
    for (const format of ['svg', 'svg-animated']) {
      const exported = await run(target, 'export', { documentId, format, scope: 'page' });
      const [file] = exported.files as { text: string }[];
      expect(file!.text.match(/<image href="data:image\/svg\+xml/g)?.length, format).toBe(3);
    }
  });
});
