// The Threads panel's state: what it lists, which threads are unread for this browser, and the ways into a thread
// (a card, a pin, a link). It owns no document data: threads live in the document, reads in the preferences.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { findThread, removeThread, setThreadResolved } from '../../domain/threads/threads';
import type { ScenePage } from '../../domain/document/types';
import type { useDocumentSession } from '../../application/session/useDocumentSession';
import type { useV2MapMode } from './map/useV2MapMode';
import type { ToastItem } from '../design-system';
import type { OpenThreadRequest } from './V2Comments';
import type { useV2Camera } from './useV2Camera';
import type { useV2Panels } from './useV2Panels';
import type { V2Tool } from './v2ToolCatalog';
import type { useV2Preferences } from './useV2Preferences';
import {
  isUnread, lastActivity, openThreadTotal, selectThreads, threadLinkText, threadParam, unreadIds, withRead, withUnread, collectThreads,
} from './v2ThreadsView';

interface ThreadsInput {
  readonly session: Pick<ReturnType<typeof useDocumentSession>, 'document' | 'updateThreads'>;
  readonly page: ScenePage | null;
  readonly setActivePageId: (pageId: string | null) => void;
  readonly panels: ReturnType<typeof useV2Panels>;
  readonly tool: V2Tool;
  readonly camera: ReturnType<typeof useV2Camera>;
  readonly rendererReady: boolean;
  /** Map hides pins, so a thread is opened from Canvas. */
  readonly map: Pick<ReturnType<typeof useV2MapMode>, 'active' | 'choose'>;
  /** A repo document's map page cannot be left for Canvas. */
  readonly lockedMapPageId: string | null;
  readonly preferences: ReturnType<typeof useV2Preferences>['preferences'];
  readonly updatePreferences: ReturnType<typeof useV2Preferences>['updatePreferences'];
  readonly pushToast: (toast: ToastItem) => void;
  readonly readOnly: boolean;
}

/** Frames to wait after the panel opens: the free canvas is measured beside it, and must not be measured before it has its width. */
const SETTLE_FRAMES = 2;

