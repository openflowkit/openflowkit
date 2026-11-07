import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { replaceSelection } from '../../application/selection/selection';
import type { DocumentCommand } from '../../domain/commands/types';
import { applyDocumentCommand } from '../../domain/commands/execute';
import { excalidrawScene } from '../../../services/dsl/excalidraw';
import { useV2EditActions } from './useV2EditActions';

// The real importer, watched: one test makes it throw as a bug in it would.
vi.mock('../../../services/dsl/excalidraw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/dsl/excalidraw')>();
  return { ...actual, excalidrawScene: vi.fn(actual.excalidrawScene) };
});

function setup(nodeIds: readonly string[]) {
  const document = createTestDocument({
    nodes: [createTestNode('a'), createTestNode('b', { metadata: { model: { elementId: 'api' } } })],
  });
  const page = document.pages[0]!;
  // Applied for real, so a paste the document would refuse throws here as it does in the editor.
  const commit = vi.fn<(command: DocumentCommand) => void>((command) => { applyDocumentCommand(document, command); });
  const announce = vi.fn();
  const notify = vi.fn();
  const applySelection = vi.fn();
  const applyConnectorSelection = vi.fn();
  let minted = 0;
  const { result } = renderHook(() => useV2EditActions({
    commit, pageRef: { current: page }, selectionRef: { current: replaceSelection(nodeIds) }, selectedConnectorIds: [],
    mintId: (prefix) => `${prefix}-${++minted}`, readOnly: false, applySelection, applyConnectorSelection, announce, notify,
  }));
  return { actions: result.current, commit, announce, notify, applySelection, applyConnectorSelection };
}

const excalidraw = (elements: readonly object[]) => JSON.stringify({ type: 'excalidraw/clipboard', files: {}, elements });
const arrow = { id: 'go', type: 'arrow', x: 0, y: 0, width: 100, height: 0, angle: 0, isDeleted: false, points: [[0, 0], [100, 0]] };

describe('useV2EditActions paste', () => {
  it('pastes our own clipboard JSON from the paste event, and leaves other text alone', () => {
    const source = setup(['a']);
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    source.actions.copySelection();
    const json = (writeText.mock.calls[0] as unknown as [string])[0];

    const target = setup([]);
    expect(target.actions.pasteShapes('just words')).toBe(false);
    expect(target.actions.pasteShapes(json)).toBe(true);
    expect(target.commit).toHaveBeenCalledOnce();
    expect(target.applySelection).toHaveBeenCalledWith(expect.objectContaining({ nodeIds: [expect.stringMatching(/^node-/)] }));
  });

  it('a paste that beats the copy\'s clipboard write pastes what was just copied, not the older clipboard', () => {
    const t = setup(['a']);
    // The system clipboard write is still in flight when ⌘V's paste event reads the previous contents.
    Object.assign(navigator, { clipboard: { writeText: vi.fn(() => new Promise(() => undefined)) } });
    t.actions.copySelection();
    const stale = JSON.stringify({ format: 'openflowkit.selection', version: 1, connectors: [],
      nodes: [createTestNode('old-1'), createTestNode('old-2')] });
    expect(t.actions.pasteShapes(stale)).toBe(true);
    const command = t.commit.mock.calls[0]![0];
    expect(command.kind === 'batch' ? command.commands.length : 0).toBe(1);
  });

  it('pastes the in-memory copy when no text is given (the menu, or a clipboard that is not ours)', () => {
    const t = setup(['a']);
    expect(t.actions.pasteShapes()).toBe(false);
    t.actions.copySelection();
    expect(t.actions.pasteShapes()).toBe(true);
    expect(t.commit).toHaveBeenCalledOnce();
  });
});

describe('useV2EditActions paste from Excalidraw', () => {
  it('pastes arrows copied without their shapes as free connectors, selected, in one step', () => {
    const t = setup([]);
    expect(t.actions.pasteShapes(excalidraw([arrow]))).toBe(true);
    expect(t.commit).toHaveBeenCalledOnce();
    const command = t.commit.mock.calls[0]![0];
    expect(command.kind === 'batch' ? command.commands.map((child) => child.kind) : []).toEqual(['insert-connector']);
    expect(t.applyConnectorSelection).toHaveBeenLastCalledWith([expect.stringMatching(/^connector-/)]);
  });

  it('says so when Excalidraw’s copy holds nothing to paste, and never pastes the older copy instead', async () => {
    const t = setup(['a']);
    Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
    t.actions.copySelection();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.actions.pasteShapes(excalidraw([{ ...arrow, isDeleted: true }]))).toBe(true);
    expect(t.commit).not.toHaveBeenCalled();
    expect(t.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nothing to paste from Excalidraw' }));
  });

  it('selects loose arrows pasted with shapes too, so Delete takes them all', () => {
    const t = setup([]);
    const box = { id: 'box', type: 'rectangle', x: 0, y: 0, width: 40, height: 40, isDeleted: false };
    const tied = { ...arrow, id: 'tied', x: 40, y: 20, startBinding: { elementId: 'box' } };
    t.actions.pasteShapes(excalidraw([box, arrow, tied]));
    expect(t.applySelection).toHaveBeenLastCalledWith(expect.objectContaining({ nodeIds: ['node-1'] }));
    // The loose arrow is selected; the one tied to the box goes with the box.
    expect(t.applyConnectorSelection).toHaveBeenLastCalledWith(['connector-2']);
  });

  it('names what didn’t come across, as the import does', () => {
    const t = setup([]);
    t.actions.pasteShapes(excalidraw([{ id: 'box', type: 'rectangle', x: 0, y: 0, width: 40, height: 40, isDeleted: false, groupIds: ['g'] }]));
    expect(t.commit).toHaveBeenCalledOnce();
    expect(t.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Pasted from Excalidraw', description: '1 thing didn’t come across: groups come in as separate shapes.',
    }));
  });
});

