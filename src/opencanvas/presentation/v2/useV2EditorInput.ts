import { useRef, useState, type RefObject } from 'react';
import type { CanvasSelection } from '../../application/selection/selection';
import type { DocumentCommand } from '../../domain/commands/types';
import type { ScenePage } from '../../domain/document/types';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import type { ToastItem } from '../design-system';
import type { V2Tool } from './V2CreationToolbar';
import { isEditableTarget } from './pointerOperations';
import { looksLikeDiagramCode, type useV2CodeWorkspace } from './useV2CodeWorkspace';
import type { useV2EditActions } from './useV2EditActions';
import { useV2IconLibrary } from './useV2IconLibrary';
import { useV2Inserts } from './useV2Inserts';
import type { OpenEditorOptions } from './useV2LabelEditing';
import { IMAGE_URL_PATTERN, useV2MediaInsert } from './useV2MediaInsert';
import type { useV2Preferences } from './useV2Preferences';
import { mintV2Id } from './v2Document';
import { counted, imageFiles } from './v2EditorUtil';
import { platformKeys } from './v2Shortcuts';

interface EditorInputInput {
  readonly hostRef: RefObject<PixiRendererHost | null>;
  readonly pageRef: RefObject<ScenePage | null>;
  readonly sectionRef: RefObject<HTMLElement | null>;
  readonly selectionRef: RefObject<CanvasSelection>;
  readonly readOnlyRef: RefObject<boolean>;
  readonly drawCommit: (command: DocumentCommand) => void;
  readonly applySelection: (selection: CanvasSelection) => void;
  readonly applyConnectorSelection: (connectorIds: readonly string[]) => void;
  readonly setAnnouncement: (message: string) => void;
  readonly pushToast: (toast: ToastItem) => void;
  readonly setTool: (tool: V2Tool) => void;
  readonly openEditor: (nodeId: string, options?: OpenEditorOptions) => void;
  readonly openChart: (nodeId: string) => void;
  readonly editLocked: boolean;
  readonly editActions: ReturnType<typeof useV2EditActions>;
  readonly code: ReturnType<typeof useV2CodeWorkspace>;
  readonly preferences: ReturnType<typeof useV2Preferences>['preferences'];
  readonly updatePreferences: ReturnType<typeof useV2Preferences>['updatePreferences'];
}

/** What comes in from outside the canvas: the icon library, images (picked, dropped, pasted), emoji, and pasted shapes or code. */
export function useV2EditorInput(input: EditorInputInput) {
  const {
    hostRef, pageRef, sectionRef, selectionRef, readOnlyRef, drawCommit, applySelection, applyConnectorSelection, setAnnouncement,
    pushToast, setTool, openEditor, openChart, editLocked, editActions, code, preferences, updatePreferences,
  } = input;
  const iconLibrary = useV2IconLibrary({
    hostRef, pageRef, commit: drawCommit, mintId: mintV2Id, openEditor, readOnly: editLocked,
  });

  // The icon library hosts emoji on their own tab; I and E open it there.
  const [librarySection, setLibrarySection] = useState<'icons' | 'emoji'>('icons');
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const media = useV2MediaInsert({
    pageRef, commit: drawCommit, applySelection, applyConnectorSelection,
    announce: setAnnouncement, mintId: mintV2Id, readOnlyRef,
    onFailure: (title) => pushToast({ id: `media-${Date.now()}`, tone: 'danger', title }),
    centreWorld: () => {
      const bounds = sectionRef.current?.getBoundingClientRect();
      return hostRef.current && bounds
        ? hostRef.current.screenToWorld({ x: bounds.width / 2, y: bounds.height / 2 })
        : { x: 0, y: 0 };
    },
  });
  const inserts = useV2Inserts({
    pageRef, readOnlyRef, selectionRef, commit: drawCommit, applySelection, applyConnectorSelection,
    centreWorld: media.centreWorld, setTool, openEditor, openChart, announce: setAnnouncement,
  });
  const pickImageFile = () => imageInputRef.current?.click();
  const pointFromEvent = (event: { clientX: number; clientY: number }) => {
    const bounds = sectionRef.current?.getBoundingClientRect();
    return bounds && hostRef.current
      ? hostRef.current.screenToWorld({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
      : undefined;
  };
  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    const files = imageFiles(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    const at = pointFromEvent(event);
    for (const file of files) void media.insertImageFile(file, at);
  };
  // ⌘V arrives here as the native paste event (the keyboard hook leaves it alone): a text field pastes into itself;
  // on the canvas, images, then shapes copied here or in Excalidraw, image URLs, diagram code (drawn in place), and last the in-memory copy.
  const handlePaste = (event: Pick<ClipboardEvent, 'target' | 'clipboardData' | 'preventDefault'>) => {
    editActions.pasteEventArrived();
    if (isEditableTarget(event.target) || editLocked) return;
    const files = imageFiles(event.clipboardData);
    if (files.length > 0) {
      event.preventDefault();
      for (const file of files) void media.insertImageFile(file);
      return;
    }
    const text = event.clipboardData?.getData('text/plain').trim() ?? '';
    if (editActions.pasteShapes(text)) {
      event.preventDefault();
    } else if (IMAGE_URL_PATTERN.test(text)) {
      event.preventDefault();
      media.insertImageUrl(text);
    } else if (looksLikeDiagramCode(text)) {
      // The code panel converts and draws it as one undo step, its source open beside it.
      event.preventDefault();
      void code.startFrom(text).then(counted('created_import'));
    } else if (editActions.pasteShapes()) {
      event.preventDefault();
    } else if (text) {
      event.preventDefault();
      pushToast({ id: 'paste-text', tone: 'info', title: `Pasted text isn’t a diagram — open Diagram as code (${platformKeys('⌥C')}) to convert it` });
    }
  };
  const [moreOpen, setMoreOpen] = useState(false);
  const pickEmoji = (glyph: string) => {
    media.insertEmoji(glyph);
    const recent = [glyph, ...preferences.recentEmoji.filter((entry) => entry !== glyph)].slice(0, 24);
    updatePreferences({ recentEmoji: recent });
    iconLibrary.setOpen(false);
  };
  return { iconLibrary, librarySection, setLibrarySection, imageInputRef, media, inserts, pickImageFile, handleDrop, handlePaste, moreOpen, setMoreOpen, pickEmoji };
}
