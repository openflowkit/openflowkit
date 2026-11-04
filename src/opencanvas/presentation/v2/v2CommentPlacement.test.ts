import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Placement } from './v2CommentPlacement';

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
    const placement = new Placement(() => camera, () => 1000);
    const pins = [0, 1, 2].map((i) => { const el = document.createElement('div'); placement.add(el, { x: i * 10, y: 5 }); return el; });
    return { camera, placement, pins };
  };

  it('paints a pin where its world point lands on screen and flips the card near the right edge', () => {
    const { camera, placement, pins } = setup();
    camera.x = 100;
    placement.kick();
    runFrame();
    expect(pins[1]!.style.transform).toBe('translate3d(110px, 5px, 0)');
    expect(pins[1]!.dataset.side).toBe('right');
    const edge = document.createElement('div');
    placement.add(edge, { x: 900, y: 0 });
    expect(edge.dataset.side).toBe('left');
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

  it('repaints when the section is resized, so a card flips to the side that has room', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    let width = 1000;
    const placement = new Placement(() => camera, () => width);
    const el = document.createElement('div');
    placement.add(el, { x: 500, y: 0 });
    expect(el.dataset.side).toBe('right');
    runFrame(); runFrame();
    width = 800;
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
