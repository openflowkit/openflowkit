import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpCapabilities } from '../../../agent/ops/types';
import { createTestDocument } from '../../testing/builders/documentBuilder';
import {
  agentDid, bridgeTabId, ELSEWHERE, pause, portTaken, stillWaiting, TAKEN, useV2AgentBridge, WAITING, type V2AgentBridgeOptions,
} from './useV2AgentBridge';

/** Web Locks as the browser runs them, for two hooks standing in for two tabs: try, queue, steal (the holder's request rejects). */
function fakeLocks() {
  let holder: object | null = null;
  const queue: (() => void)[] = [];
  const grant = (callback: LockGrantedCallback, resolve: (value: unknown) => void, reject: (error: unknown) => void, me: object) => {
    holder = me;
    const release = () => { if (holder === me) { holder = null; queue.shift()?.(); } };
    Promise.resolve(callback({ name: 'ofk-agent-bridge', mode: 'exclusive' } as Lock)).then(
      (value) => { release(); resolve(value); },
      (error: unknown) => { release(); reject(error); },
    );
  };
  const steals = new Map<object, (error: unknown) => void>();
  const locks = {
    request: (_name: string, options: LockOptions, callback: LockGrantedCallback) => new Promise((resolve, reject) => {
      const me = {};
      steals.set(me, reject);
      if (options.steal) {
        if (holder) steals.get(holder)?.(new DOMException('stolen', 'AbortError'));
        grant(callback, resolve, reject, me);
      } else if (!holder) grant(callback, resolve, reject, me);
      else if (options.ifAvailable) Promise.resolve(callback(null)).then(resolve, reject);
      else {
        const entry = () => grant(callback, resolve, reject, me);
        queue.push(entry);
        options.signal?.addEventListener('abort', () => {
          const at = queue.indexOf(entry);
          if (at >= 0) { queue.splice(at, 1); reject(new DOMException('aborted', 'AbortError')); }
        });
      }
    }),
  };
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
}

/** The hook as a second tab runs it: its own module, so its own tab id and lock bookkeeping. */
async function anotherTab(): Promise<typeof useV2AgentBridge> {
  vi.resetModules();
  return (await import('./useV2AgentBridge')).useV2AgentBridge;
}

