import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CanvasCamera } from '../../domain/camera/types';
import {
  addComment, addThread, editComment, moveThread, pageThreads, removeComment, removeThread, setThreadResolved,
} from '../../domain/threads/threads';
import type { Point2d } from '../../domain/geometry/types';
import type { SceneThread, SceneDocumentV1, ScenePage } from '../../domain/document/types';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import { Avatar, CommentComposer, ThreadPopover } from './V2CommentsParts';
import { mintV2Id } from './v2Document';
import { HUMAN_AUTHOR_NAME, keyboardSpot, pinNudge } from './v2CommentsView';
import { Placement } from './v2CommentPlacement';
import type { V2Tool } from './v2ToolCatalog';
import { FRESH_GUARD, hasDraftText, outsideClick, typed, type DraftGuard } from './v2DraftGuard';

const placementFor = (cameraRef: RefObject<CanvasCamera>, sectionRef: RefObject<HTMLElement | null>): Placement =>
  new Placement(() => cameraRef.current, () => sectionRef.current?.clientWidth ?? Infinity);

const PlacementContext = createContext<Placement | null>(null);

/** Children sit at a world point; the tip of whatever is inside is the origin. */
function Anchored(props: { readonly world: Point2d; readonly className?: string; readonly children: ReactNode; readonly testId?: string }): React.JSX.Element {
  const placement = useContext(PlacementContext);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !placement) return;
    placement.add(el, props.world);
    return () => placement.remove(el);
    // The world point is handed over below on every render; add/remove is for mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placement]);
  useLayoutEffect(() => {
    if (ref.current) placement?.move(ref.current, props.world);
  }, [placement, props.world]);
  return <div ref={ref} className={`ofk-comment-anchor ${props.className ?? ''}`} data-testid={props.testId}>{props.children}</div>;
}

type Open =
  | { readonly kind: 'composer'; readonly world: Point2d; readonly nodeId: string | null }
  /** `shownResolved`: opened from the Threads panel while resolved, so it stays up (its pin is drawn dimmed) until closed. */
  | { readonly kind: 'thread'; readonly id: string; readonly shownResolved?: boolean };

/** Ask the canvas to open a thread's popover (the Threads panel, a deep link); `seq` makes asking twice for one thread count twice. */
export interface OpenThreadRequest { readonly threadId: string; readonly seq: number }

interface Props {
  readonly page: ScenePage;
  readonly sectionRef: RefObject<HTMLElement | null>;
  readonly hostRef: RefObject<PixiRendererHost | null>;
  readonly cameraRef: RefObject<CanvasCamera>;
  /** Called on every camera write; the pin loop sleeps until one wakes it. Returns the way to stop listening. */
  readonly subscribeCamera: (listener: () => void) => () => void;
  /** The selected node's id, read when a thread is placed from the keyboard. */
  readonly selectedNodeId: () => string | null;
  /** Filled with the way to open a composer without a pointer (Enter with the comment tool); false when it cannot. */
  readonly placeRef: RefObject<() => boolean>;
  readonly tool: V2Tool;
  /** Pins and threads show; nothing can be added or changed. */
  readonly readOnly: boolean;
  /** The canvas shows another page than the one holding the threads (Map): their coordinates mean nothing there. */
  readonly hidden: boolean;
  readonly updateThreads: (change: (document: SceneDocumentV1) => SceneDocumentV1) => void;
  /** Open this thread's popover as soon as its page is the one shown. */
  readonly request: OpenThreadRequest | null;
  /** The thread whose popover is open (null for none): the Threads panel highlights its card. */
  readonly onOpenThreadChange: (threadId: string | null) => void;
  /** Threads with news for this viewer: their pin carries a dot. */
  readonly unread: ReadonlySet<string>;
}

/** A press on a pin that moves less than this is a click. */
const DRAG_PX = 4;

const HUMAN_AUTHOR = { kind: 'human' as const, name: HUMAN_AUTHOR_NAME };

