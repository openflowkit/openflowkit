import { createTransformSnapshot } from '../../domain/transforms/transformSelection';
import { V2LaserTrail } from './V2LaserTrail';
import { useV2CanvasWheel } from './useV2CanvasWheel';
import { openCanvasContextMenu } from './v2CanvasContextMenu';
import { editorStyle } from './v2EditorStyle';
import { useV2ContextBarKeepOff } from './useV2ContextBarKeepOff';
import type { IconChoice } from '../../domain/nodes/iconNode';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ErrorState } from '../design-system';
import { V2StateHero } from './V2StateHero';
import type { DocumentCommand } from '../../domain/commands/types';
import type { ScenePage } from '../../domain/document/types';
import type { Point2d } from '../../domain/geometry/types';
import type { CanvasCamera } from '../../domain/camera/types';
import {
  replaceSelection,
  type CanvasSelection,
} from '../../application/selection/selection';
import { pointAtPolylineRatio } from '../../domain/geometry/polyline';
import { worldToScreen } from '../../domain/camera/camera';
import { detectWebGlCapability } from '../../infrastructure/pixi/capabilities';
import {
  PixiRendererHost,
  type PixiRendererStatus,
} from '../../infrastructure/pixi/PixiRendererHost';
import { OpenCanvasTextEditorOverlay } from './OpenCanvasTextEditorOverlay';
import { connectorLabelOnCanvas, resolveConnectorLabelStyle } from '../../domain/connectors/labelStyle';
import { selectionAnnouncement } from './selectionAnnouncement';
import { V2ContextBar, contextBarEdges, contextBarStyle, sameRect, unionScreenBounds } from './V2ContextBar';
import type { ContextMenuTarget } from './V2ContextMenu';
import { useV2Pointer } from './useV2Pointer';
import type { StylePresets, V2GestureApi } from './v2PointerGestures';
import { connectorAppearanceWithPatch } from '../../domain/commands/styleConnectors';
import type { V2Tool } from './V2CreationToolbar';
import type { V2ToolConfig } from './v2ToolCatalog';
import './openCanvasTextEditorOverlay.css';
import { numericColorToHex } from '../../domain/color/adaptiveColor';
import { readAssetUrl } from '../../../services/storage/assets';

export interface V2EditingState {
  readonly nodeId: string;
  readonly bounds: DOMRect;
  readonly value: string;
  readonly isNew: boolean;
  /** Type-to-edit seeds the value: caret goes after it instead of selecting all. */
  readonly caretAtEnd: boolean;
}

