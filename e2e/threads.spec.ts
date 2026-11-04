import { expect, test, type Page } from './test';

// The Threads panel: every thread of the document in one list. It searches, filters, opens a thread on the canvas
// (switching page and bringing the pin into view), tracks what is unread in this browser, and copies / follows links.
// OFK_SHOTS_DIR=<dir> also writes screenshots.

const SHOTS = process.env.OFK_SHOTS_DIR;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

interface Doc { id: string; pages: { id: string; name: string; nodes: { id: string; content: Record<string, unknown> }[]; threads?: unknown[] }[] }
type V2Api = { getState(): { nodes: string[] }; getDocument(): Doc | null; getNodeRect(id: string): { x: number; y: number; width: number; height: number } | null };
const doc = (page: Page) => page.evaluate(() => (window as unknown as { __V2__: V2Api }).__V2__.getDocument()) as Promise<Doc>;
const threadsOf = async (page: Page) => ((await doc(page)) ?? { pages: [] }).pages.flatMap((p) => (p.threads ?? []) as { id: string; number: number; resolved: boolean }[]);

const SEED_NOW = Date.UTC(2026, 9, 26, 12, 0); // a fixed instant: every run seeds identical data
const ago = (minutes: number) => new Date(SEED_NOW - minutes * 60_000).toISOString();
const NODE_LABEL = 'Session updateComments';

/** A drawing with a rectangle on Page 1 and an empty Page 2, to build a document from. */
async function drawn(page: Page): Promise<Doc> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __V2__?: V2Api }).__V2__?.getState());
  await expect(page.locator('[data-cover]')).toHaveCount(0, { timeout: 15_000 });
  await page.getByTestId('v2-canvas').focus();
  await expect(async () => {
    await page.keyboard.press('r');
    await page.mouse.click(520, 360);
    expect((await page.evaluate(() => (window as unknown as { __V2__: V2Api }).__V2__.getState())).nodes.length).toBe(1);
  }).toPass({ timeout: 15_000, intervals: [1000] });
  await page.keyboard.press('Escape');
  return doc(page);
}

const human = { kind: 'human', name: 'User' };
const agent = { kind: 'agent', name: 'Claude Code' };
const message = (id: string, author: object, body: string, minutes: number) => ({ id, author, body, createdAt: ago(minutes) });
const pin = { nodeId: null, offset: null };

/** Four threads over two pages: #1 answered by the agent (unread), #2 far from the node and unanswered, #3 resolved, #4 on Page 2 and unanswered. */
function seeded(base: Doc) {
  const [first] = base.pages as unknown as Record<string, unknown>[];
  const node = (first!.nodes as { id: string; content: Record<string, unknown> }[])[0]!;
  const { translation } = (node as unknown as { transform: { translation: { x: number; y: number } } }).transform;
  const origin = { x: translation.x, y: translation.y };
  const withLabel = (first!.nodes as typeof base.pages[0]['nodes']).map((n, i) => (i === 0 ? { ...n, content: { ...n.content, label: NODE_LABEL } } : n));
  return {
    ...base,
    pages: [
      { ...first, nodes: withLabel, threads: [
        { id: 'thread-1', number: 1, resolved: false, anchor: { nodeId: node.id, offset: { x: 10, y: 10 }, point: { x: origin.x + 10, y: origin.y + 10 } },
          comments: [message('m1', human, 'Why is this a queue?', 180), message('m2', agent, 'Latency: the queue absorbs bursts.', 10)] },
        { id: 'thread-2', number: 2, resolved: false, anchor: { ...pin, point: { x: 3200, y: 2400 } }, comments: [message('m3', human, 'Rename the cache layer', 120)] },
        { id: 'thread-3', number: 3, resolved: true, anchor: { ...pin, point: { x: 200, y: -200 } },
          comments: [message('m4', human, 'Old question about the DNS', 1500), message('m5', agent, 'Fixed in the last pass.', 1490)] },
      ] },
      { ...first, id: 'page-two', name: 'Page 2', nodes: [], connectors: [], threads: [
        { id: 'thread-4', number: 4, resolved: false, anchor: { ...pin, point: { x: 400, y: 300 } }, comments: [message('m6', human, 'Check the retry policy', 30)] },
      ] },
    ],
  };
}

