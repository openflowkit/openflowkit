import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { IconArrowUp, IconCheck, IconDots, IconPencil, IconSparkles, IconTrash, IconUser, IconX } from '@tabler/icons-react';
import type { SceneComment, SceneThread } from '../../domain/document/types';
import { COMMENT_BODY_MAX } from '../../domain/document/types';
import { Button, Icon, IconButton, Menu, MenuItem, Tooltip } from '../design-system';
import { avatarColor, relativeTime } from './v2CommentsView';
import { CommentDrafts, draftKey } from './v2DraftGuard';

/** Where every comment box keeps its unsent text (V2Comments owns it), so closing a box never loses what was typed. */
export const DraftsContext = createContext(new CommentDrafts());

/** A box's text, kept in the drafts under `key` as it is typed. `initial` is what an untouched box holds (an edit's message). */
function useDraft(key: string, initial = ''): readonly [string, (text: string) => void] {
  const drafts = useContext(DraftsContext);
  const [text, setText] = useState(() => (drafts.has(key) ? drafts.get(key) : initial));
  const write = (next: string) => { setText(next); drafts.set(key, next === initial ? '' : next); };
  return [text, write];
}

// Keys typed into a comment belong to the comment: they never reach the editor's shortcuts.
const keep = (event: KeyboardEvent): void => event.stopPropagation();

/** A card's keys: none reaches the editor, and Escape closes the card unless something inside (an edit box, a menu) took it. */
function cardKeys(onClose: () => void) {
  return (event: KeyboardEvent) => {
    keep(event);
    if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as Element).closest('[role="menu"]')) {
      event.preventDefault();
      onClose();
    }
  };
}

export function Avatar({ kind, name, size = 24 }: { readonly kind: 'human' | 'agent'; readonly name: string; readonly size?: number }): React.JSX.Element {
  return kind === 'agent'
    ? <span className="ofk-comment-avatar" data-kind="agent" style={{ width: size, height: size }} aria-hidden="true"><Icon icon={IconSparkles} /></span>
    : <span className="ofk-comment-avatar" style={{ width: size, height: size, background: avatarColor(name) }} aria-hidden="true"><Icon icon={IconUser} /></span>;
}

/** Enter sends, Shift+Enter breaks a line; `onEscape` gives the box its own Escape (else the card's closes it). The box grows with its text. */
function CommentInput(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  readonly onEscape?: () => void;
  readonly placeholder: string;
  readonly label: string;
  readonly autoFocus?: boolean;
  readonly selectOnFocus?: boolean;
  readonly sendLabel?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  // After the opening click has finished moving focus (the canvas takes it on pointerdown).
  useEffect(() => {
    if (!props.autoFocus) return;
    const frame = requestAnimationFrame(() => {
      const box = ref.current;
      if (!box) return;
      box.focus({ preventScroll: true });
      if (props.selectOnFocus) box.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [props.autoFocus, props.selectOnFocus]);
  const empty = props.value.trim() === '';
  return (
    <div className="ofk-comment-input">
      <textarea ref={ref} rows={1} value={props.value} maxLength={COMMENT_BODY_MAX} placeholder={props.placeholder} aria-label={props.label}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          // The card around the box keeps every key from the editor and closes on an Escape this box leaves alone.
          if (event.key === 'Escape' && props.onEscape) { event.preventDefault(); props.onEscape(); return; }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!empty) props.onSend();
          }
        }} />
      <Tooltip content={props.sendLabel ?? 'Send comment'} shortcut="Enter">
        <button type="button" className="ofk-comment-send" disabled={empty} aria-label={props.sendLabel ?? 'Send comment'} onClick={props.onSend}>
          <Icon icon={IconArrowUp} />
        </button>
      </Tooltip>
    </div>
  );
}