interface V2CanvasHostProps {
  readonly page: ScenePage;
  readonly onRemoveIcons: () => void;
  readonly onSetIcon: (icon: IconChoice) => void;
  /** WebGL off: Diagram as code still works, so the fallback offers it. */
  readonly onOpenCode: () => void;
  readonly onInspect: () => void;
  readonly hostRef: RefObject<PixiRendererHost | null>;
  readonly camera: CanvasCamera;
  readonly cameraRef: RefObject<CanvasCamera>;
  readonly pageRef: RefObject<ScenePage | null>;
  readonly selectionRef: RefObject<CanvasSelection>;
  readonly selectedConnectorIdsRef: RefObject<readonly string[]>;
  readonly toolRef: RefObject<V2Tool>;
  readonly tool: V2Tool;
  readonly toolConfigRef: RefObject<V2ToolConfig>;
  /** Double-click on a chart opens its data panel (the page owns the panel). */
  readonly onOpenChartData?: (nodeId: string) => boolean;
  /** A plain click on a node, after it was selected (Map mode: open or close the box). */
  readonly onNodeClick?: (nodeId: string) => void;
  /** Read-only: a double-click or a drag on a node (Map: edit it in the model panel; explain why it does not move). */
  readonly onNodeDoubleClick?: (nodeId: string) => void;
  readonly onNodeDrag?: (nodeId: string) => void;
  /** A click with the comment tool on the canvas itself (V2Comments opens a composer there). */
  readonly onCommentClick?: (point: Point2d) => void;
  /** The one selected model element has a deeper view: its name and the way in. */
  readonly zoomInto?: { readonly name: string; readonly open: () => void } | null;
  readonly spacePanRef: RefObject<boolean>;
  readonly readOnlyRef: RefObject<boolean>;
  readonly gestureApiRef: RefObject<V2GestureApi | null>;
  readonly selection: CanvasSelection;
  readonly selectedConnectorId: string | null;
  readonly selectedConnectorIds: readonly string[];
  readonly editing: V2EditingState | null;
  readonly children?: ReactNode;
  readonly commit: (command: DocumentCommand) => void;
  readonly applySelection: (selection: CanvasSelection) => void;
  readonly applyConnectorSelection: (connectorIds: readonly string[]) => void;
  readonly updateCamera: (camera: CanvasCamera) => void;
  readonly openEditor: (nodeId: string) => void;
  readonly openConnectorEditor: (connectorId: string, at: Point2d) => void;
  readonly onToolChange: (tool: V2Tool) => void;
  readonly mintId: (prefix: string) => string;
  readonly extendConnectorCommand?: (command: DocumentCommand, fromNodeId: string, toNodeId: string) => DocumentCommand;
  readonly onCommitLabel: (value: string) => void;
  readonly onCancelEdit: () => void;
  readonly connectorEditing: { readonly connectorId: string; readonly bounds: DOMRect; readonly value: string } | null;
  readonly onCommitConnectorLabel: (value: string) => void;
  readonly onCancelConnectorEdit: () => void;
  readonly onStatusChange: (status: PixiRendererStatus) => void;
  readonly sectionRef: RefObject<HTMLElement | null>;
  /** Numeric canvas-ground color from the same token source as SystemRoot. */
  readonly backgroundColor: number;
  readonly readOnly: boolean;
  readonly snapToGrid: boolean;
  readonly showGrid: boolean;
  /** Right-click: the host has already selected the target; the page shows the menu. */
  readonly onContextMenu: (target: ContextMenuTarget) => void;
}

