import { PixiDotGrid } from './PixiDotGrid';
import { PixiLiveTransformPreview } from './PixiLiveTransformPreview';
import { Application, Container, Graphics } from 'pixi.js';
import { screenToWorld, worldToScreen } from '../../domain/camera/camera';
import { recordOpenCanvasRenderWork } from '../../application/renderer/renderWorkMeasurement';
import type { CanvasCamera } from '../../domain/camera/types';
import type { Bounds2d, Point2d, Size2d } from '../../domain/geometry/types';
import type { SceneConnector, ScenePage } from '../../domain/document/types';
import type { ConnectorEditHandle } from '../../domain/connectors/editing';
import { createSceneIndex } from '../../domain/scene/spatialIndex';
import type { TransformHandle, TransformResult } from '../../domain/transforms/types';
import { PixiTransformOverlay } from './PixiTransformOverlay';
import { PixiConnectorRenderer } from './PixiConnectorRenderer';
import { applyTextResolution, textResolutionForZoom } from './pixiText';
import { PixiFreeformPreview, type FreeformPreviewFrame } from './PixiFreeformPreview';
import { PixiProposalPreview, type ProposalPreviewFrame } from './PixiProposalPreview';
import { PixiFocusOverlay, type FocusFrame } from './PixiFocusOverlay';
import { PixiContainerRenderer } from './PixiContainerRenderer';
import type { PixiMapMotion } from './PixiMapMotion';
import type { PixiAgentReveal } from './PixiAgentReveal';
import type { RevealPlan } from '../../domain/animation/agentReveal';
import type { MotionFrame } from '../../application/map/motionFrame';
import { PixiConnectorEditOverlay } from './PixiConnectorEditOverlay';
import { inspectConnectorEdit, inspectConnectorHandleScreenPoints, inspectConnectorSamples, type ConnectorEditDebugSnapshot, type ConnectorHandleScreenPoint } from './PixiConnectorInspection';
import { PixiNodeRenderer } from './PixiNodeRenderer';
import { PixiSelectionOverlay, selectionWorldBounds } from './PixiSelectionOverlay';
import { shouldRedrawNodes } from './sceneInvalidation';
import { type ConnectSide } from '../../domain/connectors/connectHandles';
import { type ViewportSceneProjection } from './viewportProjection';
import { abandonInitializedApplication, assembleStage, contextLost, getNodeDebugSnapshot, getRenderDiagnostics, PIXI_HOST_STAGE_DESTROY_OPTIONS, warmShader, type PixiRenderDiagnostics } from './pixiHostStage';
import { drawMotionFrame, endMotion, getMotionState } from './pixiHostMotion';
import { finishReveal, revealTick, startArmedReveal, type ArmedReveal, type RevealStats, type RunningReveal } from './pixiHostReveal';
import { drawFocus, getFocusState, syncFlow } from './pixiHostFocus';
import { setAlignmentGuides, setMarquee, setPlacementGhost, type PlacementGhost } from './pixiHostOverlays';
import { getContentBounds, getNodeLabelScreenBounds, getNodeScreenBounds, pickConnector, pickConnectorHandle, pickInScreenBounds, pickNode, pickTransformHandle } from './pixiHostQueries';
import { getConnectorLabelScreenPoint, getLiveConnectorSamples, setConnectionPreview, setConnectorPreview, setTransformPreview } from './pixiHostPreview';
import { createViewportProjection, drawConnectorEditOverlay, drawDotGrid, drawProposalPreview, drawSelection, getSelectedConnector, rebuildScene, refreshViewportProjection, settleCamera, updateLabelVisibility } from './pixiHostScene';

export { PIXI_HOST_STAGE_DESTROY_OPTIONS };

export type PixiRendererStatus =
  | 'unavailable'
  | 'initializing'
  | 'ready'
  | 'context-lost'
  | 'destroyed';