/** Opens a document with these threads through Open file…, which keeps thread ids and numbers. */
async function open(page: Page): Promise<string> {
  const document = seeded(await drawn(page));
  await page.getByRole('button', { name: 'Canvas menu' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Open file…' }).click();
  await (await chooser).setFiles({ name: 'threads.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect.poll(async () => (await threadsOf(page)).length, { timeout: 15_000 }).toBe(4);
  await expect(page.locator('[data-cover]')).toHaveCount(0, { timeout: 15_000 });
  return (await doc(page)).id;
}

/** The document as autosave stored it: the one place a reload reads from. */
const persistedThreads = (page: Page, id: string) => page.evaluate((docId) => new Promise<number>((resolve) => {
  const request = indexedDB.open('openflowkit-persistence');
  request.onsuccess = () => {
    const db = request.result;
    const get = db.transaction('v2Documents', 'readonly').objectStore('v2Documents').get(docId);
    get.onsuccess = () => {
      db.close();
      const record = get.result as { document: { pages: { threads?: unknown[] }[] } } | undefined;
      resolve(record ? record.document.pages.reduce((total, p) => total + (p.threads?.length ?? 0), 0) : 0);
    };
  };
}), id);
const panel = (page: Page) => page.getByTestId('v2-threads-panel');
const cards = (page: Page) => panel(page).getByTestId('v2-thread-card');
const card = (page: Page, number: number) => cards(page).filter({ hasText: new RegExp(`#${number} ·`) });
const openPanel = async (page: Page) => {
  await page.getByRole('button', { name: /^Threads/ }).click();
  await expect(panel(page)).toBeVisible();
};
const order = (page: Page) => cards(page).evaluateAll((items) => items.map((item) => item.getAttribute('data-thread-id')));

test('the panel opens with C and from the toolbar button, which counts the open threads', { tag: '@gate' }, async ({ page }) => {
  await drawn(page);
  await expect(panel(page)).toHaveCount(0);
  // No threads yet: the button carries no count and the panel says so.
  await expect(page.getByRole('button', { name: 'Threads', exact: true })).toBeVisible();
  await page.getByTestId('v2-canvas').focus();
  await page.keyboard.press('c');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: 'Threads', exact: true })).toBeVisible();
  await expect(panel(page).getByTestId('v2-threads-empty')).toContainText('No threads yet');
  // Closable, and the comment tool still on leaves it closed.
  await panel(page).getByRole('button', { name: 'Close threads' }).click();
  await expect(panel(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Threads', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  // It shares the slot with the AI assistant: one at a time.
  await page.getByRole('button', { name: 'AI assistant' }).click();
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Threads', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'AI assistant' })).toHaveCount(0);
});

test('the toolbar button shows how many threads are open, and the panel lists them newest activity first', async ({ page }) => {
  await open(page);
  // Three are open (#1, #2, #4); #3 is resolved.
  const button = page.getByRole('button', { name: /^Threads, 3 open$/ });
  await expect(button).toHaveAttribute('data-count', '3');
  await button.click();
  await expect(cards(page)).toHaveCount(3);
  // #1 replied 10m ago, #4 30m ago, #2 2h ago.
  expect(await order(page)).toEqual(['thread-1', 'thread-4', 'thread-2']);
  const first = card(page, 1);
  await expect(first).toContainText('#1 · Page 1');
  await expect(first).toContainText('User');
  await expect(first).toContainText('Why is this a queue?');
  await expect(first).toContainText('1 reply');
  await expect(card(page, 4)).toContainText('#4 · Page 2');
  await expect(card(page, 4)).not.toContainText('repl');
});

test('search reads every comment of every thread on every page', async ({ page }) => {
  await open(page);
  await openPanel(page);
  const search = panel(page).getByRole('searchbox', { name: 'Search threads' });
  // Only the agent's reply in #1 says "bursts".
  await search.fill('BURSTS');
  expect(await order(page)).toEqual(['thread-1']);
  await search.fill('retry');
  expect(await order(page)).toEqual(['thread-4']);
  await search.fill('zzz');
  await expect(panel(page).getByTestId('v2-threads-empty')).toContainText('Nothing matches');
  await panel(page).getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(cards(page)).toHaveCount(3);
  // Esc empties the box before it closes the panel.
  await search.fill('cache');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(panel(page)).toBeVisible();
});

test('Show resolved and Unanswered only are off by default, combine, and are remembered', async ({ page }) => {
  await open(page);
  await openPanel(page);
  await panel(page).getByRole('button', { name: 'Filter threads' }).click();
  const showResolved = page.getByRole('menuitemcheckbox', { name: 'Show resolved' });
  const unanswered = page.getByRole('menuitemcheckbox', { name: 'Unanswered only' });
  await expect(showResolved).toHaveAttribute('aria-checked', 'false');
  await expect(unanswered).toHaveAttribute('aria-checked', 'false');

  await showResolved.click();
  await expect(cards(page)).toHaveCount(4);
  expect(await order(page)).toEqual(['thread-1', 'thread-4', 'thread-2', 'thread-3']);
  await expect(card(page, 3)).toContainText('Resolved');
  // #1 and #3 were answered by the agent; #2 and #4 wait on someone.
  await unanswered.click();
  expect(await order(page)).toEqual(['thread-4', 'thread-2']);
  await page.keyboard.press('Escape');

  // Remembered with the other preferences.
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __V2__?: V2Api }).__V2__?.getState());
  await openPanel(page);
  expect(await order(page)).toEqual(['thread-4', 'thread-2']);
  await panel(page).getByRole('button', { name: 'Filter threads' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Unanswered only' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Show resolved' }).click();
  expect(await order(page)).toEqual(['thread-1', 'thread-4', 'thread-2']);
});

