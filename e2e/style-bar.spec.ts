import { expect, test } from './test';

type NodeDebug = { readonly id: string; readonly fill: number; readonly textColor?: number };
type V2Api = { getState(): { nodes: string[] }; getNodeDebugSnapshot(): readonly NodeDebug[] | undefined };
const fills = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as unknown as { __V2__?: V2Api }).__V2__?.getNodeDebugSnapshot() ?? []).map((n) => n.fill));
const count = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __V2__?: V2Api }).__V2__?.getState().nodes.length ?? 0);
const textColors = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as unknown as { __V2__?: V2Api }).__V2__?.getNodeDebugSnapshot() ?? [])
    .filter((node) => node.textColor !== undefined).map((node) => node.textColor));

const BLUE_PASTEL = 0xeff6ff;

test('free text uses adaptive ink until user pins a colour', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.waitForSelector('[data-testid="v2-canvas"]');
  await page.mouse.click(400, 300);
  await page.keyboard.press('t');
  await page.mouse.click(400, 300);
  await page.keyboard.type('Adaptive');
  await expect(page.getByRole('textbox', { name: 'Edit node label' })).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.keyboard.press('Meta+Enter');
  await expect.poll(() => textColors(page)).toEqual([0xffffff]);

  await page.locator('[data-context-bar]').getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('radio', { name: 'Red', exact: true }).click();
  await expect.poll(() => textColors(page)).not.toEqual([0xffffff]);
});

// phase-1-style acceptance 1, 11, 12: a palette swatch recolours the shape as
// one undo step, and the next shape inherits the last style.
test('fill swatch recolours the shape, undoes as one step, and sticks to the next shape', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="v2-canvas"]');
  await page.mouse.click(400, 300);
  await page.keyboard.press('r');
  await page.mouse.click(400, 300);
  await expect.poll(() => count(page)).toBe(1);

  await page.locator('[data-context-bar]').getByRole('button', { name: 'Fill' }).click();
  await page.getByRole('radio', { name: 'Blue', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect.poll(() => fills(page)).toEqual([BLUE_PASTEL]);

  await page.keyboard.press('Meta+z');
  await expect.poll(() => fills(page)).not.toEqual([BLUE_PASTEL]);
  await page.keyboard.press('Meta+Shift+z');
  await expect.poll(() => fills(page)).toEqual([BLUE_PASTEL]);

  await page.keyboard.press('Escape');
  await page.mouse.click(900, 600);
  await page.keyboard.press('r');
  await page.mouse.click(700, 500);
  await expect.poll(() => count(page)).toBe(2);
  await expect.poll(() => fills(page)).toEqual([BLUE_PASTEL, BLUE_PASTEL]);
});

// Enter used to commit and then blur into a second, stale commit: an uncaught precondition error (the fixture fails on it).
test('typing an opacity and pressing Enter commits once, with no page error, as one undo step @gate', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="v2-canvas"]');
  await page.mouse.click(400, 300);
  await page.keyboard.press('r');
  await page.mouse.click(400, 300);
  await expect.poll(() => count(page)).toBe(1);
  await page.locator('[data-context-bar]').getByRole('button', { name: 'Fill', exact: true }).click();
  const opacity = page.getByRole('dialog', { name: 'Fill', exact: true }).getByRole('spinbutton', { name: 'Opacity', exact: true });
  await opacity.fill('40');
  await opacity.press('Enter');
  await expect(opacity).toHaveValue('40');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+z');
  await page.locator('[data-context-bar]').getByRole('button', { name: 'Fill', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Fill', exact: true }).getByRole('spinbutton', { name: 'Opacity', exact: true })).toHaveValue('100');
});

