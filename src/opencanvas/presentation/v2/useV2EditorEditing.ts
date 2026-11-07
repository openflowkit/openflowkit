import { useCallback, type MutableRefObject, type RefObject } from 'react';
import { placedElementId } from '../../../dsl/model/model';
import { visibleWorldBounds } from '../../domain/camera/camera';
import type { CanvasSelection } from '../../application/selection/selection';
import type { useDocumentSession } from '../../application/session/useDocumentSession';
import type { DocumentCommand } from '../../domain/commands/types';
import type { ScenePage } from '../../domain/document/types';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import type { useV2ArchitectureActions } from './useV2ArchitectureActions';
import type { useV2Camera } from './useV2Camera';
import { useV2ConnectorLabelEditing } from './useV2ConnectorLabelEditing';
import { useV2EditActions } from './useV2EditActions';
import { useV2LabelEditing, type OpenEditorOptions } from './useV2LabelEditing';
import { mintV2Id } from './v2Document';
import type { ToastItem } from '../design-system';

interface EditorEditingInput {
  readonly session: ReturnType<typeof useDocumentSession>;
  readonly page: ScenePage | null;
  readonly pageRef: RefObject<ScenePage | null>;
  readonly hostRef: RefObject<PixiRendererHost | null>;
  readonly camera: ReturnType<typeof useV2Camera>;
  readonly selectionRef: RefObject<CanvasSelection>;
  readonly selectedConnectorId: string | null;
  readonly selectedConnectorIds: readonly string[];
  readonly applySelection: (selection: CanvasSelection) => void;
  readonly applyConnectorSelection: (connectorIds: readonly string[]) => void;
  readonly selectNodes: (nodeIds: readonly string[]) => void;
  readonly commit: (command: DocumentCommand) => void;
  readonly writable: (command: DocumentCommand) => boolean;
  readonly editLocked: boolean;
  readonly focusCanvas: () => void;
  readonly setAnnouncement: (message: string) => void;
  readonly pushToast: (toast: ToastItem) => void;
  /** Set by the page once its architecture actions exist (a model element renames through them). */
  readonly architectureActionsRef: MutableRefObject<ReturnType<typeof useV2ArchitectureActions> | null>;
}

/** Editing what is selected: shape and connector labels, and the clipboard-and-arrange actions. */
export function useV2EditorEditing(i: EditorEditingInput) {
  const { session, page, pageRef, hostRef, camera, selectionRef, selectedConnectorId, selectedConnectorIds, applySelection, applyConnectorSelection, commit, writable, editLocked, focusCanvas, setAnnouncement, pushToast, architectureActionsRef } = i;
  const labelEditing = useV2LabelEditing({
    hostRef,
    page,
    camera: camera.camera,
    commit: commit,
    amendNewNode: (nodeId, command) => { if (writable(command)) session.amendNewNode(nodeId, command); },
    announce: setAnnouncement,
    focusCanvas,
    onRenamePlacedElement: (nodeId, label) => {
      const node = page?.nodes.find((candidate) => candidate.id === nodeId);
      const elementId = node ? placedElementId(node) : null;
      if (!elementId) return false;
      architectureActionsRef.current?.editElement(elementId, { name: label });
      return true;
    },
  });
  const { openEditor: openLabelEditor } = labelEditing;
  const { selectNodes } = i;
  const openEditor = useCallback(
    (nodeId: string, editorOptions?: OpenEditorOptions) => {
      selectNodes([nodeId]);
      openLabelEditor(nodeId, editorOptions);
    },
    [openLabelEditor, selectNodes]
  );
  const connectorLabel = useV2ConnectorLabelEditing({
    document: session.document,
    pageRef, hostRef, cameraRef: camera.cameraRef, readOnly: editLocked, selectedConnectorId,
    commit: commit, applySelection, applyConnectorSelection, focusCanvas, announce: setAnnouncement,
  });
  const editActions = useV2EditActions({
    commit: commit,
    pageRef,
    selectionRef,
    selectedConnectorIds,
    mintId: mintV2Id,
    readOnly: editLocked,
    applySelection,
    applyConnectorSelection,
    announce: setAnnouncement,
    notify: pushToast,
    viewWorldBounds: () => {
      const host = hostRef.current;
      return host ? visibleWorldBounds(camera.cameraRef.current, host.getViewportSize()) : null;
    },
  });
  return { labelEditing, openEditor, connectorLabel, editActions };
}
