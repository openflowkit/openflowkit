import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { addThread } from '../../domain/threads/threads';
import { useV2Threads } from './useV2Threads';

const human = { kind: 'human' as const, name: 'User' };
const base = createTestDocument({ nodes: [createTestNode('a')] });
const document = addThread(base, { pageId: base.pages[0]!.id, threadId: 't1', nodeId: null, point: { x: 1, y: 1 },
  comment: { id: 'm1', author: human, body: 'hello', createdAt: '2026-10-26T12:00:00.000Z' } });
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

describe('opening a thread from the panel while the editor is in Map', () => {
  // `map` is a new object every render, as the editor's hook returns it.
  const setup = (choose: (mode: 'canvas') => void) => {
    const input = (mapActive: boolean, rendererReady: boolean) => ({
      session: { document, updateThreads: vi.fn() }, page: document.pages[0]!, setActivePageId: vi.fn(),
      panels: { openWorkspace: vi.fn(), toggleWorkspace: vi.fn() }, camera: { revealPin: vi.fn() }, rendererReady,
      map: { active: mapActive, choose }, lockedMapPageId: null,
      preferences: { threadsShowResolved: false, threadsUnansweredOnly: false, threadReads: {} },
      updatePreferences: vi.fn(), pushToast: vi.fn(), readOnly: false,
    }) as never;
    return renderHook((props: { map: boolean; ready: boolean }) => useV2Threads(input(props.map, props.ready)), {
      wrapper, initialProps: { map: true, ready: false },
    });
  };

  it('leaves Map once, however often the editor renders before the canvas is ready', () => {
    const choose = vi.fn();
    const hook = setup(choose);
    act(() => { hook.result.current.select('t1'); });
    for (let render = 0; render < 5; render += 1) hook.rerender({ map: true, ready: false });
    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledWith('canvas');
  });

  it('lets the user go back to Map: the request is over, and Map is not left again', () => {
    const choose = vi.fn();
    const hook = setup(choose);
    act(() => { hook.result.current.select('t1'); });
    hook.rerender({ map: false, ready: false });
    hook.rerender({ map: true, ready: false });
    hook.rerender({ map: true, ready: true });
    hook.rerender({ map: false, ready: true });
    expect(choose).toHaveBeenCalledTimes(1);
    expect(hook.result.current.commentProps.request).toBeNull();
  });
});
