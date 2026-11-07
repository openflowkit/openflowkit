// Typed text is never lost. Each comment box keeps its unsent text in CommentDrafts, so a box that closes for any reason
// (a click away, another pin, a page or tool switch, Map) has it back when it opens again; only sending or saving clears it.
// And a stray click does not close a box holding text at once: the first click outside only warns (the box shakes);
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

/** The box unsent text was typed in: a thread's reply, a message being edited, a new thread on a page. */
export const draftKey = {
  reply: (threadId: string): string => `reply:${threadId}`,
  edit: (threadId: string, commentId: string): string => `edit:${threadId}:${commentId}`,
  compose: (pageId: string): string => `new:${pageId}`,
};

/** Unsent text by box (see draftKey). Blank text is no draft. `onChange` hears every write: the guard starts over. */
export class CommentDrafts {
  private readonly texts = new Map<string, string>();
  constructor(private readonly onChange: () => void = () => undefined) {}

  get(key: string): string {
    return this.texts.get(key) ?? '';
  }

  has(key: string): boolean {
    return this.texts.has(key);
  }

  set(key: string, text: string): void {
    if (hasDraftText(text)) this.texts.set(key, text);
    else this.texts.delete(key);
    this.onChange();
  }

  /** Unsent text anywhere in a thread: its reply, or a message being edited. */
  inThread(threadId: string): boolean {
    const edits = `edit:${threadId}:`;
    for (const key of this.texts.keys()) if (key === draftKey.reply(threadId) || key.startsWith(edits)) return true;
    return false;
  }

  /** A deleted thread's boxes go with it. */
  dropThread(threadId: string): void {
    const edits = `edit:${threadId}:`;
    for (const key of [...this.texts.keys()]) if (key === draftKey.reply(threadId) || key.startsWith(edits)) this.texts.delete(key);
  }
}