interface PixiRendererHostOptions {
  readonly liveTransformPreview?: boolean;
  readonly onStatusChange?: (status: PixiRendererStatus) => void;
  readonly connectorModelEnabled?: boolean;
  /** Resolves an IndexedDB asset id to a loadable URL (image nodes). */
  readonly resolveAsset?: (assetId: string) => Promise<string | null>;
}

// The state below is shared with the pixiHost* helper modules (they take the host and draw, pick or animate from it).
export class PixiRendererHost {
  readonly app = new Application();
  readonly livePreview: PixiLiveTransformPreview | null;
  previewResult: TransformResult | null = null;
  /** The preview is a copy (⌥-drag): the originals stay drawn, their lines stay put. */
  previewCopy = false;
  previewFrame: number | null = null;
  readonly world = new Container();
  readonly dotGrid = new PixiDotGrid();
  showDotGrid = false;
  readonly precisionGrid = new Graphics();
  readonly connectorRenderer = new PixiConnectorRenderer();
  readonly containerRenderer = new PixiContainerRenderer();
  readonly connectorEditOverlay = new PixiConnectorEditOverlay();
  readonly nodeRenderer: PixiNodeRenderer;
  readonly selectionOverlay = new PixiSelectionOverlay();
  readonly transformOverlay = new PixiTransformOverlay();
  readonly freeformPreview = new PixiFreeformPreview();
  readonly proposalPreview = new PixiProposalPreview();
  proposalFrame: ProposalPreviewFrame | null = null;
  readonly focusOverlay = new PixiFocusOverlay();
  focusFrame: FocusFrame | null = null;
  flowFrame: number | null = null;
  flowStart = 0;
  readonly marquee = new Graphics();
  readonly placementGhost = new Graphics();
  readonly connectionPreview = new PixiConnectorRenderer();
  readonly alignmentGuides = new Graphics();
  alignmentGuidesShown = false;
  private readonly onStatusChange?: PixiRendererHostOptions['onStatusChange'];
  readonly connectorModelEnabled: boolean;
  readonly resolveAsset: PixiRendererHostOptions['resolveAsset'];
  camera: CanvasCamera = { x: 64, y: 64, zoom: 1 };
  page: ScenePage | null = null;
  index: ReturnType<typeof createSceneIndex> | null = null;
  selectedNodeIds: readonly string[] = [];
  primaryNodeId: string | null = null;
  hoveredNodeId: string | null = null;
  hoveredSide: ConnectSide | null = null;
  editable = true;
  /** The shape a dragged connector end would bind to. */
  dropTargetId: string | null = null;
  /** The unselected connector under the pointer. */
  hoveredConnectorId: string | null = null;
  /** The connector whose endpoint/segment is being dragged: its committed copy is not drawn. */
  previewConnectorId: string | null = null;
  // Many connectors can be selected (marquee, ⌘A); edit handles show for one.
  selectedConnectorIds: readonly string[] = [];
  activeConnectorHandle: ConnectorEditHandle | null = null;
  destroyed = false;
  backgroundColor = 0xf8fafc;
  renderFrame: number | null = null;
  cameraDirty = false;
  renderCount = 0;
  renderRequests = 0;
  coalescedRequests = 0;
  lastRenderDurationMs = 0;
  viewportProjection: ViewportSceneProjection | null = null;
  // --- Agent reveal: an agent's change building in (armReveal). Its shapes draw in the reveal layers, not the scene, until it ends.
  revealArmed: ArmedReveal | null = null;
  reveal: RunningReveal | null = null;
  revealLayers: PixiAgentReveal | null = null;
  revealStats: RevealStats = { runs: 0, frames: 0, groups: 0, morphs: 0, durationMs: 0, cut: 0 };
  // --- end agent reveal
  // Map mode's open/close move: a layer drawn over the page while the host's own boxes are hidden (see drawMotionFrame).
  motion: PixiMapMotion | null = null;
  motionActive = false;
  arrowAlpha = 1;
  arrowFade: number | null = null;
  // Frames can stop coming (a busy software GPU, a hidden tab); the fade still ends on time and the next render shows the arrows.
  arrowFadeDeadline: ReturnType<typeof setTimeout> | null = null;
  motionRenderMs: number[] = [];

