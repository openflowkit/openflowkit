import type { CanvasCamera } from '../../domain/camera/types';
import type { Point2d } from '../../domain/geometry/types';

interface Entry { world: Point2d; key: string }

/** The card opens to the left of a pin this close to the right edge. */
const CARD_ROOM = 380;

/**
 * Pins and what opens from them keep their place on screen by world position: transforms are set here, React never renders a frame.
 * A frame is scheduled only while something is moving; `kick` (a camera or anchor change) starts the next one, and the loop ends
 * on the first frame that paints nothing new.
 */
export class Placement {
  private readonly entries = new Map<HTMLElement, Entry>();
  private raf = 0;
  constructor(private readonly camera: () => CanvasCamera, private readonly width: () => number) {}

  add(el: HTMLElement, world: Point2d): void {
    const entry = { world, key: '' };
    this.entries.set(el, entry);
    this.paint(el, entry);
    this.kick();
  }

  move(el: HTMLElement, world: Point2d): void {
    const entry = this.entries.get(el);
    if (!entry || (entry.world.x === world.x && entry.world.y === world.y)) return;
    entry.world = world;
    this.kick();
  }

  remove(el: HTMLElement): void {
    this.entries.delete(el);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Something that decides where pins sit (the camera) changed: paint on the next frame. */
  kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private paint(el: HTMLElement, entry: Entry): boolean {
    const { x, y, zoom } = this.camera();
    const left = entry.world.x * zoom + x;
    const top = entry.world.y * zoom + y;
    const width = this.width();
    const key = `${left}|${top}|${width}`;
    if (key === entry.key) return false;
    entry.key = key;
    el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    const side = left > width - CARD_ROOM ? 'left' : 'right';
    if (el.dataset.side !== side) el.dataset.side = side;
    return true;
  }

  private readonly tick = (): void => {
    this.raf = 0;
    let moved = false;
    for (const [el, entry] of this.entries) moved = this.paint(el, entry) || moved;
    // A frame that moved nothing ends the loop; the camera's next change kicks it again.
    if (moved) this.raf = requestAnimationFrame(this.tick);
  };
}
