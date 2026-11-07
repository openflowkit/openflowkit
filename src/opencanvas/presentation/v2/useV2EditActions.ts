import { useRef, type RefObject } from 'react';
import type { ScenePage } from '../../domain/document/types';
import {
  buildPasteProductionSelectionCommand,
  copyProductionSelection,
  pastePlacement,
  type ProductionClipboardSnapshot,
} from '../../application/selection/clipboard';
import { excalidrawScene, lossNote, readExcalidraw } from '../../../services/dsl/excalidraw';
import type { ToastItem } from '../design-system';
import {
  buildAlignCommand, buildDistributeCommand, buildFlipCommand, buildStepOrderCommand,
} from '../../domain/commands/arrangeNodes';
import { buildUngroupCommand, buildWrapCommand, type WrapKind } from '../../domain/commands/groupNodes';
import { buildPasteStyleCommand, copyConnectorStyle, copyNodeStyle, type StyleClipboard } from '../../domain/commands/styleClipboard';
import type { AlignMode, DistributeAxis } from '../../domain/transforms/arrangement';
import { resolveNodeStyle } from '../../domain/nodes/nodeStyle';
import { buildStyleNodesCommand } from '../../domain/commands/styleNodes';
import {
  clearSelection,
  replaceSelection,
  type CanvasSelection,
} from '../../application/selection/selection';
import type { DocumentCommand } from '../../domain/commands/types';
import { DocumentCommandError } from '../../domain/commands/execute';
import type { Bounds2d } from '../../domain/geometry/types';
import {
  buildDeleteSelectionCommand,
  buildDuplicateSelectionCommand,
  buildMoveNodesCommand,
  buildReorderCommand,
  buildToggleLockCommand,
} from '../../domain/commands/sceneEdits';
import { isModelPlacement } from '../../application/dsl/architectureCommands';

const CLIPBOARD_FORMAT = 'openflowkit.selection';

/** Shapes to paste, and what of them didn't come across (`excalidraw` when they were copied in Excalidraw). */
interface ClipboardShapes {
  readonly snapshot: ProductionClipboardSnapshot;
  readonly excalidraw?: { readonly losses: readonly string[] };
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const objects = (value: unknown): boolean => Array.isArray(value) && value.every(isObject);

/**
 * The shapes in pasted text: our copy or Excalidraw's; `unreadable` when it is our format but not a copy this
 * version can paste (hand-edited, or cut short); null when it is neither, so the paste tries what else it could be.
 */
function parseClipboard(text: string): ClipboardShapes | 'unreadable' | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!isObject(parsed) || parsed.format !== CLIPBOARD_FORMAT) return excalidrawClipboard(text);
  return parsed.version === 1 && objects(parsed.nodes) && objects(parsed.connectors)
    ? { snapshot: parsed as unknown as ProductionClipboardSnapshot } : 'unreadable';
}

/** Shapes copied in Excalidraw (`excalidraw/clipboard`) paste as ours, where they were drawn relative to each other. */
function excalidrawClipboard(text: string): ClipboardShapes | null {
  const scene = readExcalidraw(text);
  if (!scene) return null;
  const { nodes, connectors, losses } = excalidrawScene(scene);
  return { snapshot: { version: 1, nodes, connectors }, excalidraw: { losses } };
}

interface V2EditActionsOptions {
  readonly commit: (command: DocumentCommand) => void;
  readonly pageRef: RefObject<ScenePage | null>;
  readonly selectionRef: RefObject<CanvasSelection>;
  readonly selectedConnectorIds: readonly string[];
  readonly mintId: (prefix: string) => string;
  readonly readOnly: boolean;
  readonly applySelection: (selection: CanvasSelection) => void;
  readonly applyConnectorSelection: (connectorIds: readonly string[]) => void;
  readonly announce: (message: string) => void;
  /** A toast: what a paste couldn't do, or what didn't come across from Excalidraw. */
  readonly notify: (toast: ToastItem) => void;
  /** The canvas's visible world area: a paste whose spot is out of it lands in its middle. */
  readonly viewWorldBounds?: () => Bounds2d | null;
}

