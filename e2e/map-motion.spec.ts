import { expect, test, type Page } from './test';
import { centreOf, doc, rect, state } from './helpers';

// Map mode's open/close move on the Pixi canvas: boxes grow and slide for 480 ms, arrows come back after.
// npx playwright test e2e/map-motion.spec.ts

interface Motion {
  running: boolean;
  frames: number;
  workMs: { p50: number; p95: number; max: number };
  rafMs: { p50: number; p95: number };
  reactRendersDuringMotion: number;
  active: boolean;
  arrowAlpha: number;
  renderMs: { p50: number; p95: number };
}
const motion = (page: Page): Promise<Motion> =>
  page.evaluate(() => (window as unknown as { __V2__: { getMapMotion(): Motion } }).__V2__.getMapMotion());
const mapNodes = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __V2__: { getMapState(): { nodes: string[] } } }).__V2__.getMapState().nodes);
const camera = (page: Page) => page.evaluate(() => (window as unknown as { __V2__: { getRenderDiagnostics(): unknown } }).__V2__.getRenderDiagnostics());

// Past the editor's double-click guard (400 ms after a click that opened or closed a box).
const PAST_DOUBLE_CLICK_MS = 420;

async function openModel(page: Page, create: () => Promise<void>): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await create();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await mapNodes(page)).length).toBeGreaterThan(0);
}

async function openStarter(page: Page): Promise<void> {
  await openModel(page, async () => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="v2-canvas"]');
    await page.getByRole('toolbar', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Architecture model', exact: true }).click();
    await page.getByRole('button', { name: 'Create C4 workspace', exact: true }).click();
    await expect.poll(async () => (await doc(page))?.pages.length).toBe(3);
    await expect(page.getByRole('complementary', { name: 'Architecture model' })).toBeVisible();
  });
}

const idle = async (page: Page): Promise<void> => {
  await expect.poll(async () => { const m = await motion(page); return !m.running && !m.active && m.arrowAlpha === 1; }, { timeout: 15_000 }).toBe(true);
};

async function click(page: Page, id: string): Promise<void> {
  const at = await centreOf(page, id);
  await page.mouse.click(at.x, at.y);
}

test('opening a box moves in place, hides the arrows meanwhile and shows them after, without rendering the page per frame @gate', async ({ page }) => {
  test.setTimeout(60_000);
  await openStarter(page);
  await idle(page);
  // Entering Map lands like a fresh map: no move.
  expect((await motion(page)).frames).toBe(0);
  expect((await page.evaluate(() => (window as unknown as { __V2__: { getMapState(): { connectors: unknown[] } } }).__V2__.getMapState().connectors.length))).toBeGreaterThan(0);

  await click(page, 'shop.api');
  await expect.poll(async () => (await motion(page)).running || (await motion(page)).frames > 0).toBe(true);
  await expect.poll(async () => (await mapNodes(page))).toContain('shop.api.orders');
  await idle(page);
  const after = await motion(page);
  // Headless SwiftShader is slow: it draws what it can in the 480 ms, never fewer than two frames.
  expect(after.frames).toBeGreaterThan(1);
  expect(after.reactRendersDuringMotion).toBeLessThanOrEqual(2);
  console.log(`open: ${JSON.stringify(after)}`);
  expect((await rect(page, 'shop.api.orders'))!.width).toBeGreaterThan(20);
});

test('arrows are hidden during the move and fade in after it @gate', async ({ page }) => {
  test.setTimeout(60_000);
  await openStarter(page);
  await idle(page);
  await click(page, 'shop.api');
  // The move starts with the arrows off; the first sample inside it sees them hidden.
  await expect.poll(async () => { const m = await motion(page); return m.running ? m.arrowAlpha : null; }, { timeout: 10_000, intervals: [16] }).toBe(0);
  await idle(page);
  expect((await motion(page)).arrowAlpha).toBe(1);
});

