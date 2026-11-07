import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from './test';

// Home → Import opens an Excalidraw export where it was drawn, and Excalidraw's copied shapes paste onto the canvas.
// npx playwright test e2e/excalidraw-import.spec.ts

interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
interface Drawn {
  readonly nodes: readonly { readonly id: string; readonly kind: string; readonly label: string; readonly rect: Rect | null }[];
  readonly connectors: readonly { readonly target: string | null }[];
}

/** The open page's nodes with their labels and on-screen boxes, and where its connectors end. */
const drawn = (page: Page): Promise<Drawn> => page.evaluate(() => {
  const api = (window as unknown as { __V2__?: {
    getDocument(): { pages: { nodes: { id: string; kind: string; content: { label?: unknown } }[]; connectors: { target: { nodeId: string | null } }[] }[] } | null;
    getNodeRect(id: string): Rect | null;
  } }).__V2__;
  const current = api?.getDocument()?.pages[0];
  return {
    nodes: (current?.nodes ?? []).map((node) => ({
      id: node.id, kind: node.kind, label: typeof node.content.label === 'string' ? node.content.label : '', rect: api!.getNodeRect(node.id),
    })),
    connectors: (current?.connectors ?? []).map((connector) => ({ target: connector.target.nodeId })),
  };
});

test('Home → Import opens an Excalidraw drawing where it was drawn, and its copied shapes paste @gate', async ({ page }) => {
  await page.goto('/#/home');
  const file = test.info().outputPath('architecture.excalidraw');
  writeFileSync(file, readFileSync('src/services/dsl/fixtures/excalidraw/architecture.excalidraw'));
  await page.locator('input[type="file"]').setInputFiles(file);
  // The importer loads on the first import: on a cold dev server its modules take seconds to arrive.
  await expect(page.getByText('Imported 1 diagram')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/hatched fills are drawn solid/)).toBeVisible();
  await page.getByRole('list', { name: 'Diagrams' }).locator('.ofk-home-card-hit', { hasText: 'architecture' }).click();
  await expect.poll(() => page.url()).toContain('#/d/');
  // The document arrives before the canvas has painted it: wait until the three boxes checked below are on screen.
  const painted = async () => {
    const { nodes } = await drawn(page);
    return ['API\nGateway', 'CDN', 'Media\nService'].every((label) => nodes.find((node) => node.label === label)?.rect);
  };
  await expect.poll(painted, { timeout: 20_000 }).toBe(true);

  const scene = await drawn(page);
  const named = (label: string) => scene.nodes.find((node) => node.label === label);
  const gateway = named('API\nGateway');
  const cdn = named('CDN');
  const media = named('Media\nService');
  // The gateway's text is its label, not a node of its own; free text is a text node.
  expect(gateway?.kind).toBe('process');
  expect(cdn?.kind).toBe('text');
  // On the canvas, as drawn: the CDN left of the media service, the gateway below both.
  for (const node of [gateway, cdn, media]) expect(node?.rect, node?.label).not.toBeNull();
  expect(cdn!.rect!.x).toBeLessThan(media!.rect!.x);
  expect(gateway!.rect!.y).toBeGreaterThan(cdn!.rect!.y + cdn!.rect!.height);
  // The four arrows drawn into the gateway are tied to it.
  expect(scene.connectors.filter((connector) => connector.target === gateway!.id)).toHaveLength(4);

  // Shapes copied in Excalidraw paste as ours, as one more box on the page.
  const before = scene.nodes.length;
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', JSON.stringify({ type: 'excalidraw/clipboard', files: {}, elements: [{
      id: 'pasted', type: 'rectangle', x: 0, y: 0, width: 120, height: 60, angle: 0, strokeColor: '#1e1e1e',
      backgroundColor: '#b2f2bb', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', opacity: 100, isDeleted: false,
    }, {
      // Tied to the box at one end only: its free end pastes too.
      id: 'half', type: 'arrow', x: 120, y: 30, width: 100, height: 0, points: [[0, 0], [100, 0]], angle: 0, strokeColor: '#1e1e1e',
      strokeWidth: 2, opacity: 100, isDeleted: false, startBinding: { elementId: 'pasted' }, endBinding: null, endArrowhead: 'arrow',
    }] }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect.poll(async () => (await drawn(page)).nodes.length).toBe(before + 1);
  expect((await drawn(page)).connectors).toHaveLength(scene.connectors.length + 1);
});

