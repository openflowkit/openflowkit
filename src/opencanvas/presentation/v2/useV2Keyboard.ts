import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { isEditableTarget } from './pointerOperations';
import type { V2Tool } from './V2CreationToolbar';
import type { AlignMode, DistributeAxis } from '../../domain/transforms/arrangement';

interface V2KeyboardOptions {
  readonly toolRef: RefObject<V2Tool>;
  readonly editingRef: RefObject<boolean>;
  readonly onToolChange: (tool: V2Tool) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onDelete: () => void;
  readonly onDuplicate: () => void;
  readonly onReorder: (direction: 'front' | 'back' | 'forward' | 'backward') => void;
  readonly onToggleLock: () => void;
  readonly onGroup: () => void;
  readonly onUngroup: () => void;
  readonly onWrapInSection: () => void;
  readonly onCut: () => void;
  readonly onCopy: () => void;
  /** ⌘V: never cancelled, so the native paste event still fires; the editor falls back when none does. */
  readonly onPasteKey: () => void;
  readonly onCopyStyle: () => void;
  readonly onPasteStyle: () => void;
  readonly onAlign: (mode: AlignMode) => void;
  readonly onDistribute: (axis: DistributeAxis) => void;
  readonly onFlip: (axis: 'horizontal' | 'vertical') => void;
  readonly onZoomToSelection: () => void;
  /** ⌘B / ⌘I / ⌘U on a selection (not while editing). */
  readonly onTextStyle: (toggle: 'bold' | 'italic' | 'underline') => void;
  /** Enter drills into a model view when there is one; F2/⌘Enter always rename. */
  readonly onEditPrimary: (source: 'enter' | 'f2') => void;
  /** Enter with the comment tool: open a new thread's composer at the selection or the viewport centre; false when it could not. */
  readonly onCommentHere?: () => boolean;
  /** ⌘⇧⌫ on a C4 element: remove it from the model and every view. */
  readonly onRemoveFromModel: () => void;
  readonly onNudge: (delta: { x: number; y: number }) => void;
  readonly onCancelGesture: () => boolean;
  /** Escape: close an open utility panel first; false falls through. */
  readonly onEscapePanel?: () => boolean;
  /** Enter: finish a click-by-click path; false falls through to label editing. */
  readonly onClearSelection: () => void;
  readonly onSelectAll: () => void;
  readonly onFitView: () => void;
  readonly onZoomStep: (factor: number) => void;
  readonly onResetZoom: () => void;
  readonly onToggleTree: () => void;
  readonly onToggleIcons: () => void;
  /** E opens the emoji picker; ⇧I picks an image file. */
  readonly onToggleEmoji: () => void;
  readonly onInsertImage: () => void;
  /** F: a plain frame at the viewport centre; N: a sticky note, label open. */
  readonly onInsertFrame: () => void;
  readonly onInsertSticky: () => void;
  /** ⇧S: the More flyout (frames, tools, wireframe). */
  readonly onToggleMore: () => void;
  readonly onToggleAgent: () => void;
  readonly onToggleCode: () => void;
  readonly onToggleModel: () => void;
  readonly onToggleInspect: () => void;
  /** M: Canvas ↔ Map on any page; false when it could not switch, so the key falls through. */
  readonly onToggleMap: () => boolean;
  /** ⌘F: the find bar, in place of the browser's. */
  readonly onFind: () => void;
  readonly onSpacePan: (active: boolean) => void;
  /** Type-to-edit: return true when the key opened an editor, false to fall through to shortcuts. */
  readonly onTypeToEdit: (key: string) => boolean;
}

// ⌥ shortcuts read event.code: on macOS ⌥A produces "å" in event.key.
const ALT_ALIGN: Readonly<Record<string, AlignMode>> = {
  KeyA: 'left', KeyD: 'right', KeyW: 'top', KeyS: 'bottom', KeyH: 'center-x', KeyV: 'center-y',
};