describe('useV2EditActions paste of a copy that is ours but not readable', () => {
  const own = (body: object) => JSON.stringify({ format: 'openflowkit.selection', version: 1, ...body });

  // A copy made here earlier, its clipboard write done: a paste that falls back would paste it.
  const withOlderCopy = async () => {
    const t = setup(['a']);
    Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
    t.actions.copySelection();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return t;
  };

  it('says it couldn’t paste a copy without its connectors or nodes, and never pastes the older copy instead', async () => {
    for (const broken of [own({ nodes: [createTestNode('x')] }), own({ connectors: [] }), own({ nodes: [null], connectors: [] }),
      own({ version: 2, nodes: [createTestNode('x')], connectors: [] })]) {
      const t = await withOlderCopy();
      expect(t.actions.pasteShapes(broken)).toBe(true);
      expect(t.commit).not.toHaveBeenCalled();
      expect(t.notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', title: 'Couldn’t paste the copied shapes' }));
    }
  });

  it('says there is nothing to paste for an empty copy of ours, without naming Excalidraw', () => {
    const t = setup([]);
    expect(t.actions.pasteShapes(own({ nodes: [], connectors: [] }))).toBe(true);
    expect(t.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nothing to paste' }));
  });

  it('lets an importer error through instead of pasting what was copied before', async () => {
    const t = await withOlderCopy();
    vi.mocked(excalidrawScene).mockImplementationOnce(() => { throw new Error('importer bug'); });
    expect(() => t.actions.pasteShapes(excalidraw([arrow]))).toThrow('importer bug');
    expect(t.commit).not.toHaveBeenCalled();
  });
});

describe('useV2EditActions paste that the document refuses', () => {
  it('says it couldn’t paste instead of throwing, and leaves the document as it was', () => {
    const t = setup([]);
    const loop = JSON.stringify({ format: 'openflowkit.selection', version: 1, connectors: [], nodes: [createTestNode('x', { parentId: 'x' })] });
    expect(t.actions.pasteShapes(loop)).toBe(true);
    expect(t.notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', title: 'Couldn’t paste the copied shapes' }));
    expect(t.applySelection).not.toHaveBeenCalled();
  });

  it('lets an error that is not the document refusing through: a bug is never shown as a bad copy', () => {
    const t = setup([]);
    t.commit.mockImplementationOnce(() => { throw new TypeError('a bug'); });
    expect(() => t.actions.pasteShapes(JSON.stringify({ format: 'openflowkit.selection', version: 1, connectors: [],
      nodes: [createTestNode('x')] }))).toThrow('a bug');
    expect(t.notify).not.toHaveBeenCalled();
  });
});

describe('useV2EditActions delete', () => {
  it('a mixed selection on a model view deletes all of it in one step and says the model keeps the elements', () => {
    const t = setup(['a', 'b']);
    t.actions.deleteSelection();
    expect(t.commit).toHaveBeenCalledOnce();
    const command = t.commit.mock.calls[0]![0];
    const removed = command.kind === 'batch' ? command.commands.flatMap((c) => (c.kind === 'remove-node' ? [c.node.id] : [])) : [];
    expect(removed.sort()).toEqual(['a', 'b']);
    expect(t.announce).toHaveBeenCalledWith(expect.stringContaining('The model keeps'));
  });

  it('a plain delete just says so', () => {
    const t = setup(['a']);
    t.actions.deleteSelection();
    expect(t.announce).toHaveBeenCalledWith('Selection deleted.');
  });
});

describe('useV2EditActions ⌘V without a paste event (WebKit outside a field)', () => {
  afterEach(() => vi.useRealTimers());
  it('the key alone pastes the in-memory copy after a beat', () => {
    vi.useFakeTimers();
    const t = setup(['a']);
    t.actions.copySelection();
    t.actions.pasteKeyPressed();
    expect(t.commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(t.commit).toHaveBeenCalledOnce();
  });

  it('a paste event that follows the key takes over: no second paste', () => {
    vi.useFakeTimers();
    const t = setup(['a']);
    t.actions.copySelection();
    t.actions.pasteKeyPressed();
    t.actions.pasteEventArrived();
    vi.advanceTimersByTime(500);
    expect(t.commit).not.toHaveBeenCalled();
  });
});
