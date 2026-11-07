import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  fitCameraToBounds,
  zoomCameraAt,
  DEFAULT_CANVAS_CAMERA,
  DEFAULT_CAMERA_LIMITS,
} from '../../domain/camera/camera';
import { readableLanding, type LandingDirection } from '../../domain/camera/readableLanding';
import { foundation } from '../design-system/tokens';
import { clearance } from './map/mapMode';
import type { CanvasCamera } from '../../domain/camera/types';
import type { Bounds2d, Point2d } from '../../domain/geometry/types';
import type { SceneDocumentV1 } from '../../domain/document/types';
import type { PixiRendererStatus } from '../../infrastructure/pixi/PixiRendererHost';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';

/** The closest a landing ever zooms; drill-down uses the same ceiling. */
const LANDING_MAX_ZOOM = 1.4;
/** Breathing room inside the free canvas, which already keeps 8px off the chrome. */
const FIT_PADDING = 32;
/** Room above a fitted selection for its context bar (drawn 104px above it, never above y 80), so the bar never lands on it. */
const CONTEXT_BAR_ROOM = 80;

// Camera per I-12: wheel/trackpad pan-zoom anchored at the pointer, fit,
// Space-pan (owned by the keyboard hook), zoom to 100%. Canvas zoom is
// independent of browser zoom (I-32).
/** Screen px a comment pin's marker takes around its tip: the 30px `.ofk-comment-pin` in v2EditorPage.css plus its outline and the room to hover. */
const PIN_MARKER = { halfWidth: 20, above: 64, below: 8 };

