import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { addThread } from '../../domain/threads/threads';
import type { SceneDocumentV1 } from '../../domain/document/types';
import { V2Comments, type V2CommentApi } from './V2Comments';
import type { V2Tool } from './v2ToolCatalog';

// jsdom: no layout, no scrolling, no ResizeObserver (menus place themselves with one).
Element.prototype.scrollTo = function scrollTo() {} as never;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
const host = {
  screenToWorld: (point: { x: number; y: number }) => point,
  worldToScreen: (point: { x: number; y: number }) => point,
  pickNode: () => null,
  getNodeScreenBounds: () => null,
  getViewportSize: () => ({ width: 1000, height: 800 }),
};

const api: { current: V2CommentApi | null } = { current: null };

function Harness(props: { readonly initial: SceneDocumentV1; readonly tool: V2Tool; readonly pageIndex?: number; readonly onDoc?: (doc: SceneDocumentV1) => void }) {
  const [doc, setDoc] = useState(props.initial);
  const sectionRef = useRef<HTMLElement | null>(null);
  const hostRef = useRef(host as never);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  const page = doc.pages[props.pageIndex ?? 0]!;
  return (
    <section ref={sectionRef} tabIndex={-1} data-testid="section">
      <button type="button" data-testid="context-bar-button">Fill colour</button>
      <V2Comments page={page} sectionRef={sectionRef} hostRef={hostRef} cameraRef={cameraRef} subscribeCamera={() => () => undefined}
        selectedNodeId={() => null} apiRef={api} tool={props.tool} readOnly={false} hidden={false}
        updateThreads={(change) => setDoc((current) => { const next = change(current); props.onDoc?.(next); return next; })} />
    </section>
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
