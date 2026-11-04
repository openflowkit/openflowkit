import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { replaceSelection } from '../../application/selection/selection';
import { useDocumentSession } from '../../application/session/useDocumentSession';
import type { PixiRendererHost, PixiRendererStatus } from '../../infrastructure/pixi/PixiRendererHost';
import { createV2Repository } from '../../../services/storage/v2/v2Repository';
import { dslFrames } from '../../../dsl/frameScene';
import type { LandingDirection } from '../../domain/camera/readableLanding';
import { archFrameOf, placedElementId } from '../../../dsl/model/model';
import type { SceneDocumentV1 } from '../../domain/document/types';
import { AgentCursor, SystemRoot, ToastRegion, withToast, type ToastItem } from '../design-system';
import { V2CanvasWelcome, V2WorkspaceRail } from './V2Workspace';
import { V2CommentsHost } from './V2Comments';
import { V2EditorCanvas } from './V2EditorCanvas';
import { V2EditorChrome } from './V2EditorChrome';
import { V2EditorContextMenu } from './V2EditorContextMenu';
import { V2EditorExport } from './V2EditorExport';
import { V2EditorOverlays } from './V2EditorOverlays';
import { V2EditorSidePanels } from './V2EditorSidePanels';
import type { ContextMenuTarget } from './V2ContextMenu';
import { V2LoadCenter } from './V2LoadCenter';
import { BrandLoader } from './BrandLoader';
import { isEditableTarget } from './pointerOperations';
import { useV2Appearance } from './useV2Appearance';
import { useV2Architecture } from './useV2Architecture';
import { useV2ArchitectureActions } from './useV2ArchitectureActions';
import { useV2Autosave } from './useV2Autosave';
import { useV2Camera } from './useV2Camera';
import { useV2CodeWorkspace } from './useV2CodeWorkspace';
import { useV2Compilers } from './useV2Compilers';
import { useV2DocumentTitle } from './useV2DocumentTitle';
import { useV2EditorAgents } from './useV2EditorAgents';
import { useV2EditorLoad } from './useV2EditorLoad';
import { useV2EditorEditing } from './useV2EditorEditing';
import { useV2EditorHints } from './useV2EditorHints';
import { useV2EditorInput } from './useV2EditorInput';
import { useV2EditorKeyboard } from './useV2EditorKeyboard';
import { useV2EditorNotices } from './useV2EditorNotices';
import { useV2ExportPanel } from './useV2ExportPanel';
import { useV2Find } from './useV2Find';
import { useV2GuardedCommit } from './useV2GuardedCommit';
import { useV2History } from './useV2History';
import { useV2IconActions } from './useV2IconActions';
import { keyOwnedByTarget } from './useV2Keyboard';
import { useV2ActivePage } from './useV2ActivePage';
import { useV2BodyFocusForward } from './useV2BodyFocusForward';
import { useV2MapHandoff } from './useV2MapHandoff';
import { useV2ModelWorkspace } from './useV2ModelWorkspace';
import { useV2PageFit } from './useV2PageFit';
import { useV2RepoDrawing } from './useV2RepoDrawing';
import { useV2RepoMapThumbnail } from './useV2RepoMapThumbnail';
import { useV2RevealCover } from './useV2RevealCover';
import { useV2StartIntent } from './useV2StartIntent';
import { useV2ToolState } from './useV2ToolState';
import { useV2VisibleSelection } from './useV2VisibleSelection';
import { useV2MapMode } from './map/useV2MapMode';
import { useV2RepoDocument } from './useV2RepoDocument';
import { BadRepoAddress } from './map/V2RepoMapState';
import { useV2Pages } from './useV2Pages';
import { useV2Panels } from './useV2Panels';
import type { V2GestureApi } from './v2PointerGestures';
import { useV2Preferences } from './useV2Preferences';
import { useV2Proposal } from './useV2Proposal';
import { useV2ProposalPreview } from './useV2ProposalPreview';
import { useV2Selection } from './useV2Selection';
import { useV2TestApi } from './useV2TestApi';
import { isV2StartIntent, lastDocumentId, mintV2Id } from './v2Document';
import { imageFiles } from './v2EditorUtil';
import { connectorWithRelation } from './v2ConnectorRelation';
import { downloadTextFile } from './v2Export';
import { landingDirectionOf, zoomedToReadToast } from './v2Landing';
import { scheduleV2Thumbnail } from './v2Thumbnail';
import type { DocumentCommand } from '../../domain/commands/types';
import './v2EditorPage.css';