// @local: the click must land mid-animation, which headless frame timing misses; it runs in the headed suite.
test('a click during the move lands on the target layout, and a second flip re-targets the move @gate @local', async ({ page }) => {
  test.setTimeout(60_000);
  await openStarter(page);
  await idle(page);
  await click(page, 'shop.api');
  await expect.poll(async () => (await motion(page)).running, { intervals: [16] }).toBe(true);
  // Mid-move the boxes are still travelling; Web is where the target layout has it, and a click there selects it.
  const clickedWhileRunning = (await motion(page)).running;
  await click(page, 'shop.web');
  expect(clickedWhileRunning).toBe(true);
  await expect.poll(async () => (await state(page)).selectedNodes).toEqual(['shop.web']);
  // Escape closes the box around it: a new move starting from where the boxes are drawn, fired while the first still runs.
  const retargetedWhileRunning = (await motion(page)).running;
  await page.keyboard.press('Escape');
  expect(retargetedWhileRunning).toBe(true);
  await expect.poll(async () => (await mapNodes(page))).not.toContain('shop.web');
  await idle(page);
  expect((await mapNodes(page)).sort()).toEqual(['customer', 'payments', 'shop']);
});

test('two flips in quick succession end in the right state, open then closed @gate', async ({ page }) => {
  test.setTimeout(60_000);
  await openStarter(page);
  await idle(page);
  const before = [...(await mapNodes(page))].sort();
  await click(page, 'shop.api');
  await expect.poll(async () => (await mapNodes(page))).toContain('shop.api.orders');
  await page.waitForTimeout(PAST_DOUBLE_CLICK_MS);
  // The open box's header strip closes it again while the first move may still be running.
  const box = (await page.locator('[data-testid="v2-canvas"] canvas').boundingBox())!;
  const api = (await rect(page, 'shop.api'))!;
  await page.mouse.click(box.x + api.x + 12, box.y + api.y + 8);
  await expect.poll(async () => (await mapNodes(page))).not.toContain('shop.api.orders');
  await idle(page);
  expect([...(await mapNodes(page))].sort()).toEqual(before);
  expect((await camera(page))).toBeTruthy();
});

test('reduced motion lands the end state at once with the arrows visible and no frames between @gate', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openStarter(page);
  await idle(page);
  await click(page, 'shop.api');
  await expect.poll(async () => (await mapNodes(page))).toContain('shop.api.orders');
  const m = await motion(page);
  expect(m.frames).toBe(0);
  expect(m.running).toBe(false);
  expect(m.arrowAlpha).toBe(1);
  await page.waitForTimeout(200);
  expect((await motion(page)).frames).toBe(0);
});

// A system too wide for the screen: 14 services in a chain, so its open frame is ~3500 px wide (a Marketplace-like big box).
function wideModel(): string {
  const services = Array.from({ length: 14 }, (_, c) => `  container W${c} [tech: Go]`).join('\n');
  const relations = Array.from({ length: 13 }, (_, c) => ` hub.W${c} -> hub.W${c + 1} : feeds [tech: gRPC]`).join('\n');
  return `%% ofk 1\narchitecture\ntitle: Wide\nmodel {\n system Hub {\n${services}\n }\n${relations}\n}\nviews {\n view landscape\n}\n`;
}
const READABLE_FLOOR = 0.7;
const zoomOf = (page: Page): Promise<number> => page.evaluate(() => {
  const v = (window as unknown as { __V2__: { worldToScreen(p: { x: number; y: number }): { x: number } } }).__V2__;
  return v.worldToScreen({ x: 1, y: 0 }).x - v.worldToScreen({ x: 0, y: 0 }).x;
});
const detail = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __V2__: { getRenderDiagnostics(): { detailLevel: string } } }).__V2__.getRenderDiagnostics().detailLevel);

async function openWide(page: Page): Promise<void> {
  const { deflateRawSync } = await import('node:zlib');
  await openModel(page, async () => {
    await page.goto(`/#/from/dsl?d=${deflateRawSync(Buffer.from(wideModel(), 'utf8')).toString('base64url')}`);
    await page.waitForSelector('[data-testid="v2-canvas"]', { timeout: 30_000 });
  });
  await idle(page);
}

