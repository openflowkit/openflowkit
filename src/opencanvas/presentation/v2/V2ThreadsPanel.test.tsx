import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SceneThread } from '../../domain/document/types';
import { V2ThreadsPanel } from './V2ThreadsPanel';
import type { ThreadEntry } from './v2ThreadsView';

// jsdom has no ResizeObserver; menus place themselves with one.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const thread = (resolved: boolean): SceneThread => ({
  id: 't1', number: 1, resolved, anchor: { nodeId: null, offset: null, point: { x: 0, y: 0 } },
  comments: [{ id: 'm1', author: { kind: 'human', name: 'User' }, body: 'Why is this a queue?', createdAt: '2026-10-26T12:00:00.000Z' }],
});
const panel = (entries: readonly ThreadEntry[], total = entries.length) => render(
  <V2ThreadsPanel entries={entries} total={total} unread={new Set()} selectedId={null} query="" onQuery={vi.fn()}
    filters={{ showResolved: false, unansweredOnly: false }} onFilters={vi.fn()} readOnly={false} focusOnOpen={false}
    onSelect={vi.fn()} onToggleResolved={vi.fn()} onMarkRead={vi.fn()} onMarkUnread={vi.fn()} onCopyLink={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />);

describe('V2ThreadsPanel', () => {
  it('an empty document shows the editor\'s empty state, with copy true before agents can comment', () => {
    panel([]);
    const empty = screen.getByTestId('v2-threads-empty');
    expect(empty.querySelector('.ofk-empty')).not.toBeNull();
    expect(empty).toHaveTextContent('No threads yet');
    expect(empty).not.toHaveTextContent(/agent/i);
  });

  it('every icon-only button has a tooltip, and Reopen does not wear Resolve\'s check', () => {
    const view = panel([{ thread: thread(false), pageId: 'p', pageName: 'Page 1' }]);
    for (const name of ['Filter threads', 'Resolve thread', 'Thread actions']) {
      expect(screen.getByRole('button', { name }).closest('.ofk-tooltip-anchor'), name).not.toBeNull();
    }
    const resolveIcon = screen.getByRole('button', { name: 'Resolve thread' }).querySelector('svg')!.getAttribute('class');
    view.unmount();
    panel([{ thread: thread(true), pageId: 'p', pageName: 'Page 1' }]);
    expect(screen.getByRole('button', { name: 'Reopen thread' }).querySelector('svg')!.getAttribute('class')).not.toBe(resolveIcon);
  });

  it('says what a copied link is: a link to this thread, which opens in this browser', () => {
    panel([{ thread: thread(false), pageId: 'p', pageName: 'Page 1' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Thread actions' }));
    expect(screen.getByRole('menuitem', { name: 'Copy link to this thread' })).toBeTruthy();
  });
});