test('Excalidraw’s copied shapes paste into an ordinary new diagram @gate', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('v2-canvas')).toBeVisible();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', JSON.stringify({ type: 'excalidraw/clipboard', files: {}, elements: [{
      id: 'pasted', type: 'rectangle', x: 0, y: 0, width: 120, height: 60, angle: 0, isDeleted: false,
    }] }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await expect.poll(async () => (await drawn(page)).nodes.length).toBe(1);
});

// Excalidraw's clipboard JSON, as its copy puts it on the clipboard, handed to the canvas as a paste.
const element = { angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2,
  strokeStyle: 'solid', opacity: 100, roundness: null, isDeleted: false, groupIds: [], frameId: null };
const paste = (page: Page, elements: readonly object[]) => page.evaluate((json) => {
  const data = new DataTransfer();
  data.setData('text/plain', json);
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
}, JSON.stringify({ type: 'excalidraw/clipboard', files: {}, elements: elements.map((item) => ({ ...element, ...item })) }));
const state = (page: Page) => page.evaluate(() => (window as unknown as { __V2__?: {
  getState(): { nodes: string[]; connectors: string[]; selectedConnectors: string[] };
} }).__V2__?.getState() ?? { nodes: ['not ready'], connectors: [], selectedConnectors: [] });

async function freshDiagram(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('v2-canvas')).toBeVisible();
  await expect.poll(async () => (await state(page)).nodes.length).toBe(0);
}

test('Excalidraw labels and words read on the dark canvas @gate', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('openflowkit-v2-preferences', JSON.stringify({ theme: 'dark' })));
  await page.goto('/#/home');
  const file = test.info().outputPath('labels.excalidraw');
  const box = (id: string, x: number, backgroundColor: string, y = 0, opacity = 100) =>
    ({ ...element, id, type: 'rectangle', x, y, width: 160, height: 80, backgroundColor, opacity });
  const words = (id: string, x: number, y: number, text: string, containerId: string | null) =>
    ({ ...element, id, type: 'text', x, y, width: 120, height: 25, text, originalText: text, fontSize: 20, containerId });
  writeFileSync(file, JSON.stringify({ type: 'excalidraw', version: 2, elements: [
    box('plain', 0, 'transparent'), words('plain-label', 20, 28, 'default box', 'plain'),
    box('white', 200, '#ffffff'), words('white-label', 220, 28, 'white box', 'white'),
    box('under', 400, '#ffffff'), words('free', 420, 28, 'free on white', null),
    // A white card on a pastel zone, and a blue fill at 30% (slate grey on the dark canvas): white words on both.
    { ...box('zone', 0, '#ffec99', 120), width: 400, height: 160 }, box('card', 20, '#ffffff', 140), words('on-card', 40, 168, 'on a card', null),
    box('faint', 420, '#a5d8ff', 140, 30), words('faint-label', 440, 168, 'faint', 'faint'),
    box('under-faint', 620, '#a5d8ff', 140, 30), words('on-faint', 640, 168, 'free on faint', null),
  ], files: {} }));
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText('Imported 1 diagram')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('list', { name: 'Diagrams' }).locator('.ofk-home-card-hit', { hasText: 'labels' }).click();
  // Default ink on the dark canvas (no fill, or a white fill the dark theme washes) is drawn white, not #1e1e1e.
  const inks = () => page.evaluate(() => {
    const api = (window as unknown as { __V2__?: { getNodeDebugSnapshot(): { id: string; textColor?: number }[] | undefined } }).__V2__;
    return Object.fromEntries((api?.getNodeDebugSnapshot() ?? []).map(({ id, textColor }) => [id, textColor]));
  });
  await expect.poll(inks, { timeout: 20_000 }).toMatchObject({ plain: 0xffffff, white: 0xffffff, free: 0xffffff,
    'on-card': 0xffffff, faint: 0xffffff, 'on-faint': 0xffffff });
});