  constructor(options: PixiRendererHostOptions = {}) {
    this.resolveAsset = options.resolveAsset;
    this.nodeRenderer = new PixiNodeRenderer(() => this.requestRender(), options.resolveAsset);
    this.livePreview = options.liveTransformPreview ? new PixiLiveTransformPreview() : null;
    this.onStatusChange = options.onStatusChange;
    this.connectorModelEnabled = options.connectorModelEnabled !== false;
  }

  async mount(container: HTMLElement): Promise<HTMLCanvasElement> {
    this.emitStatus('initializing');
    await this.app.init({
      preference: 'webgl',
      preferWebGLVersion: 2,
      autoStart: false,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      powerPreference: 'high-performance',
      backgroundColor: this.backgroundColor,
      resizeTo: container,
    });
    if (this.destroyed) {
      // React StrictMode can start the replacement host before this async init
      // resolves. Pixi renderer destruction here tears down shared CanvasText
      // pools used by that live host, so release only this abandoned GL context.
      abandonInitializedApplication(this.app);
      throw new Error('Pixi renderer was destroyed during initialization.');
    }

    warmShader(this);
    assembleStage(this);
    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.className = 'pixi-spike__canvas';
    canvas.setAttribute('aria-label', 'Diagram drawing surface');
    document.addEventListener('visibilitychange', this.onVisibility);
    this.watchResolution();
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    container.appendChild(canvas);
    this.applyCamera();
    if (this.page && refreshViewportProjection(this)) rebuildScene(this);
    this.emitStatus('ready');
    return canvas;
  }

  setDotGrid(visible: boolean): void {
    this.showDotGrid = visible;
    drawDotGrid(this);
    this.requestRender();
  }

  /** Canvas ground color; applied at mount and live afterwards. */
  setBackground(background: number): void {
    if (this.backgroundColor === background) return;
    this.backgroundColor = background;
    drawDotGrid(this);
    if (this.app.renderer) {
      this.app.renderer.background.color.setValue(background);
      rebuildScene(this);
    }
  }

  setPage(page: ScenePage): void {
    // Agent reveal: any new page ends a running reveal (the shapes show where they are); an armed one starts on this page.
    const revealing = this.reveal !== null;
    if (revealing) finishReveal(this, false);
    const before = this.page;
    const redrawNodes = shouldRedrawNodes(this.page, page) || revealing;
    if (this.page && this.page.id !== page.id && this.focusFrame) {
      this.focusFrame = null;
      this.focusOverlay.clear();
    }
    this.page = page;
    this.index = createSceneIndex(page);
    const availableNodeIds = new Set(page.nodes.map((node) => node.id));
    this.selectedNodeIds = this.selectedNodeIds.filter((id) => availableNodeIds.has(id));
    if (!this.primaryNodeId || !availableNodeIds.has(this.primaryNodeId)) {
      this.primaryNodeId = this.selectedNodeIds.at(-1) ?? null;
    }
    const connectorIds = new Set(page.connectors.map((connector) => connector.id));
    if (!this.selectedConnectorIds.every((id) => connectorIds.has(id))) {
      this.selectedConnectorIds = this.selectedConnectorIds.filter((id) => connectorIds.has(id));
      this.activeConnectorHandle = null;
    }
    this.viewportProjection = createViewportProjection(this);
    const started = startArmedReveal(this, before, page);
    rebuildScene(this, redrawNodes || started);
    if (started) this.revealTick(performance.now());
  }

  /**
   * Builds in the next page this host is given (an agent's commit lands a render later): `make` turns the page drawn
   * now and that one into a plan, or null for none. View only: the page, its index and every click are the new page's.
   */
  armReveal(make: (before: ScenePage, after: ScenePage) => RevealPlan | null): void {
    this.revealArmed = { make, at: performance.now() };
  }

