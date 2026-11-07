import { createContext, memo, useContext, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { Point2d } from '../../domain/geometry/types';
import type { SceneThread } from '../../domain/document/types';
import { Avatar } from './V2CommentsParts';
import { pinLabel } from './v2CommentsView';
import type { Placement } from './v2CommentPlacement';

export const PlacementContext = createContext<Placement | null>(null);

/** Children sit at a world point; the tip of whatever is inside is the origin. `card`: an open card is among them. */
export function Anchored(props: { readonly world: Point2d; readonly card?: boolean; readonly className?: string; readonly children: ReactNode; readonly testId?: string }): React.JSX.Element {
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

/** What a pin does, one object for every pin and the layer's life, so a pin re-renders only when its own thread or state does. */
export interface PinActions {
  readonly press: (threadId: string, event: PointerEvent<HTMLButtonElement>) => void;
  readonly drag: (threadId: string, event: PointerEvent<HTMLButtonElement>) => void;
  readonly drop: (threadId: string, event: PointerEvent<HTMLButtonElement>) => void;
  readonly cancel: () => void;
  readonly toggle: (threadId: string) => void;
  readonly key: (thread: SceneThread, event: KeyboardEvent<HTMLButtonElement>) => void;
}

/** One thread's pin, and its card when it is the open one (`children`). */
export const CommentPin = memo(function CommentPin(props: {
  readonly thread: SceneThread;
  readonly world: Point2d;
  readonly selected: boolean;
  readonly dragging: boolean;
  readonly actions: PinActions;
  readonly children?: ReactNode;
}): React.JSX.Element {
  const { thread, actions } = props;
  const lead = thread.comments[0]!;
  return (
    <Anchored world={props.world} card={props.children != null} className="ofk-comment-pinned" testId="v2-comment-pin">
      <button type="button" className="ofk-comment-pin" data-comment-ui data-thread-id={thread.id} data-selected={props.selected || undefined}
        data-kind={lead.author.kind} data-dragging={props.dragging || undefined}
        aria-label={pinLabel(thread)}
        aria-expanded={props.selected}
        onPointerDown={(event) => actions.press(thread.id, event)} onPointerMove={(event) => actions.drag(thread.id, event)}
        onPointerUp={(event) => actions.drop(thread.id, event)} onPointerCancel={actions.cancel}
        onKeyDown={(event) => actions.key(thread, event)} onClick={() => actions.toggle(thread.id)}>
        <Avatar kind={lead.author.kind} size={22} />
      </button>
      {props.children}
    </Anchored>
  );
});
