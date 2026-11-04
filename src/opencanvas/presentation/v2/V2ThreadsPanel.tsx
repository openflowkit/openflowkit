// The Threads panel: every thread of the document in one list (Figma's Comments panel, trimmed). It lists, searches and filters;
// the document, the unread marks and the camera are the host's (useV2Threads).
import { useEffect, useRef, useState } from 'react';
import {
  IconAdjustmentsHorizontal, IconCheck, IconDots, IconLink, IconMail, IconMailOpened, IconMessageCircle, IconSearch, IconTrash,
} from '@tabler/icons-react';
import { Button, Dialog, Icon, IconButton, Menu, MenuItem, MenuSeparator, Panel } from '../design-system';
import { Avatar } from './V2CommentsParts';
import { relativeTime } from './v2CommentsView';
import { replyCount, type ThreadEntry, type ThreadFilters } from './v2ThreadsView';

interface Props {
  readonly entries: readonly ThreadEntry[];
  /** Threads in the document, before any search or filter. */
  readonly total: number;
  readonly unread: ReadonlySet<string>;
  /** The thread whose popover is open on the canvas. */
  readonly selectedId: string | null;
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly filters: ThreadFilters;
  readonly onFilters: (patch: Partial<ThreadFilters>) => void;
  /** Nothing can be resolved, deleted or started; the list, search, open and copy link still work. */
  readonly readOnly: boolean;
  /** False when the panel opened by itself (the comment tool, a link): focus stays where it was. */
  readonly focusOnOpen: boolean;
  readonly onSelect: (threadId: string) => void;
  readonly onToggleResolved: (threadId: string) => void;
  readonly onMarkRead: (threadId: string) => void;
  readonly onMarkUnread: (threadId: string) => void;
  readonly onCopyLink: (threadId: string) => void;
  readonly onDelete: (threadId: string) => void;
  readonly onClose: () => void;
}

function Card(props: {
  readonly entry: ThreadEntry;
  readonly unread: boolean;
  readonly selected: boolean;
  readonly readOnly: boolean;
  readonly now: number;
  readonly onSelect: () => void;
  readonly onToggleResolved: () => void;
  readonly onToggleRead: () => void;
  readonly onCopyLink: () => void;
  readonly onDelete: () => void;
}): React.JSX.Element {
  const { entry, unread, selected, readOnly } = props;
  const { thread } = entry;
  const lead = thread.comments[0]!;
  const replies = replyCount(thread);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <li className="ofk-threads-card" data-testid="v2-thread-card" data-thread-id={thread.id} data-selected={selected || undefined}
      data-resolved={thread.resolved || undefined} data-unread={unread || undefined} data-menu-open={menuOpen || undefined}>
      <button type="button" className="ofk-threads-card-main" aria-current={selected || undefined} onClick={props.onSelect}>
        <Avatar kind={lead.author.kind} name={lead.author.name} size={28} />
        <span className="ofk-threads-card-text">
          <span className="ofk-threads-card-where">
            <span>#{thread.number} · {entry.pageName}</span>
            {thread.resolved ? <span className="ofk-threads-card-state">Resolved</span> : null}
            {unread ? <span className="ofk-threads-card-dot" role="img" aria-label="Unread" /> : null}
          </span>
          <span className="ofk-threads-card-meta">
            <strong>{lead.author.name}</strong>
            <time dateTime={lead.createdAt}>{relativeTime(lead.createdAt, props.now)}</time>
          </span>
          <span className="ofk-threads-card-body">{lead.body}</span>
          {replies > 0 ? <span className="ofk-threads-card-replies">{replies} {replies === 1 ? 'reply' : 'replies'}</span> : null}
        </span>
      </button>
      <div className="ofk-threads-card-actions">
        {readOnly ? null : (
          <IconButton variant="quiet" label={thread.resolved ? 'Reopen thread' : 'Resolve thread'} icon={<Icon icon={IconCheck} />}
            onClick={props.onToggleResolved} />
        )}
        <IconButton ref={anchor} variant="quiet" label="Thread actions" aria-haspopup="menu" aria-expanded={menuOpen}
          icon={<Icon icon={IconDots} />} onClick={() => setMenuOpen((open) => !open)} />
        <Menu open={menuOpen} anchorRef={anchor} onClose={() => setMenuOpen(false)} label="Thread actions" placement="bottom-end">
          <MenuItem icon={<Icon icon={unread ? IconMailOpened : IconMail} />} onSelect={props.onToggleRead}>
            {unread ? 'Mark as read' : 'Mark as unread'}
          </MenuItem>
          <MenuItem icon={<Icon icon={IconLink} />} onSelect={props.onCopyLink}>Copy link</MenuItem>
          {readOnly ? null : <>
            <MenuSeparator />
            <MenuItem icon={<Icon icon={IconTrash} />} danger onSelect={props.onDelete}>Delete thread…</MenuItem>
          </>}
        </Menu>
      </div>
    </li>
  );
}

