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
  // Everything comes across: the AWS icons, the connectors, and the colours as drawn.
  await expect(page.getByText(/multi-page\.drawio: .* didn’t come across/)).toHaveCount(0);
  await page.getByRole('list', { name: 'Diagrams' }).locator('.ofk-home-card-hit', { hasText: 'multi-page' }).click();
  await expect.poll(() => page.url()).toContain('#/d/');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __V2__?: { getDocument(): { pages: unknown[] } | null } })
    .__V2__?.getDocument()?.pages.length)).toBe(2);

  // Page 1 is the flowchart. As in draw.io's dark mode, its deep fills turn light and their white words dark:
  // our canvas's dark, where draw.io uses its own page's.
  await expect.poll(async () => (await inks(page)).find((node) => node.label === 'Project')?.ink, { timeout: 20_000 }).toBe(0x191b19);

  // Page 2 is AWS: its navy captions (drawn for a white page) turn light grey on the dark canvas, as draw.io draws them.
  await page.getByRole('button', { name: /^Pages/ }).click();
  await page.getByRole('dialog', { name: 'Pages', exact: true }).getByRole('button', { name: 'Page 2', exact: true }).click();
  await expect.poll(async () => (await inks(page)).find((node) => node.label === 'Bucket' && node.ink !== undefined)?.ink, { timeout: 20_000 }).toBe(0xbfc9d6);
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