/** A shared link opens here: the decrypted document, read-only, never stored; `onEdit` saves a local copy. */
export interface V2SharedView { readonly document: SceneDocumentV1; readonly onEdit: () => Promise<void> }

export function V2EditorPage({ shared }: { readonly shared?: V2SharedView } = {}): React.JSX.Element {
  // Under /s/:id the route's id is the share's, not a stored document's.
  const routeId = useParams().id;
  const id = shared ? undefined : routeId;
  // Fit-once needs a stable key; a shared document has no stored id.
  const fitKey = id ?? (shared ? `shared:${shared.document.id}` : undefined);
  // Read before this document becomes the last one: a reload of a new, untouched diagram opens it again.
  const [lastOpen] = useState(lastDocumentId);
  const { preferences, updatePreferences } = useV2Preferences();
  const panels = useV2Panels();
  const appearance = useV2Appearance(preferences.theme);
  const canvasDefaultColor = appearance === 'dark' ? '#191b19' : '#f7f7f5';
  const canvasColor = preferences.canvasColor ?? canvasDefaultColor;
  const repository = useMemo(
    () => createV2Repository(typeof window === 'undefined' ? null : window.indexedDB),
    []
  );
  const hostRef = useRef<PixiRendererHost | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const pasteRef = useRef<(event: ClipboardEvent) => void>(() => undefined);
  const gestureApiRef = useRef<V2GestureApi | null>(null);
  const commentHereRef = useRef<() => boolean>(() => false);
  const focusCanvas = useCallback(() => sectionRef.current?.focus(), []);
  useV2BodyFocusForward(sectionRef, pasteRef);
  const { tool, setTool, toolConfig, spacePan, setSpacePan, toolRef, toolConfigRef, spacePanRef, pickShape, pickConnector } = useV2ToolState(gestureApiRef);
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  const exportPanel = useV2ExportPanel(contextMenu, Boolean(shared));
  const { exportOpen } = exportPanel;
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [rendererStatus, setRendererStatus] = useState<PixiRendererStatus>('initializing');
  const rendererReady = rendererStatus === 'ready';

  const pushToast = useCallback((toast: ToastItem) => {
    setToasts((current) => withToast(current, toast));
  }, []);
  const dismissToast = useCallback((toastId: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);
  useV2EditorNotices(pushToast);

  const camera = useV2Camera(hostRef);
  const reloadRef = useRef<() => void>(() => undefined);
  const session = useDocumentSession(useMemo(() => ({
    onStaleRevision: () => {
      // Event context (a second tab won the write race), not render:
      // announce, reset first-open fit, and reload from the repository.
      camera.resetFit();
      setAnnouncement('Another tab changed this document. Reloading.');
      reloadRef.current();
    },
    // camera callbacks are stable and fittedRef persists across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []));
  const selectionApi = useV2Selection();
  const {
    selection, selectionRef, selectedConnectorId, selectedConnectorIds, selectedConnectorIdsRef,
    applySelection, applyConnectorSelection,
  } = selectionApi;
  const selectedNodeId = useCallback(() => selectionRef.current.primaryNodeId, [selectionRef]);
  /** Exactly these shapes selected, and no connector. */
  const selectNodes = useCallback((nodeIds: readonly string[]) => {
    applyConnectorSelection([]);
    applySelection(replaceSelection(nodeIds));
  }, [applyConnectorSelection, applySelection]);
  const { activePageId, setActivePageId, documentId, page, pageRef } = useV2ActivePage(session);
  useEffect(() => { setActivePageId(null); }, [documentId, setActivePageId]);
  const [pendingPageId, setPendingPageId] = useState<string | null>(null);
  const architecture = useV2Architecture(session.document, page);
  const notify = (message: string) => { setAnnouncement(message); pushToast({ id: `map-${Date.now()}`, tone: 'info', title: message }); };
  const location = useLocation();
  const startIntent = isV2StartIntent(location.state) ? location.state : null;
  const repo = useV2RepoDocument(session.document, startIntent, id);
  // Only the repo's own map page is locked and drawn as a map; its other pages are ordinary Canvas pages.
  const repoPage = repo.lockedPageId !== null && page?.id === repo.lockedPageId;
  // "This is the repo page", not "this is a repo document": a page added to a repo document is an ordinary one.
  const repoSource = repoPage ? repo.source : null;
  const { writable, commit, drawCommit, documentRef } = useV2GuardedCommit(session, repo, setAnnouncement);
  // A repo map is kept (Recents, last open) once it has files to draw: a typo, a private repo or a rate limit leaves nothing behind.
  const repoReadable = (repo.state.model?.stats.files ?? 0) > 0;
  const load = useV2EditorLoad({ id, lastOpen, fixed: shared?.document, startIntent, repo, repoReadable, session, repository, pushToast });
  // Map mode: a lens on the page's model. The canvas draws `viewPage`; commands, undo and autosave still see `page`.
  const docReadOnly = load.readOnly || repo.broken || repoPage;
  const { openWorkspace } = panels;
  const { compileDraft, compileAny, compileAt } = useV2Compilers(preferences);
  const landingDirection = (): LandingDirection => landingDirectionOf(pageRef.current);
  const toastZoomedToRead = () => pushToast(zoomedToReadToast());
  const code = useV2CodeWorkspace({
    document: session.document, page, pageRef, hostRef, readOnly: docReadOnly,
    palette: preferences.diagramPalette, autoIcons: preferences.autoIcons,
    onPaletteChange: useCallback((diagramPalette) => updatePreferences({ diagramPalette }), [updatePreferences]),
    // A new diagram lands readable, as the assistant's does.
    commit: commit, applySelection, fitView: (ids) => { camera.landReadable(landingDirection(), ids); },
    openPanel: useCallback(() => openWorkspace('code'), [openWorkspace]),
    onViews: setPendingPageId, pushToast, dismissToast, announce: setAnnouncement,
    focusCanvas, forgetHistory: session.forgetHistory,
  });
  // The page's diagram opens as itself (the selected one, or the only one); else a new diagram.
  const toggleCode = () => {
    if (panels.workspace === 'code') { panels.closeWorkspace(); return; }
    const frames = page ? dslFrames(page) : [];
    const frame = frames.find((candidate) => selectionRef.current.nodeIds.includes(candidate.id)) ?? (frames.length === 1 ? frames[0] : undefined);
    if (frame) code.openFrame(frame.id); else code.openNew();
  };
  // Map's start screen is for a document that is editable and has no model on any page (a model page elsewhere keeps the old rule).
  const modelled = useMemo(() => session.document?.pages.some((candidate) => archFrameOf(candidate) !== null) ?? false, [session.document]);
  // A model being written (the start screen's action) keeps Map on until its page is the one on screen (generating, then the page switch pending).
  const startable = !load.readOnly && !shared && repo.lockedPageId === null && (!modelled || code.generating || pendingPageId !== null);
  const pinRef = useRef<() => void>(() => undefined);
  // A repo page's Canvas is its drawing: the newest one, else one made from the map on screen (set below).
  const openDrawingRef = useRef<() => boolean>(() => false);
  // Map cannot edit the drawing: a blocked edit explains why (set below, once the selection is known).
  const explainMapRef = useRef<() => void>(() => undefined);
  const map = useV2MapMode({
    onPin: () => pinRef.current(),
    onBlockedEdit: () => explainMapRef.current(),
    ...(repoPage ? { onCanvas: () => openDrawingRef.current() } : {}),
    ready: rendererReady,
    panelsKey: [panels.workspace, panels.shortcutsOpen, panels.chartId, panels.treeOpen, panels.motionOpen].join(),
    selectedIds: () => selectionRef.current.nodeIds,
    glide: camera.animateTo,
    page, documentId: session.document?.id, repo: repoSource ? { model: repo.state.model, loading: repo.state.status === 'loading' } : null, startable, palette: preferences.diagramPalette, autoIcons: preferences.autoIcons, hostRef,
    cameraRef: camera.cameraRef, updateCamera: camera.updateCamera, fitView: camera.fitView, onToolChange: setTool,
    primaryId: () => selectionRef.current.primaryNodeId,
    select: (id) => selectNodes([id]),
    clearSelection: () => selectionApi.clearAll(),
    selectedNodeId: selection.nodeIds.length === 1 && selectedConnectorIds.length === 0 ? selection.nodeIds[0]! : null,
    selectedConnectorId: selection.nodeIds.length === 0 ? selectedConnectorId : null,
    cancelTransient: () => {
      if (gestureApiRef.current?.cancelGesture()) return true;
      if (escapePanel()) return true;
      if (toolRef.current === 'select') return false;
      setTool('select');
      return true;
    },
    closeChart: () => panels.closeChart(),
    notify,
  });
  // Zoom to fit takes what is on screen: the map's own fit in Map mode.
  const fitAll = () => (map.active ? map.fit() : camera.fitView());
  const withMapScene = useV2RepoMapThumbnail({
    id, repoPage, page, repoReadable, repo, document: session.document, map, repository, openWorkspace,
  });
  // Choosing a Create tool on Map's start screen goes back to Canvas with it armed.
  const leaveStart = <A extends unknown[], R>(action: (...args: A) => R) => (...args: A): R => {
    if (map.start) map.choose('canvas');
    return action(...args);
  };
  const viewPage = map.mapPage ?? page;
  useV2DocumentTitle(session.document?.name);
  const escapePanel = () => {
    if (!panels.chartId) return false;
    panels.closeChart();
    sectionRef.current?.focus({ preventScroll: true });
    return true;
  };
  const architectureActionsRef = useRef<ReturnType<typeof useV2ArchitectureActions> | null>(null);

  useEffect(() => {
    reloadRef.current = load.reload;
  }, [load.reload]);
  const readOnlyRef = useRef(load.readOnly);
  // Map mode is read-only for geometry: its box ids are the Canvas page's node ids, so any edit that got through
  // would land on the Canvas node of the same id.
  // Pin as page: the map as drawn now becomes a plain Canvas page, one undo step. It adds a page, not a model edit,
  // the repo map's own page is read-only, but pinning only adds a page, so it is offered there; a shared view (load.readOnly) is not.
  // A repo still being read would pin half a map.
  const pinnable = !load.readOnly && !repo.broken && map.active && map.mapPage !== null && map.mapPage.nodes.length > 0
    && !(repoPage && repo.state.status === 'loading');
  const { showDrawing, repoDrawing, backTo, backToMap, keepCameraOnPage, pin, openDrawing } = useV2RepoDrawing({
    session, map, panels, repo, readOnly: load.readOnly, page, activePageId, setActivePageId, pinnable, repoPage, documentRef,
    commit, pushToast, dismissToast, notify, setAnnouncement, openDrawingRef,
  });
  pinRef.current = pin;
  openDrawingRef.current = openDrawing;
  const { undo, redo } = useV2History({ session, map, page, setActivePageId, showDrawing, setAnnouncement, pushToast });
  const editLocked = docReadOnly || map.active;
  useEffect(() => { readOnlyRef.current = editLocked; }, [editLocked]);
  const { labelEditing, openEditor, connectorLabel, editActions } = useV2EditorEditing({
    session, page, pageRef, hostRef, camera, selectionRef, selectedConnectorId, selectedConnectorIds, applySelection, applyConnectorSelection, selectNodes,
    commit, writable, editLocked, focusCanvas, setAnnouncement, architectureActionsRef,
  });
  useV2VisibleSelection(page, selection, applySelection);
  useV2StartIntent({
    startIntent, pathname: location.pathname, shared, load, page, session, repo, code, commit, openWorkspace, setActivePageId, pushToast,
  });

  const { status: saveStatus, retry: retrySave } = useV2Autosave({
    repository,
    documentId: id ?? null,
    document: session.document,
    revision: session.revision,
    baseRevision: load.baseRevision,
    onConflict: () => setAnnouncement('Another tab saved first. Reload to continue.'),
    onSaved: (saved) => { if (id) scheduleV2Thumbnail(repository, id, withMapScene(saved)); },
  });

  const proposal = useV2Proposal({
    document: session.document, revision: session.revision, pageId: page?.id ?? null,
    commit: commit, readOnly: docReadOnly,
    announce: setAnnouncement, compileDsl: compileDraft,
  });

  useV2TestApi({
    hostRef, selectionRef, toolRef, selectedConnectorIds,
    document: session.document, revision: session.revision, saveStatus, proposal, mapState: map.state, mapMotion: map.motionStats, mapOpen: map.openBoxes,
  });

  const ghostPage = useV2ProposalPreview(proposal, hostRef, rendererReady, camera.revealBounds);
  const cover = useV2RevealCover({
    load, page, rendererStatus, startIntent, generating: code.generating, map, repoSource, repoStatus: repo.state.status,
  });

  const revisionRef = useRef(session.revision);
  revisionRef.current = session.revision;
  const pages = useV2Pages({
    document: session.document, pageId: page?.id ?? null, readOnly: load.readOnly || repo.broken, lockedPageId: repo.lockedPageId,
    commit: commit, onSelect: setActivePageId, mintId: mintV2Id,
    announce: setAnnouncement, toast: pushToast, undo: () => session.undo(), revision: () => revisionRef.current,
  });
  useV2PageFit({ camera, panels, session, page, pageRef, hostRef, fitKey, rendererStatus, mapActive: map.active, keepCameraOnPage });

  // Drawing a connector between two model objects records the relation too: one batch, one undo step.
  const extendConnectorCommand = useCallback(
    (command: DocumentCommand, fromNodeId: string, toNodeId: string) => connectorWithRelation(command, fromNodeId, toNodeId, pageRef.current, Boolean(architecture.model), session.document),
    [architecture, session.document, pageRef]);

  const architectureActions = useV2ArchitectureActions(
    { architecture, document: session.document, pageRef, readOnly: docReadOnly, mintId: mintV2Id },
    {
      glideToNodes: camera.glideToNodes,
      openPage: setActivePageId,
      selectNodes,
      commit: commit,
      announce: setAnnouncement,
      compileWorkspace: compileAny,
      compileSequence: compileAny,
      openInMap: map.enterMapAt,
    },
  );
  architectureActionsRef.current = architectureActions;
  const { workspaceFolder, playback, endFlow } = useV2ModelWorkspace({
    session, page, architecture, architectureActions, perspectiveTags: preferences.perspectiveTags, hostRef, rendererReady, camera, code, docReadOnly, mapActive: map.active, pendingPageId, setPendingPageId, setActivePageId, pushToast, focusCanvas,
  });
  const selectedNode = selection.primaryNodeId && viewPage
    ? viewPage.nodes.find((node) => node.id === selection.primaryNodeId)
    : undefined;
  const chartPanelNode = page && panels.chartId
    ? page.nodes.find((node) => node.id === panels.chartId && node.kind === 'chart') ?? null
    : null;
  const { openChart } = panels;
  const openChartData = useCallback((nodeId: string): boolean => {
    if (pageRef.current?.nodes.find((candidate) => candidate.id === nodeId)?.kind !== 'chart') return false;
    openChart(nodeId);
    return true;
  }, [openChart, pageRef]);
  const selectedElementId = selectedNode ? placedElementId(selectedNode) : null;
  const [renameRequest, setRenameRequest] = useState<{ readonly id: string } | null>(null);
  // Spent once the panel closes: reopening it from the rail is not another rename.
  useEffect(() => { if (panels.workspace !== 'model') setRenameRequest(null); }, [panels.workspace]);
  // Map's start screen writes a model: its panel opens once the model is there, never on an empty "create one" state.
  const [modelPanelOnStart, setModelPanelOnStart] = useState(false);
  useEffect(() => {
    if (modelPanelOnStart && architecture.model) { setModelPanelOnStart(false); openWorkspace('model'); }
  }, [modelPanelOnStart, architecture.model, openWorkspace]);
  const { placedElementIds, canvasElementIds, showOnCanvas, editInModel, editBox, repoPanel, mapArrow, explainMap } = useV2MapHandoff({
    map, panels, setRenameRequest, document: session.document, page, viewPage, docReadOnly, loadReadOnly: load.readOnly, repoSource, pinnable,
    selection, selectedConnectorId, applySelection, applyConnectorSelection, selectedElementId, pushToast, pinRef, openDrawingRef,
  });
  explainMapRef.current = explainMap;
  const iconActions = useV2IconActions({
    pageRef, readOnly: editLocked, commit: commit, announce: setAnnouncement,
    compileAt, document: session.document, setModelIcons: architectureActions.setModelIcons,
  });
  // The deeper view of the selected element, when its page exists.
  const deeperView = selectedElementId ? architecture.childViewOf(selectedElementId) : null;
  const zoomInto = deeperView && architecture.pageForView(deeperView.id) && selectedElementId
    ? { name: deeperView.name, open: () => { architectureActions.drillToMap(selectedElementId); } } : null;

  const agents = useV2EditorAgents({
    id, session, load, repo, map, panels, camera, code, preferences, updatePreferences, proposal, compileDraft, page, viewPage, pageRef, hostRef,
    selectionRef, selectedConnectorIdsRef, selectionNodeIds: selection.nodeIds, applySelection, applyConnectorSelection, pinnable, openDrawingRef,
    showDrawing, setActivePageId, writable, landingDirection, toastZoomedToRead, setAnnouncement, pushToast,
  });

  const input = useV2EditorInput({
    hostRef, pageRef, sectionRef, selectionRef, readOnlyRef, drawCommit, applySelection, applyConnectorSelection, setAnnouncement,
    pushToast, setTool, openEditor, openChart, editLocked, editActions, code, preferences, updatePreferences,
  });
  pasteRef.current = input.handlePaste;
  const find = useV2Find({
    page: viewPage, selectionRef, selectedConnectorIdsRef, cameraRef: camera.cameraRef,
    applySelection, applyConnectorSelection,
    glideToNodes: camera.glideToNodes, animateTo: camera.animateTo, focusCanvas,
    ...(map.findSource && repoPanel.drawn ? { source: map.findSource } : {}),
  });
  const handleKeyDown = useV2EditorKeyboard({
    toolRef, commentHereRef, editingRef: labelEditing.editingRef, pageRef, selectionRef, gestureApiRef, setTool, setSpacePan, input, editActions, architectureActions, camera, connectorLabel,
    panels, selectionApi, map, find, viewPage, selectedElementId, selectedConnectorIds, docReadOnly, editLocked, undo, redo, escapePanel,
    openEditor, selectNodes, fitAll, toggleCode, backToMap,
  });

  const { setExported, transient, feedback, tips, runTip } = useV2EditorHints({
    shared: Boolean(shared), loadReadOnly: load.readOnly, page, editLocked, rendererReady, selectedCount: selection.nodeIds.length,
    aiConfigured: agents.aiSettings.configured, panels, playback, code, exportOpen, contextMenu,
    typing: labelEditing.editing !== null || connectorLabel.editing !== null,
    agentConnected: agents.agentBridge.status === 'connected', onDrawing: backTo !== null, setAnnouncement,
  });

  return (
    <SystemRoot appearance={appearance} density={preferences.density}>
      <div className="ofk-v2" data-testid="v2-editor" data-tool={spacePan ? 'hand' : tool}
        style={{ backgroundColor: canvasColor }}
        data-workspace-open={panels.workspace !== null || panels.shortcutsOpen || panels.motionOpen || chartPanelNode !== null}
        data-left-open={panels.treeOpen}
        onKeyDown={(event) => {
          // A focused control (a tree, a button) keeps its own arrows and Space; a playing flow takes the rest.
          if (playback.flow && !keyOwnedByTarget(event)) {
            if (event.key === 'ArrowRight' || event.key === ' ') { playback.next(); event.preventDefault(); return; }
            if (event.key === 'ArrowLeft') { playback.prev(); event.preventDefault(); return; }
            if (event.key === 'Escape') { endFlow(); event.preventDefault(); return; }
          }
          if (event.key === '?' && !isEditableTarget(event.target)) {
            event.preventDefault(); panels.toggleShortcuts();
          } else if (!map.onKey(event)) handleKeyDown(event);
        }}
        onKeyUp={(event) => { if (event.key === ' ') setSpacePan(false); }}
        onDragOver={(event) => { if (imageFiles(event.dataTransfer).length > 0) event.preventDefault(); }}
        onDrop={input.handleDrop}
        onPaste={input.handlePaste}>
        <input ref={input.imageInputRef} type="file" hidden
          accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void input.media.insertImageFile(file);
            event.target.value = '';
          }} />
        {repo.mismatch ? <BadRepoAddress /> : load.phase === 'loading' || !page ? (
          <V2LoadCenter
            phase={load.phase}
            documentId={id}
            corruptIssues={load.corruptIssues}
            loadError={load.loadError}
            onRetry={load.reload}
            onDownloadDiagnostic={() => downloadTextFile(
              `${id ?? 'document'}-diagnostic.json`,
              JSON.stringify(load.corruptIssues, null, 2),
              'application/json'
            )}
          />
        ) : (
          <>
            <V2EditorChrome
              session={session} pageId={page.id} pages={pages} preferences={preferences} updatePreferences={updatePreferences}
              canvasDefaultColor={canvasDefaultColor} saveStatus={saveStatus} retrySave={retrySave} reload={load.reload} docReadOnly={docReadOnly}
              loadReadOnly={load.readOnly} rendererStatus={rendererStatus} tool={tool} toolConfig={toolConfig} camera={camera} panels={panels}
              undo={undo} redo={redo} pushToast={pushToast} workspaceFolder={workspaceFolder} architecture={architecture}
              architectureActions={architectureActions} map={map} repo={repo} repoSource={repoSource} repoPanel={repoPanel} repoReadable={repoReadable}
              repoDrawing={repoDrawing} backTo={backTo} backToMap={backToMap} pinRef={pinRef} pinnable={pinnable} shared={shared}
              exportPanel={exportPanel} commit={commit} leaveStart={leaveStart} setTool={setTool} pickShape={pickShape} pickConnector={pickConnector}
              gestureApiRef={gestureApiRef} input={input} fitAll={fitAll} />
            <V2EditorCanvas
              comments={<V2CommentsHost session={session} page={page} sectionRef={sectionRef} hostRef={hostRef} cameraRef={camera.cameraRef} subscribeCamera={camera.subscribe}
                selectedNodeId={selectedNodeId} placeRef={commentHereRef} tool={tool} readOnly={docReadOnly} hidden={map.active} />}
              agentCursor={<AgentCursor ref={agents.presence.cursorRef} name={agents.agentShown} working={agents.agentBridge.activity?.doing === 'drawing'} data-testid="v2-agent-cursor" />}
              page={page} viewPage={viewPage ?? page} hostRef={hostRef} sectionRef={sectionRef} pageRef={pageRef} selectionRef={selectionRef}
              selectedConnectorIdsRef={selectedConnectorIdsRef} toolRef={toolRef} spacePanRef={spacePanRef} toolConfigRef={toolConfigRef}
              readOnlyRef={readOnlyRef} gestureApiRef={gestureApiRef} explainMapRef={explainMapRef} openDrawingRef={openDrawingRef} tool={tool}
              camera={camera} map={map} panels={panels} repo={repo} repoSource={repoSource} repoDrawing={repoDrawing} code={code}
              labelEditing={labelEditing} connectorLabel={connectorLabel} iconActions={iconActions} selection={selection}
              selectedConnectorId={selectedConnectorId} selectedConnectorIds={selectedConnectorIds} zoomInto={zoomInto} editLocked={editLocked}
              canvasColor={canvasColor} showGrid={preferences.showGrid} snapToGrid={preferences.snapToGrid} drawCommit={drawCommit}
              applySelection={applySelection} applyConnectorSelection={applyConnectorSelection} openEditor={openEditor} setTool={setTool}
              setContextMenu={setContextMenu} setRendererStatus={setRendererStatus} extendConnectorCommand={extendConnectorCommand}
              openChartData={openChartData} editBox={editBox} setModelPanelOnStart={setModelPanelOnStart} />
            <V2EditorContextMenu
              target={contextMenu} page={page} viewPage={viewPage ?? page} selection={selection} selectionRef={selectionRef} selectionApi={selectionApi}
              selectedNode={selectedNode} selectedElementId={selectedElementId} editLocked={editLocked} docReadOnly={docReadOnly}
              editActions={editActions} iconActions={iconActions} code={code} architectureActions={architectureActions} camera={camera} commit={commit}
              openEditor={openEditor} editSelectedConnectorLabel={connectorLabel.editSelected} openWorkspace={openWorkspace}
              dismiss={() => setContextMenu(null)} close={() => { setContextMenu(null); focusCanvas(); }}
              mapActive={map.active} zoomInto={zoomInto} editInModel={editInModel} openElementExport={exportPanel.openElementExport} fitAll={fitAll}
              inMap={map.active ? {
                ...(selectedElementId && canvasElementIds.has(selectedElementId) && !repoSource ? { onShowOnCanvas: () => showOnCanvas(selectedElementId) } : {}),
                ...(pinnable ? { onCopyToCanvas: () => pinRef.current() } : {}),
              } : null}
              showGrid={preferences.showGrid} snapToGrid={preferences.snapToGrid}
              onToggleGrid={() => updatePreferences({ showGrid: !preferences.showGrid })}
              onToggleSnap={() => updatePreferences({ snapToGrid: !preferences.snapToGrid })} />
            <V2EditorExport exportPanel={exportPanel} session={session} page={page} map={map} selectedNodeIds={selection.nodeIds}
              selectedConnectorIds={selectedConnectorIds} shared={Boolean(shared)} onExported={() => setExported(true)} onOpenAnimation={panels.openMotion}
              pushToast={pushToast} focusCanvas={focusCanvas} />
            <V2WorkspaceRail mode={panels.workspace} onChange={(mode) => { if (mode === 'code') toggleCode(); else panels.toggleWorkspace(mode); }}
              onShortcuts={panels.toggleShortcuts} agentConnected={agents.agentBridge.status === 'connected'} />
            {/* A drawing tool armed means the next click draws: the welcome steps aside instead of catching it. */}
            {page.nodes.length === 0 && page.connectors.length === 0 && !ghostPage && !docReadOnly && rendererReady && !map.active && tool === 'select'
              ? <V2CanvasWelcome onOpen={openWorkspace}
                blankDocument={session.document?.pages.every((candidate) => candidate.nodes.length === 0 && candidate.connectors.length === 0) ?? true} /> : null}
            <V2EditorSidePanels
              panels={panels} code={code} preferences={preferences} updatePreferences={updatePreferences} agents={agents} session={session}
              viewPage={viewPage ?? page} selection={selection} selectedConnectorIds={selectedConnectorIds} selectionApi={selectionApi} selectNodes={selectNodes}
              camera={camera} architecture={architecture} architectureActions={architectureActions} playback={playback} endFlow={endFlow} map={map}
              repoPanel={repoPanel} repoSource={repoSource} repoLoading={repo.state.status === 'loading'} mapArrow={mapArrow} renameRequest={renameRequest}
              selectedElementId={selectedElementId} placedElementIds={placedElementIds} canvasElementIds={canvasElementIds} showOnCanvas={showOnCanvas}
              workspaceFolder={workspaceFolder} docReadOnly={docReadOnly} pushToast={pushToast} setAnnouncement={setAnnouncement} focusCanvas={focusCanvas} />
            <V2EditorOverlays
              panels={panels} find={find} tips={tips} runTip={runTip} feedback={feedback} transient={transient} mapActive={map.active} code={code}
              session={session} page={page} viewPage={viewPage ?? page} chartPanelNode={chartPanelNode} selection={selection}
              selectedConnectorIds={selectedConnectorIds} editLocked={editLocked} docReadOnly={docReadOnly} commit={commit}
              applySelection={applySelection} applyConnectorSelection={applyConnectorSelection} selectNodes={selectNodes} openEditor={openEditor}
              setContextMenu={setContextMenu} camera={camera} architectureActions={architectureActions} agents={agents} proposal={proposal}
              pushToast={pushToast} focusCanvas={focusCanvas} />
            <ToastRegion items={toasts} onDismiss={dismissToast} />
            <p className="sr-only" aria-live="polite">{announcement || `Revision ${session.revision}.`}</p>
            {cover !== 'gone' ? <BrandLoader screen cover leaving={cover === 'leaving'} ground={canvasColor} label="Opening the diagram" /> : null}
          </>
        )}
      </div>
    </SystemRoot>
  );
}
