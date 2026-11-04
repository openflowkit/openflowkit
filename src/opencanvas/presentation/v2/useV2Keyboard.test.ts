import { renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { keyOwnedByTarget, useV2Keyboard } from './useV2Keyboard';

function setup(onTypeToEdit = vi.fn(() => true), tool: string = 'select', onCommentHere?: () => boolean) {
  const onToolChange = vi.fn();
  const onFitView = vi.fn();
  const onResetZoom = vi.fn();
  const onZoomStep = vi.fn();
  const onSpacePan = vi.fn();
  const onReorder = vi.fn();
  const onToggleLock = vi.fn();
  const onToggleInspect = vi.fn();
  const onToggleIcons = vi.fn();
  const onFind = vi.fn();
  const onToggleMap = vi.fn(() => true);
  const onToggleAgent = vi.fn();
  const onToggleCode = vi.fn();
  const onEditPrimary = vi.fn();
  const onPasteKey = vi.fn();
  const insert = { onInsertFrame: vi.fn(), onInsertSticky: vi.fn(), onToggleMore: vi.fn() };
  const clipboard = { onGroup: vi.fn(), onUngroup: vi.fn(), onWrapInSection: vi.fn(), onCut: vi.fn(), onCopy: vi.fn(), onCopyStyle: vi.fn(), onPasteStyle: vi.fn() };
  const arrange = { onAlign: vi.fn(), onDistribute: vi.fn(), onFlip: vi.fn(), onZoomToSelection: vi.fn(), onTextStyle: vi.fn() };
  const { result } = renderHook(() => useV2Keyboard({
    onReorder, onToggleLock, ...clipboard, ...arrange, ...insert,
    toolRef: { current: tool as never }, ...(onCommentHere ? { onCommentHere } : {}), editingRef: { current: false }, onToolChange,
    onUndo: vi.fn(), onRedo: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onEditPrimary, onPasteKey, onRemoveFromModel: vi.fn(),
    onNudge: vi.fn(), onEscapePanel: () => false, onToggleEmoji: () => undefined, onInsertImage: () => undefined, onCancelGesture: () => false, onClearSelection: vi.fn(), onSelectAll: vi.fn(),
    onFitView, onZoomStep, onResetZoom, onToggleTree: vi.fn(), onToggleIcons, onToggleInspect, onToggleMap, onFind,
    onToggleAgent, onToggleCode, onToggleModel: vi.fn(), onSpacePan, onTypeToEdit,
  }));
  const key = (init: Partial<KeyboardEvent<HTMLElement>>) => result.current({
    key: 'q', target: document.createElement('section'), preventDefault: vi.fn(),
    ...init,
  } as unknown as KeyboardEvent<HTMLElement>);
  return { key, ...insert, onToggleAgent, onToggleCode, onEditPrimary, onPasteKey, onFind, onToggleMap, onToggleInspect, onToggleIcons, onToolChange, onTypeToEdit, onFitView, onResetZoom, onZoomStep, onSpacePan, onReorder, onToggleLock, ...clipboard, ...arrange };
}

describe('useV2Keyboard type-to-edit', () => {
  it('a printable key with a single selection opens the editor with that character', () => {
    const { key, onTypeToEdit, onToolChange } = setup();
    key({ key: 'Q' });
    expect(onTypeToEdit).toHaveBeenCalledWith('Q');
    // Tool letters go to the editor too when something is selected.
    key({ key: 'r' });
    expect(onTypeToEdit).toHaveBeenLastCalledWith('r');
    expect(onToolChange).not.toHaveBeenCalled();
  });

  // Review 2026-10-11: Safari's IME sends its first keydown with the letter and keyCode 229.
  it('a key the input method is composing is neither a label nor a shortcut', () => {
    const { key, onTypeToEdit, onToolChange } = setup();
    key({ key: 'r', keyCode: 229 });
    key({ key: 'r', nativeEvent: { isComposing: true } } as never);
    expect(onTypeToEdit).not.toHaveBeenCalled();
    expect(onToolChange).not.toHaveBeenCalled();
  });

  it('falls through to shortcuts when nothing editable is selected or a modifier is held', () => {
    const { key, onToolChange, onTypeToEdit } = setup(vi.fn(() => false));
    key({ key: 'r' });
    expect(onToolChange).toHaveBeenCalledWith('rectangle');
    key({ key: 'z', metaKey: true });
    expect(onTypeToEdit).toHaveBeenCalledTimes(1);
  });
});

describe('useV2Keyboard inspect', () => {
  it('⌥I toggles Inspect even with a selection, and never types or opens icons', () => {
    const { key, onToggleInspect, onToggleIcons, onTypeToEdit } = setup();
    // macOS reports ⌥I as a dead key; the physical code is what we match.
    key({ key: 'Dead', code: 'KeyI', altKey: true });
    expect(onToggleInspect).toHaveBeenCalledOnce();
    expect(onToggleIcons).not.toHaveBeenCalled();
    expect(onTypeToEdit).not.toHaveBeenCalled();
  });
});

describe('useV2Keyboard map', () => {
  it('M toggles Map before type-to-edit on a model page; ⌥M stays the Model panel', () => {
    const { key, onToggleMap, onTypeToEdit } = setup();
    key({ key: 'm' });
    expect(onToggleMap).toHaveBeenCalledOnce();
    expect(onTypeToEdit).not.toHaveBeenCalled();
    key({ key: 'M', shiftKey: true });
    key({ key: 'm', metaKey: true });
    key({ key: 'Dead', code: 'KeyM', altKey: true });
    expect(onToggleMap).toHaveBeenCalledOnce();
  });

  it('M is an ordinary key on a page without a model', () => {
    const none = setup();
    none.onToggleMap.mockReturnValue(false);
    none.key({ key: 'm' });
    expect(none.onTypeToEdit).toHaveBeenCalledWith('m');
  });
});

describe('useV2Keyboard insert', () => {
  it('K arms the laser, F adds a frame, N a sticky note, ⇧S opens More', () => {
    const { key, onToolChange, onInsertFrame, onInsertSticky, onToggleMore } = setup(vi.fn(() => false));
    key({ key: 'k' });
    expect(onToolChange).toHaveBeenCalledWith('laser');
    key({ key: 'f' });
    key({ key: 'n' });
    key({ key: 'S', code: 'KeyS', shiftKey: true });
    expect(onInsertFrame).toHaveBeenCalledOnce();
    expect(onInsertSticky).toHaveBeenCalledOnce();
    expect(onToggleMore).toHaveBeenCalledOnce();
  });
});

describe('useV2Keyboard camera', () => {
  it('] / [ reorder ahead of type-to-edit, ⌘L toggles lock', () => {
    const { key, onReorder, onToggleLock, onTypeToEdit } = setup();
    key({ key: ']' });
    key({ key: '[' });
    expect(onReorder.mock.calls).toEqual([['front'], ['back']]);
    expect(onTypeToEdit).not.toHaveBeenCalled();
    key({ key: 'l', metaKey: true });
    expect(onToggleLock).toHaveBeenCalledOnce();
  });

  it('⌘0 / ⇧0 / ⌘1 reset to 100 %, ⇧1 fits (Figma, tldraw, Excalidraw), ⌘= / ⌘- step around the viewport centre', () => {
    const { key, onFitView, onResetZoom, onZoomStep } = setup(vi.fn(() => false));
    key({ key: '0', metaKey: true });
    key({ key: ')', code: 'Digit0', shiftKey: true });
    key({ key: '1', metaKey: true });
    expect(onResetZoom).toHaveBeenCalledTimes(3);
    expect(onFitView).not.toHaveBeenCalled();
    key({ key: '!', code: 'Digit1', shiftKey: true });
    expect(onFitView).toHaveBeenCalledOnce();
    key({ key: '=', metaKey: true });
    expect(onZoomStep).toHaveBeenCalledWith(1.2);
    key({ key: '-', metaKey: true });
    expect(onZoomStep).toHaveBeenCalledWith(1 / 1.2);
  });

  it('every key it handles is kept from the page, so a panel it opens never receives the letter', () => {
    const { key } = setup(vi.fn(() => false));
    for (const letter of ['i', 'e', 'n', 'f', 'l', 'r', 'v']) {
      const preventDefault = vi.fn();
      key({ key: letter, preventDefault });
      expect(preventDefault, letter).toHaveBeenCalled();
    }
    const unhandled = vi.fn();
    key({ key: 'q', preventDefault: unhandled });
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('space arms the hand tool and H switches to it', () => {
    const { key, onSpacePan, onToolChange } = setup(vi.fn(() => false));
    key({ key: ' ' });
    expect(onSpacePan).toHaveBeenCalledWith(true);
    key({ key: 'h' });
    expect(onToolChange).toHaveBeenCalledWith('hand');
  });
});

describe('useV2Keyboard edit shortcuts', () => {
  it('⌘X/C clipboard, ⌘⌥C/V style, ⌘B/I/U text style; ⌘V is left to the native paste event', () => {
    const t = setup();
    const preventDefault = vi.fn();
    key(t, { key: 'x', metaKey: true }); key(t, { key: 'c', metaKey: true }); key(t, { key: 'v', metaKey: true, preventDefault });
    expect([t.onCut, t.onCopy].map((fn) => fn.mock.calls.length)).toEqual([1, 1]);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(t.onPasteKey).toHaveBeenCalledOnce();
    key(t, { key: 'ç', code: 'KeyC', metaKey: true, altKey: true });
    key(t, { key: '√', code: 'KeyV', metaKey: true, altKey: true });
    expect(t.onCopyStyle).toHaveBeenCalledOnce();
    expect(t.onPasteStyle).toHaveBeenCalledOnce();
    key(t, { key: 'b', metaKey: true });
    expect(t.onTextStyle).toHaveBeenCalledWith('bold');
    key(t, { key: 'g', metaKey: true });
    key(t, { key: 'G', metaKey: true, shiftKey: true });
    expect(t.onGroup).toHaveBeenCalledOnce();
    expect(t.onUngroup).toHaveBeenCalledOnce();
    expect(t.onTypeToEdit).not.toHaveBeenCalled();
  });

  it('⌘] steps, ⌘⌥] jumps; ⌥ letters align, ⌥⇧ distribute, ⇧H/V flip, ⇧1/⇧2 zoom', () => {
    const t = setup(vi.fn(() => false));
    key(t, { key: ']', code: 'BracketRight', metaKey: true });
    key(t, { key: '[', code: 'BracketLeft', metaKey: true, altKey: true });
    expect(t.onReorder.mock.calls).toEqual([['forward'], ['back']]);
    key(t, { key: 'å', code: 'KeyA', altKey: true });
    key(t, { key: '√', code: 'KeyV', altKey: true });
    expect(t.onAlign.mock.calls).toEqual([['left'], ['center-y']]);
    key(t, { key: 'Ó', code: 'KeyH', altKey: true, shiftKey: true });
    expect(t.onDistribute).toHaveBeenCalledWith('horizontal');
    key(t, { key: 'H', code: 'KeyH', shiftKey: true });
    key(t, { key: 'V', code: 'KeyV', shiftKey: true });
    expect(t.onFlip.mock.calls).toEqual([['horizontal'], ['vertical']]);
    key(t, { key: '!', code: 'Digit1', shiftKey: true });
    key(t, { key: '@', code: 'Digit2', shiftKey: true });
    expect(t.onFitView).toHaveBeenCalledOnce();
    expect(t.onZoomToSelection).toHaveBeenCalledOnce();
  });

  it('⌥C opens the code panel; ⌥D stays align right', () => {
    const t = setup(vi.fn(() => false));
    key(t, { key: 'ç', code: 'KeyC', altKey: true });
    expect(t.onToggleCode).toHaveBeenCalledOnce();
    key(t, { key: '∂', code: 'KeyD', altKey: true });
    expect(t.onAlign).toHaveBeenCalledWith('right');
    expect(t.onToggleCode).toHaveBeenCalledOnce();
  });

  it('⇧1/⇧2 zoom even with one shape selected: they never type "!" or "@" into its label', () => {
    const t = setup();
    key(t, { key: '!', code: 'Digit1', shiftKey: true });
    key(t, { key: '@', code: 'Digit2', shiftKey: true });
    expect(t.onFitView).toHaveBeenCalledOnce();
    expect(t.onZoomToSelection).toHaveBeenCalledOnce();
    expect(t.onTypeToEdit).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter renames like ⌘Enter, for keyboards without ⌘', () => {
    const t = setup();
    key(t, { key: 'Enter', ctrlKey: true });
    key(t, { key: 'Enter', metaKey: true });
    key(t, { key: 'Enter' });
    expect(t.onEditPrimary.mock.calls).toEqual([['f2'], ['f2'], ['enter']]);
  });

  it('⇧H on a single selected shape types a capital letter instead of flipping', () => {
    const t = setup();
    key(t, { key: 'H', code: 'KeyH', shiftKey: true });
    expect(t.onTypeToEdit).toHaveBeenCalledWith('H');
    expect(t.onFlip).not.toHaveBeenCalled();
  });
});

function key(t: ReturnType<typeof setup>, init: Partial<KeyboardEvent<HTMLElement>>) {
  t.key({ code: '', ...init });
}

describe('useV2Keyboard find', () => {
  it('⌘F and Ctrl+F open the find bar and keep the browser out of it; a bare F still adds a frame', () => {
    const { key, onFind, onInsertFrame } = setup(vi.fn(() => false));
    const preventDefault = vi.fn();
    key({ key: 'f', metaKey: true, preventDefault });
    key({ key: 'f', ctrlKey: true });
    expect(onFind).toHaveBeenCalledTimes(2);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onInsertFrame).not.toHaveBeenCalled();
    key({ key: 'f' });
    expect(onFind).toHaveBeenCalledTimes(2);
    expect(onInsertFrame).toHaveBeenCalledOnce();
  });
});

describe('useV2Keyboard assistant toggle', () => {
  it('⌘J toggles the assistant even from a text field, and only with that exact chord', () => {
    const { key, onToggleAgent } = setup();
    key({ key: 'j', metaKey: true, target: document.createElement('textarea') });
    key({ key: 'J', ctrlKey: true });
    expect(onToggleAgent).toHaveBeenCalledTimes(2);
    key({ key: 'j', metaKey: true, shiftKey: true });
    key({ key: 'j', target: document.createElement('textarea') });
    expect(onToggleAgent).toHaveBeenCalledTimes(2);
  });
});

describe('keyOwnedByTarget', () => {
  const event = (target: EventTarget, init: Partial<KeyboardEvent<HTMLElement>> = {}) =>
    ({ key: 'ArrowRight', target, defaultPrevented: false, ...init }) as unknown as KeyboardEvent<HTMLElement>;
  it('a focused control, tree or field keeps its navigation keys; the canvas does not', () => {
    const button = document.createElement('button');
    const tree = document.createElement('ul');
    tree.setAttribute('role', 'tree');
    const item = tree.appendChild(document.createElement('li'));
    expect(keyOwnedByTarget(event(button))).toBe(true);
    expect(keyOwnedByTarget(event(button, { key: ' ' }))).toBe(true);
    expect(keyOwnedByTarget(event(item))).toBe(true);
    const link = document.createElement('a');
    link.href = 'https://docs.openflowkit.com/';
    expect(keyOwnedByTarget(event(link, { key: 'Enter' }))).toBe(true);
    expect(keyOwnedByTarget(event(document.createElement('textarea'), { key: 'q' }))).toBe(true);
    expect(keyOwnedByTarget(event(document.createElement('section'), { defaultPrevented: true }))).toBe(true);
    expect(keyOwnedByTarget(event(document.createElement('section')))).toBe(false);
    // Escape is never a control's: it still closes what is open.
    expect(keyOwnedByTarget(event(button, { key: 'Escape' }))).toBe(false);
  });
});

describe('useV2Keyboard comment tool', () => {
  it('bare C arms the comment tool; ⌘C still copies and ⇧C does not', () => {
    const { key, onToolChange, onCopy } = setup(vi.fn(() => false));
    key({ key: 'c' });
    expect(onToolChange).toHaveBeenCalledExactlyOnceWith('comment');
    key({ key: 'c', metaKey: true });
    expect(onCopy).toHaveBeenCalledOnce();
    expect(onToolChange).toHaveBeenCalledOnce();
    key({ key: 'C', shiftKey: true });
    expect(onToolChange).toHaveBeenCalledOnce();
  });

  it('Enter with the comment tool places a thread from the keyboard and edits nothing', () => {
    const place = vi.fn(() => true);
    const { key, onEditPrimary } = setup(vi.fn(() => false), 'comment', place);
    key({ key: 'Enter' });
    expect(place).toHaveBeenCalledOnce();
    expect(onEditPrimary).not.toHaveBeenCalled();
  });

  it('Enter falls through to editing when nothing could be placed, and with any other tool', () => {
    const { key, onEditPrimary } = setup(vi.fn(() => false), 'comment', () => false);
    key({ key: 'Enter' });
    expect(onEditPrimary).toHaveBeenCalledWith('enter');
    const other = setup(vi.fn(() => false), 'select', vi.fn(() => true));
    other.key({ key: 'Enter' });
    expect(other.onEditPrimary).toHaveBeenCalledWith('enter');
  });
});
