// Pure helpers for the comment overlays: how a message's age reads, what a pin is called, where a pin is drawn mid-drag.
import type { Point2d } from '../../domain/geometry/types';
import type { SceneDocumentV1, SceneNode, ScenePage, SceneThread } from '../../domain/document/types';
import { pageThreads, pinOnNode, ThreadError } from '../../domain/threads/threads';
import { buildNodeWorldMatrices } from '../../domain/scene/worldGeometry';

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

/**
 * Where Enter places a thread with the comment tool and no pointer: the centre of the selected node (the thread is then
 * anchored to it), else the centre of the visible canvas. `node` is that node's screen rectangle, if one is selected;
 * a node whose centre is out of view counts as none, so the composer never opens where the user cannot see it.
 */
export function keyboardSpot(
  node: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null,
  viewport: { readonly width: number; readonly height: number },
): { readonly point: { readonly x: number; readonly y: number }; readonly onNode: boolean } {
  if (node) {
    const point = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    if (point.x >= 0 && point.x <= viewport.width && point.y >= 0 && point.y <= viewport.height) return { point, onNode: true };
  }
  return { point: { x: viewport.width / 2, y: viewport.height / 2 }, onNode: false };
}

/** Alt + an arrow on a focused pin moves its thread this far in the world (Shift: ten times). */
export const PIN_STEP = 8;

/** The world offset an Alt+arrow key press moves a focused pin by, or null when the key is not a pin move. */
export function pinNudge(key: string, altKey: boolean, shiftKey: boolean): { readonly x: number; readonly y: number } | null {
  if (!altKey) return null;
  const step = shiftKey ? PIN_STEP * 10 : PIN_STEP;
  switch (key) {
    case 'ArrowLeft': return { x: -step, y: 0 };
    case 'ArrowRight': return { x: step, y: 0 };
    case 'ArrowUp': return { x: 0, y: -step };
    case 'ArrowDown': return { x: 0, y: step };
    default: return null;
  }
}

const NO_PINS: ReadonlyMap<string, Point2d> = new Map();

/**
 * Where the pins on `page` are drawn while `nodes` (a drag, resize or turn being previewed) stand in for theirs: by thread id,
 * only the pins that move. A pin follows its node's live world matrix by the same rule the document applies on drop (pinOnNode),
 * so children of a dragged frame or group come along, and a pin whose node is not on the page stays where it was.
 */
export function pinsOnPreview(page: ScenePage, nodes: readonly SceneNode[]): ReadonlyMap<string, Point2d> {
  const pinned = pageThreads(page).filter((thread) => thread.anchor.nodeId !== null && thread.anchor.offset !== null);
  if (pinned.length === 0 || nodes.length === 0) return NO_PINS;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const matrices = buildNodeWorldMatrices({ ...page, nodes: page.nodes.map((node) => byId.get(node.id) ?? node) });
  const moved = new Map<string, Point2d>();
  for (const { id, anchor } of pinned) {
    const matrix = matrices.get(anchor.nodeId!);
    if (!matrix) continue;
    const at = pinOnNode(matrix, anchor.offset!);
    if (at.x !== anchor.point.x || at.y !== anchor.point.y) moved.set(id, at);
  }
  return moved;
}

/** At most this many characters of the opening message name a pin, cut at a word. */
const LABEL_WORDS = 48;

/** A pin's accessible name: "Comment #3 by User: Why is this a queue?, 2 messages". Number and first words tell pins apart. */
export function pinLabel(thread: SceneThread): string {
  const lead = thread.comments[0]!;
  const text = lead.body.replace(/\s+/g, ' ').trim();
  const cut = text.length <= LABEL_WORDS ? text : `${text.slice(0, LABEL_WORDS + 1).replace(/\s+\S*$/, '')}…`;
  const count = thread.comments.length > 1 ? `, ${thread.comments.length} messages` : '';
  return `Comment #${thread.number} by ${lead.author.name}: ${cut}${count}`;
}

/**
 * `change`, except that a thread or message someone else removed first (an agent, another tab) makes it no change: the card
 * that asked closes with its thread, instead of the error reaching the page.
 */
export function unlessGone(change: (document: SceneDocumentV1) => SceneDocumentV1): (document: SceneDocumentV1) => SceneDocumentV1 {
  return (document) => {
    try {
      return change(document);
    } catch (error) {
      if (error instanceof ThreadError) return document;
      throw error;
    }
  };
}
