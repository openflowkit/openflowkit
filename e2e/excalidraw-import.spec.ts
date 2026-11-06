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
  await expect(page.getByText('Imported 1 diagram')).toBeVisible();
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
