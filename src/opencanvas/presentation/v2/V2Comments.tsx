import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CanvasCamera } from '../../domain/camera/types';
import {
  addComment, addThread, editComment, moveThread, pageThreads, removeComment, removeThread, setThreadResolved,
} from '../../domain/threads/threads';
import type { Point2d } from '../../domain/geometry/types';
import type { SceneThread, SceneDocumentV1, ScenePage } from '../../domain/document/types';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import { Avatar, CommentComposer, DraftsContext, ThreadPopover } from './V2CommentsParts';
import { mintV2Id } from './v2Document';
import { HUMAN_AUTHOR_NAME, keyboardSpot, pinNudge } from './v2CommentsView';
import { Placement } from './v2CommentPlacement';
import { clearance } from './map/mapMode';
import type { V2Tool } from './v2ToolCatalog';
import { CommentDrafts, draftKey, FRESH_GUARD, outsideClick, typed, type DraftGuard } from './v2DraftGuard';

/** The editor's ways into the comment layer, filled by V2Comments (as useV2Pointer fills the gesture API). */
export interface V2CommentApi {
  /** Enter with the comment tool: back into the open box, else a new thread at the selection or the centre. False when it did nothing. */
  readonly enter: () => boolean;
  /** Escape: closes the open box, first in the editor's chain. False when nothing is open. */
  readonly escape: () => boolean;
  /** A click on the canvas with the comment tool (the pointer pipeline's, screen point in the canvas). */
  readonly click: (point: Point2d) => void;
}

// A card opens in the canvas the side panels and floating chrome leave free, as the camera frames things there.
const placementFor = (cameraRef: RefObject<CanvasCamera>, hostRef: RefObject<PixiRendererHost | null>): Placement =>
  new Placement(() => cameraRef.current, () => (hostRef.current ? clearance(hostRef.current) : null));

const PlacementContext = createContext<Placement | null>(null);

/** Children sit at a world point; the tip of whatever is inside is the origin. `card`: an open card is among them. */
function Anchored(props: { readonly world: Point2d; readonly card?: boolean; readonly className?: string; readonly children: ReactNode; readonly testId?: string }): React.JSX.Element {
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
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) placement?.setCard(el, props.card ? el.querySelector<HTMLElement>('[data-comment-open]') : null);
  }, [placement, props.card]);
  return <div ref={ref} className={`ofk-comment-anchor ${props.className ?? ''}`} data-testid={props.testId}>{props.children}</div>;
}

type Open =
  | { readonly kind: 'composer'; readonly world: Point2d; readonly nodeId: string | null }
  | { readonly kind: 'thread'; readonly id: string };

