import { describe, expect, it, vi } from 'vitest';
import { createTestDocument, createTestNode } from '../opencanvas/testing/builders/documentBuilder';
import { pageOfCommand } from '../opencanvas/domain/commands/pageTouch';
import type { SceneDocumentV1 } from '../opencanvas/domain/document/types';
import { READ_ONLY_REFUSAL, REPO_MAP_REFUSAL, runLiveAgentOp, type LiveAgentSession } from './liveOp';
import { createTestCapabilities } from './ops/testHost';

const session = (overrides: Partial<LiveAgentSession> = {}): LiveAgentSession => ({
  document: createTestDocument({ nodes: [createTestNode('a')] }), pageId: 'page-1', capabilities: createTestCapabilities(),
  commit: vi.fn(), threadChange: vi.fn(), selectedIds: () => ['a'], ...overrides,
});

// The one runner behind the MCP bridge and WebMCP.
describe('runLiveAgentOp', () => {
  it('an edit commits one command and reveals what it touched on the page in view', async () => {
    const commit = vi.fn();
    const onApplied = vi.fn();
    const { command, output } = await runLiveAgentOp(() => session({ commit, onApplied }), 'add_shape', { kind: 'rectangle', id: 'n1' });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(command);
    expect(command?.label).toBe('Create rectangle');
    expect(output).toEqual({ id: 'n1' });
    expect(onApplied).toHaveBeenCalledWith(['n1']);
  });

  it('a read commits nothing and sees the selection', async () => {
    const commit = vi.fn();
    const { command, output } = await runLiveAgentOp(() => session({ commit }), 'get_document', {});
    expect(command).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    expect(output).toMatchObject({ selection: ['a'] });
  });

  it('a read-only document, or its locked page, refuses an edit and commits nothing', async () => {
    const commit = vi.fn();
    await expect(runLiveAgentOp(() => session({ commit, readOnly: true }), 'delete', { ids: ['a'] })).rejects.toThrow(READ_ONLY_REFUSAL);
    await expect(runLiveAgentOp(() => session({ commit, lockedPageId: 'page-1' }), 'delete', { ids: ['a'] })).rejects.toThrow(REPO_MAP_REFUSAL);
    expect(commit).not.toHaveBeenCalled();
    await expect(runLiveAgentOp(() => session({ readOnly: true }), 'list_pages', {})).resolves.toMatchObject({ command: null });
  });

  // F02 (2026-10-14): an agent asked to draw while the tab showed a repo map got "read-only" and the person saw nothing.
  describe('a repo map page (read from the code, never written)', () => {
    const base = createTestDocument({ nodes: [createTestNode('a')] });
    const repoDocument = (drawing: boolean): SceneDocumentV1 => ({ ...base, pages: [
      { ...base.pages[0]!, id: 'map', name: 'Repo map', nodes: [] },
      ...(drawing ? [{ ...base.pages[0]!, id: 'drawing', name: 'Repo (drawing)', metadata: { drawingOf: 'map' } }] : []),
    ] });
    // The editor as the runner sees it: the page on screen changes once it re-renders.
    const editor = (overrides: Partial<LiveAgentSession> & { readonly drawing?: boolean } = {}) => {
      const state = { pageId: 'map', document: repoDocument(overrides.drawing ?? true) };
      // A commit reaches the editor's document on its next render.
      const commit = vi.fn(() => { const next = { ...state.document }; setTimeout(() => { state.document = next; }, 5); return true; });
      const openDrawing = vi.fn(() => {
        if (!state.document.pages.some(({ id }) => id === 'drawing')) return false;
        setTimeout(() => { state.pageId = 'drawing'; }, 5);
        return true;
      });
      const showPage = vi.fn((pageId: string) => { setTimeout(() => { state.pageId = pageId; }, 5); });
      const current = (): LiveAgentSession => ({
        ...session({ commit, lockedPageId: 'map', openDrawing, showPage }), ...overrides, document: state.document, pageId: state.pageId,
      });
      return { state, current, commit, openDrawing, showPage };
    };

    it('an edit for it lands on its drawing, shown first: one commit, on the drawing', async () => {
      const onApplied = vi.fn();
      const { current, commit, openDrawing } = editor({ onApplied });
      const { command, output } = await runLiveAgentOp(current, 'add_shape', { kind: 'rectangle', id: 'n1' });
      expect(openDrawing).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(pageOfCommand(command!)).toBe('drawing');
      expect(output).toEqual({ id: 'n1' });
      expect(onApplied).toHaveBeenCalledWith(['n1']);
    });

    it('with no drawing to open or make, the edit is refused with the next step, and nothing lands', async () => {
      const { current, commit, openDrawing } = editor({ drawing: false });
      await expect(runLiveAgentOp(current, 'add_shape', { kind: 'rectangle' })).rejects.toThrow(REPO_MAP_REFUSAL);
      expect(REPO_MAP_REFUSAL).toContain('press Canvas');
      expect(openDrawing).toHaveBeenCalledTimes(1);
      expect(commit).not.toHaveBeenCalled();
    });

    it('a shared view asks the editor (it tells the person) and stays read-only', async () => {
      const { current, commit, openDrawing } = editor({ readOnly: true });
      await expect(runLiveAgentOp(current, 'add_shape', { kind: 'rectangle' })).rejects.toThrow(READ_ONLY_REFUSAL);
      expect(openDrawing).toHaveBeenCalledTimes(1);
      expect(commit).not.toHaveBeenCalled();
    });

    it('reads keep working on the map page and open nothing', async () => {
      const { current, openDrawing, showPage } = editor();
      await expect(runLiveAgentOp(current, 'list_pages', {})).resolves.toMatchObject({ command: null });
      await expect(runLiveAgentOp(current, 'get_document', {})).resolves.toMatchObject({ command: null });
      expect(openDrawing).not.toHaveBeenCalled();
      expect(showPage).not.toHaveBeenCalled();
    });

    it('an edit for a page that is not on screen shows that page, then lands', async () => {
      const onApplied = vi.fn();
      const { current, commit, showPage, openDrawing } = editor({ onApplied });
      const { command } = await runLiveAgentOp(current, 'add_shape', { kind: 'rectangle', id: 'n2' }, 'drawing');
      expect(openDrawing).not.toHaveBeenCalled();
      expect(showPage).toHaveBeenCalledWith('drawing');
      expect(commit).toHaveBeenCalledTimes(1);
      expect(pageOfCommand(command!)).toBe('drawing');
      expect(onApplied).toHaveBeenCalledWith(['n2']);
    });
  });

  it('reads the lock again once the op has resolved, before it commits', async () => {
    const commit = vi.fn();
    let readOnly = false;
    const base = session({ commit, capabilities: { ...createTestCapabilities(), compileWorkspace: async (...args) => {
      readOnly = true; // the document turned read-only while the diagram compiled
      return createTestCapabilities().compileWorkspace(...args);
    } } });
    await expect(runLiveAgentOp(() => ({ ...base, readOnly }), 'create_diagram', { dsl: 'flowchart\n  A -> B' })).rejects.toThrow(READ_ONLY_REFUSAL);
    expect(commit).not.toHaveBeenCalled();
  });

  it('an edit the session refuses is reported, not taken for applied', async () => {
    const onApplied = vi.fn();
    await expect(runLiveAgentOp(() => session({ commit: () => false, onApplied }), 'delete', { ids: ['a'] })).rejects.toThrow(READ_ONLY_REFUSAL);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('a cancelled call stops before it commits, with the reason', async () => {
    const commit = vi.fn();
    const controller = new AbortController();
    controller.abort(new Error('The editor closed this document.'));
    await expect(runLiveAgentOp(() => session({ commit }), 'delete', { ids: ['a'] }, undefined, controller.signal)).rejects.toThrow('The editor closed this document.');
    expect(commit).not.toHaveBeenCalled();
  });

  it('names an unknown op and a missing document', async () => {
    await expect(runLiveAgentOp(() => session(), 'nope', {})).rejects.toThrow('Unknown op "nope".');
    await expect(runLiveAgentOp(() => session({ document: null }), 'list_pages', {})).rejects.toThrow('The editor has no document open.');
  });
});