test('opening a box too big for the screen lands readable: labels on, header in view, never compact @gate', async ({ page }) => {
  test.setTimeout(60_000);
  await openWide(page);
  expect(await zoomOf(page)).toBeGreaterThanOrEqual(READABLE_FLOOR - 0.001);
  await click(page, 'hub');
  await expect.poll(async () => (await mapNodes(page))).toContain('hub.w13');
  await idle(page);
  // The landing is the floor, not a fit of 3500 px into 1440: labels stay on (not "compact").
  expect(await zoomOf(page)).toBeGreaterThanOrEqual(READABLE_FLOOR - 0.001);
  expect(await detail(page)).toBe('full');
  // Its header strip (where a click closes it) and first row are on screen.
  const frame = (await rect(page, 'hub'))!;
  expect(frame.x).toBeGreaterThanOrEqual(0);
  expect(frame.y).toBeGreaterThanOrEqual(0);
  expect(frame.y + 60).toBeLessThan(1000);
  // Closing lands readable too (the whole map fits again, at the most the editor's zoom allows).
  await page.waitForTimeout(PAST_DOUBLE_CLICK_MS);
  const box = (await page.locator('[data-testid="v2-canvas"] canvas').boundingBox())!;
  await page.mouse.click(box.x + frame.x + 12, box.y + frame.y + 8);
  await expect.poll(async () => (await mapNodes(page))).not.toContain('hub.w13');
  await idle(page);
  expect(await zoomOf(page)).toBeGreaterThanOrEqual(READABLE_FLOOR - 0.001);
  expect(await detail(page)).toBe('full');
});