/** The open box shakes (an outline flash under reduced motion) and keeps its text and focus. */
function shake(section: HTMLElement): void {
  const card = section.querySelector<HTMLElement>('[data-comment-open]');
  if (!card) return;
  card.removeAttribute('data-wiggle');
  void card.offsetWidth;
  card.setAttribute('data-wiggle', '');
  window.setTimeout(() => card.removeAttribute('data-wiggle'), 350);
  // The press moves focus to the canvas; give it back once that has happened.
  requestAnimationFrame(() => card.querySelector<HTMLElement>('textarea')?.focus({ preventScroll: true }));
}

/** Comment pins over the canvas, the composer a click with the comment tool opens, and a pin's thread. DOM, so no export ever draws them. */
export function V2Comments(props: Props): React.JSX.Element | null {
  const { page, hidden, readOnly, tool, sectionRef, hostRef, cameraRef, updateThreads, subscribeCamera, placeRef, selectedNodeId } = props;
  const [open, setOpen] = useState<Open | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The loop reads the refs when a frame runs, never during render.
  const [placement] = useState(() => placementFor(cameraRef, sectionRef));
  useEffect(() => () => placement.stop(), [placement]);
  useEffect(() => subscribeCamera(() => placement.kick()), [placement, subscribeCamera]);
  // A narrower section can put a card on the wrong side of its pin with the camera still.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => placement.kick());
    observer.observe(section);
    return () => observer.disconnect();
  }, [placement, sectionRef]);

  const openId = open?.kind === 'thread' ? open.id : null;
  const shownResolved = open?.kind === 'thread' && open.shownResolved === true;
  const threads = useMemo(() => pageThreads(page).filter((thread) => !thread.resolved || (shownResolved && thread.id === openId)), [page, shownResolved, openId]);
  const openThread = open?.kind === 'thread' ? pageThreads(page).find((thread) => thread.id === open.id) : undefined;
  // A thread that went away (deleted, an agent resolved it, another page) closes with it.
  useEffect(() => {
    if (open?.kind === 'thread' && (!openThread || (openThread.resolved && !open.shownResolved))) setOpen(null);
  }, [open, openThread]);
  useEffect(() => { setOpen(null); }, [page.id, hidden]);
  // Asked from outside (after the reset above, which a page switch runs): open once this page holds the thread and the canvas is shown.
  const requestSeq = props.request?.seq;
  const requestedId = props.request?.threadId;
  const handled = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (requestSeq === undefined || requestedId === undefined || hidden || requestSeq === handled.current) return;
    const target = pageThreads(page).find((thread) => thread.id === requestedId);
    if (!target) return;
    handled.current = requestSeq;
    setOpen({ kind: 'thread', id: target.id, ...(target.resolved ? { shownResolved: true } : {}) });
    // Only a new request opens; the thread, page and mode are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestSeq, requestedId, page.id, hidden]);
  const { onOpenThreadChange } = props;
  useEffect(() => { onOpenThreadChange(openId); }, [openId, onOpenThreadChange]);
  // Closing the canvas of a page (Map) or the editor reports nothing open.
  useEffect(() => () => onOpenThreadChange(null), [onOpenThreadChange]);
  useEffect(() => { if (readOnly && open?.kind === 'composer') setOpen(null); }, [readOnly, open]);
  // Ages tick while a thread is open.
  useEffect(() => {
    if (open?.kind !== 'thread') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  const latest = useRef({ open, tool, readOnly, hidden });
  useEffect(() => { latest.current = { open, tool, readOnly, hidden }; });
  // Enter with the comment tool: the keyboard's click. At the selected node's centre, else the middle of the canvas.
  useEffect(() => {
    placeRef.current = () => {
      const state = latest.current;
      const host = hostRef.current;
      const section = sectionRef.current;
      if (!host || !section || state.open || state.hidden || state.readOnly || state.tool !== 'comment') return false;
      const nodeId = selectedNodeId();
      const spot = keyboardSpot(nodeId ? host.getNodeScreenBounds(nodeId) : null, { width: section.clientWidth, height: section.clientHeight });
      setOpen({ kind: 'composer', world: host.screenToWorld(spot.point), nodeId: spot.onNode ? nodeId : null });
      return true;
    };
    return () => { placeRef.current = () => false; };
  }, [placeRef, hostRef, sectionRef, selectedNodeId]);
  // What is typed in the open box, and whether a click away has already warned about it.
  const draft = useRef({ text: '', guard: FRESH_GUARD as DraftGuard });
  const onDraft = useCallback((text: string) => { draft.current = { text, guard: typed(draft.current.guard) }; }, []);
  useEffect(() => { draft.current = { text: '', guard: FRESH_GUARD }; }, [open]);
  // One press on the canvas: clicking away closes what is open (and only that); with nothing open, the comment tool places a composer.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const onDown = (event: PointerEvent) => {
      const state = latest.current;
      if (event.button !== 0 || state.hidden) return;
      const target = event.target as Element;
      if (target.closest('[data-comment-ui]')) return;
      if (state.open) {
        const verdict = outsideClick(draft.current.guard, hasDraftText(draft.current.text));
        draft.current.guard = verdict.guard;
        if (verdict.outcome === 'warn') { shake(section); return; }
        setOpen(null);
        return;
      }
      const host = hostRef.current;
      if (state.tool !== 'comment' || state.readOnly || !host) return;
      const rect = section.getBoundingClientRect();
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setOpen({ kind: 'composer', world: host.screenToWorld(screen), nodeId: host.pickNode(screen) });
    };
    section.addEventListener('pointerdown', onDown);
    return () => section.removeEventListener('pointerdown', onDown);
  }, [sectionRef, hostRef]);
  // Leaving the comment tool abandons a half-written composer.
  useEffect(() => { if (tool !== 'comment') setOpen((current) => (current?.kind === 'composer' ? null : current)); }, [tool]);

  // A pin pressed and moved past DRAG_PX is carried with the pointer and dropped somewhere else: under a node it follows it, on empty canvas it is a page pin.
  const [drag, setDrag] = useState<{ id: string; world: Point2d } | null>(null);
  const pressed = useRef<{ id: string; x: number; y: number; moved: boolean; world: Point2d } | null>(null);
  const justDragged = useRef(false);
  const worldAt = (event: { clientX: number; clientY: number }) => {
    const rect = sectionRef.current?.getBoundingClientRect();
    const host = hostRef.current;
    if (!rect || !host) return null;
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return { screen, world: host.screenToWorld(screen) };
  };
  const pinHandlers = (threadId: string) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || readOnly) return;
      pressed.current = { id: threadId, x: event.clientX, y: event.clientY, moved: false, world: { x: 0, y: 0 } };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      const press = pressed.current;
      if (!press || press.id !== threadId) return;
      if (!press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_PX) return;
      const at = worldAt(event);
      if (!at) return;
      press.moved = true;
      press.world = at.world;
      setDrag({ id: threadId, world: at.world });
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      const press = pressed.current;
      pressed.current = null;
      if (!press || press.id !== threadId || !press.moved) return;
      justDragged.current = true;
      // The click that follows a drop is not a click on the pin.
      window.setTimeout(() => { justDragged.current = false; }, 0);
      setDrag(null);
      const at = worldAt(event);
      if (at) updateThreads((doc) => moveThread(doc, threadId, hostRef.current?.pickNode(at.screen) ?? null, at.world));
    },
    onPointerCancel: () => { pressed.current = null; setDrag(null); },
  });

  const message = useCallback((body: string) => ({ id: mintV2Id('msg'), author: HUMAN_AUTHOR, body, createdAt: new Date().toISOString() }), []);
  if (hidden) return null;

  const create = (body: string) => {
    if (open?.kind !== 'composer') return;
    const threadId = mintV2Id('thread');
    const next = message(body);
    updateThreads((doc) => addThread(doc, { pageId: page.id, threadId, nodeId: open.nodeId, point: open.world, comment: next }));
    // The comment tool stays active: the next click starts the next thread. Esc or another tool leaves it.
    setOpen(null);
    sectionRef.current?.focus({ preventScroll: true });
  };
  const reply = (thread: SceneThread, body: string) => {
    const next = message(body);
    updateThreads((doc) => addComment(doc, thread.id, next));
  };

  return (
    <PlacementContext.Provider value={placement}>
      {threads.map((thread) => {
        const lead = thread.comments[0]!;
        const selected = open?.kind === 'thread' && open.id === thread.id;
        const unread = props.unread.has(thread.id);
        return (
          <Anchored key={thread.id} world={drag?.id === thread.id ? drag.world : thread.anchor.point} className="ofk-comment-pinned" testId="v2-comment-pin">
            <button type="button" className="ofk-comment-pin" data-comment-ui data-selected={selected || undefined} data-kind={lead.author.kind}
              data-unread={unread || undefined} data-resolved={thread.resolved || undefined}
              aria-label={`Comment by ${lead.author.name}${thread.comments.length > 1 ? `, ${thread.comments.length} messages` : ''}${unread ? ', unread' : ''}`}
              aria-expanded={selected} data-dragging={drag?.id === thread.id || undefined} {...pinHandlers(thread.id)}
              onKeyDown={(event) => {
                const by = readOnly ? null : pinNudge(event.key, event.altKey, event.shiftKey);
                if (!by) return;
                event.preventDefault();
                const { nodeId, point } = thread.anchor;
                updateThreads((doc) => moveThread(doc, thread.id, nodeId, { x: point.x + by.x, y: point.y + by.y }));
              }}
              onClick={() => { if (!justDragged.current) setOpen(selected ? null : { kind: 'thread', id: thread.id }); }}>
              <Avatar kind={lead.author.kind} name={lead.author.name} size={22} />
            </button>
            {selected && openThread ? (
              <ThreadPopover thread={openThread} readOnly={readOnly} onDraft={onDraft} now={now}
                onClose={() => { setOpen(null); sectionRef.current?.focus({ preventScroll: true }); }}
                onResolve={() => { updateThreads((doc) => setThreadResolved(doc, thread.id, !thread.resolved)); setOpen(null); }}
                onDeleteThread={() => { updateThreads((doc) => removeThread(doc, thread.id)); setOpen(null); }}
                onReply={(body) => reply(thread, body)}
                onEditMessage={(commentId, body) => updateThreads((doc) => editComment(doc, thread.id, commentId, body, new Date().toISOString()))}
                onDeleteMessage={(commentId) => updateThreads((doc) => removeComment(doc, thread.id, commentId))} />
            ) : null}
          </Anchored>
        );
      })}
      {open?.kind === 'composer' ? (
        <Anchored world={open.world} className="ofk-comment-pinned" testId="v2-comment-composer">
          <span className="ofk-comment-pin" data-ghost><Avatar kind="human" name={HUMAN_AUTHOR_NAME} size={22} /></span>
          <CommentComposer onDraft={onDraft} onSend={create} onCancel={() => { setOpen(null); sectionRef.current?.focus({ preventScroll: true }); }} />
        </Anchored>
      ) : null}
    </PlacementContext.Provider>
  );
}

type HostInput = Omit<Props, 'updateThreads'> & {
  readonly session: { readonly updateThreads: Props['updateThreads'] };
};

/** V2Comments wired to the editor's session. */
export function V2CommentsHost({ session, ...rest }: HostInput): React.JSX.Element | null {
  return <V2Comments {...rest} updateThreads={session.updateThreads} />;
}
