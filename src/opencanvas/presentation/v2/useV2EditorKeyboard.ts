import type { RefObject } from 'react';
import type { CanvasSelection } from '../../application/selection/selection';
import type { ScenePage } from '../../domain/document/types';
import type { useV2MapMode } from './map/useV2MapMode';
import type { V2Tool } from './V2CreationToolbar';
import type { useV2ArchitectureActions } from './useV2ArchitectureActions';
import type { useV2Camera } from './useV2Camera';
import type { useV2ConnectorLabelEditing } from './useV2ConnectorLabelEditing';
import type { useV2EditActions } from './useV2EditActions';
import type { useV2EditorInput } from './useV2EditorInput';
import type { useV2Find } from './useV2Find';
import { typeToEditNames, type OpenEditorOptions } from './useV2LabelEditing';
import { useV2Keyboard } from './useV2Keyboard';
import type { useV2Panels } from './useV2Panels';
import type { useV2Selection } from './useV2Selection';
import { enteredGroup, type V2GestureApi } from './v2PointerGestures';

interface EditorKeyboardInput {
  readonly toolRef: RefObject<V2Tool>;
  /** The comment layer's way to open a composer without a pointer (Enter with the comment tool). */
  readonly commentHereRef: RefObject<() => boolean>;
  readonly editingRef: RefObject<boolean>;
  readonly pageRef: RefObject<ScenePage | null>;
  readonly selectionRef: RefObject<CanvasSelection>;
  readonly gestureApiRef: RefObject<V2GestureApi | null>;
  readonly setTool: (tool: V2Tool) => void;
  readonly setSpacePan: (down: boolean) => void;
  readonly input: ReturnType<typeof useV2EditorInput>;
  readonly editActions: ReturnType<typeof useV2EditActions>;
  readonly architectureActions: ReturnType<typeof useV2ArchitectureActions>;
  readonly camera: ReturnType<typeof useV2Camera>;
  readonly connectorLabel: ReturnType<typeof useV2ConnectorLabelEditing>;
  readonly panels: ReturnType<typeof useV2Panels>;
  readonly selectionApi: ReturnType<typeof useV2Selection>;
  readonly map: ReturnType<typeof useV2MapMode>;
  readonly find: ReturnType<typeof useV2Find>;
  readonly viewPage: ScenePage | null;
  readonly selectedElementId: string | null;
  readonly selectedConnectorIds: readonly string[];
  readonly docReadOnly: boolean;
  readonly editLocked: boolean;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly escapePanel: () => boolean;
  readonly openEditor: (nodeId: string, options?: OpenEditorOptions) => void;
  readonly selectNodes: (nodeIds: readonly string[]) => void;
  readonly fitAll: () => void;
  readonly toggleCode: () => void;
  readonly backToMap: () => boolean;
}

