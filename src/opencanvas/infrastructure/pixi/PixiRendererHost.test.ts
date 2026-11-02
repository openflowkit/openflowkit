import { describe, expect, it, vi } from 'vitest';
import { PIXI_HOST_STAGE_DESTROY_OPTIONS, PixiRendererHost } from './PixiRendererHost';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';

describe('Pixi renderer host lifecycle', () => {
  it('does not recursively destroy pooled CanvasText children during teardown', () => {
    expect(PIXI_HOST_STAGE_DESTROY_OPTIONS).toEqual({ children: false });
  });

  it('allows idempotent teardown before asynchronous renderer initialization', () => {
    const statuses: string[] = [];
    const host = new PixiRendererHost({ onStatusChange: (status) => statuses.push(status) });

    expect(() => host.destroy()).not.toThrow();
    expect(() => host.destroy()).not.toThrow();
    expect(statuses).toEqual(['destroyed']);
  });

  it('ignores resize before initialization', () => {
    const host = new PixiRendererHost();
    expect(() => host.resize()).not.toThrow();
    expect(host.getViewportSize()).toEqual({ width: 0, height: 0 });
    host.destroy();
  });

  it('preserves valid selection synchronously when a document commit replaces the page', () => {
    const host = new PixiRendererHost();
    const node = createTestNode('selected');
    host.setPage(createTestDocument({ nodes: [node] }).pages[0]);
    host.setSelection([node.id], node.id);

    const moved = {
      ...node,
      transform: { ...node.transform, translation: { x: 10, y: 5 } },
    };
    host.setPage(createTestDocument({ nodes: [moved] }).pages[0]);

    // Default camera is (64, 64, 1); south-east handle follows committed geometry.
    expect(host.pickTransformHandle({ x: 174, y: 119 })).toBe('south-east');
    host.destroy();
  });

  // Safari, 2026-10-26: a frame on a lost context compiled the shape shader through createShader, which returns null
  // then, and shaderSource(null) threw "Argument 1 ('shader') … must be an instance of WebGLShader".
  it('draws no frame while the WebGL context is lost, and draws again once it is back', () => {
    const host = new PixiRendererHost();
    let lost = true;
    const render = vi.fn();
    Object.defineProperty(host.app, 'renderer', { configurable: true, value: { gl: { isContextLost: () => lost } } });
    Object.defineProperty(host.app, 'render', { configurable: true, value: render });
    host.renderNow();
    expect(render).not.toHaveBeenCalled();
    lost = false;
    host.renderNow();
    expect(render).toHaveBeenCalledTimes(1);
    Object.defineProperty(host.app, 'renderer', { configurable: true, value: undefined });
    host.destroy();
  });

  it('ends the arrow fade on time when no frame comes (a busy software GPU), so nothing waits on it forever', () => {
    vi.useFakeTimers();
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1); // frames never come
    const host = new PixiRendererHost();
    // A move needs a WebGL renderer to start; the fade only needs the host to think one ran.
    (host as unknown as { motionActive: boolean }).motionActive = true;
    host.endMotion();
    expect(host.getMotionState()).toMatchObject({ fading: true, arrowAlpha: 0 });
    vi.advanceTimersByTime(400);
    expect(host.getMotionState()).toMatchObject({ fading: false, arrowAlpha: 1 });
    host.destroy();
    frames.mockRestore();
    vi.useRealTimers();
  });

  // Review 2 #8: a reveal kept drawing its own copy of the shapes over Map's move, and over a drag (a ghost for ≤700 ms).
  it('a Map motion frame or a transform drag ends a running reveal at once, shapes whole', () => {
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
    const host = new PixiRendererHost();
    const node = createTestNode('n');
    host.setPage(createTestDocument({ nodes: [node] }).pages[0]);
    // A reveal needs a WebGL renderer to start; ending one only needs the host to think one runs.
    const fakeReveal = () => ({ plan: { groups: [], durationMs: 500, trail: [], bounds: { x: 0, y: 0, width: 1, height: 1 } }, nodes: new Set(['n']), connectors: new Set(), t0: 0, frame: 1 });
    (host as unknown as { reveal: unknown }).reveal = fakeReveal();
    host.drawMotionFrame({} as Parameters<PixiRendererHost['drawMotionFrame']>[0]);
    expect(host.getRevealState()).toMatchObject({ active: false, cut: 0 });
    (host as unknown as { reveal: unknown }).reveal = fakeReveal();
    host.setTransformPreview({ nodes: [], bounds: { x: 0, y: 0, width: 1, height: 1 } } as unknown as Parameters<PixiRendererHost['setTransformPreview']>[0]);
    expect(host.getRevealState()).toMatchObject({ active: false, cut: 0 });
    host.destroy();
    frames.mockRestore();
  });

  // Found 2026-10-11 (U4-05): moving the window to a Retina screen left the canvas drawn at 1x until a reload.
  it('follows a device pixel ratio change: renderer resolution, size and text resolution', () => {
    const listeners: Array<() => void> = [];
    const queries: string[] = [];
    vi.stubGlobal('matchMedia', (query: string) => {
      queries.push(query);
      return { matches: false, addEventListener: (_: string, listener: () => void) => listeners.push(listener), removeEventListener: vi.fn() };
    });
    vi.stubGlobal('devicePixelRatio', 1);
    const host = new PixiRendererHost();
    const renderer = { resolution: 1 };
    (host as unknown as { app: { renderer: unknown } }).app.renderer = renderer;
    const resize = vi.spyOn(host, 'resize').mockImplementation(() => undefined);
    (host as unknown as { watchResolution(): void }).watchResolution();
    expect(queries.at(-1)).toBe('(resolution: 1dppx)');
    vi.stubGlobal('devicePixelRatio', 2);
    listeners.at(-1)!();
    expect(renderer.resolution).toBe(2);
    expect(resize).toHaveBeenCalledOnce();
    expect(queries.at(-1)).toBe('(resolution: 2dppx)');
    (host as unknown as { app: { renderer: unknown } }).app.renderer = undefined;
    host.destroy();
    vi.unstubAllGlobals();
  });
});
