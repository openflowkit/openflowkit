// Thread ids and numbers are unique across a document. When a page comes back (undo of its removal) or a file
// holds a clash, the thread that joins takes a free one. Both picks are deterministic, so undoing the same step
// twice gives the same document. Loading (withoutInvalidThreads) and the carry (carryThreads) share them.
import { THREAD_NUMBER_MAX } from '../document/types';

/** The lowest number from 1 that is not taken. */
export function lowestFreeThreadNumber(taken: ReadonlySet<number>): number {
  let lowest = 1;
  while (taken.has(lowest)) lowest += 1;
  return lowest;
}

/** One past the highest number taken; once that would pass THREAD_NUMBER_MAX, the lowest free one. */
export function freeThreadNumber(taken: ReadonlySet<number>): number {
  let highest = 0;
  for (const number of taken) highest = Math.max(highest, number);
  return highest < THREAD_NUMBER_MAX ? highest + 1 : lowestFreeThreadNumber(taken);
}

/** `id` when it is free, else the first of `id-2`, `id-3`, … that is. */
export function freeThreadId(taken: ReadonlySet<string>, id: string): string {
  if (!taken.has(id)) return id;
  let suffix = 2;
  while (taken.has(`${id}-${suffix}`)) suffix += 1;
  return `${id}-${suffix}`;
}
