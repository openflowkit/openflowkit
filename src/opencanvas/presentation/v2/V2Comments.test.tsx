import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, useRef, useState } from 'react';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { addThread } from '../../domain/threads/threads';
import type { SceneDocumentV1 } from '../../domain/document/types';
import { V2Comments, type V2CommentApi } from './V2Comments';
import { Placement } from './v2CommentPlacement';
import { CommentDrafts } from './v2DraftGuard';
import { ThreadPopover } from './V2CommentsParts';
import type { V2Tool } from './v2ToolCatalog';

// jsdom: no layout, no scrolling, no ResizeObserver (menus place themselves with one).
Element.prototype.scrollTo = function scrollTo() {} as never;
const toast = vi.fn();
// What the ResizeObserver watches now: Placement watches an open card, so a card that is replaced must be swapped.
const watched = new Set<Element>();
vi.stubGlobal('ResizeObserver', class { observe(el: Element) { watched.add(el); } unobserve(el: Element) { watched.delete(el); } disconnect() {} });
afterEach(() => { watched.clear(); toast.mockClear(); });
const host = {
  screenToWorld: (point: { x: number; y: number }) => point,
  worldToScreen: (point: { x: number; y: number }) => point,
  pickNode: vi.fn((_point: { x: number; y: number }): string | null => null),
  getNodeScreenBounds: () => null,
  getViewportSize: () => ({ width: 1000, height: 800 }),
};

const api: { current: V2CommentApi | null } = { current: null };
const noop = () => undefined;
const NONE: ReadonlySet<string> = new Set();

interface HarnessProps {
  readonly initial: SceneDocumentV1;
  readonly tool: V2Tool;
  readonly pageIndex?: number;
  readonly onDoc?: (doc: SceneDocumentV1) => void;
  /** The document the session holds when it differs from the one rendered: a change another writer made a moment ago. */
  readonly live?: { current: SceneDocumentV1 | null };
  readonly onRender?: () => void;
}

function Harness(props: HarnessProps) {
  const [doc, setDoc] = useState(props.initial);
  const docRef = useRef(props.initial);
  const sectionRef = useRef<HTMLElement | null>(null);
  const hostRef = useRef(host as never);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  const page = doc.pages[props.pageIndex ?? 0]!;
  // As the session does: the change runs at once, on the document of now.
  const updateThreads = (change: (document: SceneDocumentV1) => SceneDocumentV1) => {
    const next = change(props.live?.current ?? docRef.current);
    if (props.live?.current) return;
    docRef.current = next;
    setDoc(next);
    props.onDoc?.(next);
  };
  return (
    <Profiler id="comments" onRender={() => props.onRender?.()}>
      <section ref={sectionRef} tabIndex={-1} data-testid="section">
        <button type="button" data-testid="context-bar-button">Fill colour</button>
        <V2Comments page={page} sectionRef={sectionRef} hostRef={hostRef} cameraRef={cameraRef} subscribeCamera={() => () => undefined}
          selectedNodeId={() => null} apiRef={api} tool={props.tool} readOnly={false} hidden={false} panelsKey="" request={null} onOpenThreadChange={noop} unread={NONE}
          toast={toast} updateThreads={updateThreads} />
      </section>
    </Profiler>
  );
}

const human = { kind: 'human' as const, name: 'User' };
const withThread = (body = 'hello'): SceneDocumentV1 => {
  const base = createTestDocument({ nodes: [createTestNode('a')] });
  return addThread(base, { pageId: base.pages[0]!.id, threadId: 't1', nodeId: null, point: { x: 10, y: 10 },
    comment: { id: 'm1', author: human, body, createdAt: new Date().toISOString() } });
};
const blank = () => createTestDocument({ nodes: [createTestNode('a')] });
const pinButton = () => screen.getByRole('button', { name: /^Comment\b.*by User/ });
const composer = () => screen.queryByRole('dialog', { name: 'New comment' });
const thread = () => screen.queryByTestId('v2-comment-thread');
/** A canvas click with the comment tool, as the editor's pointer pipeline reports it. */
const canvasClick = (at = { x: 50, y: 50 }) => act(() => { api.current!.click(at); });

