// Run one op against the live editor session: the rules every live transport shares (the MCP bridge, WebMCP).
// Registry lookup, the page the op lands on, the person's selection, the read-only refusal, one commit (one undo
// step) and the camera reveal live here once, so no transport can drift from another.
import { commandTouchedRoots } from '../opencanvas/application/ai/proposalSession';
import type { DocumentCommand } from '../opencanvas/domain/commands/types';
import type { SceneDocumentV1 } from '../opencanvas/domain/document/types';
import { drawingSourceOf } from '../opencanvas/application/map/pinPage';
import type { OpCapabilities } from './ops/types';
import { pageHolding, resolveAgentOpCommand } from './runAction';

export interface LiveAgentSession {
  readonly document: SceneDocumentV1 | null;
  /** The page the editor shows. */
  readonly pageId: string | null;
  /** Capabilities the browser can honour (compile, syntax, icons, export, camera). */
  readonly capabilities: OpCapabilities;
  /** Commits as one undo step; false when the session refused it (a locked page), so nothing landed. */
  readonly commit: (command: DocumentCommand) => boolean | void;
  /**
   * Applies a thread change outside undo history (the session's updateThreads); throws on bad input, and runs
   * nothing when no document is open.
   */
  readonly threadChange: (change: (document: SceneDocumentV1) => SceneDocumentV1) => void;
  /** A document the reader cannot edit (a shared link, a repo map): an agent's change is refused, and told so. */
  readonly readOnly?: boolean;
  /** A page that stays as it is (a repo document's map page): a change addressed to it lands on its drawing (`openDrawing`), never on it. */
  readonly lockedPageId?: string | null;
  /**
   * A change addressed to the locked page: show its drawing (made from the map on screen when there is none, its own
   * undo step), true; or false when there is none to show, after telling the person what the agent tried and what to do.
   */
  readonly openDrawing?: () => boolean;
  /** Show a page a change is about to land on that is not on screen (a drawing from its map, the way Canvas shows it). */
  readonly showPage?: (pageId: string) => void;
  /** Node and connector ids the person has selected now, so an agent can act on "the box I selected" (get_document). */
  readonly selectedIds?: () => readonly string[];
  /** After an agent edit on the page in view, with the top-level nodes it added or changed (to bring them into view). */
  readonly onApplied?: (nodeIds: readonly string[]) => void;
}

const NO_DOCUMENT = 'The editor has no document open.';
export const READ_ONLY_REFUSAL = 'This document is read-only, so the editor did not apply the change.';
export const REPO_MAP_REFUSAL = 'The tab shows a repo map, which is read from the code, so the editor did not apply the change. '
  + 'Ask the user to press Canvas (or wait until the map is read), then call again: changes land on the map\'s drawing '
  + '(list_pages names it; pass its pageId).';

/** The editor shows a page on its next render: wait for it (about a second), so the op reads the page it lands on. */
async function shown(current: () => LiveAgentSession, ready: (session: LiveAgentSession) => boolean): Promise<LiveAgentSession | null> {
  for (let tries = 0; tries < 60; tries += 1) {
    const session = current();
    if (ready(session)) return session;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  return null;
}

/** The page on screen is a drawing of `mapId`. */
const showsDrawingOf = (mapId: string) => ({ document, pageId }: LiveAgentSession): boolean => {
  const page = document?.pages.find(({ id }) => id === pageId);
  return page !== undefined && drawingSourceOf(page) === mapId;
};

export interface LiveOpResult {
  readonly output: unknown;
  /** The command committed (its label is the undo label), or null for a read or a thread change. */
  readonly command: DocumentCommand | null;
  /** A thread change that changed the document: like a commit, it reaches the editor's state on the next render. */
  readonly threadsChanged?: true;
}

/** Why a cancelled call stopped: the reason it was aborted with, when that is an Error. */
function stopIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('The call was cancelled.');
}

/**
 * Throws with a message meant for the agent; commits at most one command. `current` is read at the start (document,
 * page, selection) and again once the op has resolved (lock, commit): an op that compiles can outlive a change to either.
 */
