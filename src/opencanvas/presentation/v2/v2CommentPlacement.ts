import type { CanvasCamera } from '../../domain/camera/types';
import type { Point2d } from '../../domain/geometry/types';
import type { FreeArea } from './map/mapMode';

interface Entry { world: Point2d; key: string; card: HTMLElement | null }
interface Size { readonly width: number; readonly height: number }

/** Screen px between a pin's tip and its card: the card starts this far right of the tip, or ends this far left of it. */
const CARD_GAP = { right: 38, left: 8 };
/** The card's top sits this far above the pin's tip, level with the top of the 30px pin. */
const CARD_RISE = 34;
/** A pin whose tip is further than this outside the canvas is not drawn: the 30px pin and its outline are all off screen. */
const CULL_PX = 40;

/**
 * Where an open card sits beside its pin (tip at `pin`, canvas px), inside `free`, the canvas the panels and floating
 * chrome leave: on the right when it fits there, else on the left, else on the roomier side; level with the pin, slid up
 * as far as it takes to clear the bottom (and never above the top). `top` is the card's top relative to the tip.
 */
export function cardSpot(pin: Point2d, card: Size, free: FreeArea): { readonly side: 'left' | 'right'; readonly top: number } {
  const right = free.left + free.width - (pin.x + CARD_GAP.right);
  const left = pin.x - CARD_GAP.left - free.left;
  const side = right >= card.width ? 'right' : left >= card.width ? 'left' : right >= left ? 'right' : 'left';
  const highest = free.top - pin.y;
  const lowest = free.top + free.height - card.height - pin.y;
  return { side, top: Math.max(highest, Math.min(-CARD_RISE, lowest)) };
}

/**
 * Pins and what opens from them keep their place on screen by world position: transforms are set here, React never renders a frame.
 * Every pin sits in one layer that the camera's pan moves, so a pan writes one transform and the compositor moves the pins; a pin
 * is written again only when the zoom or its anchor changes, or when it leaves or enters the screen (it is hidden while off it).
 * A frame is scheduled only while something is moving; `kick` (a camera or anchor change) starts the next one, and the loop ends
 * on the first frame that paints nothing new. A pin with an open card also places the card in the free canvas (cardSpot).
 */
export class Placement {
  private readonly entries = new Map<HTMLElement, Entry>();
  private readonly resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.kick());
  private raf = 0;
  private layer: HTMLElement | null = null;
  private layerKey = '';
  /**
   * `viewport`: the canvas's size (no layout read), for culling pins off screen. `free`: the canvas the panels and chrome
   * leave, read once per frame and only while a card is open.
   */
  constructor(private readonly camera: () => CanvasCamera, private readonly viewport: () => Size, private readonly free: () => FreeArea | null) {}

  add(el: HTMLElement, world: Point2d): void {
    const entry = { world, key: '', card: null };
    this.entries.set(el, entry);
    this.paint(el, entry, this.camera(), this.viewport(), null, null);
    this.kick();
  }

  move(el: HTMLElement, world: Point2d): void {
    const entry = this.entries.get(el);
    if (!entry || (entry.world.x === world.x && entry.world.y === world.y)) return;
    entry.world = world;
    this.kick();
  }

  /** The element every pin sits in: the camera's pan moves it. */
  setLayer(layer: HTMLElement | null): void {
    this.layer?.removeEventListener('focusout', this.onFocusOut);
    this.layer = layer;
    this.layerKey = '';
    layer?.addEventListener('focusout', this.onFocusOut);
    this.kick();
  }

  // Focus left a pin: if it is off screen it may be hidden now (paint keeps the focused one), a frame later, when focus has settled.
  private readonly onFocusOut = (): void => this.kick();

  /** The card open on this pin (null when none): placed beside it, and re-placed when it grows. */
  setCard(el: HTMLElement, card: HTMLElement | null): void {
    const entry = this.entries.get(el);
    if (!entry || entry.card === card) return;
    if (entry.card) this.resized?.unobserve(entry.card);
    entry.card = card;
    entry.key = '';
    if (!card) return;
    this.resized?.observe(card);
    // Placed now, so the card never shows a frame on the wrong side or under a panel.
    this.paint(el, entry, this.camera(), this.viewport(), this.free(), { width: card.offsetWidth, height: card.offsetHeight });
  }

  remove(el: HTMLElement): void {
    const card = this.entries.get(el)?.card;
    if (card) this.resized?.unobserve(card);
    this.entries.delete(el);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resized?.disconnect();
  }

  /** Something that decides where pins sit (the camera) changed: paint on the next frame. */
  kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  /** Writes only what changed: a culled pin is hidden and costs nothing more until it comes back into view. */
  private paint(el: HTMLElement, entry: Entry, camera: CanvasCamera, viewport: Size, free: FreeArea | null, card: Size | null): boolean {
    // In the layer, then on screen.
    const x = entry.world.x * camera.zoom;
    const y = entry.world.y * camera.zoom;
    const left = x + camera.x;
    const top = y + camera.y;
    // An open card is never culled (it holds typed text), nor the pin that has focus (hiding it would drop focus to the page: after
    // Alt+Arrow, a pan, or Escape closing a card whose pin is off screen); an unmeasured canvas culls nothing.
    const off = !entry.card && viewport.width > 0
      && (left < -CULL_PX || top < -CULL_PX || left > viewport.width + CULL_PX || top > viewport.height + CULL_PX)
      && !el.contains(document.activeElement);
    const spot = card && free ? cardSpot({ x: left, y: top }, card, free) : null;
    const key = off ? 'off' : spot ? `${x}|${y}|${spot.side}|${spot.top}` : `${x}|${y}`;
    if (key === entry.key) return false;
    entry.key = key;
    if (el.hidden !== off) el.hidden = off;
    if (off) return true;
    el.style.transform = `translate(${x}px, ${y}px)`;
    if (spot) {
      el.dataset.side = spot.side;
      el.style.setProperty('--ofk-card-top', `${spot.top}px`);
    }
    return true;
  }

  private readonly tick = (): void => {
    this.raf = 0;
    const camera = this.camera();
    const viewport = this.viewport();
    // Every read before any write, so a frame lays out once: the open cards' sizes and the free canvas, only when a card is open.
    const cards = new Map<Entry, Size>();
    for (const entry of this.entries.values()) if (entry.card) cards.set(entry, { width: entry.card.offsetWidth, height: entry.card.offsetHeight });
    const free = cards.size ? this.free() : null;
    let moved = false;
    const layerKey = `${camera.x}|${camera.y}`;
    if (this.layer && layerKey !== this.layerKey) {
      this.layerKey = layerKey;
      this.layer.style.transform = `translate(${camera.x}px, ${camera.y}px)`;
      moved = true;
    }
    for (const [el, entry] of this.entries) moved = this.paint(el, entry, camera, viewport, free, cards.get(entry) ?? null) || moved;
    // A frame that moved nothing ends the loop; the camera's next change kicks it again.
    if (moved) this.raf = requestAnimationFrame(this.tick);
  };
}