export function V2ThreadsPanel(props: Props): React.JSX.Element {
  const { entries, total, filters, query, readOnly } = props;
  const [filterOpen, setFilterOpen] = useState(false);
  const [deleting, setDeleting] = useState<ThreadEntry | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const filterAnchor = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // Ages tick while the panel is up.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  // A pin clicked on the canvas (or a card opened from a link) brings its card into the list's view.
  const { selectedId } = props;
  useEffect(() => {
    if (!selectedId) return;
    const card = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-thread-id]') ?? []).find((item) => item.dataset.threadId === selectedId);
    card?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, entries.length]);
  const filtering = filters.showResolved || filters.unansweredOnly;
  const clear = () => { props.onQuery(''); props.onFilters({ showResolved: false, unansweredOnly: false }); };

  return (
    <>
      <Panel title="Threads" onClose={props.onClose} closeLabel="Close threads" className="ofk-v2-workspace-panel ofk-threads-panel"
        autoFocus={props.focusOnOpen} data-testid="v2-threads-panel">
        <div className="ofk-threads-bar">
          <label className="ofk-threads-search">
            <Icon icon={IconSearch} />
            <span className="ofk-visually-hidden">Search threads</span>
            <input type="search" value={query} placeholder="Search comments" autoComplete="off"
              onChange={(event) => props.onQuery(event.target.value)}
              onKeyDown={(event) => {
                // Esc empties the box first; the panel closes on the next one.
                if (event.key === 'Escape' && query) { event.stopPropagation(); event.preventDefault(); props.onQuery(''); }
              }} />
          </label>
          <IconButton ref={filterAnchor} variant="quiet" label="Filter threads" aria-haspopup="menu" aria-expanded={filterOpen}
            data-active={filtering || undefined} icon={<Icon icon={IconAdjustmentsHorizontal} />} onClick={() => setFilterOpen((open) => !open)} />
          <Menu open={filterOpen} anchorRef={filterAnchor} onClose={() => setFilterOpen(false)} label="Filter threads" placement="bottom-end">
            <MenuItem checked={filters.showResolved} keepOpen onSelect={() => props.onFilters({ showResolved: !filters.showResolved })}>Show resolved</MenuItem>
            <MenuItem checked={filters.unansweredOnly} keepOpen onSelect={() => props.onFilters({ unansweredOnly: !filters.unansweredOnly })}>Unanswered only</MenuItem>
          </Menu>
        </div>
        {entries.length === 0 ? (
          <div className="ofk-threads-empty" data-testid="v2-threads-empty">
            <Icon icon={IconMessageCircle} />
            {total === 0 ? (
              <>
                <h3>No threads yet</h3>
                <p>{readOnly ? 'Nobody has started a thread in this document.' : 'Press C, then click the canvas to start one. Your agent can reply and start its own.'}</p>
              </>
            ) : (
              <>
                <h3>Nothing matches</h3>
                <p>{query.trim() ? 'No comment has that text' : 'No thread fits'}{filtering ? ' with these filters' : ''}.</p>
                <Button variant="quiet" onClick={clear}>Clear search and filters</Button>
              </>
            )}
          </div>
        ) : (
          <ul ref={list} className="ofk-threads-list" aria-label="Threads">
            {entries.map((entry) => (
              <Card key={entry.thread.id} entry={entry} now={now} readOnly={readOnly}
                unread={props.unread.has(entry.thread.id)} selected={props.selectedId === entry.thread.id}
                onSelect={() => props.onSelect(entry.thread.id)}
                onToggleResolved={() => props.onToggleResolved(entry.thread.id)}
                onToggleRead={() => (props.unread.has(entry.thread.id) ? props.onMarkRead : props.onMarkUnread)(entry.thread.id)}
                onCopyLink={() => props.onCopyLink(entry.thread.id)}
                onDelete={() => setDeleting(entry)} />
            ))}
          </ul>
        )}
      </Panel>
      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title={deleting ? `Delete thread #${deleting.thread.number}?` : 'Delete thread?'}
        description={deleting ? `This removes ${deleting.thread.comments.length === 1 ? 'its comment' : `its ${deleting.thread.comments.length} comments`} from the document.` : undefined}
        actions={<>
          <Button variant="quiet" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { if (deleting) props.onDelete(deleting.thread.id); setDeleting(null); }}>Delete thread</Button>
        </>} />
    </>
  );
}