test('a bent Excalidraw arrow pastes with its shape in one undo step @gate', async ({ page }) => {
  await freshDiagram(page);
  await paste(page, [
    { id: 's', type: 'rectangle', x: 0, y: 0, width: 160, height: 80, backgroundColor: '#ffec99' },
    { id: 'bend', type: 'arrow', x: 160, y: 40, width: 200, height: 100, points: [[0, 0], [100, 100], [200, 0]],
      startBinding: { elementId: 's' }, endBinding: null, endArrowhead: 'triangle' },
  ]);
  await expect.poll(async () => { const { nodes, connectors } = await state(page); return [nodes.length, connectors.length]; }).toEqual([1, 1]);
  const bends = await page.evaluate(() => (window as unknown as { __V2__: { getDocument(): { pages: { connectors: { waypoints: unknown[] }[] }[] } } })
    .__V2__.getDocument().pages[0]!.connectors[0]!.waypoints.length);
  expect(bends).toBe(1);
  await page.getByTestId('v2-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => { const { nodes, connectors } = await state(page); return [nodes.length, connectors.length]; }).toEqual([0, 0]);
});

test('Excalidraw arrows copied without their shapes paste as selected connectors @gate', async ({ page }) => {
  await freshDiagram(page);
  await paste(page, [{ id: 'a', type: 'arrow', x: 0, y: 0, width: 100, height: 0, points: [[0, 0], [100, 0]], endArrowhead: 'arrow' }]);
  await expect.poll(async () => { const { nodes, connectors, selectedConnectors } = await state(page); return [nodes.length, connectors.length, selectedConnectors.length]; })
    .toEqual([0, 1, 1]);
});

test('a pasted Excalidraw sketch selects its loose arrows with its shapes, so Delete takes them all @gate', async ({ page }) => {
  await freshDiagram(page);
  await paste(page, [
    { id: 'box', type: 'rectangle', x: 0, y: 0, width: 160, height: 80 },
    { id: 'loose', type: 'arrow', x: 0, y: 120, width: 160, height: 0, points: [[0, 0], [160, 0]], endArrowhead: 'arrow' },
  ]);
  await expect.poll(async () => { const { nodes, connectors, selectedConnectors } = await state(page); return [nodes.length, connectors.length, selectedConnectors.length]; })
    .toEqual([1, 1, 1]);
  await page.keyboard.press('Delete');
  await expect.poll(async () => { const { nodes, connectors } = await state(page); return [nodes.length, connectors.length]; }).toEqual([0, 0]);
});

test('a hand-made Excalidraw frame inside itself pastes as a frame, with no page error @gate', async ({ page }) => {
  await freshDiagram(page);
  await paste(page, [{ id: 'f', type: 'frame', x: 0, y: 0, width: 200, height: 200, name: 'Loop', frameId: 'f' }]);
  await expect.poll(async () => (await state(page)).nodes.length).toBe(1);
});

test('Excalidraw clipboard losses and an empty copy are said in a toast @gate', async ({ page }) => {
  await freshDiagram(page);
  await paste(page, [{ id: 'g', type: 'rectangle', x: 0, y: 0, width: 80, height: 40, groupIds: ['group'] }]);
  await expect(page.getByText('Pasted from Excalidraw')).toBeVisible();
  await expect(page.getByText(/groups come in as separate shapes/)).toBeVisible();
  await paste(page, [{ id: 'gone', type: 'rectangle', x: 0, y: 0, width: 80, height: 40, isDeleted: true }]);
  await expect(page.getByText('Nothing to paste from Excalidraw')).toBeVisible();
  expect((await state(page)).nodes).toHaveLength(1);
});

test('Open file… on an Excalidraw drawing titles its losses as an import @gate', async ({ page }) => {
  await freshDiagram(page);
  await page.getByRole('button', { name: 'Canvas menu' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Open file…' }).click();
  await (await chooser).setFiles({ name: 'sketch.excalidraw', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    type: 'excalidraw', version: 2, files: {}, elements: [{ ...element, id: 'g', type: 'rectangle', x: 0, y: 0, width: 80, height: 40, groupIds: ['group'] }],
  })) });
  await expect(page.getByText('Imported 1 diagram')).toBeVisible();
  await expect(page.getByText(/sketch\.excalidraw: 1 thing didn’t come across/)).toBeVisible();
  await expect(page.getByText('Opened, with a repair')).toHaveCount(0);
});