export function useV2Camera(hostRef: RefObject<PixiRendererHost | null>) {
  // The ref feeds gesture math mid-drag; the state re-renders screen-anchored
  // overlays (text editor, context bar) so they track pan and zoom.
  const cameraRef = useRef<CanvasCamera>(DEFAULT_CANVAS_CAMERA);
  const fittedRef = useRef<string | null>(null);
  // A landing asked for before the renderer has a size; any other camera move or a document switch drops it.
  const pendingLandingRef = useRef<{ direction: LandingDirection; nodeIds?: readonly string[] } | null>(null);
  const statusRef = useRef<PixiRendererStatus | null>(null);
  const docRef = useRef<string | undefined>(undefined);
  const frameRef = useRef<number | null>(null);
  const glideRef = useRef<number | null>(null);
  const glidingRef = useRef(false);
  const [camera, setCamera] = useState<CanvasCamera>(DEFAULT_CANVAS_CAMERA);
  // Things drawn over the canvas by world position (comment pins) follow the camera in the frame it moves, not after React settles.
  const listeners = useRef(new Set<() => void>());
  const subscribe = useCallback((listener: () => void) => { listeners.current.add(listener); return () => { listeners.current.delete(listener); }; }, []);
  const notify = () => { for (const listener of listeners.current) listener(); };

  // Ref and renderer update per input event; the React state (which
  // re-renders the whole page) settles once per animation frame so a real
  // mouse/trackpad at 120–1000 events/s cannot starve the frame.
  const updateCamera = useCallback(
    (next: CanvasCamera) => {
      if (glidingRef.current) stopGlide();
      pendingLandingRef.current = null;
      cameraRef.current = next;
      hostRef.current?.setCamera(next);
      notify();
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setCamera(cameraRef.current);
      });
    },
    // stopGlide is a stable ref-based function; keeping it out avoids rotating
    // the identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostRef]
  );

  const stopGlide = useCallback(() => {
    if (glideRef.current !== null) cancelAnimationFrame(glideRef.current);
    glideRef.current = null;
    glidingRef.current = false;
  }, []);

  /** Frames update directly (one rAF, no per-frame React render). */
  const applyGlideFrame = useCallback((next: CanvasCamera) => {
    cameraRef.current = next;
    hostRef.current?.setCamera(next);
    notify();
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setCamera(cameraRef.current);
    });
  }, [hostRef]);

  /** Navigation motion: a short glide the user can interrupt by touching the canvas. */
  const animateTo = useCallback((destination: CanvasCamera, durationMs = foundation.motion.camera) => {
    stopGlide();
    pendingLandingRef.current = null;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = { ...cameraRef.current };
    if (reduced || durationMs <= 0) {
      applyGlideFrame(destination);
      return;
    }
    const startedAt = performance.now();
    glidingRef.current = true;
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      applyGlideFrame({
        x: start.x + (destination.x - start.x) * eased,
        y: start.y + (destination.y - start.y) * eased,
        zoom: start.zoom + (destination.zoom - start.zoom) * eased,
      });
      if (t < 1) glideRef.current = requestAnimationFrame(step);
      else { glideRef.current = null; glidingRef.current = false; }
    };
    glideRef.current = requestAnimationFrame(step);
  }, [applyGlideFrame, stopGlide]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (glideRef.current !== null) cancelAnimationFrame(glideRef.current);
  }, []);

  const viewportCenter = useCallback(() => {
    const size = hostRef.current?.getViewportSize() ?? { width: 800, height: 600 };
    return { x: size.width / 2, y: size.height / 2 };
  }, [hostRef]);

  /**
   * The camera that frames `bounds` in the canvas the side panels and the floating chrome (tool rail, workspace rail,
   * document bar, view controls) leave free, and that free region. A phone, where they cover most of it, gets the whole viewport.
   */
  const fitInto = useCallback((bounds: Bounds2d, padding = FIT_PADDING, maxZoom = DEFAULT_CAMERA_LIMITS.maxZoom, reserveTop = 0) => {
    const area = clearance(hostRef.current!);
    const free = area.height - reserveTop >= area.height / 2 ? { ...area, top: area.top + reserveTop, height: area.height - reserveTop } : area;
    const fitted = fitCameraToBounds(bounds, { width: free.width, height: free.height }, padding, { ...DEFAULT_CAMERA_LIMITS, maxZoom });
    return { camera: { ...fitted, x: fitted.x + free.left, y: fitted.y + free.top }, free };
  }, [hostRef]);

  /** Drill-down / flow camera: frame the nodes without zooming in past readability. */
  const glideToNodes = useCallback((nodeIds: readonly string[], padding = FIT_PADDING + 32) => {
    const host = hostRef.current;
    const bounds = host?.getContentBounds(nodeIds);
    if (!host || !bounds) return;
    animateTo(fitInto(bounds, padding, LANDING_MAX_ZOOM).camera);
  }, [animateTo, hostRef, fitInto]);

  /**
   * On open, or after the assistant draws: the fit when readable, else a readable zoom on the start of
   * `nodeIds` (all content when absent). Never past LANDING_MAX_ZOOM: a two-box diagram is not a close-up.
   * True when it zoomed in.
   */
  const landReadable = useCallback((direction: LandingDirection, nodeIds?: readonly string[]) => {
    const bounds = hostRef.current?.getContentBounds(nodeIds);
    if (!bounds) return false;
    // A template generates while WebGL is still starting: fitting a 0×0 viewport lands at the floor zoom, jammed at
    // the top. The landing waits for the renderer instead (fitOnOpen runs it when the host turns ready).
    const size = hostRef.current!.getViewportSize();
    if (size.width <= 0 || size.height <= 0) {
      pendingLandingRef.current = { direction, ...(nodeIds ? { nodeIds } : {}) };
      return false;
    }
    pendingLandingRef.current = null;
    // Landing on given nodes (a generated frame, the assistant's edit) leaves room above them for the bar their selection shows.
    const { camera: fitted, free } = fitInto(bounds, FIT_PADDING, LANDING_MAX_ZOOM, nodeIds?.length ? CONTEXT_BAR_ROOM : 0);
    const landing = readableLanding(bounds, { width: free.width, height: free.height }, direction, FIT_PADDING,
      { ...DEFAULT_CAMERA_LIMITS, maxZoom: LANDING_MAX_ZOOM });
    updateCamera(landing.zoomedIn ? { ...landing.camera, x: landing.camera.x + free.left, y: landing.camera.y + free.top } : fitted);
    return landing.zoomedIn;
  }, [hostRef, updateCamera, fitInto]);

  /** Fit all content, or `nodeIds` (a selection, a generated frame) with room above them for the bar that selection shows. */
  const fitView = useCallback((nodeIds?: readonly string[]) => {
    const bounds = hostRef.current?.getContentBounds(nodeIds);
    if (!bounds) return;
    updateCamera(fitInto(bounds, FIT_PADDING, DEFAULT_CAMERA_LIMITS.maxZoom, nodeIds?.length ? CONTEXT_BAR_ROOM : 0).camera);
  }, [hostRef, updateCamera, fitInto]);

  /** Whether `bounds` is fully on screen, beside any open panel. */
  const inView = useCallback((bounds: Bounds2d) => {
    const { free } = fitInto(bounds);
    const { x, y, zoom } = cameraRef.current;
    return bounds.x * zoom + x >= free.left && (bounds.x + bounds.width) * zoom + x <= free.left + free.width
      && bounds.y * zoom + y >= free.top && (bounds.y + bounds.height) * zoom + y <= free.top + free.height;
  }, [fitInto]);

  /** Brings `bounds` into view, and leaves the camera alone when it is already fully visible. */
  const revealBounds = useCallback((bounds: Bounds2d) => {
    if (hostRef.current && !inView(bounds)) updateCamera(fitInto(bounds).camera);
  }, [hostRef, updateCamera, fitInto, inView]);

  /**
   * A comment pin (its tip is `point`, the marker stands above it): left alone when the marker is fully on screen, else glided to
   * the middle of the free canvas at the current zoom, held between 50% and 200% so it never lands on a blur or a close-up.
   */
  const revealPin = useCallback((point: Point2d) => {
    if (!hostRef.current) return;
    const { zoom } = cameraRef.current;
    const { halfWidth, above, below } = PIN_MARKER;
    const bounds = { x: point.x - halfWidth / zoom, y: point.y - above / zoom, width: 2 * halfWidth / zoom, height: (above + below) / zoom };
    if (!inView(bounds)) animateTo(fitInto(bounds, FIT_PADDING, Math.min(2, Math.max(0.5, zoom))).camera);
  }, [hostRef, animateTo, fitInto, inView]);

  /** A Layers row: glides `nodeIds` to the middle at the current zoom when any of them is off screen, zooming out only if they do not fit. */
  const revealNodes = useCallback((nodeIds: readonly string[]) => {
    const bounds = hostRef.current?.getContentBounds(nodeIds);
    if (bounds && !inView(bounds)) animateTo(fitInto(bounds, FIT_PADDING, cameraRef.current.zoom).camera);
  }, [hostRef, animateTo, fitInto, inView]);

  /**
   * An agent's edit: left alone when it is already on screen, else landed like the assistant's (readable,
   * at its start). A plain fit put a wide diagram at 40%, below the zoom where labels draw. True when it zoomed in.
   */
  const revealReadable = useCallback((direction: LandingDirection, nodeIds: readonly string[]) => {
    const bounds = hostRef.current?.getContentBounds(nodeIds);
    return bounds && !inView(bounds) ? landReadable(direction, nodeIds) : false;
  }, [hostRef, inView, landReadable]);

  /**
   * `revealReadable` once the host has drawn `nodeIds`: an agent's edit reaches the renderer a frame or more after
   * it is applied, and a reveal with no bounds yet did nothing. Gives up after half a second.
   */
  const revealWhenDrawn = useCallback((direction: LandingDirection, nodeIds: readonly string[], onZoomedIn: () => void) => {
    let frames = 0;
    const attempt = () => {
      if (hostRef.current?.getContentBounds(nodeIds)) { if (revealReadable(direction, nodeIds)) onZoomedIn(); return; }
      if (++frames < 30) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }, [hostRef, revealReadable]);

  const zoomStep = useCallback(
    (factor: number) => {
      updateCamera(zoomCameraAt(cameraRef.current, viewportCenter(), cameraRef.current.zoom * factor));
    },
    [updateCamera, viewportCenter]
  );

  const zoomTo = useCallback(
    (percent: number) => {
      updateCamera(zoomCameraAt(cameraRef.current, viewportCenter(), percent / 100));
    },
    [updateCamera, viewportCenter]
  );
  const resetZoom = useCallback(() => zoomTo(100), [zoomTo]);

  // First open of a non-empty doc lands fitted, or readable when the fit would be too small, (I-32), including after
  // a reload. Empty docs keep the default camera; later edits never hijack
  // it. The host receives the page just after reporting ready, so a missing
  // content bounds means "not yet" rather than "empty": only auto-fit while
  // the session is still pristine (revision 0 — undo/redo advance it, so it
  // never returns to 0 after an edit).
  const fitOnOpen = useCallback(
    (
      status: PixiRendererStatus,
      document: SceneDocumentV1 | null,
      docId: string | undefined,
      revision: number,
      direction: LandingDirection,
      /** Map is up: the host draws the map, so its bounds are the map's, and Map lands its own camera. */
      mapActive = false
    ) => {
      if (docRef.current !== undefined && docId !== docRef.current) pendingLandingRef.current = null;
      docRef.current = docId;
      const becameReady = status === 'ready' && statusRef.current !== 'ready';
      statusRef.current = status;
      // Only the ready transition runs a waiting landing (a later call is an edit); a viewport still 0×0 then is
      // retried for a second of frames.
      const flush = (frames: number) => {
        const pending = pendingLandingRef.current;
        if (!pending) return;
        landReadable(pending.direction, pending.nodeIds);
        if (!pendingLandingRef.current) return;
        if (frames > 0) requestAnimationFrame(() => flush(frames - 1));
        else pendingLandingRef.current = null;
      };
      if (becameReady) flush(60);
      if (status !== 'ready' || !document || fittedRef.current === docId) return;
      if (revision !== 0) {
        fittedRef.current = docId ?? null;
        return;
      }
      if (!hostRef.current?.getContentBounds()) return;
      fittedRef.current = docId ?? null;
      // A document opened in Map: landing here would re-frame the map's scene a moment after Map framed it (leaving
      // Map fits Canvas itself), so the open counts as done.
      if (mapActive) return;
      landReadable(direction);
    },
    [landReadable, hostRef]
  );

  const resetFit = useCallback(() => {
    fittedRef.current = null;
  }, []);

  return {
    cameraRef,
    subscribe,
    camera,
    zoom: Math.round(camera.zoom * 100),
    updateCamera,
    animateTo,
    glideToNodes,
    revealWhenDrawn,
    fitView,
    landReadable,
    revealBounds,
    revealNodes,
    revealPin,
    revealReadable,
    zoomStep,
    zoomTo,
    resetZoom,
    fitOnOpen,
    resetFit,
  };
}
