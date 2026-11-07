import { Sprite, Texture, type Application } from 'pixi.js';
import type { PixiRendererHost } from './PixiRendererHost';
import type { PixiNodeRenderer } from './PixiNodeRenderer';
import type { SemanticDetailLevel } from './viewportProjection';

export interface PixiRenderDiagnostics {
  readonly renderCount: number;
  readonly renderRequests: number;
  readonly coalescedRequests: number;
  readonly lastRenderDurationMs: number;
  readonly nodeCount: number;
  readonly connectorCount: number;
  readonly renderedNodeCount: number;
  readonly renderedConnectorCount: number;
  readonly detailLevel: SemanticDetailLevel;
  readonly pendingFrame: boolean;
  readonly continuousTickerRunning: boolean;
  readonly proposalPreviewVisible: boolean;
  readonly alignmentGuidesVisible: boolean;
}

// Pixi 8 CanvasText can throw while returning pooled textures during stage-tree
// destruction across overlapping React StrictMode lifecycles. The renderer owns
// and releases GPU resources; display children can be reclaimed with the host.
export const PIXI_HOST_STAGE_DESTROY_OPTIONS = { children: false } as const;

export function abandonInitializedApplication(app: Application): void {
  app.stop();
  const canvas = app.canvas as HTMLCanvasElement;
  const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  context?.getExtension('WEBGL_lose_context')?.loseContext();
  canvas.remove();
}

/**
 * True while the browser has taken the WebGL context away (Safari does on a GPU reset or memory pressure). A draw then
 * must wait for `webglcontextrestored`: Pixi compiles a program it has not cached through `createShader`, which returns
 * null on a lost context, and `shaderSource(null)` throws.
 */
export function contextLost(app: Application): boolean {
  const gl = (app.renderer as { gl?: WebGLRenderingContext | WebGL2RenderingContext } | undefined)?.gl;
  return gl?.isContextLost() ?? false;
}

export function warmShader(h: PixiRendererHost): void {
  if (contextLost(h.app)) return;
  // The first draw of a node compiles and links Pixi's batch shader (seconds under software GL) inside the frame that shows it,
  // holding the label editor back. Draw one pixel now, while nothing waits, so that frame finds the program ready.
  const warm = new Sprite(Texture.WHITE);
  warm.setSize(1, 1);
  h.app.stage.addChild(warm);
  h.app.render();
  warm.destroy();
}

export function assembleStage(h: PixiRendererHost): void {
  h.world.addChild(
    h.precisionGrid,
    h.containerRenderer.graphics,
    h.nodeRenderer.backdrop,
    h.connectorRenderer.container,
    h.nodeRenderer.graphics,
    h.nodeRenderer.media,
    h.nodeRenderer.labels,
    // Frame and section names stay readable over everything, a frame in front included, as Figma's do (owner, #92).
    // The SVG export paints each name with its frame instead, so a covered one is hidden there.
    h.containerRenderer.labels,
    h.selectionOverlay.graphics,
    h.transformOverlay.graphics,
    h.freeformPreview.graphics,
    h.placementGhost,
    h.connectorEditOverlay.graphics,
    h.connectionPreview.container,
    h.alignmentGuides
  );
  if (h.livePreview) h.world.addChild(h.livePreview.container);
  h.world.addChild(h.proposalPreview.container);
  // The veil dims the page; the focused objects sit above it, in their own layer that follows the camera like the world.
  h.app.stage.addChild(h.dotGrid.graphics, h.world, h.focusOverlay.veil, h.focusOverlay.content, h.marquee);
}

export function getNodeDebugSnapshot(h: PixiRendererHost): ReturnType<PixiNodeRenderer['getDebugSnapshot']> {
  const recordsById = new Map(
    [...h.nodeRenderer.getDebugSnapshot(), ...h.containerRenderer.getDebugSnapshot()].map(
      (record) => [record.id, record]
    )
  );
  return (
    h.page?.nodes.flatMap((node) => {
      const record = recordsById.get(node.id);
      return record ? [record] : [];
    }) ?? []
  );
}

export function getRenderDiagnostics(h: PixiRendererHost): PixiRenderDiagnostics {
  const renderedNodeCount = h.viewportProjection?.nodeIds?.size ?? h.page?.nodes.length ?? 0;
  const renderedConnectorCount = h.viewportProjection?.connectorIds?.size
    ?? h.page?.connectors.length ?? 0;
  return { renderCount: h.renderCount, renderRequests: h.renderRequests,
    coalescedRequests: h.coalescedRequests, lastRenderDurationMs: h.lastRenderDurationMs,
    nodeCount: h.page?.nodes.length ?? 0, connectorCount: h.page?.connectors.length ?? 0,
    renderedNodeCount, renderedConnectorCount,
    detailLevel: h.viewportProjection?.detailLevel ?? 'full',
    pendingFrame: h.renderFrame !== null, continuousTickerRunning: h.app.ticker.started,
    proposalPreviewVisible: h.proposalPreview.container.visible,
    alignmentGuidesVisible: h.alignmentGuidesShown };
}