export function V2CanvasHost(props: V2CanvasHostProps): React.JSX.Element {
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const [capability] = useState(detectWebGlCapability);
  const [status, setStatus] = useState<PixiRendererStatus>(
    capability.supported ? 'initializing' : 'unavailable'
  );
  const [mountError, setMountError] = useState<string | null>(null);

  // No React state per move: the renderer preview goes through refs, and the
  // context bar fades out for the gesture (it would cover what you align against).
  // Latest React-rendered bar anchor; a gesture's end restores the bar to exactly
  // this when no re-render follows (anchor truly unchanged).
  const anchorForRestoreRef = useRef<DOMRect | null>(null);
  // What the bar keeps off (label plates, neighbour shapes); the restore below writes the DOM directly, so it reads it here.
  const avoidRef = useRef<readonly DOMRect[]>([]);
  // Bar width is measured (node and connector bars differ); side panels
  // shrink the visible canvas the bar is clamped into.
  const [barWidth, setBarWidth] = useState(320);
  // Read after commit, never during render: a panel that opened this render has
  // not written its width or its data attribute yet, and the bar would be
  // clamped into the canvas it had a frame ago — i.e. under the new panel.
  const [edges, setEdges] = useState(() => ({ left: 0, right: window.innerWidth }));
  // No dep list on purpose: the panels that move these edges are not this
  // component's props. The equality bail-out below is what terminates it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const next = contextBarEdges(props.sectionRef.current?.closest<HTMLElement>('.ofk-v2') ?? null);
    setEdges((current) => (current.left === next.left && current.right === next.right ? current : next));
  });
  const barLayout = (bar: HTMLElement) => ({ width: bar.offsetWidth, ...contextBarEdges(bar.closest<HTMLElement>('.ofk-v2')) });
  // Sticky defaults live with the host for the session: what you last styled
  // is what the next shape/text/connector gets.
  const stylePresetsRef = useRef<StylePresets>({ shape: {}, text: {}, connector: {}, ink: {} });
  const pointer = useV2Pointer({
    stylePresetsRef,
    hostRef: props.hostRef,
    cameraRef: props.cameraRef,
    pageRef: props.pageRef,
    selectionRef: props.selectionRef,
    selectedConnectorIdsRef: props.selectedConnectorIdsRef,
    toolRef: props.toolRef,
    toolConfigRef: props.toolConfigRef,
    ...(props.onOpenChartData ? { onOpenChartData: props.onOpenChartData } : {}),
    ...(props.onNodeClick ? { onNodeClick: props.onNodeClick } : {}),
    ...(props.onNodeDoubleClick ? { onNodeDoubleClick: props.onNodeDoubleClick } : {}),
    ...(props.onNodeDrag ? { onNodeDrag: props.onNodeDrag } : {}),
    ...(props.onCommentClick ? { onCommentClick: props.onCommentClick } : {}),
    spacePanRef: props.spacePanRef,
    readOnlyRef: props.readOnlyRef,
    gestureApiRef: props.gestureApiRef,
    commit: props.commit,
    applySelection: props.applySelection,
    applyConnectorSelection: props.applyConnectorSelection,
    updateCamera: props.updateCamera,
    openEditor: props.openEditor,
    openConnectorEditor: props.openConnectorEditor,
    onToolChange: props.onToolChange,
    mintId: props.mintId,
    ...(props.extendConnectorCommand ? { extendConnectorCommand: props.extendConnectorCommand } : {}),
    snapToGrid: props.snapToGrid,
    // Renderer preview is immediate; the context bar fades out while a shape moves or resizes
    // and returns, at the settled anchor, on drop.
    onTransformPreview: (result) => {
      const bar = props.sectionRef.current?.querySelector<HTMLElement>('[data-context-bar]');
      if (!bar) return;
      if (result) { bar.dataset.gesture = 'true'; return; }
      delete bar.dataset.gesture;
      if (anchorForRestoreRef.current) {
        const restore = contextBarStyle(anchorForRestoreRef.current, barLayout(bar), avoidRef.current);
        if (restore.left !== undefined) bar.style.left = `${restore.left}px`;
        if (restore.top !== undefined) bar.style.top = `${restore.top}px`;
      }
    },
  });

  const { cancelGesture } = pointer;
  useEffect(() => {
    cancelGesture();
    const canvas = viewport?.querySelector('canvas');
    if (canvas) canvas.style.cursor = '';
  }, [props.page, props.tool, viewport, cancelGesture]);

  const { sectionRef, cameraRef, updateCamera } = props;
  const handleWheel = useV2CanvasWheel(sectionRef, cameraRef, updateCamera);

  // What the canvas shows now (in Map, the map's scene, not the document's page): the renderer draws it once it has started.
  const shownPageRef = useRef(props.page);
  useEffect(() => { shownPageRef.current = props.page; });
  const statusCallbackRef = useRef(props.onStatusChange);
  statusCallbackRef.current = props.onStatusChange;
  useEffect(() => {
    statusCallbackRef.current(status);
  }, [status]);

  useEffect(() => {
    if (!viewport || !capability.supported) return;
    let disposed = false;
    const host = new PixiRendererHost({
      liveTransformPreview: true,
      resolveAsset: (assetId) => readAssetUrl(assetId),
      onStatusChange: (next) => {
        if (!disposed) setStatus(next);
      },
    });
    props.hostRef.current = host;
    host.setBackground(props.backgroundColor);
    host.setDotGrid(props.showGrid);
    host.setCamera(props.cameraRef.current);
    void host
      .mount(viewport)
      .then(() => {
        if (disposed) return;
        // Not pageRef (the document's page, what edits address): a map laid out before the renderer started would be replaced by it.
        host.setPage(shownPageRef.current);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setMountError(error instanceof Error ? error.message : 'PixiJS could not start.');
        setStatus('unavailable');
      });
    const observer = new ResizeObserver(() => {
      host.resize();
      setViewportSize(host.getViewportSize());
    });
    observer.observe(viewport);
    return () => {
      disposed = true;
      observer.disconnect();
      host.destroy();
      props.hostRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport]);

  useEffect(() => { props.hostRef.current?.setDotGrid(props.showGrid); }, [props.showGrid, props.hostRef]);

  useEffect(() => {
    props.hostRef.current?.setBackground(props.backgroundColor);
  }, [props.backgroundColor, props.hostRef]);

  useEffect(() => {
    props.hostRef.current?.setPage(props.page);
    const available = new Set(props.page.nodes.map((node) => node.id));
    const kept = props.selectionRef.current.nodeIds.filter((id) => available.has(id));
    if (kept.length !== props.selectionRef.current.nodeIds.length) {
      props.applySelection(replaceSelection(kept));
    }
    const connectors = new Set(props.page.connectors.map((connector) => connector.id));
    const keptConnectors = props.selectedConnectorIds.filter((id) => connectors.has(id));
    if (keptConnectors.length !== props.selectedConnectorIds.length) props.applyConnectorSelection(keptConnectors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.page]);

  useEffect(() => {
    props.hostRef.current?.setEditingNode(props.editing?.nodeId ?? null);
  }, [props.editing, props.hostRef, props.page, status]);

  useEffect(() => {
    props.hostRef.current?.setEditingConnector(props.connectorEditing?.connectorId ?? null);
  }, [props.connectorEditing, props.hostRef, props.page, status]);

  // A read-only page (shared view, Map mode) shows what is selected and nothing to grab.
  useEffect(() => {
    props.hostRef.current?.setEditable(!props.readOnly);
  }, [props.readOnly, props.hostRef, status]);

  useEffect(() => {
    props.hostRef.current?.setSelection(props.selection.nodeIds, props.selection.primaryNodeId);
    props.hostRef.current?.setConnectorSelection(props.selectedConnectorIds, null);
  }, [props.selection, props.selectedConnectorIds, props.hostRef, props.page, status]);

  const selectionIds = props.selection.nodeIds;
  const selectedConnectorId = props.selectedConnectorId;
  // Context bar anchor follows selection, page geometry and camera; the state
  // only changes when the union actually moves.
  const [contextAnchor, setContextAnchor] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (props.editing || props.readOnly
      || (selectionIds.length === 0 && !selectedConnectorId)) {
      setContextAnchor(null);
      anchorForRestoreRef.current = null;
      return;
    }
    if (selectionIds.length > 0) {
      const next = unionScreenBounds(
        selectionIds.map((nodeId) => props.hostRef.current?.getNodeScreenBounds(nodeId))
      );
      if (next) anchorForRestoreRef.current = next;
      setContextAnchor((current) => (current && next && sameRect(current, next) ? current : next));
      return;
    }
    const samples = selectedConnectorId
      ? props.hostRef.current?.getConnectorSamples(selectedConnectorId)
      : null;
    // Point anchor (width 0): x at the path's arc-length midpoint, y/height
    // spanning the path so the bar sits above or below every run rather than
    // crossing a vertical one.
    const midpoint = samples ? pointAtPolylineRatio(samples, 0.5) : null;
    const middle = midpoint ? worldToScreen(props.camera, midpoint) : null;
    const ys = samples?.map((sample) => worldToScreen(props.camera, sample).y) ?? [];
    const top = ys.length ? Math.min(...ys) : 0;
    const next = middle && ys.length ? new DOMRect(middle.x, top, 0, Math.max(...ys) - top) : null;
    if (next) anchorForRestoreRef.current = next;
    setContextAnchor((current) => (current && next && sameRect(current, next) ? current : next));
  }, [selectionIds, selectedConnectorId, props.editing, props.readOnly, props.hostRef,
    props.camera, props.page, viewportSize]);
  const labelPlates = useV2ContextBarKeepOff({
    page: props.page, camera: props.camera, sectionRef: props.sectionRef, contextAnchor, selectionIds, selectedConnectorId,
  });
  // Shapes in the band the bar could take, above or below the selection: the bar keeps off them too,
  // so it never sits on a neighbour or on the shapes a selected line joins. Containers hold everything; skipped.
  const avoid = useMemo(() => {
    const host = props.hostRef.current;
    if (!contextAnchor || !host) return labelPlates;
    const selected = new Set(selectionIds);
    const band = {
      x: contextAnchor.x - barWidth, y: contextAnchor.y - 112,
      width: contextAnchor.width + barWidth * 2, height: contextAnchor.height + 112 + 96,
    };
    const shapes = host.pickNodesInScreenBounds(band)
      .filter((id) => !selected.has(id))
      .flatMap((id) => {
        const bounds = host.getNodeScreenBounds(id);
        return bounds ? [new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height)] : [];
      });
    return [...labelPlates, ...shapes];
  }, [contextAnchor, labelPlates, selectionIds, barWidth, props.hostRef]);
  avoidRef.current = avoid;

  useLayoutEffect(() => {
    const bar = props.sectionRef.current?.querySelector<HTMLElement>('[data-context-bar]');
    if (!contextAnchor || !bar) return;
    setBarWidth(bar.offsetWidth);
    const observer = new ResizeObserver(() => setBarWidth(bar.offsetWidth));
    observer.observe(bar);
    return () => observer.disconnect();
  }, [contextAnchor, selectedConnectorId, props.sectionRef]);

  const unavailableReason = mountError ?? capability.reason ?? null;
  const navigate = useNavigate();

  const editingNode = props.editing && props.page.nodes.find((node) => node.id === props.editing?.nodeId);
  const editingStyle = editingNode ? editorStyle(editingNode, props.page, numericColorToHex(props.backgroundColor)) : null;
  const editingConnector = props.connectorEditing
    && props.page.connectors.find((connector) => connector.id === props.connectorEditing?.connectorId);
  const connectorEditingStyle = editingConnector
    ? connectorLabelOnCanvas(resolveConnectorLabelStyle(editingConnector), numericColorToHex(props.backgroundColor)) : null;

  return (
    <section
      ref={props.sectionRef}
      className="ofk-v2-canvas"
      data-testid="v2-canvas"
      tabIndex={0}
      aria-label="Diagram canvas. Press V to select, R for rectangle, O for ellipse, A for connector, T for text. Double-click or press Enter to edit a label."
      onPointerDown={pointer.handlePointerDown}
      onPointerMove={pointer.handlePointerMove}
      onPointerUp={pointer.handlePointerUp}
      onPointerCancel={pointer.handlePointerCancel}
      onPointerLeave={pointer.handlePointerLeave}
      onDoubleClick={pointer.handleDoubleClick}
      onWheel={handleWheel}
      onContextMenu={(event) => openCanvasContextMenu(event, props.hostRef.current, props)}
    >
      <div ref={setViewport} className="ofk-v2-viewport" data-testid="v2-viewport" />
      {props.tool === 'laser' ? <V2LaserTrail sectionRef={props.sectionRef} /> : null}
      {unavailableReason ? (
        <div className="ofk-v2-fallback" data-testid="v2-webgl-off" title={unavailableReason}>
          <ErrorState hero={<V2StateHero kind="no-canvas" />}
            title="This browser can’t draw the canvas."
            description="OpenFlowKit needs WebGL. Turn on hardware acceleration in your browser settings, or open this page in Chrome, Edge or Firefox."
            action={<Button variant="primary" onClick={props.onOpenCode}>Diagram as code</Button>}
            secondary={<Button variant="quiet" onClick={() => navigate('/home')}>Back to home</Button>} />
        </div>
      ) : null}
      {props.editing && editingStyle ? (
        <OpenCanvasTextEditorOverlay
          bounds={props.editing.bounds}
          value={props.editing.value}
          style={editingStyle}
          zoom={props.camera.zoom}
          selectAll={!props.editing.caretAtEnd}
          onCommit={props.onCommitLabel}
          onCancel={props.onCancelEdit}
        />
      ) : null}
      {props.connectorEditing && connectorEditingStyle && !props.editing ? (
        <OpenCanvasTextEditorOverlay
          bounds={props.connectorEditing.bounds}
          value={props.connectorEditing.value}
          label="Edit connector label"
          zoom={props.camera.zoom}
          style={connectorEditingStyle}
          plate
          onCommit={props.onCommitConnectorLabel}
          onCancel={props.onCancelConnectorEdit}
        />
      ) : null}
      {contextAnchor ? (
        <V2ContextBar
          page={props.page}
          nodeIds={props.selection.nodeIds}
          connectorId={props.selectedConnectorId}
          commit={props.commit}
          onStylePreview={(patch) => {
            if (!patch) { props.hostRef.current?.setTransformPreview(null); return; }
            const snapshot = createTransformSnapshot(props.page, props.selection.nodeIds);
            props.hostRef.current?.setTransformPreview(patch ? {
              nodes: snapshot.nodes.map((node) => ({ ...node, appearance: { ...node.appearance, ...patch } })),
              bounds: snapshot.bounds, snappedX: false, snappedY: false,
            } : null);
          }}
          style={contextBarStyle(contextAnchor, { width: barWidth, ...edges }, avoid)}
          selection={contextAnchor}
          onRemoveIcons={props.onRemoveIcons}
          onSetIcon={props.onSetIcon}
          onNodeStyleCommitted={(patch) => {
            const selected = props.selection.nodeIds
              .map((id) => props.page.nodes.find((node) => node.id === id))
              .filter((node): node is NonNullable<typeof node> => Boolean(node));
            // Ink lives in content: keep it apart from the shape/text presets.
            if (selected.length > 0 && selected.every((node) => node.kind === 'pen'
              || node.kind === 'highlighter' || node.kind === 'line' || node.kind === 'arrow')) {
              stylePresetsRef.current.ink = { ...stylePresetsRef.current.ink, ...patch };
              return;
            }
            const kind = selected.every((node) => node.kind === 'text') ? 'text' : 'shape';
            stylePresetsRef.current[kind] = { ...stylePresetsRef.current[kind], ...patch };
          }}
          onConnectorStyleCommitted={(patch) => {
            stylePresetsRef.current.connector = connectorAppearanceWithPatch(stylePresetsRef.current.connector, patch);
          }}
          {...(props.onOpenChartData && props.selection.nodeIds.length === 1
            && props.page.nodes.find((node) => node.id === props.selection.nodeIds[0])?.kind === 'chart'
            ? { onOpenChartData: () => props.onOpenChartData!(props.selection.nodeIds[0]!) }
            : {})}
          {...(props.zoomInto && props.selection.nodeIds.length === 1 ? { zoomInto: props.zoomInto } : {})}
          onInspect={props.onInspect}
          onOpenMenu={(rect) => {
            const at = { x: rect.left, y: rect.bottom + 6, trigger: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
            props.onContextMenu(props.selectedConnectorId ? { kind: 'connector', id: props.selectedConnectorId, ...at } : { kind: 'nodes', ...at });
          }}
        />
      ) : null}
      {props.children}
      <p className="sr-only" aria-live="polite">
        {selectionAnnouncement(props.page, props.selection.nodeIds, props.selectedConnectorIds)}
      </p>
    </section>
  );
}
