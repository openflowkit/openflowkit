import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardSpot, Placement } from './v2CommentPlacement';

// One fake rAF for the file: frames run only when the test says so, and every request is counted.
const frames: FrameRequestCallback[] = [];
let requests = 0;
const runFrame = () => { const next = frames.splice(0); for (const callback of next) callback(0); };

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { requests += 1; frames.push(callback); return requests; });
  vi.stubGlobal('cancelAnimationFrame', () => { frames.length = 0; });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { frames.length = 0; requests = 0; });

describe('Placement', () => {
  const setup = () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const placement = new Placement(() => camera, () => ({ left: 0, top: 0, width: 1000, height: 800 }));
    const pins = [0, 1, 2].map((i) => { const el = document.createElement('div'); placement.add(el, { x: i * 10, y: 5 }); return el; });
    return { camera, placement, pins };
  };

  it('paints a pin where its world point lands on screen', () => {
    const { camera, placement, pins } = setup();
    camera.x = 100;
    placement.kick();
    runFrame();
    expect(pins[1]!.style.transform).toBe('translate3d(110px, 5px, 0)');
  });

  it('schedules no frame while pins are mounted and nothing moves', () => {
    const { placement, pins } = setup();
    for (let i = 0; i < 20; i += 1) runFrame();
    const settled = requests;
    for (let i = 0; i < 20; i += 1) runFrame();
    expect(requests).toBe(settled);
    expect(frames).toHaveLength(0);
    // Moving a pin to where it already is costs nothing; a kick with the camera still costs exactly one frame, which ends the loop.
    placement.move(pins[0]!, { x: 0, y: 5 });
    expect(requests).toBe(settled);
    placement.kick();
    runFrame();
    runFrame();
    expect(requests).toBe(settled + 1);
    expect(frames).toHaveLength(0);
  });

  it('keeps painting while the camera moves, then stops one frame after it settles', () => {
    const { camera, placement, pins } = setup();
    runFrame(); runFrame();
    for (let x = 1; x <= 5; x += 1) { camera.x = x; placement.kick(); runFrame(); expect(frames).toHaveLength(1); }
    expect(pins[0]!.style.transform).toBe('translate3d(5px, 5px, 0)');
    runFrame();
    expect(frames).toHaveLength(0);
  });

  it('places an open card in the free canvas at once, and again when the free canvas shrinks (a panel opens)', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    let free = { left: 0, top: 0, width: 1000, height: 800 };
    const placement = new Placement(() => camera, () => free);
    const el = document.createElement('div');
    const card = document.createElement('div');
    Object.defineProperties(card, { offsetWidth: { value: 320 }, offsetHeight: { value: 200 } });
    placement.add(el, { x: 500, y: 300 });
    placement.setCard(el, card);
    expect(el.dataset.side).toBe('right');
    expect(el.style.getPropertyValue('--ofk-card-top')).toBe('-34px');
    runFrame(); runFrame();
    free = { left: 0, top: 0, width: 600, height: 800 };
    placement.kick();
    runFrame();
    expect(el.dataset.side).toBe('left');
  });

  it('repaints a pin whose anchor moved even when the camera did not', () => {
    const { placement, pins } = setup();
    runFrame(); runFrame();
    placement.move(pins[0]!, { x: 50, y: 60 });
    runFrame();
    expect(pins[0]!.style.transform).toBe('translate3d(50px, 60px, 0)');
  });
});

describe('cardSpot', () => {
  const free = { left: 40, top: 60, width: 900, height: 700 };
  const card = { width: 320, height: 300 };

  it('opens on the right, level with the pin, when it fits there', () => {
    expect(cardSpot({ x: 300, y: 300 }, card, free)).toEqual({ side: 'right', top: -34 });
  });

  it('opens on the left when the right would run under a panel or past the rail', () => {
    expect(cardSpot({ x: 700, y: 300 }, card, free).side).toBe('left');
  });

  it('takes the roomier side when neither fits', () => {
    const narrow = { left: 0, top: 0, width: 500, height: 700 };
    expect(cardSpot({ x: 300, y: 300 }, card, narrow).side).toBe('left');
    expect(cardSpot({ x: 150, y: 300 }, card, narrow).side).toBe('right');
  });

  it('slides up near the bottom so the whole card shows, and never above the top', () => {
    // The free canvas ends at 760: a 300px card from a pin at 700 rises to end there.
    expect(cardSpot({ x: 300, y: 700 }, card, free).top).toBe(760 - 300 - 700);
    // Taller than the free canvas: it starts at the top.
    expect(cardSpot({ x: 300, y: 700 }, { width: 320, height: 900 }, free).top).toBe(60 - 700);
    // Near the top it stays level with the pin unless that would cross the top.
    expect(cardSpot({ x: 300, y: 80 }, card, free).top).toBe(60 - 80);
  });
});