// The bridge starts when a window reloads with the agent still enabled, which is before the document loads.
describe('useV2AgentBridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'locks');
  });

  it('tells the server about a document that loads after the bridge started', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const { pathname, searchParams } = new URL(url);
      calls.push(`${init?.method ?? 'GET'} ${pathname} token=${searchParams.get('token')}`);
      if (pathname === '/next') {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    }));
    const base: V2AgentBridgeOptions = {
      enabled: true, port: 43119, token: 'secret', document: null, pageId: null, revision: 0,
      capabilities: {} as OpCapabilities, commit: vi.fn(), onActivity: vi.fn(),
    };
    const { rerender, unmount } = renderHook((options: V2AgentBridgeOptions) => useV2AgentBridge(options), { initialProps: base });
    await waitFor(() => expect(calls.some((call) => call.startsWith('GET /health'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    // No poll before this tab's hello: a server another tab said hello to would refuse it (409) and idle this tab.
    expect(calls.filter((call) => !call.startsWith('GET /health'))).toEqual([]);

    rerender({ ...base, document: createTestDocument(), pageId: 'page-1', revision: 1 });
    await waitFor(() => expect(calls).toContain('POST /hello token=secret'));
    await waitFor(() => expect(calls.some((call) => call.startsWith('GET /next'))).toBe(true));
    expect(calls.findIndex((call) => call.startsWith('POST /hello'))).toBeLessThan(calls.findIndex((call) => call.startsWith('GET /next')));
    // The token travels in the query: a custom header would make every call a CORS preflight. The probe carries none.
    expect(calls.filter((call) => !call.startsWith('GET /health')).every((call) => call.endsWith('token=secret'))).toBe(true);
    expect(calls.filter((call) => call.startsWith('GET /health')).every((call) => call.endsWith('token=null'))).toBe(true);
    unmount();
  });

  const parkedNext = (url: string, init?: RequestInit) => new URL(url).pathname === '/next'
    ? new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    : null;
  const options: V2AgentBridgeOptions = {
    enabled: true, port: 43119, token: '', document: createTestDocument(), pageId: 'page-1', revision: 1,
    capabilities: {} as OpCapabilities, commit: vi.fn(), onActivity: vi.fn(),
  };

  it('a hello the server refuses is a failure, whatever the status', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => parkedNext(url, init) ?? Promise.resolve(new Response('{}', { status: 500 }))));
    const { result, unmount } = renderHook(() => useV2AgentBridge(options));
    await waitFor(() => expect(result.current).toMatchObject({ status: 'error', detail: 'The agent bridge answered 500.' }));
    unmount();
  });

  it('nothing listening is waiting, not an error, and a retry never flickers back to connecting', async () => {
    let hellos = 0;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (new URL(url).pathname === '/health') hellos += 1;
      // A real refused connection takes a moment, long enough for React to paint what came before it.
      return new Promise<Response>((_, reject) => setTimeout(() => reject(new TypeError('Failed to fetch')), 20));
    }));
    const seen: string[] = [];
    const { result, unmount } = renderHook(() => {
      const bridge = useV2AgentBridge(options);
      seen.push(bridge.status);
      return bridge;
    });
    await waitFor(() => expect(hellos).toBeGreaterThanOrEqual(2), { timeout: 4000 });
    expect(result.current).toMatchObject({ status: 'waiting', detail: WAITING });
    expect(seen).not.toContain('error');
    expect(seen.slice(seen.indexOf('waiting'))).not.toContain('connecting');
    unmount();
  });

  it('after 30 s of waiting it retries every 5 s and says what to check', async () => {
    const start = Date.now();
    let hellos = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      hellos += 1;
      return Promise.reject(new TypeError('Failed to fetch'));
    }));
    const now = vi.spyOn(Date, 'now');
    const timeout = vi.spyOn(window, 'setTimeout');
    const { result, unmount } = renderHook(() => useV2AgentBridge(options));
    await waitFor(() => expect(result.current.detail).toBe(WAITING));
    now.mockReturnValue(start + 31_000);
    await waitFor(() => expect(result.current.detail).toBe(stillWaiting(43119)), { timeout: 4000 });
    expect(result.current.status).toBe('waiting');
    expect(timeout.mock.calls.some(([, ms]) => ms === 5000)).toBe(true);
    expect(hellos).toBeGreaterThanOrEqual(2);
    unmount();
  });

  it('a server that is not the bridge holding the port is a real failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('not found', { status: 404 }))));
    const { result, unmount } = renderHook(() => useV2AgentBridge(options));
    await waitFor(() => expect(result.current).toMatchObject({ status: 'error', detail: portTaken(43119) }));
    unmount();
  });

  it('a poll answered 409 (another tab said hello last) stops polling until this tab is claimed again', async () => {
    const calls: string[] = [];
    let taken = true;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const { pathname, searchParams } = new URL(url);
      calls.push(`${pathname} tab=${searchParams.get('tab')}`);
      if (pathname === '/next' && taken) return Promise.resolve(new Response('{}', { status: 409 }));
      return parkedNext(url, init) ?? Promise.resolve(new Response('{}', { status: 200 }));
    }));
    const { result, unmount } = renderHook(() => useV2AgentBridge(options));
    // Not "Connect is on in another tab": that tab may be in another browser.
    await waitFor(() => expect(result.current).toMatchObject({ status: 'elsewhere', detail: TAKEN }));
    const stopped = calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(calls).toHaveLength(stopped);
    // Every bridge request names this tab, so the server can tell it from another (the token-free probe is not one).
    expect(calls.filter((call) => !call.startsWith('/health')).every((call) => call.endsWith(`tab=${bridgeTabId()}`))).toBe(true);
    taken = false;
    act(() => result.current.claim());
    await waitFor(() => expect(result.current.status).toBe('connected'));
    expect(calls.slice(stopped).filter((call) => !call.startsWith('/health'))[0]).toMatch(/^\/hello/);
    unmount();
  });

  it('after an agent edit it reports what changed, for the camera and the panel', async () => {
    let served = false;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (new URL(url).pathname === '/next' && !served) {
        served = true;
        return Promise.resolve(new Response(JSON.stringify({ id: 'r1', op: 'add_shape', input: { kind: 'rectangle', id: 'n1' }, client: 'claude-code' }), { status: 200 }));
      }
      return parkedNext(url, init) ?? Promise.resolve(new Response('{}', { status: 200 }));
    }));
    const onApplied = vi.fn();
    const commit = vi.fn();
    const seen: unknown[] = [];
    const { result, rerender, unmount } = renderHook((undoTopId: string | null) => {
      const bridge = useV2AgentBridge({ ...options, commit, onApplied, undoTopId });
      seen.push(bridge.activity);
      return bridge;
    }, { initialProps: null as string | null });
    // The first request loads the op registry (a dynamic import): over 1 s on a loaded machine.
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(['n1']), { timeout: 5000 });
    expect(commit).toHaveBeenCalledTimes(1);
    // Several sessions can share one canvas: the panel lists who sent requests.
    expect(result.current.agents).toEqual(['Claude Code']);
    // While the op ran, the panel said who was doing what.
    expect(seen).toContainEqual({ agent: 'Claude Code', doing: 'drawing', change: null });
    const command = commit.mock.calls[0][0] as { id: string };
    // Not the undo top (yet): no line, so an Undo there could not act on something else.
    expect(result.current.activity).toBeNull();
    rerender(command.id);
    // Said as what it did, not the command's name (persona F10).
    expect(result.current.activity).toEqual({ agent: 'Claude Code', doing: null, change: 'added a rectangle' });
    // Undone (or buried under a later edit): the line goes; redone, it comes back.
    rerender(null);
    expect(result.current.activity).toBeNull();
    rerender(command.id);
    expect(result.current.activity?.change).toBe('added a rectangle');
    unmount();
  });

  it('while nothing listens, no request carries the token (failed requests print their URL in the console)', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) => { urls.push(url); return Promise.reject(new TypeError('Failed to fetch')); }));
    const { result, unmount } = renderHook(() => useV2AgentBridge({ ...options, token: 'secret' }));
    await waitFor(() => expect(urls.length).toBeGreaterThanOrEqual(2), { timeout: 4000 });
    expect(result.current.status).toBe('waiting');
    expect(urls.some((url) => url.includes('secret'))).toBe(false);
    unmount();
  });

  it('a retry pause leaves no abort listener behind', async () => {
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    await pause(5, controller.signal);
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  // Review 2 #2: the lock was held while waiting, so the first tab ever opened shut every other tab out.
  it('two tabs waiting for an agent both say waiting; neither claims the other has it', async () => {
    fakeLocks();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const first = renderHook(() => useV2AgentBridge(options));
    await waitFor(() => expect(first.result.current.status).toBe('waiting'));
    const otherTab = await anotherTab();
    const second = renderHook(() => otherTab(options));
    await waitFor(() => expect(second.result.current.status).toBe('waiting'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(second.result.current.status).toBe('waiting');
    first.unmount();
    second.unmount();
  });

  // Review 2 #4: after a 409 the tab let go of its lock, and the tab queued behind it took the bridge back.
  it('a tab replaced by another browser keeps its lock, so a sibling tab does not steal the bridge back', async () => {
    fakeLocks();
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const { pathname } = new URL(url);
      calls.push(pathname);
      if (pathname === '/next') return Promise.resolve(new Response('{}', { status: 409 }));
      return parkedNext(url, init) ?? Promise.resolve(new Response('{}', { status: 200 }));
    }));
    const first = renderHook(() => useV2AgentBridge(options));
    await waitFor(() => expect(first.result.current).toMatchObject({ status: 'elsewhere', detail: TAKEN }));
    const before = calls.filter((call) => call !== '/health').length;
    const otherTab = await anotherTab();
    const second = renderHook(() => otherTab(options));
    await waitFor(() => expect(second.result.current).toMatchObject({ status: 'elsewhere', detail: ELSEWHERE }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(calls.filter((call) => call !== '/health')).toHaveLength(before);
    expect(first.result.current.status).toBe('elsewhere');
    first.unmount();
    second.unmount();
  });

  // Review 2 #1: "Use this tab" mid-op aborted the old tab's /result, so the agent timed out and retried: a duplicate diagram.
  it('a takeover while an op runs still delivers that op\'s result, once', async () => {
    fakeLocks();
    let served = 0;
    const results: { body: string; aborted: () => boolean }[] = [];
    let release = (): void => undefined;
    const posted = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const { pathname } = new URL(url);
      if (pathname === '/next' && served === 0) {
        served += 1;
        return Promise.resolve(new Response(JSON.stringify({ id: 'r1', op: 'add_shape', input: { kind: 'rectangle', id: 'n1' }, client: 'claude-code' }), { status: 200 }));
      }
      if (pathname === '/result') {
        const signal = init?.signal;
        results.push({ body: String(init?.body), aborted: () => signal?.aborted ?? false });
        // The POST is in flight when the other tab takes over; a real fetch rejects once its signal aborts.
        return new Promise<Response>((resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          void posted.then(() => resolve(new Response('{"ok":true}', { status: 200 })));
        });
      }
      return parkedNext(url, init) ?? Promise.resolve(new Response('{}', { status: 200 }));
    }));
    const commit = vi.fn();
    const first = renderHook(() => useV2AgentBridge({ ...options, commit }));
    await waitFor(() => expect(results).toHaveLength(1), { timeout: 5000 });
    const otherTab = await anotherTab();
    const second = renderHook(() => otherTab(options));
    act(() => second.result.current.claim());
    await waitFor(() => expect(second.result.current.status).toBe('connected'));
    await waitFor(() => expect(first.result.current.status).toBe('elsewhere'));
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(results).toHaveLength(1);
    expect(results[0].aborted()).toBe(false);
    expect(JSON.parse(results[0].body)).toMatchObject({ id: 'r1', ok: true });
    expect(served).toBe(1);
    expect(commit).toHaveBeenCalledTimes(1);
    first.unmount();
    second.unmount();
  });

  it('says what the agent did the way a person would, falling back to the command label', () => {
    expect(agentDid('add_shape', { kind: 'database', label: 'Cache' }, 'Insert node')).toBe('added Cache');
    expect(agentDid('add_shape', { kind: 'icon' }, 'Insert node')).toBe('added an icon');
    expect(agentDid('add_shape', {}, 'Insert node')).toBe('added a shape');
    expect(agentDid('create_diagram', { dsl: 'x' }, 'Generate diagram')).toBe('drew a diagram');
    expect(agentDid('update_diagram', {}, 'Update diagram')).toBe('updated the diagram');
    expect(agentDid('move', { ids: ['a', 'b'] }, 'Move 2 shapes')).toBe('moved 2 shapes');
    expect(agentDid('style', { ids: ['a'] }, 'Style shape')).toBe('restyled a shape');
    expect(agentDid('delete', { ids: ['c1'], kind: 'connector' }, 'Delete')).toBe('deleted a connector');
    expect(agentDid('something_new', {}, 'Do a thing')).toBe('made a change: Do a thing');
  });
});