interface Props {
  readonly page: ScenePage;
  readonly sectionRef: RefObject<HTMLElement | null>;
  readonly hostRef: RefObject<PixiRendererHost | null>;
  readonly cameraRef: RefObject<CanvasCamera>;
  /** Called on every camera write; the pin loop sleeps until one wakes it. Returns the way to stop listening. */
  readonly subscribeCamera: (listener: () => void) => () => void;
  /** The selected node's id, read when a thread is placed from the keyboard. */
  readonly selectedNodeId: () => string | null;
  readonly apiRef: RefObject<V2CommentApi | null>;
  readonly tool: V2Tool;
  /** Pins and threads show; nothing can be added or changed. */
  readonly readOnly: boolean;
  /** The canvas shows another page than the one holding the threads (Map): their coordinates mean nothing there. */
  readonly hidden: boolean;
  /** Changes when a side panel opens or closes: the free canvas an open card stays inside changed. */
  readonly panelsKey: string;
  readonly updateThreads: (change: (document: SceneDocumentV1) => SceneDocumentV1) => void;
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
  const { page, hidden, readOnly, tool, sectionRef, hostRef, cameraRef, updateThreads, subscribeCamera, apiRef, selectedNodeId } = props;
  const [open, setOpen] = useState<Open | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The loop reads the refs when a frame runs, never during render.
  // eslint-disable-next-line react-hooks/refs -- only handed over here; a frame reads them
  const [placement] = useState(() => placementFor(cameraRef, hostRef));
  useEffect(() => () => placement.stop(), [placement]);
  useEffect(() => subscribeCamera(() => placement.kick()), [placement, subscribeCamera]);
  // A panel that opens or a narrower section can leave a card under the panel or on the wrong side, with the camera still.
  useEffect(() => { placement.kick(); }, [placement, props.panelsKey]);
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => placement.kick());
    observer.observe(section);
    return () => observer.disconnect();
  }, [placement, sectionRef]);

  const threads = useMemo(() => pageThreads(page).filter((thread) => !thread.resolved), [page]);
  const openThread = open?.kind === 'thread' ? pageThreads(page).find((thread) => thread.id === open.id) : undefined;
  // A thread that went away (deleted, an agent resolved it, another page) closes with it.
  useEffect(() => {
    if (open?.kind === 'thread' && (!openThread || openThread.resolved)) setOpen(null);
  }, [open, openThread]);
  useEffect(() => { setOpen(null); }, [page.id, hidden]);
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
  // Unsent text by box, kept for the editor's life; whether a click away has already warned about the open box's.
  const guard = useRef<DraftGuard>(FRESH_GUARD);
  // eslint-disable-next-line react-hooks/refs -- only handed over here; a later keystroke writes it
  const [drafts] = useState(() => new CommentDrafts(() => { guard.current = typed(guard.current); }));
  useEffect(() => { guard.current = FRESH_GUARD; }, [open]);
  const pageId = page.id;
  const pageIdRef = useRef(pageId);
  useEffect(() => { pageIdRef.current = pageId; });
  /** The open box holds unsent text. */
  const unsent = useCallback((box: Open | null) => (box?.kind === 'thread' ? drafts.inThread(box.id)
    : box?.kind === 'composer' ? drafts.has(draftKey.compose(pageIdRef.current)) : false), [drafts]);
  /** Closes the open box; focus goes back to the thread's pin, or to the canvas. */
  const close = useCallback(() => {
    const current = latest.current.open;
    setOpen(null);
    const pin = current?.kind === 'thread'
      ? sectionRef.current?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(current.id)}"]`) : null;
    (pin ?? sectionRef.current)?.focus({ preventScroll: true });
  }, [sectionRef]);
  // Whether the press going on now found a box open: the document hears it before the canvas, so the click it ends in is not a new thread.
  const pressFoundOpen = useRef(false);
  // A press anywhere outside the open box (canvas, toolbar, rail, a panel) closes it, as a popover's does; text in it warns first.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const state = latest.current;
      pressFoundOpen.current = state.open !== null && !state.hidden;
      if (!pressFoundOpen.current || event.button !== 0) return;
      // The open box, the pins and the menus they open.
      if ((event.target as Element | null)?.closest?.('[data-comment-ui]')) return;
      const verdict = outsideClick(guard.current, unsent(state.open));
      guard.current = verdict.guard;
      if (verdict.outcome === 'warn') { if (sectionRef.current) shake(sectionRef.current); return; }
      setOpen(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [sectionRef, unsent]);
  useEffect(() => {
    // A composer at a screen point of the canvas, on the node under it.
    const compose = (point: Point2d, nodeId: string | null) => {
      const host = hostRef.current;
      if (host) setOpen({ kind: 'composer', world: host.screenToWorld(point), nodeId });
    };
    const canAdd = () => { const state = latest.current; return !state.hidden && !state.readOnly && state.tool === 'comment'; };
    apiRef.current = {
      enter: () => {
        const section = sectionRef.current;
        const box = section?.querySelector<HTMLElement>('[data-comment-open] textarea');
        if (latest.current.open && box) { box.focus({ preventScroll: true }); return true; }
        const host = hostRef.current;
        if (!host || !section || latest.current.open || !canAdd()) return false;
        // At the selected node's centre, else the middle of the canvas.
        const nodeId = selectedNodeId();
        const spot = keyboardSpot(nodeId ? host.getNodeScreenBounds(nodeId) : null, { width: section.clientWidth, height: section.clientHeight });
        compose(spot.point, spot.onNode ? nodeId : null);
        return true;
      },
      escape: () => {
        if (!latest.current.open || latest.current.hidden) return false;
        close();
        return true;
      },
      click: (point) => {
        if (pressFoundOpen.current || latest.current.open || !canAdd()) return;
        compose(point, hostRef.current?.pickNode(point) ?? null);
      },
    };
    return () => { apiRef.current = null; };
  }, [apiRef, hostRef, sectionRef, selectedNodeId, close]);
  // Leaving the comment tool closes an empty composer; one holding text stays until it is sent or closed.
  useEffect(() => {
    if (tool !== 'comment') setOpen((current) => (current?.kind === 'composer' && !unsent(current) ? null : current));
  }, [tool, unsent]);

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
    close();
  };
  const reply = (thread: SceneThread, body: string) => {
    const next = message(body);
    updateThreads((doc) => addComment(doc, thread.id, next));
  };

  return (
    <DraftsContext.Provider value={drafts}>
    <PlacementContext.Provider value={placement}>
      {threads.map((thread) => {
        const lead = thread.comments[0]!;
        const selected = open?.kind === 'thread' && open.id === thread.id;
        return (
          <Anchored key={thread.id} world={drag?.id === thread.id ? drag.world : thread.anchor.point} card={selected && openThread !== undefined} className="ofk-comment-pinned" testId="v2-comment-pin">
            <button type="button" className="ofk-comment-pin" data-comment-ui data-thread-id={thread.id} data-selected={selected || undefined} data-kind={lead.author.kind}
              aria-label={`Comment by ${lead.author.name}${thread.comments.length > 1 ? `, ${thread.comments.length} messages` : ''}`}
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
              <ThreadPopover thread={openThread} readOnly={readOnly} now={now}
                onClose={close}
                onResolve={() => { updateThreads((doc) => setThreadResolved(doc, thread.id, !thread.resolved)); setOpen(null); }}
                onDeleteThread={() => { updateThreads((doc) => removeThread(doc, thread.id)); drafts.dropThread(thread.id); setOpen(null); }}
                onReply={(body) => reply(thread, body)}
                onEditMessage={(commentId, body) => updateThreads((doc) => editComment(doc, thread.id, commentId, body, new Date().toISOString()))}
                onDeleteMessage={(commentId) => updateThreads((doc) => removeComment(doc, thread.id, commentId))} />
            ) : null}
          </Anchored>
        );
      })}
      {open?.kind === 'composer' ? (
        <Anchored world={open.world} card className="ofk-comment-pinned" testId="v2-comment-composer">
          <span className="ofk-comment-pin" data-ghost><Avatar kind="human" name={HUMAN_AUTHOR_NAME} size={22} /></span>
          <CommentComposer pageId={page.id} onSend={create} onCancel={close} />
        </Anchored>
      ) : null}
    </PlacementContext.Provider>
    </DraftsContext.Provider>
  );
}
