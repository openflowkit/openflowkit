// Typed text is not lost to a stray click: the first click outside a box holding text only warns (the box shakes);
// a second one closes it. Typing starts the count over. An empty box closes at once.

export interface DraftGuard {
  /** Outside clicks since the last keystroke, while the box held text. */
  readonly warned: boolean;
}

export const FRESH_GUARD: DraftGuard = { warned: false };

export type OutsideOutcome = 'close' | 'warn';

/** What an outside click does, and the guard after it. `hasText`: the box holds something other than whitespace. */
export function outsideClick(guard: DraftGuard, hasText: boolean): { readonly outcome: OutsideOutcome; readonly guard: DraftGuard } {
  if (!hasText || guard.warned) return { outcome: 'close', guard: FRESH_GUARD };
  return { outcome: 'warn', guard: { warned: true } };
}

/** The draft changed: the next outside click warns again. */
export function typed(guard: DraftGuard): DraftGuard {
  return guard.warned ? FRESH_GUARD : guard;
}

export const hasDraftText = (text: string): boolean => text.trim() !== '';
