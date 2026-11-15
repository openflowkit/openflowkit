import { readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { expect, test, type Page } from './test';

// Home → Download all diagrams, then Import (and the editor's Open file…) brings every diagram back; Home search reads
// box labels; a link's title names the copy.
// npx playwright test e2e/backup.spec.ts

const link = (dsl: string, title: string) =>
  `/#/from/dsl?d=${deflateRawSync(Buffer.from(dsl, 'utf8')).toString('base64url')}&t=${encodeURIComponent(title)}`;
const doc = (page: Page) => page.evaluate(() => (window as unknown as { __V2__: { getDocument(): { name: string; pages: { nodes: unknown[] }[] } | null } }).__V2__?.getDocument() ?? null);

async function draw(page: Page, title: string, dsl: string): Promise<void> {
  await page.goto(link(dsl, title));
  await expect.poll(() => page.url(), { timeout: 20_000 }).toContain('#/d/');
  await expect.poll(async () => ((await doc(page))?.pages[0]?.nodes.length ?? 0), { timeout: 20_000 }).toBeGreaterThan(1);
}

test('a link’s title names the copy it opens @gate', async ({ page }) => {
  await draw(page, 'Checkout flow', 'flowchart\nCart -> Stripe -> Receipt\n');
  expect((await doc(page))?.name).toBe('Checkout flow');
});

test('Download all diagrams writes one file that Import and Open file… bring back @gate', async ({ page }) => {
  await draw(page, 'Checkout flow', 'flowchart\nCart -> Stripe -> Receipt\n');
  await page.waitForTimeout(1_500); // autosave
  await draw(page, 'Auth', 'flowchart\nLogin -> Session\n');
  await page.waitForTimeout(1_500);
  await page.goto('/#/home');
  const cards = page.getByRole('list', { name: 'Diagrams' }).locator('.ofk-home-card-hit');
  await expect(cards).toHaveCount(2);

  // Search reads box labels, not only titles.
  const search = page.getByRole('searchbox', { name: 'Search diagrams' });
  await search.fill('stripe');
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveText('Checkout flow');
  await search.fill('');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all diagrams' }).click();
  // Saved under its own name: the browser's temp path has no extension, and Import goes by it.
  const file = test.info().outputPath((await download).suggestedFilename());
  await (await download).saveAs(file);
  expect(file).toMatch(/openflowkit-diagrams-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = JSON.parse(readFileSync(file, 'utf8')) as { format: string; version: number; documents: { name: string }[] };
  expect(backup).toMatchObject({ format: 'openflowkit.backup', version: 1 });
  expect(backup.documents.map(({ name }) => name).sort()).toEqual(['Auth', 'Checkout flow']);

  // Home → Import: every document comes back as a copy beside the original.
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText('Imported 2 diagrams')).toBeVisible();
  await expect(cards).toHaveCount(4);

  // The editor's Open file… takes the same file, and says where it went.
  await page.goto('/');
  await page.getByRole('button', { name: 'Canvas menu' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Open file…' }).click();
  await (await chooser).setFiles(file);
  await expect.poll(() => page.url()).toContain('#/home');
  await expect(cards).toHaveCount(6);
});

test('Open file… takes a text diagram and names it after the file @gate', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="v2-canvas"]')).toBeVisible();
  const before = page.url();
  await page.getByRole('button', { name: 'Canvas menu' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Open file…' }).click();
  await (await chooser).setFiles({ name: 'orders.mmd', mimeType: 'text/plain', buffer: Buffer.from('flowchart LR\nA --> B\n') });
  await expect.poll(() => page.url()).not.toBe(before);
  await expect.poll(async () => (await doc(page))?.name, { timeout: 20_000 }).toBe('orders');
  await expect.poll(async () => ((await doc(page))?.pages[0]?.nodes.length ?? 0), { timeout: 20_000 }).toBeGreaterThan(1);
});

test('Zoom to fit keeps the diagram between Layers and the code panel on a small laptop @gate', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await draw(page, 'Wide', `flowchart right\n${Array.from({ length: 8 }, (_, i) => `N${i}`).join(' -> ')}\n`);
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  // The link opens the code panel beside the drawing.
  await expect(page.getByRole('textbox', { name: 'Diagram source' })).toBeVisible();
  const left = await page.getByRole('complementary', { name: 'Layers' }).boundingBox();
  const right = await page.getByRole('complementary').filter({ has: page.getByRole('textbox', { name: 'Diagram source' }) }).boundingBox();
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForTimeout(800);
  const rects = await page.evaluate(() => {
    const api = (window as unknown as { __V2__: { getDocument(): { pages: { nodes: { id: string }[] }[] }; getNodeRect(id: string): { x: number; width: number } | null } }).__V2__;
    return api.getDocument().pages[0]!.nodes.flatMap(({ id }) => api.getNodeRect(id) ?? []);
  });
  expect(rects.length).toBeGreaterThan(6);
  expect(Math.min(...rects.map(({ x }) => x)), 'left edge clear of Layers').toBeGreaterThanOrEqual(left!.x + left!.width);
  expect(Math.max(...rects.map(({ x, width }) => x + width)), 'right edge clear of the code panel').toBeLessThanOrEqual(right!.x);
});

test('Home → Import opens a draw.io file with every page, and says what didn’t come across', async ({ page }) => {
  await page.goto('/#/home');
  const file = test.info().outputPath('checkout.drawio');
  writeFileSync(file, readFileSync('src/services/dsl/fixtures/drawio/flow.drawio'));
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText('Imported 1 diagram')).toBeVisible();
  await expect(page.getByText(/1 thing didn’t come across/)).toBeVisible();
  const card = page.getByRole('list', { name: 'Diagrams' }).locator('.ofk-home-card-hit', { hasText: 'checkout' });
  await card.click();
  await expect.poll(() => page.url()).toContain('#/d/');
  await expect.poll(async () => (await doc(page))?.pages.length ?? 0, { timeout: 20_000 }).toBe(2);
  expect((await doc(page))?.name).toBe('checkout');
});