test('right-click selects the shape and opens its menu; ⌘G groups two shapes', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="v2-canvas"]');
  await page.mouse.click(300, 300);
  await page.keyboard.press('r'); await page.mouse.click(300, 300);
  await page.keyboard.press('Escape'); await page.mouse.click(900, 600);
  await page.keyboard.press('r'); await page.mouse.click(600, 420);
  await page.keyboard.press('Escape'); await page.mouse.click(900, 600);
  await expect.poll(() => count(page)).toBe(2);

  await page.mouse.click(300, 300, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Canvas actions' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Transform' }).click();
  await expect(page.getByRole('menu', { name: 'Transform', exact: true }).getByRole('menuitem', { name: 'Flip horizontal' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(menu.getByRole('menuitem', { name: 'Reorder' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await page.keyboard.down('Shift'); await page.mouse.click(600, 420); await page.keyboard.up('Shift');
  await page.keyboard.press('Meta+g');
  await expect.poll(() => count(page)).toBe(3);
  await page.keyboard.press('Meta+Shift+g');
  await expect.poll(() => count(page)).toBe(2);
});

for (const theme of ['light', 'dark'] as const) {
  test(`refined style panels and cascading menus in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await page.waitForSelector('[data-testid="v2-canvas"]');
    await page.mouse.click(400, 300);
    await page.keyboard.press('r');
    await page.mouse.click(400, 300);
    await expect.poll(() => count(page)).toBe(1);
    const bar = page.locator('[data-context-bar]');
    await expect(bar.getByRole('button', { name: 'Position', exact: true })).toHaveCount(0);
    await bar.getByRole('button', { name: 'Text', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Text', exact: true });
    const box = await panel.boundingBox();
    expect(box!.height).toBeLessThan(540);
    expect(box!.width).toBeLessThanOrEqual(320);
    const font = panel.getByRole('button', { name: /Font family/ });
    await expect(font).toBeVisible();
    await font.click();
    await expect(page.getByRole('listbox', { name: 'Font family' })).toBeVisible();
    await page.keyboard.press('Escape');
    const glyphColor = await bar.locator('.ofk-style-glyph').evaluate((el) => getComputedStyle(el).color);
    const themeColor = await bar.evaluate((el) => getComputedStyle(el).color);
    expect(glyphColor).toBe(themeColor);
    await panel.getByRole('radio', { name: 'White', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(panel.getByRole('radio', { name: 'Mid gray', exact: true })).toBeFocused();
    await expect(panel.getByRole('radiogroup', { name: 'Line height', exact: true })).toBeHidden();
    await panel.getByText('Spacing', { exact: true }).click();
    await expect(panel.getByRole('radiogroup', { name: 'Line height', exact: true })).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: `test-results/style-${theme}.png` });
    await page.keyboard.press('Escape');
    await bar.getByRole('button', { name: 'Fill', exact: true }).click();
    const fill = page.getByRole('dialog', { name: 'Fill', exact: true });
    await expect(fill.getByRole('spinbutton', { name: 'Opacity', exact: true })).toBeVisible();
    await fill.getByRole('button', { name: 'Decrease Opacity', exact: true }).click();
    await expect(fill.getByRole('spinbutton', { name: 'Opacity', exact: true })).toHaveValue('90');
    await page.keyboard.press('Meta+z');
    await expect(fill.getByRole('spinbutton', { name: 'Opacity', exact: true })).toHaveValue('100');
    await page.keyboard.press('Meta+Shift+z');
    await expect(fill.getByRole('spinbutton', { name: 'Opacity', exact: true })).toHaveValue('90');
    await page.screenshot({ animations: 'disabled', path: `test-results/fill-${theme}.png` });
    await page.keyboard.press('Escape');
    await bar.getByRole('button', { name: 'Outline', exact: true }).click();
    const outline = page.getByRole('dialog', { name: 'Outline', exact: true });
    const outlineStyle = outline.getByRole('radiogroup', { name: 'Outline style' });
    const outlineBox = (await outlineStyle.boundingBox())!;
    const selectedStyleBox = (await outlineStyle.getByRole('radio', { name: '—' }).locator('..').boundingBox())!;
    expect(selectedStyleBox.x).toBeGreaterThan(outlineBox.x);
    expect(selectedStyleBox.y).toBeGreaterThan(outlineBox.y);
    await page.screenshot({ animations: 'disabled', path: `test-results/outline-${theme}.png` });
    await page.keyboard.press('Escape');
    await bar.getByRole('button', { name: 'Arrange', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: `test-results/arrange-${theme}.png` });
    await page.keyboard.press('Escape');
    await bar.getByRole('button', { name: 'More options', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'Canvas actions' }).getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.click(400, 300, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Canvas actions' });
    expect((await menu.boundingBox())!.height).toBeLessThan(540);
    await menu.getByRole('menuitem', { name: 'Reorder' }).focus();
    await page.keyboard.press('ArrowRight');
    const submenu = page.getByRole('menu', { name: 'Reorder', exact: true });
    await expect(submenu.getByRole('menuitem', { name: 'Bring to front' })).toBeVisible();
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Back', exact: true })).toHaveCount(0);
    const parentBox = (await menu.boundingBox())!;
    const childBox = (await submenu.boundingBox())!;
    expect(childBox.x).toBeGreaterThan(parentBox.x + parentBox.width - 8);
    await page.screenshot({ animations: 'disabled', path: `test-results/menu-${theme}.png` });
    await page.keyboard.press('ArrowLeft');
    await expect(menu.getByRole('menuitem', { name: 'Reorder', exact: true })).toBeFocused();
    await expect(submenu).toBeHidden();
    await menu.getByRole('menuitem', { name: 'Reorder', exact: true }).hover();
    await expect(submenu).toBeVisible();
    await submenu.getByRole('menuitem', { name: 'Bring to front' }).click();
    await expect(menu).toBeHidden();
    await page.mouse.click(400, 300, { button: 'right' });
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
}

test('submenu flips at the right edge, Escape closes one level, outside closes all', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 720 });
  await page.goto('/');
  await page.waitForSelector('[data-testid="v2-canvas"]');
  // Focus by keyboard: at 700px the welcome's stacked actions and its Map repo field cover the
  // canvas; an armed tool sends the welcome aside, so the click then draws.
  await page.getByTestId('v2-canvas').focus();
  await page.keyboard.press('r');
  await page.mouse.click(400, 600);
  await expect.poll(() => count(page)).toBe(1);
  await page.mouse.click(400, 600, { button: 'right' });
  const parent = page.getByRole('menu', { name: 'Canvas actions' });
  const trigger = parent.getByRole('menuitem', { name: 'Reorder', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowRight');
  const child = page.getByRole('menu', { name: 'Reorder', exact: true });
  await expect(child.getByRole('menuitem', { name: 'Bring to front' })).toBeFocused();
  expect((await child.boundingBox())!.x).toBeLessThan((await parent.boundingBox())!.x);
  await page.keyboard.press('Escape');
  await expect(child).toBeHidden();
  await expect(parent).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(child).toBeVisible();
  await page.mouse.click(50, 600);
  await expect(parent).toBeHidden();
  await expect(child).toBeHidden();
});

for (const theme of ['light', 'dark'] as const) {
  test(`custom color swatch opens nested picker in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await page.waitForSelector('[data-testid="v2-canvas"]');
    await page.mouse.click(400, 300);
    await page.keyboard.press('r');
    await page.mouse.click(400, 300);
    await expect.poll(() => count(page)).toBe(1);
    await page.locator('[data-context-bar]').getByRole('button', { name: 'Fill', exact: true }).click();
    const parent = page.getByRole('dialog', { name: 'Fill', exact: true });
    const trigger = parent.getByRole('button', { name: 'Custom color', exact: true });
    const before = await parent.boundingBox();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const picker = page.getByRole('dialog', { name: 'Custom color', exact: true });
    await expect(picker.getByRole('slider', { name: 'Saturation and brightness' })).toBeVisible();
    await picker.getByRole('textbox', { name: 'Hex', exact: true }).fill('123456');
    await page.keyboard.press('Enter');
    await expect.poll(() => fills(page)).toEqual([0x123456]);
    await expect(parent).toBeVisible();
    expect(Math.abs((await parent.boundingBox())!.height - before!.height)).toBeLessThan(16);
    await page.screenshot({ animations: 'disabled', path: `test-results/custom-color-${theme}.png` });
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(parent).toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+z');
    await expect.poll(() => fills(page)).not.toEqual([0x123456]);
  });
}

test('a custom navy fill gets a white label @gate', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="v2-canvas"]');
  await page.mouse.click(400, 300);
  await page.keyboard.press('r');
  await page.mouse.click(400, 300);
  await expect.poll(() => count(page)).toBe(1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Navy');
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.locator('[data-context-bar]').getByRole('button', { name: 'Fill', exact: true }).click();
  await page.getByRole('dialog', { name: 'Fill', exact: true }).getByRole('button', { name: 'Custom color', exact: true }).click();
  const hex = page.getByRole('dialog', { name: 'Custom color', exact: true }).getByRole('textbox', { name: 'Hex', exact: true });
  await hex.fill('1e3a5f');
  await hex.press('Enter');
  await expect.poll(() => fills(page)).toEqual([0x1e3a5f]);
  // The label's ink is reported once the shape is drawn at rest: close the pickers and let go of the selection.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.mouse.click(900, 600);
  await expect.poll(() => textColors(page)).toEqual([0xffffff]);
});