export async function runLiveAgentOp(current: () => LiveAgentSession, name: string, input: unknown, requestedPageId?: string, signal?: AbortSignal, client?: string): Promise<LiveOpResult> {
  stopIfAborted(signal);
  // The registry loads with the first call, so an editor no agent talks to never downloads it.
  const { findAgentOp } = await import('./ops');
  const op = findAgentOp(name);
  if (!op) throw new RangeError(`Unknown op "${name}".`);
  const { CAPABILITY_MANIFEST } = await import('./manifest');
  let session = current();
  if (!session.document) throw new Error(NO_DOCUMENT);
  // The page the op will run on (a named frame's own page), so the read-only check and the camera agree with it.
  let pageId = pageHolding({ document: session.document, pageId: requestedPageId ?? session.pageId ?? session.document.pages[0]?.id ?? '', capabilities: session.capabilities }, input);
  // Thread writes are conversation, not drawing: no repo-map redirect, no page switch, no camera, no commit.
  const writes = CAPABILITY_MANIFEST.find(({ action }) => action === name)?.writes ?? null;
  if (writes === 'threads' && session.readOnly) throw new Error(READ_ONLY_REFUSAL);
  const drawing = writes === 'diagram';
  const locked = session.lockedPageId ?? null;
  let opened = false;
  // A change for the repo map lands on its drawing, which the person sees first (as Canvas opens it); reads stay on the map.
  if (drawing && locked !== null && pageId === locked) {
    opened = session.openDrawing?.() ?? false;
    if (!opened || session.readOnly) throw new Error(session.readOnly ? READ_ONLY_REFUSAL : REPO_MAP_REFUSAL);
    const drawn = await shown(current, showsDrawingOf(locked));
    if (!drawn) throw new Error(REPO_MAP_REFUSAL);
    session = drawn;
    pageId = drawn.pageId!;
  }
  const { document, capabilities } = session;
  if (!document) throw new Error(NO_DOCUMENT);
  const selection = { pageId: session.pageId, ids: session.selectedIds?.() ?? [] };
  const outcome = await resolveAgentOpCommand(op, input, { document, pageId, capabilities, selection, client });
  if (outcome.threads) {
    stopIfAborted(signal);
    const now = current();
    if (now.readOnly) throw new Error(READ_ONLY_REFUSAL);
    // The change runs against the editor's document as it is then, so the output is read off that one.
    const { threads, report } = outcome;
    const ran: { before?: SceneDocumentV1; after?: SceneDocumentV1 } = {};
    now.threadChange((before) => {
      ran.before = before;
      ran.after = threads(before);
      return ran.after;
    });
    // The session runs the change only on an open document: one that closed meanwhile took nothing.
    if (!ran.after) throw new Error(NO_DOCUMENT);
    const output = report ? report(ran.after) : outcome.output;
    return ran.after === ran.before ? { output, command: null } : { output, command: null, threadsChanged: true };
  }
  if (!outcome.command) return { output: outcome.output, command: null };
  stopIfAborted(signal);
  let now = current();
  if (now.readOnly || (now.lockedPageId ?? null) === pageId) throw new Error(now.readOnly ? READ_ONLY_REFUSAL : REPO_MAP_REFUSAL);
  // A change for a page that is not on screen shows that page first, so it never happens out of sight.
  if (pageId !== now.pageId && now.showPage) {
    now.showPage(pageId);
    now = await shown(current, (session) => session.pageId === pageId) ?? current();
  }
  const before = now.document;
  if (now.commit(outcome.command) === false) throw new Error(READ_ONLY_REFUSAL);
  // A caller that waits for the document to change (WebMCP) saw it change already, with the drawing: wait for this edit too.
  if (opened) await shown(current, (session) => session.document !== before);
  // Only an edit on the page in view moves the camera, so only that one pays for the diff.
  if (pageId === now.pageId && now.onApplied) {
    const touched = commandTouchedRoots(document, outcome.command, pageId);
    if (touched.length) now.onApplied(touched);
  }
  return { output: outcome.output, command: outcome.command };
}