/** A new thread's opening box, next to the ghost pin. */
export function CommentComposer(props: {
  /** The page it is on: a new thread's unsent text is kept per page (draftKey.compose). */
  readonly pageId: string;
  readonly onSend: (body: string) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [body, setBody] = useDraft(draftKey.compose(props.pageId));
  return (
    <div className="ofk-comment-card ofk-comment-composer" role="dialog" aria-label="New comment" data-comment-ui data-comment-open
      onKeyDown={cardKeys(props.onCancel)}>
      <CommentInput value={body} onChange={setBody} onSend={() => { props.onSend(body); setBody(''); }}
        placeholder="Add a comment" label="Comment" autoFocus />
    </div>
  );
}

function MessageMenu(props: { readonly label: string; readonly onEdit: () => void; readonly onDelete: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton ref={anchor} variant="quiet" label={props.label} aria-haspopup="menu" aria-expanded={open}
        icon={<Icon icon={IconDots} />} onClick={() => setOpen((on) => !on)} />
      <Menu open={open} anchorRef={anchor} onClose={() => setOpen(false)} label={props.label} placement="bottom-end" data-comment-ui>
        <MenuItem icon={<Icon icon={IconPencil} />} onSelect={props.onEdit}>Edit</MenuItem>
        <MenuItem icon={<Icon icon={IconTrash} />} danger onSelect={props.onDelete}>Delete</MenuItem>
      </Menu>
    </>
  );
}

function Message(props: {
  readonly threadId: string;
  readonly message: SceneComment;
  readonly canEdit: boolean;
  readonly now: number;
  readonly onEdit: (body: string) => void;
  readonly onDelete: () => void;
}): React.JSX.Element {
  const { message } = props;
  const key = draftKey.edit(props.threadId, message.id);
  const drafts = useContext(DraftsContext);
  // An edit left unsaved when the thread closed is still open, with its text, when the thread opens again.
  const [editing, setEditing] = useState(() => drafts.has(key));
  const [draft, setDraft] = useDraft(key, message.body);
  const stop = () => { setDraft(message.body); setEditing(false); };
  const commit = () => { if (draft.trim()) { props.onEdit(draft); stop(); } };
  return (
    <li className="ofk-comment-message" data-testid="v2-comment-message">
      <Avatar kind={message.author.kind} name={message.author.name} />
      <div>
        <p className="ofk-comment-meta">
          <strong>{message.author.name}</strong>
          <time dateTime={message.createdAt}>{relativeTime(message.createdAt, props.now)}</time>
          {message.editedAt ? <span>edited</span> : null}
        </p>
        {editing ? (
          <div className="ofk-comment-edit">
            <CommentInput value={draft} onChange={setDraft} onSend={commit} onEscape={stop}
              placeholder="Edit comment" label="Edit comment" sendLabel="Save comment" autoFocus selectOnFocus />
          </div>
        ) : <p className="ofk-comment-body">{message.body}</p>}
      </div>
      {props.canEdit && !editing ? (
        <MessageMenu label="Comment actions" onEdit={() => setEditing(true)} onDelete={props.onDelete} />
      ) : null}
    </li>
  );
}

/** A thread: its messages, a reply box, and resolve / delete. Read-only shows the conversation and nothing to change. */
export function ThreadPopover(props: {
  readonly thread: SceneThread;
  readonly readOnly: boolean;
  readonly onClose: () => void;
  readonly onResolve: () => void;
  readonly onDeleteThread: () => void;
  readonly onReply: (body: string) => void;
  readonly onEditMessage: (commentId: string, body: string) => void;
  readonly onDeleteMessage: (commentId: string) => void;
  readonly now: number;
  /** Opens asking to delete the thread (Delete on its pin). */
  readonly askDelete?: boolean;
}): React.JSX.Element {
  const { thread, readOnly } = props;
  const [reply, setReply] = useDraft(draftKey.reply(thread.id));
  const [menuOpen, setMenuOpen] = useState(false);
  // Every delete asks first, in the card: a reply (its id), or the thread (null; deleting the opening message is deleting it).
  // Thread changes are not undo steps, so this is the only way back.
  const [confirming, setConfirming] = useState<{ readonly commentId: string | null } | null>(props.askDelete ? { commentId: null } : null);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const count = thread.comments.length;
  useLayoutEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [count]);
  const first = thread.comments[0]?.id;
  let body: ReactNode = null;
  if (confirming) {
    const reply = confirming.commentId;
    body = (
      <div className="ofk-comment-confirm" role="alert">
        <p>{reply ? 'Delete this reply?' : `Delete this thread${count > 1 ? ` and its ${count} messages` : ''}?`}</p>
        <div>
          <Button variant="danger" autoFocus onClick={() => {
            setConfirming(null);
            if (reply) props.onDeleteMessage(reply); else props.onDeleteThread();
          }}>{reply ? 'Delete reply' : 'Delete thread'}</Button>
          <Button variant="quiet" onClick={() => setConfirming(null)}>Cancel</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="ofk-comment-card ofk-comment-thread" role="dialog" aria-label="Comment thread" data-comment-ui data-comment-open
      data-testid="v2-comment-thread" onKeyDown={cardKeys(props.onClose)}>
      <header>
        <h3>Comment</h3>
        {readOnly ? null : (
          <>
            <IconButton ref={menuAnchor} variant="quiet" label="Thread actions" aria-haspopup="menu" aria-expanded={menuOpen}
              icon={<Icon icon={IconDots} />} onClick={() => setMenuOpen((open) => !open)} />
            <Menu open={menuOpen} anchorRef={menuAnchor} onClose={() => setMenuOpen(false)} label="Thread actions" placement="bottom-end" data-comment-ui>
              <MenuItem icon={<Icon icon={IconTrash} />} danger onSelect={() => setConfirming({ commentId: null })}>Delete thread…</MenuItem>
            </Menu>
            <IconButton variant="quiet" label={thread.resolved ? 'Reopen thread' : 'Resolve thread'} icon={<Icon icon={IconCheck} />} onClick={props.onResolve} />
          </>
        )}
        <IconButton variant="quiet" label="Close thread" icon={<Icon icon={IconX} />} onClick={props.onClose} />
      </header>
      {body}
      <ul ref={listRef} className="ofk-comment-messages">
        {thread.comments.map((message) => (
          <Message key={message.id} threadId={thread.id} message={message} now={props.now}
            canEdit={!readOnly && message.author.kind === 'human'}
            onEdit={(text) => props.onEditMessage(message.id, text)}
            onDelete={() => setConfirming({ commentId: message.id === first ? null : message.id })} />
        ))}
      </ul>
      {readOnly ? null : (
        <footer>
          <CommentInput value={reply} onChange={setReply} placeholder="Reply" label="Reply" sendLabel="Send reply"
            onSend={() => { props.onReply(reply); setReply(''); }} />
        </footer>
      )}
    </div>
  );
}
