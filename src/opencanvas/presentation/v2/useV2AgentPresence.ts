// An agent on the canvas: a named cursor that shows while it draws and glides, at a calm human pace, to where its change
// lands, and the change building in under it (PixiRendererHost.armReveal). Ops arrive whole over MCP, so this is the
// "live" feel: presentation only. The commit is already in the document, one undo step, before the first frame.
import { useCallback, useEffect, useState, type RefObject } from 'react';
import { cursorGlideMs, planAgentReveal, type RevealPlan } from '../../domain/animation/agentReveal';
import type { CanvasCamera } from '../../domain/camera/types';
import type { Point2d, Size2d } from '../../domain/geometry/types';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';

interface Options {
  readonly hostRef: RefObject<PixiRendererHost | null>;
  readonly cameraRef: RefObject<CanvasCamera>;
  /** True while an agent's drawing request runs. */
  readonly working: boolean;
}

interface Leg { readonly from: Point2d; readonly to: Point2d; readonly t0: number; readonly ms: number }

/** The cursor stays this long after the agent's last move, then fades. */
const IDLE_MS = 1500;
const FADE_MS = 280;
/** The change starts building once the cursor is under way, so the first shape comes in just ahead of it. */
const MAX_LEAD_MS = 140;

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a: Point2d, b: Point2d, t: number): Point2d => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const delayed = (plan: RevealPlan, ms: number): RevealPlan => ({
  ...plan, durationMs: plan.durationMs + ms, groups: plan.groups.map((group) => ({ ...group, startMs: group.startMs + ms })),
});

/** The cursor's one rAF loop, in world space so it stays on its shape while the camera moves. No React: a frame never renders the page. */
export class CursorMotion {
  private el: HTMLDivElement | null = null;
  private pos: Point2d | null = null;
  private legs: Leg[] = [];
  private until = 0;
  private opacity = 0;
  private last = 0;
  private raf = 0;
  private busy = false;

  constructor(private readonly camera: () => CanvasCamera, private readonly view: () => Size2d) {}

  /** Where the cursor first shows when nothing has landed yet: a little right of the middle of the canvas. */
  private spot(): Point2d {
    const camera = this.camera();
    const view = this.view();
    return { x: (view.width * 0.58 - camera.x) / camera.zoom, y: (view.height * 0.42 - camera.y) / camera.zoom };
  }

  attach(el: HTMLDivElement | null): void {
    this.el = el;
  }

  working(busy: boolean): void {
    if (busy && (!this.pos || this.opacity === 0)) this.pos = this.spot();
    // Done working: it lingers, then fades (it never shows for an agent that has not worked).
    if (this.busy && !busy) this.until = Math.max(this.until, performance.now() + IDLE_MS);
    this.busy = busy;
    this.kick();
  }

  /** The change landed along `trail`: glide there (or, reduced, show there). Returns how long the build-in should wait for the cursor. */
  land(trail: readonly Point2d[], durationMs: number, reduced: boolean): number {
    const now = performance.now();
    const [first, last] = trail as [Point2d, Point2d | undefined];
    if (this.el) this.el.dataset.reveal = reduced ? 'reduced' : 'build';
    if (reduced) {
      this.legs = [];
      this.pos = last ?? first;
      this.until = now + IDLE_MS;
      this.kick();
      return 0;
    }
    // From where it is drawn (mid-glide included); a cursor that had gone comes back in from the middle.
    const start = this.opacity > 0 && this.pos ? this.pos : this.spot();
    const zoom = this.camera().zoom;
    const toFirst = cursorGlideMs(Math.hypot(first.x - start.x, first.y - start.y) * zoom);
    const lead = Math.min(MAX_LEAD_MS, toFirst / 2);
    this.legs = [{ from: start, to: first, t0: now, ms: toFirst }];
    // Then on along the build to the last shape, no faster than a glide and no sooner than the build ends.
    if (last) {
      const drift = Math.max(cursorGlideMs(Math.hypot(last.x - first.x, last.y - first.y) * zoom), durationMs + lead - toFirst);
      this.legs.push({ from: first, to: last, t0: now + toFirst, ms: drift });
    }
    const end = this.legs.at(-1)!;
    this.until = end.t0 + end.ms + IDLE_MS;
    this.kick();
    return lead;
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.raf = 0;
    const gliding = this.legs.length > 0;
    while (this.legs[0] && now >= this.legs[0].t0 + this.legs[0].ms) { this.pos = this.legs[0].to; this.legs.shift(); }
    // The rest counts from the frame that draws it arriving: a page held up past the rest (a busy software-GL
    // runner) still shows it at the change before it fades.
    if (gliding && !this.legs.length) this.until = Math.max(this.until, now + IDLE_MS);
    const leg = this.legs[0];
    if (leg && now >= leg.t0) this.pos = lerp(leg.from, leg.to, easeInOut((now - leg.t0) / leg.ms));
    const shown = this.pos !== null && (this.busy || this.legs.length > 0 || now < this.until);
    const dt = this.last ? Math.min(64, now - this.last) : 16;
    this.last = now;
    this.opacity = Math.min(1, Math.max(0, this.opacity + (shown ? 1 : -1) * (dt / FADE_MS)));
    if (this.el) {
      const camera = this.camera();
      const at = this.pos ?? { x: 0, y: 0 };
      this.el.style.transform = `translate3d(${at.x * camera.zoom + camera.x}px, ${at.y * camera.zoom + camera.y}px, 0)`;
      this.el.style.opacity = String(this.opacity);
      this.el.dataset.state = this.busy ? 'working' : this.legs.length ? 'gliding' : shown ? 'resting' : this.opacity > 0 ? 'leaving' : 'hidden';
    }
    // Runs while it shows (it follows the camera); stops once faded out.
    if (shown || this.opacity > 0) this.raf = requestAnimationFrame(this.tick);
    else this.last = 0;
  };
}

export function useV2AgentPresence({ hostRef, cameraRef, working }: Options) {
  // The loop reads the refs when a frame runs, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [motion] = useState(() => new CursorMotion(() => cameraRef.current, () => hostRef.current?.getViewportSize() ?? { width: 800, height: 600 }));
  const cursorRef = useCallback((el: HTMLDivElement | null) => motion.attach(el), [motion]);
  useEffect(() => { motion.working(working); }, [motion, working]);
  useEffect(() => () => motion.stop(), [motion]);

  /**
   * An agent's commit is in: the host builds in the page it is given next (a render away) against the one it draws now,
   * and the cursor glides there. With reduced motion nothing moves: the cursor shows at the change, then fades.
   */
  const arm = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const reduced = reducedMotion();
    host.armReveal((before, after) => {
      const plan = planAgentReveal(before, after);
      if (!plan) return null;
      const lead = motion.land(plan.trail, plan.durationMs, reduced);
      return reduced ? null : delayed(plan, lead);
    });
  }, [hostRef, motion]);

  return { cursorRef, arm };
}