// Commits scoped to the current selection: the context bar and keyboard
// share these, and both stay inert in read-only mode. Consumers read them
// through refs or plain props, so no memoization is needed.
export function useV2EditActions(options: V2EditActionsOptions) {
  const { pageRef, selectionRef, selectedConnectorIds, readOnly } = options;
  const clipboardRef = useRef<ProductionClipboardSnapshot | null>(null);
  const writingRef = useRef(false);
  const styleClipboardRef = useRef<StyleClipboard>({});
  // Style copy/paste wants one subject; delete and duplicate take them all.
  const selectedConnectorId = selectedConnectorIds.length === 1 ? selectedConnectorIds[0]! : null;
  const connectorIds = () => selectedConnectorIds;
  const editablePage = () => {
    const page = pageRef.current;
    return page && !readOnly ? page : null;
  };

  // On a C4 view a deleted placement is only unplaced: the model keeps the element.
  const deleteSelection = () => {
    const page = editablePage();
    const { nodeIds } = selectionRef.current;
    if (!page || (nodeIds.length === 0 && selectedConnectorIds.length === 0)) return;
    const unplaced = page.nodes.some((node) => nodeIds.includes(node.id) && isModelPlacement(node));
    options.commit(buildDeleteSelectionCommand(page, nodeIds, connectorIds()));
    options.applySelection(clearSelection());
    options.applyConnectorSelection([]);
    options.announce(unplaced ? 'Deleted. Model elements were unplaced from this view. The model keeps them.' : 'Selection deleted.');
  };

  const duplicateSelection = () => {
    const page = editablePage();
    if (!page || selectionRef.current.nodeIds.length === 0) return;
    const command = buildDuplicateSelectionCommand(
      page,
      selectionRef.current.nodeIds,
      connectorIds(),
      options.mintId
    );
    options.commit(command);
    options.applySelection(
      replaceSelection(
        command.commands.flatMap((child) => (child.kind === 'insert-node' ? [child.node.id] : []))
      )
    );
    options.applyConnectorSelection([]);
    options.announce('Selection duplicated.');
  };

  const nudgeSelection = (delta: { x: number; y: number }) => {
    const page = editablePage();
    if (!page || selectionRef.current.nodeIds.length === 0) return;
    const command = buildMoveNodesCommand(page, selectionRef.current.nodeIds, delta);
    if (command) options.commit(command);
  };

  const reorderSelection = (direction: 'front' | 'back' | 'forward' | 'backward') => {
    const page = editablePage();
    if (!page || selectionRef.current.nodeIds.length === 0) return;
    const command = direction === 'front' || direction === 'back'
      ? buildReorderCommand(page, selectionRef.current.nodeIds, direction)
      : buildStepOrderCommand(page, selectionRef.current.nodeIds, direction);
    if (command) options.commit(command);
  };

  const commitMaybe = (command: ReturnType<typeof buildAlignCommand>) => { if (command) options.commit(command); };
  const alignSelection = (mode: AlignMode) => {
    const page = editablePage();
    if (page) commitMaybe(buildAlignCommand(page, selectionRef.current.nodeIds, mode));
  };
  const distributeSelection = (axis: DistributeAxis) => {
    const page = editablePage();
    if (page) commitMaybe(buildDistributeCommand(page, selectionRef.current.nodeIds, axis));
  };
  const flipSelection = (axis: 'horizontal' | 'vertical') => {
    const page = editablePage();
    if (page) commitMaybe(buildFlipCommand(page, selectionRef.current.nodeIds, axis));
  };

  // Clipboard: the system clipboard gets a JSON copy so a paste survives a
  // reload or crosses tabs; the in-memory snapshot covers a denied write.
  const copySelection = () => {
    const page = pageRef.current;
    if (!page || selectionRef.current.nodeIds.length === 0) return false;
    const snapshot = copyProductionSelection(page, selectionRef.current.nodeIds);
    clipboardRef.current = snapshot;
    // Until the system clipboard has it, a ⌘V reads the clipboard from before: the copy just made wins.
    const write = navigator.clipboard?.writeText(JSON.stringify({ format: CLIPBOARD_FORMAT, ...snapshot }));
    if (write) {
      writingRef.current = true;
      void write.catch(() => undefined).finally(() => { writingRef.current = false; });
    }
    options.announce(`${snapshot.nodes.length} copied.`);
    return true;
  };
  const cutSelection = () => { if (copySelection()) deleteSelection(); };
  /**
   * ⌘V hands over the paste event's text: shapes when it is our JSON or Excalidraw's. With no text (the menu), the in-memory
   * copy. True when the text was shapes: pasted, or said why not, so the paste goes no further (never to an older copy).
   */
  const pasteShapes = (text?: string): boolean => {
    const page = editablePage();
    const memory = clipboardRef.current;
    const shapes = text === undefined || writingRef.current ? (memory ? { snapshot: memory } : null) : parseClipboard(text);
    if (!page || !shapes) return false;
    const refuse = () => options.notify({ id: 'paste-shapes', tone: 'danger', title: 'Couldn’t paste the copied shapes',
      description: 'They don’t make a valid diagram. Nothing was changed.' });
    if (shapes === 'unreadable') { refuse(); return true; }
    const { snapshot, excalidraw } = shapes;
    const note = excalidraw?.losses.length ? { description: lossNote(excalidraw.losses) } : {};
    if (snapshot.nodes.length + snapshot.connectors.length === 0) {
      options.notify({ id: 'paste-shapes', tone: 'info', title: excalidraw ? 'Nothing to paste from Excalidraw' : 'Nothing to paste', ...note });
      return true;
    }
    const view = options.viewWorldBounds?.();
    let pasted: ReturnType<typeof buildPasteProductionSelectionCommand>;
    try {
      pasted = buildPasteProductionSelectionCommand(page, snapshot, (kind) => options.mintId(kind),
        ...(view ? [pastePlacement(snapshot, view)] : []));
      options.commit(pasted.command);
    } catch (error) {
      // Clipboard text is anyone's JSON: one the document refuses is said, not thrown. Nothing was changed.
      // Anything else is a bug, and goes on up where it is seen.
      if (!(error instanceof DocumentCommandError)) throw error;
      refuse();
      return true;
    }
    const { pastedNodeIds, pastedConnectorIds } = pasted;
    options.applySelection(replaceSelection(pastedNodeIds));
    options.applyConnectorSelection(pastedNodeIds.length ? [] : pastedConnectorIds);
    options.announce(`${pastedNodeIds.length || pastedConnectorIds.length} pasted.`);
    if (excalidraw?.losses.length) options.notify({ id: 'paste-shapes', tone: 'info', title: 'Pasted from Excalidraw', ...note });
    return true;
  };
  const hasClipboard = () => clipboardRef.current !== null;
  // WebKit may fire no paste event for ⌘V outside an editable field: the key arms an in-memory paste
  // a beat later, and a paste event (every other engine, or WebKit with a field) disarms it.
  const pendingPasteRef = useRef<number | null>(null);
  const pasteEventArrived = () => {
    if (pendingPasteRef.current !== null) window.clearTimeout(pendingPasteRef.current);
    pendingPasteRef.current = null;
  };
  const pasteKeyPressed = () => {
    pasteEventArrived();
    pendingPasteRef.current = window.setTimeout(() => { pendingPasteRef.current = null; pasteShapes(); }, 100);
  };

  const wrapSelection = (kind: WrapKind) => {
    const page = editablePage();
    if (!page) return;
    const id = options.mintId(kind);
    const command = buildWrapCommand(page, selectionRef.current.nodeIds, id, kind);
    if (!command) return;
    options.commit(command);
    options.applySelection(replaceSelection([id]));
    options.announce(kind === 'group' ? 'Grouped.' : 'Wrapped in a section.');
  };
  const groupSelection = () => wrapSelection('group');
  const wrapInSection = () => wrapSelection('section');
  const ungroupSelection = () => {
    const page = editablePage();
    if (!page) return;
    const command = buildUngroupCommand(page, selectionRef.current.nodeIds);
    if (!command) return;
    const released = command.commands.flatMap((child) => (child.kind === 'set-node' ? [child.after.id] : []));
    options.commit(command);
    options.applySelection(replaceSelection(released));
    options.announce('Ungrouped.');
  };
  const canUngroup = () => {
    const page = pageRef.current;
    return !!page && selectionRef.current.nodeIds.some((id) => {
      const kind = page.nodes.find((node) => node.id === id)?.kind;
      return kind === 'group' || kind === 'section';
    });
  };
  /** Every selected node is locked: ⌘L would unlock (buildToggleLockCommand locks when any is not). */
  const selectionLocked = () => {
    const page = pageRef.current;
    const nodes = page?.nodes.filter((node) => selectionRef.current.nodeIds.includes(node.id)) ?? [];
    return nodes.length > 0 && nodes.every((node) => node.content.sectionLocked === true);
  };

  // ⌘B/I/U: toggle against the primary node's resolved style so mixed
  // selections settle on one value.
  const toggleTextStyle = (toggle: 'bold' | 'italic' | 'underline') => {
    const page = editablePage();
    const ids = selectionRef.current.nodeIds;
    const primary = page?.nodes.find((node) => node.id === (selectionRef.current.primaryNodeId ?? ids[0]));
    if (!page || !primary) return;
    const style = resolveNodeStyle(primary);
    const patch = toggle === 'bold' ? { fontWeight: style.fontWeight === 700 ? 400 : 700 }
      : toggle === 'italic' ? { fontStyle: style.fontStyle === 'italic' ? 'normal' : 'italic' }
        : { textDecoration: style.textDecoration === 'underline' ? 'none' : 'underline' };
    commitMaybe(buildStyleNodesCommand(page, ids, patch));
  };

  const copyStyle = () => {
    const page = pageRef.current;
    if (!page) return;
    const connector = selectedConnectorId ? page.connectors.find((candidate) => candidate.id === selectedConnectorId) : null;
    const node = page.nodes.find((candidate) => candidate.id === selectionRef.current.primaryNodeId);
    if (connector) styleClipboardRef.current = { ...styleClipboardRef.current, connector: copyConnectorStyle(connector) };
    else if (node) styleClipboardRef.current = { ...styleClipboardRef.current, node: copyNodeStyle(node) };
    else return;
    options.announce('Style copied.');
  };
  const pasteStyle = () => {
    const page = editablePage();
    if (!page) return;
    const command = buildPasteStyleCommand(page, selectionRef.current.nodeIds, selectedConnectorId, styleClipboardRef.current);
    if (command) { options.commit(command); options.announce('Style pasted.'); }
  };

  const toggleLock = () => {
    const page = editablePage();
    if (!page || selectionRef.current.nodeIds.length === 0) return;
    const command = buildToggleLockCommand(page, selectionRef.current.nodeIds);
    options.commit(command);
    options.announce(command.label === 'Lock' ? 'Selection locked.' : 'Selection unlocked.');
  };

  return {
    deleteSelection, duplicateSelection, nudgeSelection, reorderSelection, toggleLock,
    alignSelection, distributeSelection, flipSelection,
    copySelection, cutSelection, pasteShapes, pasteKeyPressed, pasteEventArrived, hasClipboard, copyStyle, pasteStyle, toggleTextStyle,
    groupSelection, wrapInSection, ungroupSelection, canUngroup, selectionLocked,
  };
}