  /** Runs so far, frames drawn, and whether one is on screen (the e2e reads it). */
  getRevealState(): { active: boolean; runs: number; frames: number; groups: number; morphs: number; durationMs: number; cut: number } {
    return { active: this.reveal !== null, ...this.revealStats };
  }

  readonly revealTick = (now: number): void => revealTick(this, now);

  // Wheel/trackpad deliver several camera updates per frame; only the world
  // transform moves per call. Dot grid, overlays, projection and label
  // visibility settle once, right before the next render.
  setCamera(camera: CanvasCamera): void {
    this.camera = camera;
    this.world.position.set(camera.x, camera.y);
    this.world.scale.set(camera.zoom);
    this.focusOverlay.content.position.set(camera.x, camera.y);
    this.focusOverlay.content.scale.set(camera.zoom);
    this.cameraDirty = true;
    this.requestRender();
  }

  drawMotionFrame(frame: MotionFrame): void { drawMotionFrame(this, frame); }
  endMotion(fadeArrows = true): void { endMotion(this, fadeArrows); }
  getMotionState(): ReturnType<typeof getMotionState> { return getMotionState(this); }

  getConnectorDebugSnapshot(): ReturnType<PixiConnectorRenderer['getDebugSnapshot']> { return this.connectorRenderer.getDebugSnapshot(); }

  getNodeDebugSnapshot(): ReturnType<PixiNodeRenderer['getDebugSnapshot']> { return getNodeDebugSnapshot(this); }

  getConnectorLabelScreenPoint(connectorId: string): Point2d | null { return getConnectorLabelScreenPoint(this, connectorId); }
  getConnectorSamples(connectorId: string): readonly Point2d[] | null { return inspectConnectorSamples(this.page, connectorId); }
  getLiveConnectorSamples(connectorId: string): readonly Point2d[] | null { return getLiveConnectorSamples(this, connectorId); }

  getConnectorEditDebugSnapshot(): ConnectorEditDebugSnapshot { return inspectConnectorEdit(this.page, this.getSelectedConnectorId(), this.activeConnectorHandle); }
  getConnectorHandleScreenPoints(): readonly ConnectorHandleScreenPoint[] { return inspectConnectorHandleScreenPoints(this.page, this.getSelectedConnectorId(), this.camera); }
  worldToScreen(point: Point2d): Point2d { return worldToScreen(this.camera, point); }
  screenToWorld(point: Point2d): Point2d { return screenToWorld(this.camera, point); }

  pickNode(screenPoint: Point2d, scope: string | null = null): string | null { return pickNode(this, screenPoint, scope); }
  pickConnector(screenPoint: Point2d): string | null { return pickConnector(this, screenPoint); }
  pickConnectorHandle(screenPoint: Point2d): ConnectorEditHandle | null { return pickConnectorHandle(this, screenPoint); }

  setConnectorSelection(connectorIds: readonly string[], handle: ConnectorEditHandle | null = null): void {
    this.selectedConnectorIds = connectorIds;
    this.activeConnectorHandle = handle;
    drawConnectorEditOverlay(this);
    this.requestRender();
  }

  setConnectorPreview(connector: SceneConnector | null): void { setConnectorPreview(this, connector); }

  setSelection(nodeIds: readonly string[], primaryNodeId: string | null): void {
    this.selectedNodeIds = nodeIds;
    this.primaryNodeId = primaryNodeId;
    this.hoveredNodeId = null;
    this.hoveredSide = null;
    if (refreshViewportProjection(this)) rebuildScene(this);
    drawSelection(this);
    drawConnectorEditOverlay(this);
    this.requestRender();
  }