export function useV2Threads(input: ThreadsInput) {
  const { page, setActivePageId, panels, tool, camera, rendererReady, lockedMapPageId, preferences, updatePreferences, pushToast, readOnly } = input;
  const { document, updateThreads } = input.session;
  const mapActive = input.map.active;
  const leaveMap = useCallback(() => input.map.choose('canvas'), [input.map]);
  const [query, setQuery] = useState('');
  // The panel opened by itself (the comment tool, a card, a link): it leaves focus where it was.
  const [quiet, setQuiet] = useState(false);
  const { workspace, openWorkspace } = panels;
  const openPanel = useCallback(() => { setQuiet(true); openWorkspace('threads'); }, [openWorkspace]);
  const toggleFromRail = useCallback(() => { setQuiet(false); panels.toggleWorkspace('threads'); }, [panels]);
  // Only the moment the tool is picked opens it: closing the panel with the tool still on leaves it closed. Code stays (it may hold a draft).
  const previousTool = useRef(tool);
  useEffect(() => {
    const was = previousTool.current;
    previousTool.current = tool;
    if (tool === 'comment' && was !== 'comment' && workspace !== 'code') openPanel();
  }, [tool, workspace, openPanel]);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [pending, setPending] = useState<OpenThreadRequest | null>(null);
  const [request, setRequest] = useState<OpenThreadRequest | null>(null);
  const seq = useRef(0);
  const filters = useMemo(() => ({ showResolved: preferences.threadsShowResolved, unansweredOnly: preferences.threadsUnansweredOnly }), [preferences.threadsShowResolved, preferences.threadsUnansweredOnly]);
  const reads = preferences.threadReads;
  const latest = useRef({ reads, document, updatePreferences });
  const revealPin = useRef(camera.revealPin);
  useEffect(() => { latest.current = { reads, document, updatePreferences }; revealPin.current = camera.revealPin; });

  const entries = useMemo(() => (document ? selectThreads(document, query, filters) : []), [document, query, filters]);
  const total = useMemo(() => (document ? collectThreads(document).length : 0), [document]);
  const openCount = useMemo(() => (document ? openThreadTotal(document) : 0), [document]);
  const unread = useMemo(() => (document ? unreadIds(document, reads) : new Set<string>()), [document, reads]);

  const markRead = useCallback((threadId: string) => {
    const { reads: current, document: doc, updatePreferences: update } = latest.current;
    const found = doc ? findThread(doc, threadId) : undefined;
    if (!doc || !found || !isUnread(found.thread, doc.id, current)) return;
    update({ threadReads: withRead(current, doc.id, found.thread, Date.now()) });
  }, []);
  const markUnread = useCallback((threadId: string) => {
    const { reads: current, document: doc, updatePreferences: update } = latest.current;
    if (doc) update({ threadReads: withUnread(current, doc.id, threadId) });
  }, []);

  // An open popover is a read thread, and stays one while replies arrive in front of you. Keyed on the thread and its newest
  // comment only, so "Mark as unread" on the open thread is not undone at once.
  const openThread = openThreadId && document ? findThread(document, openThreadId)?.thread : undefined;
  const newest = openThread ? lastActivity(openThread) : 0;
  const commentCount = openThread?.comments.length ?? 0;
  useEffect(() => {
    if (openThreadId) markRead(openThreadId);
  }, [openThreadId, newest, commentCount, markRead]);

  /** Switches page (and leaves Map) as needed, then opens the thread and brings its pin into view. */
  const select = useCallback((threadId: string): boolean => {
    const found = document ? findThread(document, threadId) : undefined;
    if (!found) {
      pushToast({ id: 'thread-missing', tone: 'info', title: 'That thread no longer exists' });
      return false;
    }
    openPanel();
    if (mapActive && found.page.id === lockedMapPageId) {
      // The repo's map page is Map and nothing else: no canvas, so no pin to open.
      setActivePageId(found.page.id);
      pushToast({ id: 'thread-on-map', tone: 'info', title: `Thread #${found.thread.number} is on the map page`, description: 'Pins are not drawn in Map.' });
      return false;
    }
    if (mapActive) leaveMap();
    if (page?.id !== found.page.id) setActivePageId(found.page.id);
    seq.current += 1;
    setPending({ threadId, seq: seq.current });
    return true;
  }, [document, page?.id, openPanel, mapActive, lockedMapPageId, leaveMap, setActivePageId, pushToast]);

  // The page and renderer are ready: open the popover, then (after the panel has its width) bring the pin into view.
  useEffect(() => {
    if (!pending || !document) return;
    const found = findThread(document, pending.threadId);
    if (!found) { setPending(null); return; }
    if (page?.id !== found.page.id || mapActive || !rendererReady) return;
    setPending(null);
    setRequest(pending);
    const point = found.thread.anchor.point;
    // Not cancelled by this effect's cleanup: the state it just set re-runs it before the frames are up.
    let frames = SETTLE_FRAMES;
    const settle = () => {
      if (frames-- > 0) { requestAnimationFrame(settle); return; }
      revealPin.current(point);
    };
    requestAnimationFrame(settle);
  }, [pending, document, page?.id, mapActive, rendererReady]);

  // `#/d/<id>?thread=<threadId>`: open it once the document is up, then take the param off the address.
  const location = useLocation();
  const navigate = useNavigate();
  const wanted = threadParam(location.search);
  useEffect(() => {
    if (!wanted || !document) return;
    select(wanted);
    const search = new URLSearchParams(location.search);
    search.delete('thread');
    const rest = search.toString();
    navigate({ pathname: location.pathname, search: rest ? `?${rest}` : '' }, { replace: true, state: location.state });
    // The link is handled once per document; `select` is read as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, document?.id]);

  const toggleResolved = useCallback((threadId: string) => {
    const found = document ? findThread(document, threadId) : undefined;
    if (found && !readOnly) updateThreads((doc) => setThreadResolved(doc, threadId, !found.thread.resolved));
  }, [document, readOnly, updateThreads]);
  const remove = useCallback((threadId: string) => {
    if (!readOnly) updateThreads((doc) => removeThread(doc, threadId));
  }, [readOnly, updateThreads]);

  const copyLink = useCallback((threadId: string) => {
    const found = document ? findThread(document, threadId) : undefined;
    if (!document || !found) return;
    const entry = { thread: found.thread, pageId: found.page.id, pageName: found.page.name };
    const text = threadLinkText(document, entry, `${window.location.origin}${window.location.pathname}`);
    const done = () => pushToast({ id: 'thread-link', tone: 'success', title: 'Link copied' });
    const failed = () => pushToast({ id: 'thread-link', tone: 'danger', title: 'Couldn’t copy', description: 'This browser blocked the clipboard.' });
    if (!navigator.clipboard) { failed(); return; }
    void navigator.clipboard.writeText(text).then(done, failed);
  }, [document, pushToast]);

  const setFilters = useCallback((patch: Partial<typeof filters>) => {
    updatePreferences({
      ...(patch.showResolved !== undefined ? { threadsShowResolved: patch.showResolved } : {}),
      ...(patch.unansweredOnly !== undefined ? { threadsUnansweredOnly: patch.unansweredOnly } : {}),
    });
  }, [updatePreferences]);

  return {
    query, setQuery, filters, setFilters, entries, total, openCount, unread,
    openThreadId, commentProps: { request, onOpenThreadChange: setOpenThreadId, unread },
    quiet, toggleFromRail, select, markRead, markUnread, toggleResolved, remove, copyLink,
  };
}
