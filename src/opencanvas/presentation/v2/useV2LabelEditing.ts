import { dslFrameRaw } from '../../../dsl/sceneMeta';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { CanvasCamera } from '../../domain/camera/types';
import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneNode, ScenePage } from '../../domain/document/types';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import { sameRect } from './V2ContextBar';
import { buildDeleteSelectionCommand, buildEditLabelCommand, buildSetNodeLabelCommand } from '../../domain/commands/sceneEdits';
import { nodeTechHint, refreshAutoIcon, withoutIcon } from '../../application/dsl/iconCommands';
import { resolveDslIcon } from '../../../services/dsl/iconResolver';
import type { V2EditingState } from './V2CanvasHost';
import { widgetLabelBox } from '../../domain/nodes/widgetNodePresentation';

interface V2LabelEditingOptions {
  readonly hostRef: RefObject<PixiRendererHost | null>;
  readonly page: ScenePage | null;
  readonly camera: CanvasCamera;
  readonly commit: (command: DocumentCommand) => void;
  /** A node made for this edit: its label (or its removal) joins the undo step that created it. */
  readonly amendNewNode: (nodeId: string, command: DocumentCommand) => void;
  readonly announce: (message: string) => void;
  readonly focusCanvas: () => void;
  /**
   * Model pages route a label edit to the element instead of the node, so the
   * rename lands on every view. Return true when the rename was handled.
   */
  readonly onRenamePlacedElement?: (nodeId: string, label: string) => boolean;
}

export interface OpenEditorOptions {
  /** Node was created for this edit: an empty commit or a cancel removes it again. */
  readonly isNew?: boolean;
  /** Type-to-edit: the editor opens with this text instead of the current label. */
  readonly initialValue?: string;
}

const STROKE_KINDS: ReadonlySet<string> = new Set(['pen', 'highlighter', 'line', 'arrow']);

/**
 * Type-to-edit names a blank shape (just placed, never named) and nothing else: on a named one the
 * letters stay tool shortcuts, and Enter/F2 rename it (U1-01). Groups, label-less widgets and
 * derived view titles have no label to type into.
 */
export function typeToEditNames(node: SceneNode | undefined): boolean {
  if (!node || node.kind === 'group' || (node.kind === 'widget' && !widgetLabelBox(node))) return false;
  // Strokes draw no label; a generated diagram's frame is named in its source or with F2/Enter, never by a stray letter.
  if (STROKE_KINDS.has(node.kind)) return false;
  if (node.kind === 'frame' && Object.keys(dslFrameRaw(node)).length > 0) return false;
  return typeof node.content.label !== 'string' || node.content.label.trim() === '';
}

// In-place label editing owns keyboard input while open (I-02, I-06).
// Escape restores, commit is a single set-node, and focus returns to the
// canvas so F2 and arrows keep working afterwards.
export function useV2LabelEditing(options: V2LabelEditingOptions) {
  const { hostRef, page, camera } = options;
  const [editing, setEditing] = useState<V2EditingState | null>(null);
  const editingRef = useRef(false);
  const editingStateRef = useRef<V2EditingState | null>(null);
  const optionsRef = useRef(options);
  // A node created and edited in one gesture is not on the renderer yet;
  // hold the request until the page that contains it has been drawn.
  const pendingRef = useRef<{ nodeId: string; editorOptions: OpenEditorOptions } | null>(null);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  useEffect(() => {
    editingRef.current = editing !== null;
    editingStateRef.current = editing;
  }, [editing]);

  // Keep the overlay glued to its node while the camera moves. Depends on the
  // camera alone: depending on state set here would re-run every render and
  // race cancel/commit with a stale re-open.
  useEffect(() => {
    setEditing((current) => {
      const bounds = current && hostRef.current?.getNodeLabelScreenBounds(current.nodeId);
      return bounds && !sameRect(bounds, current.bounds) ? { ...current, bounds } : current;
    });
  }, [camera, hostRef]);

  const openEditor = useCallback(
    (nodeId: string, editorOptions: OpenEditorOptions = {}) => {
      const node = optionsRef.current.page?.nodes.find((candidate) => candidate.id === nodeId);
      // Groups are invisible containers, and some widgets (an image, a divider)
      // draw no label: nothing to edit.
      if (node?.kind === 'frame' && typeof dslFrameRaw(node).viewTitle === 'string') {
        optionsRef.current.announce('This title comes from the architecture view. Edit it in diagram source.');
        return;
      }
      if (node?.kind === 'group' || (node?.kind === 'widget' && !widgetLabelBox(node))) return;
      const bounds = node && hostRef.current?.getNodeLabelScreenBounds(nodeId);
      if (!node || !bounds) {
        pendingRef.current = { nodeId, editorOptions };
        return;
      }
      pendingRef.current = null;
      setEditing({
        nodeId,
        bounds,
        value: editorOptions.initialValue
          ?? (typeof node.content.label === 'string' ? node.content.label : ''),
        isNew: editorOptions.isNew === true,
        caretAtEnd: editorOptions.initialValue !== undefined,
      });
      optionsRef.current.announce('Editing label');
    },
    [hostRef]
  );

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending && page?.nodes.some((node) => node.id === pending.nodeId)) {
      openEditor(pending.nodeId, pending.editorOptions);
    }
  }, [page, openEditor]);

  // A node created for this edit and left blank is removed, so a double-click
  // on empty canvas followed by Escape/blur leaves nothing invisible behind.
  const removeIfNew = useCallback((): boolean => {
    const { amendNewNode, page: currentPage } = optionsRef.current;
    const current = editingStateRef.current;
    if (!current?.isNew || !currentPage?.nodes.some((node) => node.id === current.nodeId)) return false;
    amendNewNode(current.nodeId, buildDeleteSelectionCommand(currentPage, [current.nodeId], []));
    return true;
  }, []);

  const cancelEdit = useCallback(() => {
    removeIfNew();
    setEditing(null);
    optionsRef.current.focusCanvas();
  }, [removeIfNew]);

  const commitLabel = useCallback((value: string) => {
    const { commit, amendNewNode, announce, focusCanvas, page: currentPage } = optionsRef.current;
    const current = editingStateRef.current;
    const node = current && currentPage?.nodes.find((candidate) => candidate.id === current.nodeId);
    const previous = typeof node?.content.label === 'string' ? node.content.label : '';
    if (value.trim() === '' && removeIfNew()) {
      /* blank new node removed */
    } else if (node && currentPage && value !== previous) {
      if (optionsRef.current.onRenamePlacedElement?.(node.id, value)) {
        announce('Element renamed in every view');
      } else {
        const linked = buildEditLabelCommand(currentPage, node.id, value);
        if (linked.kind === 'batch') {
          // A shape and its label partner (words set beside it) change together.
          commit(linked);
        } else {
          const command = buildSetNodeLabelCommand(currentPage, node.id, value);
          // An inferred icon follows the new label (or leaves with it).
          const after = refreshAutoIcon(command.after, value, nodeTechHint(command.after), resolveDslIcon, (plain) => withoutIcon(plain, false));
          if (current.isNew) amendNewNode(node.id, { ...command, after }); else commit({ ...command, after });
        }
        announce('Label saved');
      }
    }
    setEditing(null);
    focusCanvas();
  }, [removeIfNew]);

  return { editing, editingRef, openEditor, cancelEdit, commitLabel };
}