test('a card switches page, brings its pin into view, opens the thread, and marks it read', async ({ page }) => {
  await open(page);
  await openPanel(page);
  // #4 is on Page 2.
  await expect(page.getByTestId('v2-comment-pin')).toHaveCount(2);
  await card(page, 4).getByRole('button', { name: /Check the retry policy/ }).click();
  const thread = page.getByTestId('v2-comment-thread');
  await expect(thread).toBeVisible();
  await expect(thread).toContainText('Check the retry policy');
  await expect(page.getByTestId('v2-comment-pin')).toHaveCount(1);
  await expect(card(page, 4)).toHaveAttribute('data-selected', 'true');
  await expect(card(page, 1)).not.toHaveAttribute('data-selected', 'true');

  // #2 is pinned far off screen on Page 1: the camera goes to it.
  await card(page, 2).getByRole('button', { name: /Rename the cache layer/ }).click();
  await expect(thread).toContainText('Rename the cache layer');
  const view = page.viewportSize()!;
  await expect.poll(async () => {
    const box = await page.locator('.ofk-comment-pin[data-selected]').boundingBox();
    return !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height;
  }).toBe(true);

  // Opening reads it: #1's unread dot goes when its thread opens.
  await expect(card(page, 1)).toHaveAttribute('data-unread', 'true');
  await card(page, 1).getByRole('button', { name: /Why is this a queue/ }).click();
  await expect(thread).toContainText('Latency: the queue absorbs bursts.');
  await expect(card(page, 1)).not.toHaveAttribute('data-unread', 'true');

  // A request is answered once: close the popover, leave Canvas and come back, and it stays closed.
  await thread.getByRole('button', { name: 'Close thread' }).click();
  await page.getByRole('group', { name: 'View mode' }).getByRole('button', { name: 'Map' }).click();
  await page.getByRole('group', { name: 'View mode' }).getByRole('button', { name: 'Canvas' }).click();
  await expect(page.getByTestId('v2-comment-pin')).not.toHaveCount(0);
  await expect(thread).toHaveCount(0);
});

test('Tab reaches the panel\'s search, filter, a card and its actions in order', async ({ page }) => {
  await open(page);
  const rail = page.getByRole('button', { name: /^Threads/ });
  await rail.focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  const first = cards(page).first();
  await expect(panel(page).getByRole('button', { name: 'Close threads' })).toBeFocused(); // opening from the rail focuses the panel
  for (const stop of [
    panel(page).getByRole('searchbox', { name: 'Search threads' }),
    panel(page).getByRole('button', { name: 'Filter threads' }),
    first.locator('.ofk-threads-card-main'),
    first.getByRole('button', { name: /^(Resolve|Reopen) thread$/ }),
    first.getByRole('button', { name: 'Thread actions' }),
  ]) {
    await page.keyboard.press('Tab');
    await expect(stop).toBeFocused();
  }
  await page.keyboard.press('Space');
  await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
});

