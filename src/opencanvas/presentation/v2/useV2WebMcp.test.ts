import { renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_OPS } from '../../../agent/ops';
import { createTestCapabilities } from '../../../agent/ops/testHost';
import type { WebMcpTool } from '../../../agent/webMcp';
import { applyDocumentCommand } from '../../domain/commands/execute';
import type { DocumentCommand } from '../../domain/commands/types';
import { createTestDocument } from '../../testing/builders/documentBuilder';
import { useV2WebMcp, type V2WebMcpOptions } from './useV2WebMcp';

function installModelContext() {
  const tools = new Map<string, WebMcpTool>();
  const registerTool = vi.fn(async (tool: WebMcpTool, options?: { signal?: AbortSignal }) => {
    tools.set(tool.name, tool);
    options?.signal?.addEventListener('abort', () => tools.delete(tool.name));
  });
  Object.defineProperty(document, 'modelContext', { value: { registerTool }, configurable: true });
  return { tools, registerTool };
}

const testDocument = createTestDocument();
const options = (overrides: Partial<V2WebMcpOptions> = {}): V2WebMcpOptions => ({
  document: testDocument, pageId: 'page-1', capabilities: createTestCapabilities(), commit: vi.fn(() => true), threadChange: vi.fn(), onActivity: vi.fn(),
  scene: testDocument.pages[0]!, mode: 'canvas', camera: () => ({ x: 0, y: 0, zoom: 1 }),
  screenRect: () => null, viewport: () => ({ width: 800, height: 600 }), select: vi.fn(), ...overrides,
});

/** The hook over a document that commits as a session does: the next render carries the edit, and the undo top with it. */
function useSession(overrides: Partial<V2WebMcpOptions>, commits: DocumentCommand[]) {
  const [current, setCurrent] = useState(testDocument);
  const [top, setTop] = useState<string | null>(null);
  return useV2WebMcp(options({
    document: current, scene: current.pages[0]!, undoTopId: top,
    commit: (command) => { commits.push(command); setTop(command.id); setCurrent((before) => applyDocumentCommand(before, command).document); return true; },
    ...overrides,
  }));
}

const ready = async (result: { current: { tools: number } }) =>
  // The tool chunk (and the registry) loads on mount: over 1 s on a loaded machine.
  waitFor(() => expect(result.current.tools).toBe(AGENT_OPS.length + 2), { timeout: 5000 });

describe('useV2WebMcp', () => {
  afterEach(() => { delete (document as { modelContext?: unknown }).modelContext; });

  it('does nothing in a browser without WebMCP', async () => {
    const { result } = renderHook(() => useV2WebMcp(options()));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.tools).toBe(0);
  });

  it('registers every tool once, runs an edit as one commit the next call reads, and unregisters on unmount', async () => {
    const { tools, registerTool } = installModelContext();
    const commits: DocumentCommand[] = [];
    const onActivity = vi.fn();
    const { result, unmount, rerender } = renderHook(() => useSession({ onActivity }, commits));
    await ready(result);
    rerender();
    expect(registerTool).toHaveBeenCalledTimes(AGENT_OPS.length + 2);

    await expect(tools.get('add_shape')!.execute({ kind: 'rectangle', id: 'n1' })).resolves.toEqual({ id: 'n1' });
    expect(commits).toHaveLength(1);
    expect(onActivity).toHaveBeenCalledWith('add_shape ran from an agent in this browser.');
    await expect(tools.get('get_document')!.execute({})).resolves.toMatchObject({ nodes: [{ id: 'n1' }] });
    await waitFor(() => expect(result.current.activity).toBe('Create rectangle'));

    unmount();
    expect(tools.size).toBe(0);
  });

  it('shows the change line only while that change is the undo top (an Undo hides it, a Redo brings it back)', async () => {
    const { tools } = installModelContext();
    const commits: DocumentCommand[] = [];
    const { result, rerender } = renderHook((top: { undoTopId?: string | null } = {}) => useSession(top, commits));
    await ready(result);
    await tools.get('add_shape')!.execute({ kind: 'rectangle', id: 'n1' });
    await waitFor(() => expect(result.current.activity).toBe('Create rectangle'));
    rerender({ undoTopId: null });
    expect(result.current.activity).toBeNull();
    rerender({ undoTopId: commits[0]!.id });
    expect(result.current.activity).toBe('Create rectangle');
  });

  it('after the editor closes, a call already made does not run, and says why', async () => {
    const { tools } = installModelContext();
    const commits: DocumentCommand[] = [];
    const { result, unmount } = renderHook(() => useSession({}, commits));
    await ready(result);
    const addShape = tools.get('add_shape')!;
    const pending = addShape.execute({ kind: 'rectangle' });
    unmount();
    await expect(pending).resolves.toEqual({ error: 'The editor closed this document.' });
    expect(commits).toHaveLength(0);
  });

  it('a call the agent cancelled does not run', async () => {
    const { tools } = installModelContext();
    const commits: DocumentCommand[] = [];
    const { result, unmount } = renderHook(() => useSession({}, commits));
    await ready(result);
    const controller = new AbortController();
    controller.abort();
    await expect(tools.get('add_shape')!.execute({ kind: 'rectangle' }, { signal: controller.signal })).resolves.toEqual({ error: 'The agent cancelled this call.' });
    expect(commits).toHaveLength(0);
    unmount();
  });

  it('an edit that never reaches the screen is an error, not a success', async () => {
    const { tools } = installModelContext();
    const { result, unmount } = renderHook(() => useV2WebMcp(options({ commit: () => true })));
    await ready(result);
    await expect(tools.get('add_shape')!.execute({ kind: 'rectangle' })).resolves.toMatchObject({ error: expect.stringContaining('did not show') });
    unmount();
  });

  // F02: the repo map's changes land on its drawing, so get_view does not tell the agent to give up on it.
  it('get_view does not call the repo map page read-only: its changes land on the drawing', async () => {
    const { tools } = installModelContext();
    const { result, unmount } = renderHook(() => useV2WebMcp(options({ lockedPageId: 'page-1' })));
    await ready(result);
    await expect(tools.get('get_view')!.execute({})).resolves.toMatchObject({ pageId: 'page-1', readOnly: false });
    unmount();
  });

  it('a read-only document registers the reads only, and they still answer', async () => {
    const { tools } = installModelContext();
    const commit = vi.fn();
    const { result, unmount } = renderHook(() => useV2WebMcp(options({ readOnly: true, commit })));
    await waitFor(() => expect(result.current.tools).toBeGreaterThan(0), { timeout: 5000 });
    expect(tools.has('add_shape')).toBe(false);
    await expect(tools.get('list_pages')!.execute({})).resolves.toMatchObject({ pages: [{ pageId: 'page-1' }] });
    unmount();
  });
});
