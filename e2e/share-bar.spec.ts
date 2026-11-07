import { expect, test } from './test';
import { openCanvas } from './helpers';

// The top-right bar mirrors the document bar: same top line, the workspace rail hangs below it
// with the same gap the creation rail keeps under the document bar.

const box = async (locator: import('@playwright/test').Locator) => (await locator.boundingBox())!;
const bar = (page: import('@playwright/test').Page) => page.getByRole('toolbar', { name: 'Share and export', exact: true });

test.beforeEach(async ({ page }) => { await openCanvas(page); });

test('the bar sits on the document bar line and the rail hangs below it with the left gap @gate', async ({ page }) => {
  const [doc, right, rail, tools] = await Promise.all([
    box(page.getByRole('toolbar', { name: 'Document', exact: true })),
    box(bar(page)),
    box(page.getByRole('toolbar', { name: 'Workspace', exact: true })),
    box(page.getByRole('toolbar', { name: 'Create', exact: true })),
  ]);
  expect(Math.abs(right.y - doc.y), 'same top').toBeLessThanOrEqual(1);
  expect(Math.abs(right.height - doc.height), 'same height').toBeLessThanOrEqual(1);
  expect(Math.abs((rail.y - (right.y + right.height)) - (tools.y - (doc.y + doc.height))), 'same gap below').toBeLessThanOrEqual(1);
  expect(Math.abs((page.viewportSize()!.width - (right.x + right.width)) - doc.x), 'same edge inset').toBeLessThanOrEqual(1);
});

test('Export opens the files and Share opens the two kinds of link @gate', async ({ page }) => {
  const exportButton = bar(page).getByRole('button', { name: 'Export', exact: true });
  await exportButton.click();
  const exportPanel = page.getByRole('dialog', { name: 'Export' });
  await expect(exportPanel.getByRole('button', { name: 'Download' })).toBeVisible();
  await expect(exportPanel.getByRole('button', { name: /link/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await bar(page).getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share' });
  await expect(share.getByRole('radio', { name: /View-only link/ })).toBeChecked();
  // A blank page has no code, so the editable copy says why it is off.
  await expect(share.getByRole('radio', { name: /Editable copy/ })).toBeDisabled();
  await expect(share.getByRole('button', { name: 'Copy view-only link' })).toBeVisible();
  await expect(share.getByRole('button', { name: 'Download' })).toHaveCount(0);
});

test('an editable link carries the diagram’s code and opens as a new copy @gate', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('toolbar', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Diagram as code' }).click();
  const source = page.getByRole('textbox', { name: 'Diagram source' });
  await source.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('flowchart right\nCart -> Payment -> Receipt');
  await page.getByRole('button', { name: /^Generate diagram/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __V2__: { getDocument(): { pages: { nodes: unknown[] }[] } } })
    .__V2__.getDocument().pages[0]!.nodes.length)).toBeGreaterThan(2);
  await bar(page).getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share' });
  await share.getByRole('radio', { name: /Editable copy/ }).check();
  await share.getByRole('button', { name: 'Copy editable link' }).click();
  await expect(page.getByText('Editable link copied')).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('#/from/dsl?d=');
  const copy = await context.newPage();
  await copy.goto(link);
  await expect.poll(() => copy.url(), { timeout: 20_000 }).toContain('#/d/');
  await expect(copy.getByRole('textbox', { name: 'Diagram source' })).toHaveValue(/Cart -> Payment -> Receipt/);
});

test('an editable link keeps the palette picked in the code panel @gate', async ({ page, context, browser }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  type Api = { getNodeDebugSnapshot(): readonly { readonly fill: number }[] | undefined };
  const fills = (target: typeof page) => target.evaluate(() => ((window as unknown as { __V2__?: Api }).__V2__?.getNodeDebugSnapshot() ?? []).map((node) => node.fill));
  await page.getByRole('toolbar', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Diagram as code' }).click();
  const source = page.getByRole('textbox', { name: 'Diagram source' });
  await source.fill('flowchart right\nCart [blue] -> Payment [emerald]');
  await page.getByRole('radio', { name: 'Mono', exact: true }).check();
  await page.getByRole('button', { name: /^Generate diagram/ }).click();
  await expect.poll(async () => (await fills(page)).length).toBe(3);
  const drawn = await fills(page);
  await bar(page).getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share' });
  await share.getByRole('radio', { name: /Editable copy/ }).check();
  await share.getByRole('button', { name: 'Copy editable link' }).click();
  await expect(page.getByText('Editable link copied')).toBeVisible();
  // Someone else's browser: the picker's remembered palette is the sender's, not theirs.
  const copy = await (await browser.newContext()).newPage();
  await copy.goto(await page.evaluate(() => navigator.clipboard.readText()));
  await expect.poll(() => copy.url(), { timeout: 20_000 }).toContain('#/d/');
  await expect.poll(async () => (await fills(copy)).length).toBe(3);
  expect(await fills(copy)).toEqual(drawn);
});

test('a right panel keeps the bar and the rail to its left @gate', async ({ page }) => {
  await page.getByRole('toolbar', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Diagram as code' }).click();
  const panel = await box(page.getByRole('complementary').first());
  for (const target of [bar(page), page.getByRole('toolbar', { name: 'Workspace', exact: true })]) {
    const at = await box(target);
    expect(at.x + at.width, 'left of the panel').toBeLessThanOrEqual(panel.x);
  }
});

test('on a narrow window the bar hides and the menu keeps Share… and Export… @gate', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(bar(page)).toBeHidden();
  await page.getByRole('button', { name: 'Canvas menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Share…' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Export…' })).toBeVisible();
});

test('with a panel open at 900px the bars never overlap @gate', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.getByRole('toolbar', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Diagram as code' }).click();
  const shareBar = bar(page);
  if (await shareBar.isVisible()) {
    const [doc, right] = [await box(page.getByRole('toolbar', { name: 'Document', exact: true })), await box(shareBar)];
    expect(doc.x + doc.width).toBeLessThanOrEqual(right.x);
  }
  await page.getByRole('button', { name: 'Canvas menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Share…' })).toBeVisible();
});