/** Every editor shortcut, wired to what it does. */
export function useV2EditorKeyboard(k: EditorKeyboardInput) {
  const {
    toolRef, commentHereRef, editingRef, pageRef, selectionRef, gestureApiRef, setTool, setSpacePan, input, editActions, architectureActions, camera, connectorLabel,
    panels, selectionApi, map, find, viewPage, selectedElementId, selectedConnectorIds, docReadOnly, editLocked, undo, redo, escapePanel, openEditor,
    selectNodes, fitAll, toggleCode, backToMap,
  } = k;
  return useV2Keyboard({
    toolRef, editingRef,
    onCommentHere: () => commentHereRef.current(),
    // A with two shapes selected connects them (first-selected → second); otherwise it arms the connector.
    onToolChange: (next) => { if (next !== 'connector' || !gestureApiRef.current?.connectSelection()) setTool(next); },
    onToggleIcons: () => {
      input.setLibrarySection('icons');
      input.iconLibrary.toggle();
    },
    onToggleEmoji: () => {
      input.setLibrarySection('emoji');
      input.iconLibrary.setOpen(true);
    },
    onInsertImage: input.pickImageFile,
    onInsertFrame: () => input.inserts.insertFrame('frame'),
    onInsertSticky: input.inserts.insertSticky,
    onToggleMore: () => input.setMoreOpen((open) => !open),
    // A Canvas edit undone from the map would otherwise vanish unseen.
    onUndo: undo,
    onRedo: redo,
    // On a C4 view a deleted placement is unplaced (the model keeps the element), in the same step as the rest.
    onDelete: editActions.deleteSelection,
    // A model edit, not a drawing edit: Map allows it, as its panel does.
    onRemoveFromModel: () => {
      if (!docReadOnly && selectedElementId) architectureActions.removeElement(selectedElementId);
    },
    onDuplicate: editActions.duplicateSelection,
    onReorder: editActions.reorderSelection, onToggleLock: editActions.toggleLock,
    onGroup: editActions.groupSelection, onUngroup: editActions.ungroupSelection,
    onWrapInSection: editActions.wrapInSection,
    onCut: editActions.cutSelection, onCopy: editActions.copySelection, onPasteKey: editActions.pasteKeyPressed,
    onCopyStyle: editActions.copyStyle, onPasteStyle: editActions.pasteStyle,
    onAlign: editActions.alignSelection, onDistribute: editActions.distributeSelection,
    onFlip: editActions.flipSelection,
    onZoomToSelection: () => camera.fitView(selectionRef.current.nodeIds.length ? selectionRef.current.nodeIds : undefined),
    onTextStyle: editActions.toggleTextStyle,
    onEditPrimary: (source) => {
      // Enter with a shape tool armed places one at the view centre: the keyboard's click on the canvas.
      if (source === 'enter' && gestureApiRef.current?.placeShape(input.media.centreWorld())) return;
      const primary = selectionRef.current.primaryNodeId;
      // Enter on a model object with a deeper view opens it in Map (or its view page), even read-only;
      // F2 or ⌘Enter edits the label instead.
      if (primary && source === 'enter' && selectedElementId && architectureActions.drillToMap(selectedElementId)) return;
      if (editLocked) return;
      if (primary) {
        openEditor(primary);
        return;
      }
      connectorLabel.editSelected();
    },
    // Typing on a single selected, still blank shape names it; a named shape keeps its tool letters.
    onTypeToEdit: (key) => {
      const { nodeIds, primaryNodeId } = selectionRef.current;
      if (nodeIds.length !== 1 || !primaryNodeId || editLocked || toolRef.current !== 'select') return false;
      if (!typeToEditNames(pageRef.current?.nodes.find((node) => node.id === primaryNodeId))) return false;
      openEditor(primaryNodeId, { initialValue: key });
      return true;
    },
    onNudge: editActions.nudgeSelection,
    onCancelGesture: () => gestureApiRef.current?.cancelGesture() ?? false,
    onEscapePanel: escapePanel,
    // Escape chain tail: out of an entered group to the group (Figma), then the selection, then the open panels.
    onClearSelection: () => {
      const group = pageRef.current ? enteredGroup(pageRef.current, selectionRef.current.nodeIds) : null;
      if (group) selectNodes([group]);
      else if (selectionRef.current.nodeIds.length > 0 || selectedConnectorIds.length > 0) selectionApi.clearAll();
      else panels.closeDocked();
    },
    onSelectAll: () => selectionApi.selectAll(viewPage),
    onFitView: fitAll,
    onZoomStep: camera.zoomStep,
    onResetZoom: camera.resetZoom,
    onToggleTree: panels.toggleTree,
    onToggleAgent: () => panels.toggleWorkspace('assistant'),
    onToggleCode: toggleCode,
    onToggleModel: () => panels.toggleWorkspace('model'),
    onToggleInspect: () => panels.toggleWorkspace('inspect'),
    // On a drawing, M goes back to its map, as the switch does.
    onToggleMap: () => backToMap() || map.toggle(),
    onFind: find.show,
    onSpacePan: setSpacePan,
  });
}
