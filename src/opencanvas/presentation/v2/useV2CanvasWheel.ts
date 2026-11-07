import { useEffect, useRef, type RefObject, type WheelEvent as ReactWheelEvent } from 'react';
import { normalizeWheelDelta, panCamera, zoomCameraAt } from '../../domain/camera/camera';
import type { CanvasCamera } from '../../domain/camera/types';
import type { Point2d } from '../../domain/geometry/types';

// Browser zoom never leaks from the editor: plain wheel over the canvas
// pans, ⌘/Ctrl+wheel (pinch) anywhere in the editor is ours, and Safari's
// proprietary gesture events (trackpad pinch) zoom at the pointer too.
/** A plain wheel pans over the canvas itself and over a comment pin on it, so a trackpad pan does not stall when it crosses one. */
const pansCanvas = (target: EventTarget | null): boolean =>
  target instanceof HTMLCanvasElement || (target instanceof Element && target.closest('.ofk-comment-pin') !== null);

export function useV2CanvasWheel(
  sectionRef: RefObject<HTMLElement | null>,
  cameraRef: RefObject<CanvasCamera>,
  updateCamera: (camera: CanvasCamera) => void,
): (event: ReactWheelEvent<HTMLElement>) => void {
  // Safari trackpad pinch: gesturestart anchors, gesturechange scales from it.
  const pinchRef = useRef<{ zoom: number; anchor: Point2d } | null>(null);
  useEffect(() => {
    const root = sectionRef.current?.closest<HTMLElement>('.ofk-v2');
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || pansCanvas(event.target)) event.preventDefault();
    };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      const gesture = event as unknown as { scale?: unknown; clientX?: unknown; clientY?: unknown };
      const bounds = sectionRef.current?.getBoundingClientRect();
      const anchor = bounds && Number.isFinite(gesture.clientX) && Number.isFinite(gesture.clientY)
        ? { x: (gesture.clientX as number) - bounds.left, y: (gesture.clientY as number) - bounds.top }
        : { x: bounds ? bounds.width / 2 : 0, y: bounds ? bounds.height / 2 : 0 };
      pinchRef.current = { zoom: cameraRef.current.zoom, anchor };
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const started = pinchRef.current;
      const scale = (event as unknown as { scale?: unknown }).scale;
      if (!started || typeof scale !== 'number' || !(scale > 0)) return;
      updateCamera(zoomCameraAt(cameraRef.current, started.anchor, started.zoom * scale));
    };
    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      pinchRef.current = null;
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('gesturestart', onGestureStart);
    root.addEventListener('gesturechange', onGestureChange);
    root.addEventListener('gestureend', onGestureEnd);
    return () => {
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('gesturestart', onGestureStart);
      root.removeEventListener('gesturechange', onGestureChange);
      root.removeEventListener('gestureend', onGestureEnd);
    };
  }, [sectionRef, cameraRef, updateCamera]);
  // I-12: wheel/trackpad pans; ⌘/Ctrl+wheel (and pinch, which browsers
  // report as ctrlKey) zooms at the pointer — the Figma/tldraw convention.
  return function handleWheel(event: ReactWheelEvent<HTMLElement>): void {
    const camera = cameraRef.current;
    if (!event.ctrlKey && !event.metaKey) {
      if (pansCanvas(event.target)) {
        const bounds = event.currentTarget.getBoundingClientRect();
        const delta = normalizeWheelDelta(event, { width: bounds.width, height: bounds.height });
        updateCamera(panCamera(camera, { x: -delta.x, y: -delta.y }));
      }
      return;
    }
    // Pinch/⌘-wheel zooms from anywhere over the canvas area, including the
    // floating context bar; the browser-zoom listener above already swallowed it.

    const bounds = event.currentTarget.getBoundingClientRect();
    updateCamera(zoomCameraAt(
      camera,
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      camera.zoom * Math.exp(-event.deltaY * 0.01)
    ));
  };
}