describe('Escape', () => {
  it('while an input method composes (keyCode 229) is the method\'s: it closes no card and cancels no edit', () => {
    render(<Harness initial={withThread()} tool="select" />);
    fireEvent.click(pinButton());
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Reply' }), { key: 'Escape', keyCode: 229 });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Reply' }), { key: 'Escape', isComposing: true });
    expect(thread()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Comment actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit comment' }), { key: 'Escape', keyCode: 229 });
    expect(screen.getByRole('textbox', { name: 'Edit comment' })).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit comment' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Edit comment' })).toBeNull();
  });

  it('while an input method composes in the composer does not close it', () => {
    render(<Harness initial={blank()} tool="comment" />);
    canvasClick();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment' }), { key: 'Escape', keyCode: 229 });
    expect(composer()).not.toBeNull();
  });

  it('closes a thread opened with the mouse, whatever has focus, and gives focus back to its pin', () => {
    render(<Harness initial={withThread()} tool="select" />);
    fireEvent.click(pinButton());
    expect(thread()).not.toBeNull();
    // The editor's Escape chain asks the comment layer first.
    let closed = false;
    act(() => { closed = api.current!.escape(); });
    expect(closed).toBe(true);
    expect(thread()).toBeNull();
    expect(document.activeElement).toBe(pinButton());
    // Nothing open: the chain goes on (tool, then selection).
    expect(api.current!.escape()).toBe(false);
  });

  it('on the composer\'s Send button closes the composer, and the key never reaches the editor', () => {
    const outer = vi.fn();
    render(<div onKeyDown={outer}><Harness initial={blank()} tool="comment" /></div>);
    canvasClick();
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: 'draft' } });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Send comment' }), { key: 'Escape' });
    expect(composer()).toBeNull();
    expect(outer).not.toHaveBeenCalled();
  });

  it('in the composer\'s box closes the composer', () => {
    render(<Harness initial={blank()} tool="comment" />);
    canvasClick();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment' }), { key: 'Escape' });
    expect(composer()).toBeNull();
  });

  it('in the edit box cancels the edit and leaves the thread open', () => {
    render(<Harness initial={withThread()} tool="select" />);
    fireEvent.click(pinButton());
    fireEvent.click(screen.getByRole('button', { name: 'Comment actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit comment' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Edit comment' })).toBeNull();
    expect(thread()).not.toBeNull();
  });
});

describe('presses', () => {
  it('a press on any editor control outside the comment closes an open thread', () => {
    render(<><button type="button" data-testid="toolbar">Rectangle</button><Harness initial={withThread()} tool="select" /></>);
    fireEvent.click(pinButton());
    fireEvent.pointerDown(screen.getByTestId('toolbar'), { button: 0 });
    expect(thread()).toBeNull();
  });

  it('a press on another control in the canvas section never starts a comment (only the pipeline\'s canvas click does)', () => {
    render(<Harness initial={blank()} tool="comment" />);
    fireEvent.pointerDown(screen.getByTestId('context-bar-button'), { button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerDown(screen.getByTestId('section'), { button: 0, clientX: 50, clientY: 50 });
    expect(composer()).toBeNull();
    canvasClick();
    expect(composer()).not.toBeNull();
  });

  it('the press that closes an open box starts nothing new', () => {
    render(<Harness initial={blank()} tool="comment" />);
    canvasClick();
    expect(composer()).not.toBeNull();
    // The same press: the document hears it first (it closes the empty box), then the pipeline reports the click.
    fireEvent.pointerDown(screen.getByTestId('section'), { button: 0 });
    canvasClick({ x: 200, y: 200 });
    expect(composer()).toBeNull();
    // The next press is a fresh one.
    fireEvent.pointerDown(screen.getByTestId('section'), { button: 0 });
    canvasClick({ x: 200, y: 200 });
    expect(composer()).not.toBeNull();
  });
});

describe('Enter', () => {
  it('with the comment tool opens a composer, and with a box open goes back into it instead of renaming anything', () => {
    render(<Harness initial={withThread()} tool="comment" />);
    let handled = false;
    act(() => { handled = api.current!.enter(); });
    expect(handled).toBe(true);
    expect(composer()).not.toBeNull();
    fireEvent.click(pinButton());
    expect(thread()).not.toBeNull();
    pinButton().focus();
    act(() => { handled = api.current!.enter(); });
    expect(handled).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Reply' }));
  });
});

describe('unsent text', () => {
  const twoPages = (): SceneDocumentV1 => {
    const base = withThread();
    return addThread({ ...base, pages: [...base.pages, { ...base.pages[0]!, id: 'p2', threads: undefined }] }, {
      pageId: base.pages[0]!.id, threadId: 't2', nodeId: null, point: { x: 300, y: 10 },
      comment: { id: 'm2', author: human, body: 'second', createdAt: new Date().toISOString() } });
  };
  const type = (name: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
  const box = (name: string) => (screen.getByRole('textbox', { name }) as HTMLTextAreaElement).value;
  const pins = () => screen.getAllByRole('button', { name: /^Comment\b.*by User/ });

  it('a composer holding text stays open when the tool changes; an empty one closes', () => {
    const view = render(<Harness initial={blank()} tool="comment" />);
    canvasClick();
    type('Comment', 'half written');
    view.rerender(<Harness initial={blank()} tool="rectangle" />);
    expect(box('Comment')).toBe('half written');
    type('Comment', '');
    view.rerender(<Harness initial={blank()} tool="select" />);
    expect(composer()).toBeNull();
  });

  it('a reply closed by a page switch is still in its box when the thread opens again', () => {
    const doc = twoPages();
    const view = render(<Harness initial={doc} tool="select" pageIndex={0} />);
    fireEvent.click(pins()[0]!);
    type('Reply', 'unsent reply');
    view.rerender(<Harness initial={doc} tool="select" pageIndex={1} />);
    expect(screen.queryByRole('textbox', { name: 'Reply' })).toBeNull();
    view.rerender(<Harness initial={doc} tool="select" pageIndex={0} />);
    fireEvent.click(pins()[0]!);
    expect(box('Reply')).toBe('unsent reply');
  });

  it('opening another pin keeps the first thread\'s reply; sending one clears it', () => {
    render(<Harness initial={twoPages()} tool="select" />);
    fireEvent.click(pins()[0]!);
    type('Reply', 'for the first');
    fireEvent.click(pins()[1]!);
    expect(box('Reply')).toBe('');
    fireEvent.click(pins()[0]!);
    expect(box('Reply')).toBe('for the first');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Reply' }), { key: 'Enter' });
    fireEvent.click(pins()[1]!);
    fireEvent.click(pins()[0]!);
    expect(box('Reply')).toBe('');
  });

  it('an edit in progress survives the thread closing, and Escape in it throws it away', () => {
    render(<Harness initial={withThread('original')} tool="select" />);
    fireEvent.click(pinButton());
    fireEvent.click(screen.getByRole('button', { name: 'Comment actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    type('Edit comment', 'better wording');
    act(() => { api.current!.escape(); });
    fireEvent.click(pinButton());
    expect(box('Edit comment')).toBe('better wording');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit comment' }), { key: 'Escape' });
    act(() => { api.current!.escape(); });
    fireEvent.click(pinButton());
    expect(screen.queryByRole('textbox', { name: 'Edit comment' })).toBeNull();
  });

  it('a new comment left unsent comes back in the next composer on its page', () => {
    const doc = twoPages();
    const view = render(<Harness initial={doc} tool="comment" pageIndex={0} />);
    canvasClick();
    type('Comment', 'about this box');
    view.rerender(<Harness initial={doc} tool="comment" pageIndex={1} />);
    canvasClick();
    expect(box('Comment')).toBe('');
    act(() => { api.current!.escape(); });
    view.rerender(<Harness initial={doc} tool="comment" pageIndex={0} />);
    canvasClick({ x: 400, y: 300 });
    expect(box('Comment')).toBe('about this box');
  });

  it('a click away warns once about any unsent text in the open box, the edit box included', () => {
    render(<><button type="button" data-testid="toolbar">Rectangle</button><Harness initial={withThread('original')} tool="select" /></>);
    fireEvent.click(pinButton());
    fireEvent.click(screen.getByRole('button', { name: 'Comment actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    type('Edit comment', 'changed');
    fireEvent.pointerDown(screen.getByTestId('toolbar'), { button: 0 });
    expect(thread()).not.toBeNull();
    fireEvent.pointerDown(screen.getByTestId('toolbar'), { button: 0 });
    expect(thread()).toBeNull();
  });
});

describe('deleting', () => {
  const twoMessages = (): SceneDocumentV1 => {
    const doc = withThread('opening');
    const page = doc.pages[0]!;
    const thread = page.threads![0]!;
    const reply = { id: 'm2', author: human, body: 'a reply', createdAt: new Date().toISOString() };
    return { ...doc, pages: [{ ...page, threads: [{ ...thread, comments: [...thread.comments, reply] }] }] };
  };

  it('a reply asks first, as the opening message does, and Cancel keeps it', () => {
    let latestDoc = twoMessages();
    render(<Harness initial={latestDoc} tool="select" onDoc={(doc) => { latestDoc = doc; }} />);
    fireEvent.click(pinButton());
    const deleteReply = () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Comment actions' })[1]!);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    };
    deleteReply();
    expect(screen.getByRole('alert')).toHaveTextContent('Delete this reply?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByTestId('v2-comment-message')).toHaveLength(2);
    deleteReply();
    fireEvent.click(screen.getByRole('button', { name: 'Delete reply' }));
    expect(screen.getAllByTestId('v2-comment-message')).toHaveLength(1);
    expect(latestDoc.pages[0]!.threads![0]!.comments.map((comment) => comment.body)).toEqual(['opening']);
  });

  it('Delete on a focused pin never reaches the editor (no shape is deleted); it asks to delete that thread', () => {
    const outer = vi.fn();
    render(<div onKeyDown={outer}><Harness initial={withThread()} tool="select" /></div>);
    fireEvent.keyDown(pinButton(), { key: 'Delete' });
    fireEvent.keyDown(pinButton(), { key: 'Backspace' });
    expect(outer).not.toHaveBeenCalled();
    expect(thread()).not.toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Delete this thread?');
  });
});

describe('the thread card', () => {
  it('every icon-only button has a tooltip', () => {
    render(<Harness initial={withThread()} tool="select" />);
    fireEvent.click(pinButton());
    for (const name of ['Thread actions', 'Resolve thread', 'Close thread', 'Comment actions']) {
      expect(screen.getByRole('button', { name }).closest('.ofk-tooltip-anchor'), name).not.toBeNull();
    }
  });

  it('Reopen does not wear Resolve\'s check', () => {
    const open = withThread().pages[0]!.threads![0]!;
    const icon = (resolved: boolean) => {
      const view = render(<ThreadPopover thread={{ ...open, resolved }} readOnly={false} now={Date.now()} onClose={vi.fn()} onResolve={vi.fn()}
        onDeleteThread={vi.fn()} onReply={vi.fn()} onEditMessage={vi.fn()} onDeleteMessage={vi.fn()} />);
      const svg = screen.getByRole('button', { name: resolved ? 'Reopen thread' : 'Resolve thread' }).querySelector('svg')!.getAttribute('class');
      view.unmount();
      return svg;
    };
    expect(icon(true)).not.toBe(icon(false));
  });
});

describe('moving a pin with the keyboard', () => {
  it('Alt+Arrow lands the pin like a drop: on the shape under its tip, else on the page', () => {
    let latestDoc = withThread();
    render(<Harness initial={latestDoc} tool="select" onDoc={(doc) => { latestDoc = doc; }} />);
    const anchor = () => latestDoc.pages[0]!.threads![0]!.anchor;
    host.pickNode.mockImplementation((point) => (point.x > 15 ? 'a' : null));
    fireEvent.keyDown(pinButton(), { key: 'ArrowRight', altKey: true });
    expect(anchor()).toMatchObject({ nodeId: 'a', point: { x: 18, y: 10 } });
    fireEvent.keyDown(pinButton(), { key: 'ArrowLeft', altKey: true, shiftKey: true });
    expect(anchor()).toMatchObject({ nodeId: null, point: { x: -62, y: 10 } });
    host.pickNode.mockImplementation(() => null);
  });
});

describe('the card and its placement', () => {
  const card = () => document.querySelector('[data-comment-open]')!;
  const cards = () => [...watched].filter((el) => el.matches('[data-comment-open]'));

  it('Delete on the pin of an open thread swaps the card for the confirm card: placement watches the live one', () => {
    render(<Harness initial={withThread()} tool="select" />);
    fireEvent.click(pinButton());
    const first = card();
    expect(cards()).toEqual([first]);
    fireEvent.keyDown(pinButton(), { key: 'Delete' });
    expect(screen.getByRole('alert')).toHaveTextContent('Delete this thread?');
    expect(card()).not.toBe(first);
    expect(cards()).toEqual([card()]);
  });

  it('the pins\' layer is handed over once, not on every render', () => {
    const setLayer = vi.spyOn(Placement.prototype, 'setLayer');
    render(<Harness initial={withThread()} tool="select" />);
    fireEvent.click(pinButton());
    fireEvent.click(pinButton());
    expect(setLayer.mock.calls.filter(([layer]) => layer !== null)).toHaveLength(1);
    setLayer.mockRestore();
  });

  it('a shape preview re-renders the pins only when a pin is on a shape', () => {
    const renders = vi.fn();
    const preview = { nodes: [createTestNode('a')] } as never;
    const free = render(<Harness initial={withThread()} tool="select" onRender={renders} />);
    renders.mockClear();
    act(() => api.current!.preview(preview, false));
    expect(renders).not.toHaveBeenCalled();
    free.unmount();
    const base = blank();
    const onShape = addThread(base, { pageId: base.pages[0]!.id, threadId: 't1', nodeId: 'a', point: { x: 10, y: 10 },
      comment: { id: 'm1', author: human, body: 'on a', createdAt: new Date().toISOString() } });
    render(<Harness initial={onShape} tool="select" onRender={renders} />);
    renders.mockClear();
    act(() => api.current!.preview(preview, false));
    expect(renders).toHaveBeenCalled();
  });
});

describe('a change to something that is gone, or that fails', () => {
  const type = (name: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
  const box = (name: string) => (screen.getByRole('textbox', { name }) as HTMLTextAreaElement).value;
  const twoMessages = (): SceneDocumentV1 => {
    const doc = withThread('opening');
    const page = doc.pages[0]!;
    const only = page.threads![0]!;
    const reply = { id: 'm2', author: human, body: 'a reply', createdAt: new Date().toISOString() };
    return { ...doc, pages: [{ ...page, threads: [{ ...only, comments: [...only.comments, reply] }] }] };
  };
  const without = (doc: SceneDocumentV1): SceneDocumentV1 => ({ ...doc, pages: [{ ...doc.pages[0]!, threads: undefined }] });

  it('a reply to a thread that was removed a moment ago is not sent, keeps its text, and tells the user', () => {
    const live: { current: SceneDocumentV1 | null } = { current: null };
    render(<Harness initial={withThread()} tool="select" live={live} />);
    fireEvent.click(pinButton());
    type('Reply', 'still worth saying');
    live.current = without(withThread());
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Reply' }), { key: 'Enter' });
    expect(box('Reply')).toBe('still worth saying');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]![0]).toMatchObject({ title: 'Reply not sent', description: expect.stringContaining('still worth saying') });
  });

  it('an edit of a message that was removed a moment ago stays open with its text and tells the user', () => {
    const live: { current: SceneDocumentV1 | null } = { current: null };
    render(<Harness initial={twoMessages()} tool="select" live={live} />);
    fireEvent.click(pinButton());
    fireEvent.click(screen.getAllByRole('button', { name: 'Comment actions' })[1]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    type('Edit comment', 'better wording');
    live.current = withThread('opening');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit comment' }), { key: 'Enter' });
    expect(box('Edit comment')).toBe('better wording');
    expect(toast.mock.calls[0]![0]).toMatchObject({ title: 'Edit not saved' });
  });

  it('deleting, resolving or moving what is already gone is quiet', () => {
    const live: { current: SceneDocumentV1 | null } = { current: null };
    render(<Harness initial={twoMessages()} tool="select" live={live} />);
    fireEvent.click(pinButton());
    fireEvent.click(screen.getAllByRole('button', { name: 'Comment actions' })[1]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    live.current = without(withThread());
    fireEvent.click(screen.getByRole('button', { name: 'Delete reply' }));
    fireEvent.keyDown(pinButton(), { key: 'ArrowRight', altKey: true });
    expect(toast).not.toHaveBeenCalled();
  });

  it('any other failure shows its message, and the composer keeps what was typed', () => {
    const live: { current: SceneDocumentV1 | null } = { current: null };
    render(<Harness initial={blank()} tool="comment" live={live} />);
    canvasClick();
    type('Comment', 'for a page that went away');
    live.current = { ...blank(), pages: [] };
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment' }), { key: 'Enter' });
    expect(composer()).not.toBeNull();
    expect(box('Comment')).toBe('for a page that went away');
    expect(toast.mock.calls[0]![0]).toMatchObject({ tone: 'danger', title: 'Comment not saved', description: expect.stringContaining('Unknown page') });
  });
});

describe('what a sent or deleted box leaves behind', () => {
  it('the composer is empty again after Send', () => {
    render(<Harness initial={blank()} tool="comment" />);
    canvasClick();
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: 'sent' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment' }), { key: 'Enter' });
    expect(composer()).toBeNull();
    canvasClick({ x: 200, y: 200 });
    expect((screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement).value).toBe('');
  });

  it('a deleted thread\'s unsent boxes go with it', () => {
    const drop = vi.spyOn(CommentDrafts.prototype, 'dropThread');
    render(<Harness initial={withThread()} tool="select" />);
    fireEvent.click(pinButton());
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), { target: { value: 'unsent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thread actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete thread…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete thread' }));
    expect(drop).toHaveBeenCalledWith('t1');
    drop.mockRestore();
  });
});
