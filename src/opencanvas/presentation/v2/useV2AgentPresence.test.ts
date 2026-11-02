import { afterEach, expect, it, vi } from 'vitest';
import { CursorMotion } from './useV2AgentPresence';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// CI, 2026-11-02: a software-GL runner held the page past the cursor's 1.5 s rest, so the first frame after the glide
// found the rest already over and the cursor went from gliding straight to leaving, never shown at the change.
it('rests at the change once it is drawn there, even after a stall longer than the rest', () => {
  let now = 0;
  let frame: FrameRequestCallback | null = null;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const el = document.createElement('div');
  const motion = new CursorMotion(() => ({ x: 0, y: 0, zoom: 1 }), () => ({ width: 800, height: 600 }));
  motion.attach(el);
  const step = (at: number) => {
    now = at;
    const run = frame!;
    frame = null;
    run(at);
    return el.dataset.state;
  };

  motion.working(true);
  expect(step(16)).toBe('working');
  motion.working(false);
  motion.land([{ x: 100, y: 100 }], 0, false);
  expect(step(32)).toBe('gliding');
  expect(step(5000)).toBe('resting'); // the glide (≤ 950 ms) and the rest after it were both due long before
  expect(step(5000 + 1499)).toBe('resting');
  expect(step(5000 + 1516)).toBe('leaving');
});