  getSelectionWorldBounds(): Bounds2d | null { return this.getNodesWorldBounds(this.selectedNodeIds); }
  getNodesWorldBounds(nodeIds: readonly string[]): Bounds2d | null { return this.index ? selectionWorldBounds(this.index, nodeIds) : null; }

  setAlignmentGuides(guides: { readonly x: number | null; readonly y: number | null } | null): void { setAlignmentGuides(this, guides); }
  setConnectionPreview(connector: SceneConnector | null): void { setConnectionPreview(this, connector); }
  pickTransformHandle(screenPoint: Point2d): TransformHandle | null { return pickTransformHandle(this, screenPoint); }
  setTransformPreview(result: TransformResult | null, copy = false): void { setTransformPreview(this, result, copy); }

  /** Ghost a proposal over the page; null clears. Redrawn on page and zoom changes. */
  setProposalPreview(frame: ProposalPreviewFrame | null): void {
    this.proposalFrame = frame;
    drawProposalPreview(this);
    this.requestRender();
  }

  /** Dim everything but these objects; null clears. Flow playback + tag perspectives. */
  setFocus(frame: FocusFrame | null): void {
    this.focusFrame = frame;
    drawFocus(this);
    this.requestRender();
  }

  getFocusState(): ReturnType<typeof getFocusState> { return getFocusState(this); }

  private readonly onVisibility = (): void => { if (!document.hidden) syncFlow(this); };

  // Pixi reads the pixel ratio once, at init: a window moved between a 1x and a Retina screen kept the old one (U4-05).
  private resolutionQuery: MediaQueryList | null = null;
  private watchResolution(): void {
    this.resolutionQuery?.removeEventListener('change', this.onResolutionChange);
    this.resolutionQuery = typeof matchMedia === 'function' ? matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
    this.resolutionQuery?.addEventListener('change', this.onResolutionChange);
  }
  private readonly onResolutionChange = (): void => {
    this.watchResolution();
    if (this.destroyed || !this.app.renderer) return;
    const ratio = window.devicePixelRatio || 1;
    this.app.renderer.resolution = Math.min(ratio, 2);
    this.resize();
    const text = textResolutionForZoom(this.camera.zoom, ratio);
    applyTextResolution(this.world, text);
    applyTextResolution(this.focusOverlay.content, text);
    this.requestRender();
  };

  setFreeformPreview(frame: FreeformPreviewFrame | null): void {
    if (frame) this.freeformPreview.draw(frame);
    else this.freeformPreview.clear();
    this.requestRender();
  }

  pickNodesInScreenBounds(screenBounds: Bounds2d): readonly string[] { return pickInScreenBounds(this, screenBounds, 'node'); }
  pickConnectorsInScreenBounds(screenBounds: Bounds2d): readonly string[] { return pickInScreenBounds(this, screenBounds, 'connector'); }
  setPlacementGhost(ghost: PlacementGhost | null): void { setPlacementGhost(this, ghost); }
  setMarquee(screenBounds: Bounds2d | null): void { setMarquee(this, screenBounds); }