test('a pin on the canvas highlights its card', async ({ page }) => {
  await open(page);
  await openPanel(page);
  await expect(page.getByTestId('v2-comment-pin')).toHaveCount(2);
  // The card brings the pin on screen; close the thread, then open it again from the pin itself.
  await card(page, 1).getByRole('button', { name: /Why is this a queue/ }).click();
  await page.getByTestId('v2-comment-thread').getByRole('button', { name: 'Close thread' }).click();
  await expect(card(page, 1)).not.toHaveAttribute('data-selected', 'true');
  await page.locator('.ofk-comment-pin[aria-label^="Comment by User, 2 messages"]').click();
  await expect(page.getByTestId('v2-comment-thread')).toBeVisible();
  await expect(card(page, 1)).toHaveAttribute('data-selected', 'true');
});

test('unread is per browser: an agent reply is unread until the thread opens, and Mark as unread sticks', async ({ page }) => {
  await open(page);
  await openPanel(page);
  // Never opened: the agent's reply is news; my own questions are not.
  await expect(card(page, 1)).toHaveAttribute('data-unread', 'true');
  await expect(card(page, 2)).not.toHaveAttribute('data-unread', 'true');
  await expect(page.locator('.ofk-comment-pin[data-unread]')).toHaveCount(1);

  await card(page, 1).hover();
  await card(page, 1).getByRole('button', { name: 'Thread actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark as read' }).click();
  await expect(card(page, 1)).not.toHaveAttribute('data-unread', 'true');
  await expect(page.locator('.ofk-comment-pin[data-unread]')).toHaveCount(0);

  // Marked unread by hand, even a thread of my own: it stays so until opened, and survives a reload.
  await card(page, 2).getByRole('button', { name: 'Thread actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark as unread' }).click();
  await expect(card(page, 2)).toHaveAttribute('data-unread', 'true');
  await expect(page.locator('.ofk-comment-pin[data-unread]')).toHaveCount(1);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __V2__?: V2Api }).__V2__?.getState());
  await openPanel(page);
  await expect(card(page, 2)).toHaveAttribute('data-unread', 'true');
  await expect(card(page, 1)).not.toHaveAttribute('data-unread', 'true');
  await card(page, 2).getByRole('button', { name: /Rename the cache layer/ }).click();
  await expect(card(page, 2)).not.toHaveAttribute('data-unread', 'true');
  // Nothing about it is in the document.
  expect(JSON.stringify(await doc(page))).not.toContain('lastRead');
});

