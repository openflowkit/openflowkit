import { renderHook } from '@testing-library/react';
import type { WheelEvent as ReactWheelEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useV2CanvasWheel } from './useV2CanvasWheel';

describe('useV2CanvasWheel', () => {
  const setup = () => {
    const section = document.createElement('section');
    const canvas = section.appendChild(document.createElement('canvas'));
    const pin = section.appendChild(document.createElement('button'));
    pin.className = 'ofk-comment-pin';
    const field = section.appendChild(document.createElement('textarea'));
    const updateCamera = vi.fn();
    const { result } = renderHook(() => useV2CanvasWheel({ current: section }, { current: { x: 0, y: 0, zoom: 1 } }, updateCamera));
    const wheel = (target: Element) => result.current({
      target, currentTarget: section, deltaX: 0, deltaY: 40, deltaMode: 0, ctrlKey: false, metaKey: false, clientX: 0, clientY: 0,
    } as unknown as ReactWheelEvent<HTMLElement>);
    return { canvas, pin, field, updateCamera, wheel };
  };

  it('pans over the canvas and over a comment pin (a trackpad pan does not stall on one), not over a field', () => {
    const { canvas, pin, field, updateCamera, wheel } = setup();
    wheel(canvas);
    wheel(pin.appendChild(document.createElement('span')));
    expect(updateCamera).toHaveBeenCalledTimes(2);
    wheel(field);
    expect(updateCamera).toHaveBeenCalledTimes(2);
  });
});
