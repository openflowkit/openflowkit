import { expect, test, type Page } from './test';

// Discussions: Figma-style comments pinned on the canvas. They are document data (saved, reloaded, carried with the node)
// but never undo steps of their own. OFK_SHOTS_DIR=<dir> also writes screenshots.

const SHOTS = process.env.OFK_SHOTS_DIR;
type V2Api = {
  getState(): { nodes: string[]; revision: number; save: string };
  getNodeRect(id: string): { x: number; y: number; width: number; height: number } | null;
  getDocument(): { pages: { threads?: { resolved: boolean; anchor: { nodeId: string | null; point: { x: number } }; comments: { body: string; author: { kind: string; name: string } }[] }[] }[] };
};
const api = <T,>(page: Page, run: (v2: V2Api) => T) => page.evaluate(`(${run.toString()})(window.__V2__)`) as Promise<T>;
const threads = (page: Page) => api(page, (v2) => v2.getDocument().pages[0]!.threads ?? []);
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function start(page: Page, preferences: Record<string, unknown> = {}): Promise<{ id: string; centre: { x: number; y: number } }> {
  await page.addInitScript((value) => localStorage.setItem('openflowkit-v2-preferences', JSON.stringify({ theme: 'dark', ...value })), preferences);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForFunction(() => window.__V2__?.getState());
  // The opening cover lies over the canvas until the renderer has drawn.
  await expect(page.locator('[data-cover]')).toHaveCount(0, { timeout: 15_000 });
  await page.getByTestId('v2-canvas').focus();
  // The first press right after load can land before the renderer takes input: arm and click again until a shape is there.
  await expect(async () => {
    await page.keyboard.press('r');
    await page.mouse.click(520, 360);
    expect((await api(page, (v2) => v2.getState())).nodes.length).toBe(1);
  }).toPass({ timeout: 15_000, intervals: [1000] });
  await page.keyboard.press('Escape');
  const id = (await api(page, (v2) => v2.getState())).nodes[0]!;
  const rect = (await page.evaluate((nodeId) => window.__V2__!.getNodeRect(nodeId), id))!;
  return { id, centre: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
}

async function comment(page: Page, at: { x: number; y: number }, text: string): Promise<void> {
  await page.keyboard.press('c');
  await page.mouse.click(at.x, at.y);
  const box = page.getByTestId('v2-comment-composer').getByRole('textbox', { name: 'Comment' });
  await expect(box).toBeFocused();
  await box.fill(text);
  await box.press('Enter');
}

test('press C, click a node, type, Enter: a pin appears, survives a reload, and follows the node', { tag: '@gate' }, async ({ page }) => {
  const { id, centre } = await start(page);
  await comment(page, centre, 'Why is this a queue?');
  const pin = page.getByTestId('v2-comment-pin');
  await expect(pin).toHaveCount(1);
  expect(await threads(page)).toMatchObject([{ anchor: { nodeId: id }, resolved: false, comments: [{ body: 'Why is this a queue?', author: { kind: 'human', name: 'User' } }] }]);
  await expect(pin.getByRole('button', { name: 'Comment by User' })).toBeVisible();
  await expect(pin.locator('.ofk-comment-avatar svg')).toHaveCount(1);
  // The tip of the pin is where it was clicked.
  const before = (await pin.boundingBox())!;
  expect(Math.abs(before.x - centre.x)).toBeLessThan(2);
  expect(Math.abs(before.y + before.height - centre.y)).toBeLessThan(2);
  await shot(page, 'comment-pin');

  // The shape moves, the pin goes with it.
  await page.keyboard.press('v');
  await page.mouse.move(centre.x - 30, centre.y + 10);
  await page.mouse.down();
  await page.mouse.move(centre.x + 70, centre.y + 90, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => ((await pin.boundingBox())!.x - before.x)).toBeGreaterThan(80);
  const moved = (await pin.boundingBox())!;
  expect(Math.round(moved.y - before.y)).toBeGreaterThan(70);

  // The pin follows a pan of the camera as the shape does.
  const node = (await page.evaluate((nodeId) => window.__V2__!.getNodeRect(nodeId), id))!;
  const pinned = (await pin.boundingBox())!;
  await page.mouse.move(centre.x + 200, centre.y + 150);
  await page.mouse.wheel(-120, -80);
  await expect.poll(async () => (await page.evaluate((nodeId) => window.__V2__!.getNodeRect(nodeId), id))!.x).not.toBe(node.x);
  const panned = (await page.evaluate((nodeId) => window.__V2__!.getNodeRect(nodeId), id))!;
  await expect.poll(async () => Math.round((await pin.boundingBox())!.x - pinned.x)).toBe(Math.round(panned.x - node.x));
  expect(Math.round((await pin.boundingBox())!.y - pinned.y)).toBe(Math.round(panned.y - node.y));

  // Saved with the document: reload only once the save has landed.
  await expect.poll(async () => (await api(page, (v2) => v2.getState())).save).toBe('saved');
  await page.reload();
  await page.waitForFunction(() => window.__V2__?.getState());
  await expect(page.getByTestId('v2-comment-pin')).toHaveCount(1);
});

test('the pin opens its thread: reply, edit, resolve hides the pin and keeps the thread in the document', async ({ page }) => {
  const { centre } = await start(page);
  await comment(page, centre, 'First');
  await page.getByTestId('v2-comment-pin').getByRole('button').click();
  const thread = page.getByTestId('v2-comment-thread');
  await expect(thread.getByRole('heading', { name: 'Comment' })).toBeVisible();
  await expect(thread.getByTestId('v2-comment-message')).toHaveCount(1);
  await expect(thread).toContainText('Just now');

  const reply = thread.getByRole('textbox', { name: 'Reply' });
  await reply.fill('Second line one');
  await reply.press('Shift+Enter');
  await reply.type('line two');
  await reply.press('Enter');
  await expect(thread.getByTestId('v2-comment-message')).toHaveCount(2);
  await expect(thread.getByTestId('v2-comment-message').nth(1)).toContainText('line two');
  await shot(page, 'comment-thread');

  // Edit the reply from its menu.
  await thread.getByTestId('v2-comment-message').nth(1).getByRole('button', { name: 'Comment actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const edit = thread.getByRole('textbox', { name: 'Edit comment' });
  await edit.fill('Edited');
  await edit.press('Enter');
  await expect(thread.getByTestId('v2-comment-message').nth(1)).toContainText('Edited');
  await expect(thread.getByTestId('v2-comment-message').nth(1)).toContainText('edited');

  await thread.getByRole('button', { name: 'Resolve thread' }).click();
  await expect(page.getByTestId('v2-comment-pin')).toHaveCount(0);
  expect(await threads(page)).toMatchObject([{ resolved: true, comments: [{ body: 'First' }, { body: 'Edited' }] }]);
});

test('deleting a thread asks first, in the app and not in the browser', async ({ page }) => {
  const { centre } = await start(page);
  page.on('dialog', () => { throw new Error('a browser dialog opened'); });
  await comment(page, centre, 'Gone soon');
  await page.getByTestId('v2-comment-pin').getByRole('button').click();
  const thread = page.getByTestId('v2-comment-thread');
  await thread.getByRole('button', { name: 'Thread actions' }).click();
  await page.getByRole('menuitem', { name: /Delete thread/ }).click();
  await thread.getByRole('button', { name: 'Cancel' }).click();
  expect(await threads(page)).toHaveLength(1);
  await thread.getByRole('button', { name: 'Thread actions' }).click();
  await page.getByRole('menuitem', { name: /Delete thread/ }).click();
  await thread.getByRole('button', { name: 'Delete thread' }).click();
  await expect(page.getByTestId('v2-comment-pin')).toHaveCount(0);
  expect(await threads(page)).toHaveLength(0);
});

test('undo never removes a comment, and a comment adds no undo step', async ({ page }) => {
  const { centre } = await start(page);
  await comment(page, centre, 'Stays');
  await expect(page.getByTestId('v2-comment-pin')).toHaveCount(1);
  await page.getByTestId('v2-canvas').focus();
  await page.keyboard.press('ControlMeta+z'.replace('ControlMeta', process.platform === 'darwin' ? 'Meta' : 'Control'));
  // The undo took the rectangle, not the comment.
  await expect.poll(async () => (await api(page, (v2) => v2.getState())).nodes.length).toBe(0);
  await expect(page.getByTestId('v2-comment-pin')).toHaveCount(1);
  expect(await threads(page)).toHaveLength(1);
});

test('Esc and clicking away cancel the composer; an empty comment cannot be sent', async ({ page }) => {
  const { centre } = await start(page);
  await page.keyboard.press('c');
  await page.mouse.click(centre.x, centre.y);
  const composer = page.getByRole('dialog', { name: 'New comment' });
  const box = composer.getByRole('textbox', { name: 'Comment' });
  await expect(box).toBeFocused();
  await expect(composer.getByRole('button', { name: 'Send comment' })).toBeDisabled();
  await box.fill('   ');
  await box.press('Enter');
  await expect(composer).toBeVisible();
  expect(await threads(page)).toHaveLength(0);
  await box.press('Escape');
  await expect(composer).toHaveCount(0);

  await page.getByTestId('v2-canvas').focus();
  await page.mouse.click(centre.x, centre.y);
  await expect(composer).toBeVisible();
  await page.mouse.click(centre.x + 300, centre.y + 200);
  await expect(composer).toHaveCount(0);
  expect(await threads(page)).toHaveLength(0);
});

test('the comment tool stays active after posting; a second click starts a second thread; Esc leaves it', async ({ page }) => {
  const { centre } = await start(page);
  await comment(page, centre, 'First');
  await expect(page.getByTestId('v2-comment-pin')).toHaveCount(1);
  // No second press of C: the tool is still the comment tool.
  await page.mouse.click(centre.x + 200, centre.y + 150);
  const box = page.getByTestId('v2-comment-composer').getByRole('textbox', { name: 'Comment' });
  await expect(box).toBeFocused();
  await box.fill('Second');
  await box.press('Enter');
  await expect(page.getByTestId('v2-comment-pin')).toHaveCount(2);
  expect(await threads(page)).toMatchObject([{ comments: [{ body: 'First' }] }, { comments: [{ body: 'Second' }] }]);
  // Clicking an existing pin opens its thread, not a new composer.
  await page.getByTestId('v2-comment-pin').first().getByRole('button').click();
  await expect(page.getByTestId('v2-comment-thread')).toBeVisible();
  await expect(page.getByTestId('v2-comment-composer')).toHaveCount(0);
  // Esc leaves the tool: a click on the canvas no longer starts a thread.
  await page.getByTestId('v2-canvas').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.mouse.click(centre.x + 200, centre.y - 150);
  await expect(page.getByTestId('v2-comment-composer')).toHaveCount(0);
  expect(await threads(page)).toHaveLength(2);
});

test('a thread is placed, written and sent with the keyboard alone', async ({ page }) => {
  const { id, centre } = await start(page);
  await page.getByTestId('v2-canvas').focus();
  // C arms the tool; Enter is its click, at the selected shape or else the middle of the canvas. No pointer event.
  await page.keyboard.press('c');
  await page.keyboard.press('Enter');
  const box = page.getByTestId('v2-comment-composer').getByRole('textbox', { name: 'Comment' });
  await expect(box).toBeFocused();
  await box.fill('From the keyboard');
  await box.press('Enter');
  await expect(page.getByTestId('v2-comment-pin')).toHaveCount(1);
  expect(await threads(page)).toMatchObject([{ anchor: { nodeId: null }, comments: [{ body: 'From the keyboard' }] }]);
  // Sending hands focus back to the canvas, so the next key is the canvas's.
  await expect(page.getByTestId('v2-canvas')).toBeFocused();

  // With a shape selected the thread anchors to it. Sending handed focus back to the canvas.
  await page.keyboard.press('v');
  await page.mouse.click(centre.x, centre.y);
  // A blank shape takes typed letters as its name; a named one keeps its tool letters.
  await page.keyboard.press('Enter');
  await page.keyboard.type('Queue');
  await page.keyboard.press('Enter');
  await page.getByTestId('v2-canvas').focus();
  await page.keyboard.press('c');
  await page.keyboard.press('Enter');
  await page.getByTestId('v2-comment-composer').getByRole('textbox', { name: 'Comment' }).fill('On the shape');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('v2-comment-pin')).toHaveCount(2);
  expect((await threads(page))[1]).toMatchObject({ anchor: { nodeId: id } });

  // The pin itself is a button: Alt+Arrow moves it, Enter opens its thread.
  const pinButton = page.getByTestId('v2-comment-pin').first().getByRole('button', { name: /^Comment by/ });
  const x = (await threads(page))[0]!.anchor.point.x;
  await pinButton.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(async () => (await threads(page))[0]!.anchor.point.x).toBe(x + 8);
  await pinButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('v2-comment-thread')).toBeVisible();
});