test('Copy link puts #n · page · node and a link on the clipboard', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const id = await open(page);
  await openPanel(page);
  await card(page, 1).getByRole('button', { name: 'Thread actions' }).click();
  await page.getByRole('menuitem', { name: 'Copy link' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  // The thread is pinned to a node that has a label: the text names it.
  const pinnedNode = (await doc(page)).pages[0]!.nodes[0]!.content.label;
  expect(pinnedNode).toBe(NODE_LABEL);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe(`#1 · Page 1 · on "${NODE_LABEL}" — ${baseURL}/#/d/${id}?thread=thread-1`);

  // A page pin has no "on …".
  await card(page, 4).getByRole('button', { name: 'Thread actions' }).click();
  await page.getByRole('menuitem', { name: 'Copy link' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`#4 · Page 2 — ${baseURL}/#/d/${id}?thread=thread-4`);
});

test('a deep link opens the panel and the thread, and takes the param off the address', async ({ page, baseURL }) => {
  const id = await open(page);
  await expect.poll(() => persistedThreads(page, id)).toBe(4);
  await page.goto('about:blank');
  await page.goto(`${baseURL}/#/d/${id}?thread=thread-4`);
  await expect(panel(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('v2-comment-thread')).toContainText('Check the retry policy');
  await expect(card(page, 4)).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => page.url()).not.toContain('thread=');
  expect(page.url()).toContain(`#/d/${id}`);
});

test('a deep link to a thread that is gone says so and does not break the editor', async ({ page, baseURL }) => {
  const id = await open(page);
  await expect.poll(() => persistedThreads(page, id)).toBe(4);
  await page.goto('about:blank');
  await page.goto(`${baseURL}/#/d/${id}?thread=nope`);
  await expect(page.getByText('That thread no longer exists')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.url()).not.toContain('thread=');
  await expect(page.getByTestId('v2-canvas')).toBeVisible();
  await expect(page.getByTestId('v2-comment-thread')).toHaveCount(0);
});

test('resolving from a card, and deleting after a confirmation', async ({ page }) => {
  await open(page);
  await openPanel(page);
  page.on('dialog', () => { throw new Error('a browser dialog opened'); });
  await card(page, 2).hover();
  await card(page, 2).getByRole('button', { name: 'Resolve thread' }).click();
  await expect(card(page, 2)).toHaveCount(0);
  expect((await threadsOf(page)).find(({ id }) => id === 'thread-2')?.resolved).toBe(true);
  await expect(page.getByRole('button', { name: /^Threads, 2 open$/ })).toBeVisible();

  await card(page, 4).getByRole('button', { name: 'Thread actions' }).click();
  await page.getByRole('menuitem', { name: /Delete thread/ }).click();
  const dialog = page.getByRole('dialog', { name: /Delete thread #4/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await threadsOf(page)).toHaveLength(4);

  await card(page, 4).getByRole('button', { name: 'Thread actions' }).click();
  await page.getByRole('menuitem', { name: /Delete thread/ }).click();
  await page.getByRole('dialog', { name: /Delete thread #4/ }).getByRole('button', { name: 'Delete thread' }).click();
  await expect(card(page, 4)).toHaveCount(0);
  expect((await threadsOf(page)).map(({ number }) => number).sort()).toEqual([1, 2, 3]);
});

test('numbers continue from the highest across pages when a thread is started', async ({ page }) => {
  await open(page);
  await page.getByTestId('v2-canvas').focus();
  await page.keyboard.press('c');
  await expect(panel(page)).toBeVisible();
  await page.mouse.click(700, 500);
  const box = page.getByTestId('v2-comment-composer').getByRole('textbox', { name: 'Comment' });
  await box.fill('A fifth thread');
  await box.press('Enter');
  await expect.poll(async () => (await threadsOf(page)).map(({ number }) => number).sort()).toEqual([1, 2, 3, 4, 5]);
  await expect(card(page, 5)).toContainText('A fifth thread');
  await shot(page, 'threads-panel');
});

test('the Threads button is second in the workspace toolbar, right after the AI assistant', async ({ page }) => {
  await drawn(page);
  const names = await page.getByRole('toolbar', { name: 'Workspace' }).getByRole('button').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
  expect(names).toEqual(['AI assistant', 'Threads', 'Architecture model', 'Diagram as code', 'Connect agent']);
});

test('a pin drags to a new place with either tool: onto a node it follows it, on empty canvas it is a page pin, and a tiny move is a click', async ({ page }) => {
  await open(page);
  await openPanel(page);
  await card(page, 1).getByRole('button', { name: /Why is this a queue/ }).click();
  await page.getByTestId('v2-comment-thread').getByRole('button', { name: 'Close thread' }).click();
  await panel(page).getByRole('button', { name: 'Close threads' }).click();
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  const nodeId = (await doc(page)).pages[0]!.nodes[0]!.id;
  const pinOne = page.locator('.ofk-comment-pin[aria-label^="Comment by User, 2 messages"]');
  // The pin's centre once the camera has stopped moving it.
  const centreOf = async () => {
    let last = '';
    for (let i = 0; i < 40; i += 1) {
      const box = (await pinOne.boundingBox())!;
      const now = `${Math.round(box.x)},${Math.round(box.y)}`;
      if (now === last) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      last = now;
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    }
    throw new Error('the pin never settled');
  };
  const anchor = async () => (await threadsOf(page)).find(({ id }) => id === 'thread-1') as unknown as { anchor: { nodeId: string | null; point: { x: number; y: number } } };
  const dragTo = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
  };

  // Below the threshold it is a click: the thread opens and nothing moves.
  const before = await anchor();
  expect(before.anchor.nodeId).toBe(nodeId);
  let at = await centreOf();
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 2, at.y + 1);
  await page.mouse.up();
  await expect(page.getByTestId('v2-comment-thread')).toBeVisible();
  expect((await anchor()).anchor).toEqual(before.anchor);
  await page.getByTestId('v2-comment-thread').getByRole('button', { name: 'Close thread' }).click();

  // The select tool: drop on empty canvas.
  await page.getByTestId('v2-canvas').focus();
  await page.keyboard.press('v');
  at = await centreOf();
  // Zoom to fit left the shape filling the middle; below it is empty canvas.
  const empty = { x: 420, y: 650 }; // clear of the shape, and still on screen when the comment tool opens the panel and the canvas narrows
  await dragTo(at, empty);
  await expect(page.getByTestId('v2-comment-thread')).toHaveCount(0); // a drop is not a click
  await expect.poll(async () => (await anchor()).anchor.nodeId).toBeNull();
  const dropped = (await anchor()).anchor.point;
  const state = await page.evaluate(() => (window as unknown as { __V2__: { getState(): { nodes: string[] } } }).__V2__.getState().nodes.length);
  // No undo step: undo leaves the pin where it was dropped, and the shapes alone.
  await page.getByTestId('v2-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  expect((await anchor()).anchor.point).toEqual(dropped);
  expect(await page.evaluate(() => (window as unknown as { __V2__: { getState(): { nodes: string[] } } }).__V2__.getState().nodes.length)).toBe(state);

  // The comment tool: drop on a node, and the thread follows it.
  await page.keyboard.press('c');
  await expect(panel(page)).toBeVisible();
  at = await centreOf();
  const rect = (await page.evaluate((id) => (window as unknown as { __V2__: V2Api }).__V2__.getNodeRect(id), nodeId))!;
  await dragTo(at, { x: rect.x + rect.width / 2, y: Math.min(rect.y + rect.height / 2, 760) });
  await expect.poll(async () => (await anchor()).anchor.nodeId).toBe(nodeId);
  await expect(page.getByTestId('v2-comment-composer')).toHaveCount(0);
});

test('a click away from a box with text shakes it once instead of closing it; typing starts the count over', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await page.getByTestId('v2-canvas').focus();
  await page.keyboard.press('c');
  const away = { x: 700, y: 650 };
  await page.mouse.click(400, 300);
  const composer = page.getByTestId('v2-comment-composer');
  const box = composer.getByRole('textbox', { name: 'Comment' });
  await expect(box).toBeFocused();
  await box.fill('Half-written thought');

  await page.mouse.click(away.x, away.y);
  await expect(composer.locator('.ofk-comment-card')).toHaveAttribute('data-wiggle', /.*/);
  await expect(box).toHaveValue('Half-written thought');
  await expect(box).toBeFocused();
  // Typing resets: the next click away shakes again.
  await box.press('End');
  await box.pressSequentially('!');
  await page.clock.fastForward(400); // past the shake
  await page.mouse.click(away.x, away.y);
  await expect(composer.locator('.ofk-comment-card')).toHaveAttribute('data-wiggle', /.*/);
  await expect(box).toHaveValue('Half-written thought!');
  // The second click without typing closes it, text and all.
  await page.mouse.click(away.x, away.y);
  await expect(composer).toHaveCount(0);
  expect(await threadsOf(page)).toHaveLength(4);
});

test('the reply box keeps its text through one click away, and under reduced motion the shake is an outline', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await openPanel(page);
  await card(page, 1).getByRole('button', { name: /Why is this a queue/ }).click();
  const thread = page.getByTestId('v2-comment-thread');
  const reply = thread.getByRole('textbox', { name: 'Reply' });
  await reply.fill('Not sent yet');
  await page.mouse.click(200, 650);
  await expect(thread.locator('xpath=self::*')).toHaveAttribute('data-wiggle', /.*/);
  expect(await thread.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  expect(await thread.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await expect(reply).toHaveValue('Not sent yet');
  await expect(reply).toBeFocused();
  await page.mouse.click(200, 650);
  await expect(thread).toHaveCount(0);
});

test('screenshot: the panel with a resolved, an agent-answered and an unread thread', async ({ page }) => {
  test.skip(!SHOTS, 'OFK_SHOTS_DIR not set');
  await open(page);
  await openPanel(page);
  await panel(page).getByRole('button', { name: 'Filter threads' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Show resolved' }).click();
  await page.keyboard.press('Escape');
  await expect(cards(page)).toHaveCount(4);
  await card(page, 1).hover();
  await shot(page, 'threads-panel');
});
