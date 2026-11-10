import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from './test';

// Home → Import opens draw.io files in the dark theme: every page, readable labels, losses and a broken file said in the toast.
// npx playwright test e2e/drawio-import.spec.ts --headed

const fixture = (name: string) => {
  const file = test.info().outputPath(name);
  writeFileSync(file, readFileSync(`src/services/dsl/fixtures/drawio/${name}`));
  return file;
};

/** Every node's label and painted ink on the open page, once the canvas has drawn them. */
const inks = (page: Page) => page.evaluate(() => {
  const api = (window as unknown as { __V2__?: {
    getDocument(): { pages: { nodes: { id: string; content: { label?: unknown } }[] }[] } | null;
    getNodeDebugSnapshot(): { id: string; textColor?: number }[] | undefined;
  } }).__V2__;
  const painted = new Map((api?.getNodeDebugSnapshot() ?? []).map(({ id, textColor }) => [id, textColor]));
  // Only the open page is painted, so a node with no painted ink is on another page.
  return (api?.getDocument()?.pages.flatMap((each) => each.nodes) ?? [])
    .filter((node) => typeof node.content.label === 'string' && node.content.label && painted.has(node.id))
    .map((node) => ({ label: node.content.label as string, ink: painted.get(node.id) }));
});

test('draw.io’s AWS template opens in the dark theme with every label readable, and its losses said @gate', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('openflowkit-v2-preferences', JSON.stringify({ theme: 'dark' })));
  await page.goto('/#/home');
  await page.locator('input[type="file"]').setInputFiles(fixture('multi-page.drawio'));
  // The importer loads on the first import: on a cold dev server its modules take seconds to arrive.
  await expect(page.getByText('Imported 1 diagram')).toBeVisible({ timeout: 20_000 });
  // The toast names the first losses and counts the rest.
  await expect(page.getByText(/multi-page\.drawio: 5 things didn’t come across: Page 1: 8 right-angle connectors .* icons from draw\.io’s “aws4” set .* and 2 more\./)).toBeVisible();
  await page.getByRole('list', { name: 'Diagrams' }).locator('.ofk-home-card-hit', { hasText: 'multi-page' }).click();
  await expect.poll(() => page.url()).toContain('#/d/');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __V2__?: { getDocument(): { pages: unknown[] } | null } })
    .__V2__?.getDocument()?.pages.length)).toBe(2);

  // Page 1 is the flowchart: white words on deep fills stay white.
  await expect.poll(async () => (await inks(page)).find((node) => node.label === 'Project')?.ink, { timeout: 20_000 }).toBe(0xffffff);

  // Page 2 is AWS: its navy captions (drawn for a white page) are white on the dark canvas.
  await page.getByRole('button', { name: /^Pages/ }).click();
  await page.getByRole('dialog', { name: 'Pages', exact: true }).getByRole('button', { name: 'Page 2', exact: true }).click();
  await expect.poll(async () => (await inks(page)).find((node) => node.label === 'Bucket')?.ink, { timeout: 20_000 }).toBe(0xffffff);
  const dark = (await inks(page)).filter((node) => node.ink !== undefined && node.ink < 0x404040);
  expect(dark.map((node) => node.label)).toEqual([]);
});

test('a broken draw.io file is named in the toast and nothing is added @gate', async ({ page }) => {
  await page.goto('/#/home');
  const file = test.info().outputPath('broken.drawio');
  writeFileSync(file, '<mxfile host="app.diagrams.net"><diagram id="a" name="Page-1"><mxGraphModel><root><mxCell id="0"/>');
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText(/broken\.drawio: It isn’t a readable draw\.io file/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('list', { name: 'Diagrams' }).locator('.ofk-home-card-hit', { hasText: 'broken' })).toHaveCount(0);
});