  getViewportSize(): Size2d {
    if (!this.app.renderer) return { width: 0, height: 0 };
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  getContentBounds(nodeIds?: readonly string[]): Bounds2d | null { return getContentBounds(this, nodeIds); }
  getNodeScreenBounds(nodeId: string): DOMRect | null { return getNodeScreenBounds(this, nodeId); }
  getNodeLabelScreenBounds(nodeId: string): DOMRect | null { return getNodeLabelScreenBounds(this, nodeId); }

  resize(): void {
    if (this.destroyed || !this.app.renderer) return;
    this.app.resize();
    drawDotGrid(this);
    if (refreshViewportProjection(this)) rebuildScene(this);
    else updateLabelVisibility(this);
    this.requestRender();
  }

  renderNow(): void {
    // A lost context draws nothing; the restore asks for a frame again (handleContextRestored).
    if (this.destroyed || !this.app.renderer || contextLost(this.app)) return;
    settleCamera(this);
    const startedAt = performance.now();
    this.app.render();
    const endedAt = performance.now();
    this.lastRenderDurationMs = endedAt - startedAt;
    recordOpenCanvasRenderWork(performance, startedAt, endedAt);
    this.renderCount += 1;
  }

  getRenderDiagnostics(): PixiRenderDiagnostics { return getRenderDiagnostics(this); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.previewFrame !== null) cancelAnimationFrame(this.previewFrame);
    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);
    if (this.arrowFadeDeadline !== null) clearTimeout(this.arrowFadeDeadline);
    if (this.arrowFade !== null) cancelAnimationFrame(this.arrowFade);
    if (this.flowFrame !== null) cancelAnimationFrame(this.flowFrame);
    if (this.reveal) cancelAnimationFrame(this.reveal.frame);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resolutionQuery?.removeEventListener('change', this.onResolutionChange);
    if (this.app.renderer) {
      const canvas = this.app.canvas as HTMLCanvasElement;
      canvas.removeEventListener('webglcontextlost', this.handleContextLost);
      canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
      this.app.destroy(true, PIXI_HOST_STAGE_DESTROY_OPTIONS);
    }
    this.emitStatus('destroyed');
  }

  /** False on a read-only page (a shared view, Map mode): selection is outlined, but no handle is drawn or can be picked. */
  setEditable(editable: boolean): void {
    if (this.editable === editable) return;
    this.editable = editable;
    drawSelection(this);
    drawConnectorEditOverlay(this);
    this.requestRender();
  }

  /** While a label is edited in the DOM the Pixi copy underneath is hidden. */
  setEditingNode(nodeId: string | null): void {
    this.nodeRenderer.setEditingNode(nodeId);
    this.containerRenderer.setEditingNode(nodeId);
    this.requestRender();
  }

  setEditingConnector(connectorId: string | null): void {
    this.connectorRenderer.setEditingConnector(connectorId);
    // Connector labels are rebuilt, not toggled: redraw them now or the label
    // stays hidden until the next page/camera change.
    rebuildScene(this, false);
    this.requestRender();
  }

  /** Haloes the connector under the pointer; null clears it. */
  setHoveredConnector(connectorId: string | null): void {
    if (this.hoveredConnectorId === connectorId) return;
    this.hoveredConnectorId = connectorId;
    drawSelection(this);
    this.requestRender();
  }

  /** Outlines the shape a dragged connector end will bind to; null clears it. */
  setDropTarget(nodeId: string | null): void {
    if (this.dropTargetId === nodeId) return;
    this.dropTargetId = nodeId;
    drawSelection(this);
    this.requestRender();
  }

  /** Hovered node and connect handle; drives handle visibility, never selection. */
  setHover(nodeId: string | null, side: ConnectSide | null): void {
    if (this.hoveredNodeId === nodeId && this.hoveredSide === side) return;
    this.hoveredNodeId = nodeId;
    this.hoveredSide = side;
    drawSelection(this);
    this.requestRender();
  }

  /** The one editable connector: handles and the label editor need exactly one. */
  getSelectedConnectorId(): string | null {
    return getSelectedConnector(this)?.id ?? null;
  }

  private applyCamera(): void {
    this.world.position.set(this.camera.x, this.camera.y);
    this.world.scale.set(this.camera.zoom);
    this.focusOverlay.content.position.set(this.camera.x, this.camera.y);
    this.focusOverlay.content.scale.set(this.camera.zoom);
    drawDotGrid(this);
  }

  requestRender(): void {
    if (this.destroyed) return;
    this.renderRequests += 1;
    if (this.renderFrame !== null) {
      this.coalescedRequests += 1;
      return;
    }
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.renderNow();
    });
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.emitStatus('context-lost');
  };

  private readonly handleContextRestored = (): void => {
    this.emitStatus('ready');
    this.requestRender();
  };

  private emitStatus(status: PixiRendererStatus): void {
    this.onStatusChange?.(status);
  }
}
