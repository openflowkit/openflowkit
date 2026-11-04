// Pure helpers for the comment overlays: how a message's age reads, and the avatar a name gets.

/** Every human comment is written by this name until named commenters exist; the data model already carries it. */
export const HUMAN_AUTHOR_NAME = 'User';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Just now", "5m", "3h", "2d", then a date. A clock that ran backwards reads as "Just now". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const age = now - then;
  if (age < MINUTE) return 'Just now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < 7 * DAY) return `${Math.floor(age / DAY)}d`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The same name always gets the same colour (a hue from a hash), dark enough for white text. */
export function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return `hsl(${hash % 360} 55% 42%)`;
}

/**
 * Where Enter places a thread with the comment tool and no pointer: the centre of the selected node (the thread is then
 * anchored to it), else the centre of the visible canvas. `node` is that node's screen rectangle, if one is selected.
 */
export function keyboardSpot(
  node: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null,
  viewport: { readonly width: number; readonly height: number },
): { readonly point: { readonly x: number; readonly y: number }; readonly onNode: boolean } {
  return node
    ? { point: { x: node.x + node.width / 2, y: node.y + node.height / 2 }, onNode: true }
    : { point: { x: viewport.width / 2, y: viewport.height / 2 }, onNode: false };
}
