import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CopyButton, V2AgentPanel } from './V2AgentPanel';

describe('CopyButton', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says the copy failed when the clipboard refuses it', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError'))) } });
    render(<CopyButton text="reply" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeTruthy();
  });
});

describe('V2AgentPanel proposal review', () => {
  // jsdom has no element scrolling; the thread scrolls to its newest message on mount.
  beforeAll(() => { Element.prototype.scrollTo = () => undefined; });
  // useV2Proposal decides staleness (a diagram change, not a comment); the panel shows what it says.
  const panel = (stale: boolean) => {
    const proposal = {
      proposal: { id: 'p1', baseRevision: 3, scope: { kind: 'page', pageId: 'page-1', objectIds: [] } },
      phase: 'ready', stale, changes: [{ id: 'c1', kind: 'addition', label: 'Add box' }], decisions: {},
      decide: vi.fn(), highlight: vi.fn(), discard: vi.fn(), undoable: false,
    };
    const assistant = {
      messages: [{ id: 'm1', role: 'assistant', text: 'Here you go.', status: 'done', proposalId: 'p1' }],
      busy: false, activity: null, chats: [], activeChatId: null,
      apply: vi.fn(), discard: vi.fn(), undo: vi.fn(), send: vi.fn(), retry: vi.fn(), edit: vi.fn(),
      newChat: vi.fn(), openChat: vi.fn(), deleteChat: vi.fn(),
    };
    const aiSettings = { configured: true, settings: { provider: 'openai', connections: {} } };
    render(<V2AgentPanel assistant={assistant as never} proposal={proposal as never} aiSettings={aiSettings as never}
      readOnly={false} diagramCount={1} selectedDiagramCount={0} onClose={vi.fn()} />);
  };

  it('offers Apply while the proposal is current', () => {
    panel(false);
    expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('refuses Apply once the proposal is stale', () => {
    panel(true);
    expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Document changed since this proposal/)).toBeTruthy();
  });
});
