import { expect, test, type Page } from './test';
import { clickNode, drawShape, openCanvas, state } from './helpers';

// WebMCP: a browser agent calls the editor's tools through document.modelContext. No browser ships it on by
// default yet, so a page-side stand-in (spec-shaped: registerTool(tool, { signal }), abort unregisters) records
// what the editor registers, and the test calls `execute` the way the browser would, JSON-serialising the result.

const FLOW = 'flowchart\n  Client -> API\n  API -> Store';

async function installModelContext(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tools = new Map<string, { execute: (input: object, options: object) => Promise<unknown> }>();
    const context = {
      registerTool(tool: { name: string; execute: (input: object, options: object) => Promise<unknown> }, options?: { signal?: AbortSignal }) {
        if (tools.has(tool.name)) return Promise.reject(new DOMException(`"${tool.name}" is registered`, 'InvalidStateError'));
        tools.set(tool.name, tool);
        options?.signal?.addEventListener('abort', () => tools.delete(tool.name));
        return Promise.resolve();
      },
    };
    Object.defineProperty(Document.prototype, 'modelContext', { configurable: true, get: () => context });
    Object.assign(window, {
      __webmcp: {
        names: () => [...tools.keys()],
        tool: (name: string) => tools.get(name),
        call: async (name: string, input: object) => JSON.parse(JSON.stringify(await tools.get(name)!.execute(input, { signal: new AbortController().signal }))),
      },
    });
  });
}

interface WebMcpTool { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean } }
interface Stand { names(): string[]; tool(name: string): WebMcpTool | undefined; call(name: string, input: object): Promise<unknown> }

const names = (page: Page) => page.evaluate(() => (window as unknown as { __webmcp: Stand }).__webmcp.names());
const call = <T = Record<string, unknown>>(page: Page, name: string, input: object = {}) =>
  page.evaluate(([tool, args]) => (window as unknown as { __webmcp: Stand }).__webmcp.call(tool as string, args as object), [name, input] as const) as Promise<T>;

test('a browser agent draws with create_diagram, ⌘Z takes it back in one step, and get_document sees the selection @gate', async ({ page }) => {
  await installModelContext(page);
  await openCanvas(page);
  await expect.poll(() => names(page), { timeout: 10_000 }).toEqual(expect.arrayContaining(['create_diagram', 'get_document', 'get_view', 'select']));
  const registered = await names(page);
  expect(registered).toHaveLength(22);
  // The schema the agent sees is plain JSON Schema, with read hints from the manifest.
  const create = await page.evaluate(() => {
    const tool = (window as unknown as { __webmcp: Stand }).__webmcp.tool('create_diagram')!;
    return { schema: JSON.stringify(tool.inputSchema), readOnly: tool.annotations?.readOnlyHint };
  });
  expect(create.schema).toContain('"dsl"');
  expect(create.schema).not.toContain('$ref');
  expect(create.readOnly).toBe(false);

  const before = (await state(page)).nodes.length;
  const made = await call<{ frameId?: string; error?: string }>(page, 'create_diagram', { dsl: FLOW });
  expect(made.error).toBeUndefined();
  expect(made.frameId).toBeTruthy();
  await expect.poll(async () => (await state(page)).nodes).toContain(made.frameId);
  expect((await state(page)).nodes.length).toBeGreaterThan(before + 3);

  // One agent call is one undo step.
  await page.getByTestId('v2-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await state(page)).nodes.length).toBe(before);

  // "The box I selected": the person selects, the agent reads it.
  const box = await drawShape(page, 'r', 420, 320);
  await clickNode(page, box);
  await expect.poll(async () => (await state(page)).selectedNodes).toEqual([box]);
  const read = await call<{ selection: string[] }>(page, 'get_document');
  expect(read.selection).toEqual([box]);
});

test('get_view says what the person sees, select shows them what the agent means, and the panel names WebMCP @gate', async ({ page }) => {
  await installModelContext(page);
  await openCanvas(page);
  await expect.poll(() => names(page), { timeout: 10_000 }).toContain('select');
  const one = await drawShape(page, 'r', 360, 300);
  const two = await drawShape(page, 'r', 640, 300);
  await page.getByTestId('v2-canvas').focus();
  await page.keyboard.press('Escape');

  const picked = await call(page, 'select', { ids: [one, two] });
  expect(picked).toMatchObject({ selected: [one, two] });
  await expect.poll(async () => (await state(page)).selectedNodes.sort()).toEqual([one, two].sort());
  const view = await call<{ mode: string; selection: { id: string }[]; onScreen: { id: string }[]; camera: { zoom: number } }>(page, 'get_view');
  expect(view.mode).toBe('canvas');
  expect(view.selection.map(({ id }) => id).sort()).toEqual([one, two].sort());
  expect(view.onScreen.map(({ id }) => id)).toEqual(expect.arrayContaining([one, two]));
  expect(view.camera.zoom).toBeGreaterThan(0);
  expect(await call(page, 'select', { ids: ['not-here'] })).toMatchObject({ error: expect.stringContaining('not-here') });
  // A screenshot comes back as data the agent can read, not a download.
  const shot = await call<{ mime: string; base64: string }>(page, 'screenshot', { scale: 1 });
  expect(shot.mime).toBe('image/png');
  expect(shot.base64.slice(0, 8)).toBe('iVBORw0K');

  await page.getByRole('toolbar', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Connect agent', exact: true }).click();
  await expect(page.getByTestId('webmcp-status')).toHaveText('WebMCP (experimental): agents in this browser can use 22 tools.');
});

test('without WebMCP in the browser the panel says nothing about it @gate', async ({ page }) => {
  await openCanvas(page);
  await page.getByRole('toolbar', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Connect agent', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy prompt' })).toBeVisible();
  await expect(page.getByTestId('webmcp-status')).toHaveCount(0);
});