test('the map is fully drawn the moment the motion state says idle: arrows at alpha 1, and back within 200 ms of the move ending @gate', async ({ page }) => {
  test.setTimeout(60_000);
  await openStarter(page);
  await idle(page);
  // Sampled in the page on every frame, so no poll gap hides a window where it says idle but the arrows are not back.
  await page.evaluate(() => {
    const w = window as unknown as { __V2__: { getMapMotion(): { running: boolean; active: boolean; arrowAlpha: number } }; __samples: { t: number; running: boolean; active: boolean; alpha: number }[]; __stop: boolean };
    w.__samples = []; w.__stop = false;
    const tick = () => { const m = w.__V2__.getMapMotion(); w.__samples.push({ t: performance.now(), running: m.running, active: m.active, alpha: m.arrowAlpha }); if (!w.__stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await click(page, 'shop.api');
  await expect.poll(async () => (await mapNodes(page))).toContain('shop.api.orders');
  await idle(page);
  // Until a sampled frame shows idle: on software WebGL one frame can outlast any fixed wait (CI 2026-10-12: 3/3 retries).
  await expect.poll(() => page.evaluate(() => {
    const samples = (window as unknown as { __samples: { running: boolean }[] }).__samples;
    return samples.length > 0 && !samples[samples.length - 1]!.running;
  })).toBe(true);
  const samples = await page.evaluate(() => { const w = window as unknown as { __samples: { t: number; running: boolean; active: boolean; alpha: number }[]; __stop: boolean }; w.__stop = true; return w.__samples; });
  expect(samples.some((m) => m.running)).toBe(true);
  // Not running means every arrow is at full opacity, and no box is still being drawn by the move.
  for (const m of samples) if (!m.running) expect(m.alpha).toBe(1);
  // The move ends (no longer `active`) and the arrows are back (not `running`) within 200 ms, or two frames when the
  // machine draws slower than that (software WebGL: a frame can take 100 ms, and no fade can beat the first frame).
  const moveEnd = samples.findIndex((m, i) => i > 0 && samples[i - 1]!.active && !m.active);
  expect(moveEnd).toBeGreaterThan(0);
  const back = samples.findIndex((m, i) => i >= moveEnd && !m.running);
  expect(back).toBeGreaterThanOrEqual(moveEnd);
  const frame = Math.max(...samples.slice(moveEnd, back + 1).map((m, i, all) => (i ? m.t - all[i - 1]!.t : 0)));
  expect(samples[back]!.t - samples[moveEnd]!.t).toBeLessThanOrEqual(Math.max(200, 2 * frame));
});

test('an open box keeps its children clear of its kind tag, at every depth @gate', async ({ page }) => {
  test.setTimeout(60_000);
  await openStarter(page);
  await idle(page);
  await click(page, 'shop');
  await expect.poll(async () => (await mapNodes(page))).toContain('shop.api');
  await idle(page);
  await page.waitForTimeout(PAST_DOUBLE_CLICK_MS);
  await click(page, 'shop.api');
  await expect.poll(async () => (await mapNodes(page))).toContain('shop.api.orders');
  await idle(page);
  const ids = await mapNodes(page);
  const z = await zoomOf(page);
  let frames = 0;
  for (const id of ids) {
    const kids = ids.filter((other) => other.startsWith(`${id}.`) && !other.slice(id.length + 1).includes('.'));
    if (!kids.length) continue;
    frames += 1;
    const frame = (await rect(page, id))!;
    // The tag: 10px type whose line starts 22px above the frame's bottom edge, at its left (PixiContainerRenderer.createLabel).
    const tag = { x: frame.x + 12 * z, y: frame.y + frame.height - 22 * z, right: frame.x + 12 * z + 120 * z, bottom: frame.y + frame.height - 8 * z };
    for (const kid of kids) {
      const r = (await rect(page, kid))!;
      const overlaps = r.x < tag.right && r.x + r.width > tag.x && r.y < tag.bottom && r.y + r.height > tag.y;
      expect(overlaps, `${kid} runs into ${id}'s kind tag`).toBe(false);
    }
  }
  expect(frames).toBeGreaterThanOrEqual(2);
});

// A generated C4 model with everything open: S systems x V services x P components (+ a few relations).
interface Shape { systems: number; services: number; parts: number }
function bigModel({ systems: S, services: V, parts: P }: Shape): string {
  const systems = Array.from({ length: S }, (_, s) => {
    const services = Array.from({ length: V }, (_, c) => {
      const parts = Array.from({ length: P }, (_, p) => `    component P${s}x${c}x${p}`).join('\n');
      return `   container C${s}x${c} [tech: Go] {\n${parts}\n   }`;
    }).join('\n');
    return `  system S${s} {\n${services}\n  }`;
  }).join('\n');
  const relations = [
    ...Array.from({ length: S - 1 }, (_, s) => ` S${s}.C${s}x0 -> S${s + 1}.C${s + 1}x1 : calls`),
    ...Array.from({ length: S }, (_, s) => Array.from({ length: V - 1 }, (_, c) => ` S${s}.C${s}x${c} -> S${s}.C${s}x${c + 1} : feeds`).join('\n')),
  ].join('\n');
  return `%% ofk 1\narchitecture\ntitle: Big\nmodel {\n${systems}\n${relations}\n}\nviews {\n view landscape\n}\n`;
}

/** Opens everything but the last service, then the last one (the measured move, camera landing on it); returns the motion numbers. */
async function measureOpen(page: Page, shape: Shape): Promise<{ boxes: number; m: Motion }> {
  const { deflateRawSync } = await import('node:zlib');
  await openModel(page, async () => {
    await page.goto(`/#/from/dsl?d=${deflateRawSync(Buffer.from(bigModel(shape), 'utf8')).toString('base64url')}`);
    await page.waitForSelector('[data-testid="v2-canvas"]', { timeout: 30_000 });
  });
  await idle(page);
  const systems = Array.from({ length: shape.systems }, (_, s) => `s${s}`);
  const services = systems.flatMap((s) => Array.from({ length: shape.services }, (_, c) => `${s}.c${s.slice(1)}x${c}`));
  const last = services.at(-1)!;
  const openBoxes = (ids: string[], focus?: string) => page.evaluate(([list, at]) => (window as unknown as { __V2__: { openMapBoxes(ids: string[], focus?: string): void } }).__V2__.openMapBoxes(list as string[], at as string | undefined), [ids, focus]);
  // Lands on the one before last: the camera is already where the measured move happens, at 100%.
  await openBoxes([...systems, ...services.slice(0, -1)]);
  await expect.poll(async () => (await mapNodes(page)).length, { timeout: 60_000 }).toBeGreaterThan(shape.systems * shape.services * 0.8);
  await idle(page);
  await page.waitForTimeout(500);
  const boxes = (await mapNodes(page)).length;
  await openBoxes([...systems, ...services], last);
  await expect.poll(async () => (await mapNodes(page))).toContain(`${last}.p${last.slice(1, 2)}x${last.split('x')[1]}x0`);
  await idle(page);
  return { boxes, m: await motion(page) };
}

for (const [name, shape, max] of [
  ['~170 boxes', { systems: 3, services: 14, parts: 3 }, Infinity],
  // Model C of the look-2 package: 305 boxes, ~25 on screen at 100%; a spike past two frames (33 ms) is a visible hitch.
  ['~300 boxes', { systems: 5, services: 12, parts: 4 }, 33],
] as [string, Shape, number][]) {
  test(`opening a box among ${name} never drops a frame, drawing and rendering @local`, async ({ page }) => {
    test.setTimeout(240_000);
    const { boxes, m } = await measureOpen(page, shape);
    const fps = m.frames / 0.48;
    console.log(`perf ${name}: ${boxes} boxes, ${m.frames} frames (${fps.toFixed(0)} fps), draw+render p50 ${m.workMs.p50.toFixed(2)} p95 ${m.workMs.p95.toFixed(2)} max ${m.workMs.max.toFixed(2)} ms (render alone p50 ${m.renderMs.p50.toFixed(2)} p95 ${m.renderMs.p95.toFixed(2)}), raf p50 ${m.rafMs.p50.toFixed(1)} p95 ${m.rafMs.p95.toFixed(1)} ms, react renders ${m.reactRendersDuringMotion}`);
    expect(m.workMs.p95).toBeLessThanOrEqual(16);
    expect(m.workMs.max).toBeLessThanOrEqual(max);
    expect(m.reactRendersDuringMotion).toBeLessThanOrEqual(2);
  });
}

/** A box's rect in page pixels, and the three floating chrome rects that must stay clear of it. */
async function clearOfChrome(page: Page, id: string): Promise<void> {
  const canvas = (await page.locator('[data-testid="v2-canvas"] canvas').boundingBox())!;
  const r = (await rect(page, id))!;
  const box = { x: canvas.x + r.x, y: canvas.y + r.y, width: r.width, height: r.height };
  expect(box.x, `${id} inside the canvas`).toBeGreaterThanOrEqual(canvas.x);
  expect(box.y, `${id} inside the canvas`).toBeGreaterThanOrEqual(canvas.y);
  expect(box.x + box.width, `${id} inside the canvas`).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(box.y + box.height, `${id} inside the canvas`).toBeLessThanOrEqual(canvas.y + canvas.height);
  for (const name of ['Document', 'Workspace', 'View']) {
    const chrome = (await page.getByRole('toolbar', { name, exact: true }).boundingBox())!;
    const apart = box.x + box.width <= chrome.x || chrome.x + chrome.width <= box.x || box.y + box.height <= chrome.y || chrome.y + chrome.height <= box.y;
    expect(apart, `${id} (${JSON.stringify(box)}) is under the ${name} toolbar (${JSON.stringify(chrome)})`).toBe(true);
  }
}

test('an opened box lands inside the canvas the chrome leaves, and a small child keeps the zoom @gate', async ({ page }) => {
  test.setTimeout(60_000);
  await openStarter(page);
  await idle(page);
  await click(page, 'shop');
  await expect.poll(async () => (await mapNodes(page))).toContain('shop.api');
  await idle(page);
  await clearOfChrome(page, 'shop');
  const before = await zoomOf(page);
  await page.waitForTimeout(PAST_DOUBLE_CLICK_MS);
  await click(page, 'shop.api');
  await expect.poll(async () => (await mapNodes(page))).toContain('shop.api.orders');
  await idle(page);
  // Opening a small box inside a box that is already open never zooms in (nor out: it fits where it is).
  expect(await zoomOf(page)).toBeCloseTo(before, 3);
  await clearOfChrome(page, 'shop.api');
  await clearOfChrome(page, 'shop.api.orders');
});

test('a box too big for the screen still lands with its header clear of the chrome @gate', async ({ page }) => {
  test.setTimeout(60_000);
  await openWide(page);
  await click(page, 'hub');
  await expect.poll(async () => (await mapNodes(page))).toContain('hub.w13');
  await idle(page);
  const canvas = (await page.locator('[data-testid="v2-canvas"] canvas').boundingBox())!;
  const frame = (await rect(page, 'hub'))!;
  const bar = (await page.getByRole('toolbar', { name: 'Document', exact: true }).boundingBox())!;
  expect(canvas.y + frame.y).toBeGreaterThanOrEqual(bar.y + bar.height);
});