const CONTROLS = 'button, a[href], [role="slider"], [role="menu"], [role="listbox"], [role="tree"]';
const CONTROL_KEYS = [' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

/** The key is the focused field's or control's own (typing, activation, arrow navigation), or already handled. */
export function keyOwnedByTarget(event: KeyboardEvent<HTMLElement>): boolean {
  return event.defaultPrevented || isEditableTarget(event.target)
    || (event.target instanceof HTMLElement && event.target.closest(CONTROLS) !== null && CONTROL_KEYS.includes(event.key));
}

// I-02: V/H/R/O/A/T switch tools; typing in a label or input never does.
// Escape exits the active gesture, then an armed tool, then the selection.
export function useV2Keyboard(options: V2KeyboardOptions) {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  return useCallback((event: KeyboardEvent<HTMLElement>) => {
    const opts = optionsRef.current;
    // ⌘J toggles the assistant from anywhere, its own composer included: it opens and closes the place you type.
    if (!event.defaultPrevented && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'j') {
      opts.onToggleAgent();
      event.preventDefault();
      return;
    }
    // Native chrome controls keep activation/navigation keys. Global tool and
    // history shortcuts still work after choosing a tool with the mouse.
    if (keyOwnedByTarget(event)) return;
    // An input method's keys (Safari sends the first with the letter and keyCode 229) belong to the composition.
    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
    if (event.key === ' ' && !event.repeat) {
      if (!opts.editingRef.current) {
        opts.onSpacePan(true);
        event.preventDefault();
      }
      return;
    }
    if (opts.editingRef.current) return;
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    // A handled key never reaches the page: a shortcut that opens a panel or an editor moves focus during this
    // keydown, and the key's default would type it into that field (I put "i" in the icon search).
    let handled = true;
    if (command && key === 'z') {
      if (event.shiftKey) opts.onRedo();
      else opts.onUndo();
    } else if (command && key === 'y') {
      opts.onRedo();
    } else if (command && key === 'a') {
      opts.onSelectAll();
    } else if (command && (event.key === '=' || event.key === '+')) {
      opts.onZoomStep(1.2);
    } else if (command && event.key === '-') {
      opts.onZoomStep(1 / 1.2);
    // ⌘0 is 100 % (Excalidraw, the browser); fit is ⇧1 everywhere (Figma, tldraw, Excalidraw).
    } else if (command && (key === '0' || key === '1')) {
      opts.onResetZoom();
    } else if (command && key === 'd') {
      opts.onDuplicate();
    } else if (command && key === 'f') {
      opts.onFind();
    } else if (command && key === 'l') {
      opts.onToggleLock();
    } else if (command && event.altKey && (key === 'c' || event.code === 'KeyC')) {
      opts.onCopyStyle();
    } else if (command && event.altKey && (key === 'v' || event.code === 'KeyV')) {
      opts.onPasteStyle();
    } else if (command && (key === 'g' || event.code === 'KeyG')) {
      if (event.shiftKey) opts.onUngroup(); else if (event.altKey) opts.onWrapInSection(); else opts.onGroup();
    } else if (command && key === 'x') {
      opts.onCut();
    } else if (command && key === 'c') {
      opts.onCopy();
    // ⌘V is not cancelled: that would cancel the native paste event, which the editor reads (shapes, images,
    // image URLs, Mermaid) without a clipboard permission prompt.
    } else if (command && key === 'v') {
      opts.onPasteKey();
      handled = false;
    } else if (command && (key === 'b' || key === 'i' || key === 'u')) {
      opts.onTextStyle(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
    } else if (command && (event.code === 'BracketRight' || event.code === 'BracketLeft')) {
      const front = event.code === 'BracketRight';
      opts.onReorder(event.altKey ? (front ? 'front' : 'back') : (front ? 'forward' : 'backward'));
    } else if (!command && (event.key === ']' || event.key === '[')) {
      opts.onReorder(event.key === ']' ? 'front' : 'back');
    } else if (!command && event.altKey && event.shiftKey && (event.code === 'KeyH' || event.code === 'KeyV')) {
      opts.onDistribute(event.code === 'KeyH' ? 'horizontal' : 'vertical');
    } else if (!command && event.altKey && !event.shiftKey && ALT_ALIGN[event.code]) {
      opts.onAlign(ALT_ALIGN[event.code]);
    } else if (!command && event.altKey && event.code === 'KeyC') {
      opts.onToggleCode();
    } else if (!command && event.altKey && event.code === 'KeyM') {
      opts.onToggleModel();
    } else if (!command && event.altKey && !event.shiftKey && event.code === 'KeyI') {
      opts.onToggleInspect();
    } else if (command && event.shiftKey && (event.key === 'Delete' || event.key === 'Backspace')) {
      opts.onRemoveFromModel();
    } else if (!command && (event.key === 'Delete' || event.key === 'Backspace')) {
      opts.onDelete();
    } else if (
      !command &&
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    ) {
      const amount = event.shiftKey ? 10 : 1;
      const delta =
        event.key === 'ArrowLeft'
          ? { x: -amount, y: 0 }
          : event.key === 'ArrowRight'
            ? { x: amount, y: 0 }
            : event.key === 'ArrowUp'
              ? { x: 0, y: -amount }
              : { x: 0, y: amount };
      opts.onNudge(delta);
    // M switches Canvas and Map on any page, ahead of type-to-edit: it is a mode key there, not the start of a label.
    } else if (!command && !event.shiftKey && !event.altKey && key === 'm' && opts.onToggleMap()) {
    // ⇧0/⇧1/⇧2 (by code) sit above type-to-edit: they zoom, never type ")", "!" or "@" into a label.
    } else if (!command && !event.altKey && event.shiftKey
      && (event.code === 'Digit0' || event.code === 'Digit1' || event.code === 'Digit2')) {
      if (event.code === 'Digit0') opts.onResetZoom();
      else if (event.code === 'Digit1') opts.onFitView(); else opts.onZoomToSelection();
    } else if (!command && !event.altKey && event.key.length === 1 && event.key !== ' '
      && opts.onTypeToEdit(event.key)) {
    // ⇧H/V sit below type-to-edit: a capital letter on one selected
    // shape starts its label; flips need none or several selected.
    } else if (!command && !event.altKey && event.shiftKey && event.code === 'KeyI') {
      opts.onInsertImage();
    } else if (!command && !event.altKey && event.shiftKey && event.code === 'KeyS') {
      opts.onToggleMore();
    } else if (!command && !event.altKey && event.shiftKey && event.code === 'KeyP') {
      opts.onToolChange('highlighter');
    } else if (!command && !event.altKey && event.shiftKey && (event.code === 'KeyH' || event.code === 'KeyV')) {
      opts.onFlip(event.code === 'KeyH' ? 'horizontal' : 'vertical');
    } else if (!command && !event.shiftKey && !event.altKey && key === 'v') {
      opts.onToolChange('select');
    } else if (!command && !event.shiftKey && !event.altKey && key === 'h') {
      opts.onToolChange('hand');
    } else if (!command && !event.shiftKey && !event.altKey && key === 'c') {
      opts.onToolChange('comment');
    } else if (!command && !event.shiftKey && !event.altKey && key === 'r') {
      opts.onToolChange('rectangle');
    } else if (!command && !event.shiftKey && !event.altKey && key === 'o') {
      opts.onToolChange('ellipse');
    } else if (!command && !event.shiftKey && !event.altKey && key === 's') {
      opts.onToolChange('shape');
    } else if (!command && !event.shiftKey && !event.altKey && key === 'a') {
      opts.onToolChange('connector');
    } else if (!command && !event.shiftKey && !event.altKey && key === 't') {
      opts.onToolChange('text');
    } else if (!command && !event.shiftKey && !event.altKey && key === 'p') {
      opts.onToolChange('pen');
    } else if (!command && !event.shiftKey && !event.altKey && key === 'x') {
      opts.onToolChange('eraser');
    } else if (!command && !event.shiftKey && !event.altKey && key === 'k') {
      opts.onToolChange('laser');
    } else if (!command && !event.shiftKey && !event.altKey && key === 'f') {
      opts.onInsertFrame();
    } else if (!command && !event.shiftKey && !event.altKey && key === 'n') {
      opts.onInsertSticky();
    } else if (!command && key === 'l') {
      opts.onToggleTree();
    } else if (!command && !event.shiftKey && !event.altKey && key === 'i') {
      opts.onToggleIcons();
    } else if (!command && !event.shiftKey && !event.altKey && key === 'e') {
      opts.onToggleEmoji();
    } else if (event.key === 'F2') {
      opts.onEditPrimary('f2');
    } else if (event.key === 'Enter' && !command && !event.shiftKey && opts.toolRef.current === 'comment' && opts.onCommentHere?.()) {
      /* a thread placed from the keyboard */
    } else if (event.key === 'Enter') {
      opts.onEditPrimary(command || event.shiftKey ? 'f2' : 'enter');
    } else if (event.key === 'Escape') {
      if (opts.onCancelGesture()) {
        /* gesture dropped */
      } else if (opts.onEscapePanel?.()) {
        /* panel closed */
      } else if (opts.toolRef.current !== 'select') {
        opts.onToolChange('select');
      } else {
        opts.onClearSelection();
      }
    } else {
      handled = false;
    }
    if (handled) event.preventDefault();
  }, []);
}
