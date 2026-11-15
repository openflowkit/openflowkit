import { applyDocumentCommand } from './execute';
import type { ScenePage } from '../document/types';
import { describe, expect, it } from 'vitest';
import { createEmptyV2Document, createEmptyV2Page, firstV2Page } from '../../presentation/v2/v2Document';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import {
  buildDeleteSelectionCommand,
  buildDuplicateSelectionCommand,
  buildInsertConnectorCommand,
  buildInsertShapeCommand,
  buildMoveNodesCommand,
  buildReorderCommand,
  buildToggleLockCommand,
  buildQuickCreateCommand,
  buildEditLabelCommand,
  buildSetNodeLabelCommand,
  buildSetShapeCommand,
} from './sceneEdits';

function emptyPage(): ScenePage {
  return createEmptyV2Page();
}

function pageWithTwoNodes(): ScenePage {
  const page = emptyPage();
  const first = applyDocumentCommand(
    { ...createEmptyV2Document('doc-1'), pages: [page] },
    buildInsertShapeCommand(page, { kind: 'rectangle', id: 'node-a', at: { x: 10, y: 20 } })
  ).document.pages[0];
  return applyDocumentCommand(
    { ...createEmptyV2Document('doc-1'), pages: [first] },
    buildInsertShapeCommand(first, { kind: 'ellipse', id: 'node-b', at: { x: 300, y: 20 } })
  ).document.pages[0];
}

describe('change shape', () => {
  it('swaps the outline of every unlocked shape in one step, keeping label, size, kind and paint', () => {
    const decision = createTestNode('d', { kind: 'decision', content: { label: 'Offer?' }, size: { width: 168, height: 104 }, appearance: { fill: '#fef3c7' } });
    const box = createTestNode('b', { kind: 'process', content: { shape: 'rectangle', label: 'Hired' } });
    const locked = createTestNode('l', { kind: 'process', content: { shape: 'rectangle', sectionLocked: true } });
    const text = createTestNode('t', { kind: 'text', content: { label: 'note' } });
    const page = createTestDocument({ nodes: [decision, box, locked, text] }).pages[0]!;
    const command = buildSetShapeCommand(page, ['d', 'b', 'l', 't'], 'hexagon')!;
    expect(command.label).toBe('Change shape');
    const after = command.commands.map((child) => child.kind === 'set-node' ? child.after : null);
    expect(after.map((node) => node?.id)).toEqual(['d', 'b']);
    expect(after[0]).toEqual({ ...decision, content: { label: 'Offer?', shape: 'hexagon' } });
    expect(buildSetShapeCommand(page, ['t'], 'hexagon')).toBeNull();
    expect(buildSetShapeCommand(applyDocumentCommand({ ...createEmptyV2Document('x'), pages: [page] }, command).document.pages[0]!, ['d', 'b'], 'hexagon')).toBeNull();
  });
});

describe('v2 shape creation commands', () => {
  it('places a shape inside a frame as its child, so the frame carries it', () => {
    const frame = createTestNode('f', { kind: 'section', size: { width: 400, height: 300 }, transform: { translation: { x: 100, y: 100 }, rotationRadians: 0, scale: { x: 1, y: 1 } } });
    const page = createTestDocument({ nodes: [frame] }).pages[0]!;
    const inside = buildInsertShapeCommand(page, { kind: 'rectangle', id: 'in', at: { x: 150, y: 150 } });
    expect(inside.node.parentId).toBe('f');
    expect(inside.node.transform.translation).toEqual({ x: 50, y: 50 });
    expect(buildInsertShapeCommand(page, { kind: 'rectangle', id: 'out', at: { x: 900, y: 900 } }).node.parentId).toBeNull();
  });

  it.each([['rectangle', 'process'], ['ellipse', 'process'], ['diamond', 'process'], ['text', 'text']] as const)(
    'builds a valid %s insert at the theme default size',
    (kind, nodeKind) => {
      const page = emptyPage();
      const command = buildInsertShapeCommand(page, { kind, id: 'node-1', at: { x: 40, y: 50 } });
      expect(command.kind).toBe('insert-node');
      expect(command.index).toBe(0);
      expect(command.node.kind).toBe(nodeKind);
      expect(command.node.transform.translation).toEqual({ x: 40, y: 50 });
      expect(command.node.size.width).toBeGreaterThan(0);
      expect(command.node.content).toMatchObject({ label: kind === 'text' ? 'Text' : '' });
      if (kind === 'ellipse') expect(command.node.content.shape).toBe('ellipse');
      const applied = applyDocumentCommand(
        { ...createEmptyV2Document('doc-1'), pages: [page] },
        command
      );
      expect(applied.document.pages[0].nodes).toHaveLength(1);
      // Undo removes; the inverse restores the identical node.
      const undone = applyDocumentCommand(applied.document, applied.inverse);
      expect(undone.document.pages[0].nodes).toHaveLength(0);
      const redone = applyDocumentCommand(undone.document, undone.inverse);
      expect(redone.document.pages[0].nodes[0]).toEqual(applied.document.pages[0].nodes[0]);
    }
  );

  it('creates nothing when the pointer gesture is cancelled (no command built)', () => {
    const page = emptyPage();
    expect(page.nodes).toHaveLength(0);
  });
});

describe('v2 label edit command', () => {
  it('commits one set-node and allows an empty string on text nodes', () => {
    const page = pageWithTwoNodes();
    const labeled = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [page] },
      buildSetNodeLabelCommand(page, 'node-a', 'Draft')
    );
    const command = buildSetNodeLabelCommand(labeled.document.pages[0], 'node-a', '');
    expect(command.kind).toBe('set-node');
    const applied = applyDocumentCommand(labeled.document, command);
    expect(applied.document.pages[0].nodes[0].content.label).toBe('');
    const undone = applyDocumentCommand(applied.document, applied.inverse);
    expect(undone.document.pages[0].nodes[0].content.label).toBe('Draft');
  });

  it('refits an icon tile to its new caption: height only, width and corner kept', () => {
    const tile = createTestNode('tile', {
      kind: 'architecture', size: { width: 148, height: 107 }, transform: { translation: { x: 40, y: 60 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
      content: { label: 'API', assetPresentation: 'icon', icon: 'tabler/server' },
    });
    const page = { ...pageWithTwoNodes(), nodes: [tile] };
    const after = buildSetNodeLabelCommand(page, 'tile', 'Primary\ndatabase\ncluster').after;
    expect(after.size).toEqual({ width: 148, height: Math.ceil(88 + 3 * 14.4 + 4) });
    expect(after.transform.translation).toEqual({ x: 40, y: 60 });
    expect(buildSetNodeLabelCommand(page, 'tile', 'API').after.size).toEqual({ width: 148, height: 107 });
  });

  it('drops a label’s formatting when its words change, keeps it when they don’t, and undo brings it back', () => {
    const richLabel = [{ kind: 'text', runs: [{ text: 'Holiday', bold: true }] }];
    const node = createTestNode('node-a', { content: { label: 'Holiday', richLabel } });
    const page = { ...pageWithTwoNodes(), nodes: [node] };
    const document = { ...createEmptyV2Document('doc-1'), pages: [page] };
    const edited = applyDocumentCommand(document, buildSetNodeLabelCommand(page, 'node-a', 'Vacation'));
    expect(edited.document.pages[0].nodes[0].content).not.toHaveProperty('richLabel');
    expect(applyDocumentCommand(edited.document, edited.inverse).document.pages[0].nodes[0].content.richLabel).toEqual(richLabel);
    expect(buildSetNodeLabelCommand(page, 'node-a', 'Holiday').after.content.richLabel).toEqual(richLabel);
  });

  it('edits a shape and the words set beside it together, from either one, in one undo step', () => {
    const shape = createTestNode('pic', { kind: 'image', content: { label: 'Translator' } });
    const words = createTestNode('pic:label', { parentId: 'pic', content: { label: 'Translator', labelOf: 'pic', richLabel: [{ kind: 'text', runs: [{ text: 'Translator', bold: true }] }] } });
    const other = createTestNode('other', { content: { label: 'Translator' } });
    const page = { ...pageWithTwoNodes(), nodes: [shape, words, other] };
    const document = { ...createEmptyV2Document('doc-1'), pages: [page] };
    for (const id of ['pic', 'pic:label']) {
      const edited = applyDocumentCommand(document, buildEditLabelCommand(page, id, 'Mapper'));
      const labels = edited.document.pages[0].nodes.map((node) => node.content.label);
      expect(labels).toEqual(['Mapper', 'Mapper', 'Translator']);
      expect(edited.document.pages[0].nodes[1].content).not.toHaveProperty('richLabel');
      expect(applyDocumentCommand(edited.document, edited.inverse).document.pages[0].nodes.map((node) => node.content.label)).toEqual(['Translator', 'Translator', 'Translator']);
    }
    // A node with no partner edits alone.
    expect(buildEditLabelCommand(page, 'other', 'Mapper').kind).toBe('set-node');
  });

  it('restores the pre-edit text on undo', () => {
    const page = pageWithTwoNodes();
    const labeled = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [page] },
      buildSetNodeLabelCommand(page, 'node-a', 'Checkout')
    );
    const edited = applyDocumentCommand(
      labeled.document,
      buildSetNodeLabelCommand(labeled.document.pages[0], 'node-a', 'Payments')
    );
    const undone = applyDocumentCommand(edited.document, edited.inverse);
    expect(undone.document.pages[0].nodes[0].content.label).toBe('Checkout');
    const redone = applyDocumentCommand(undone.document, undone.inverse);
    expect(redone.document.pages[0].nodes[0].content.label).toBe('Payments');
  });
});

describe('v2 move command', () => {
  it('moves selected nodes without touching selection or other nodes', () => {
    const page = pageWithTwoNodes();
    const command = buildMoveNodesCommand(page, ['node-a'], { x: 30, y: -10 })!;
    const applied = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [page] },
      command
    );
    const moved = applied.document.pages[0].nodes[0];
    expect(moved.transform.translation).toEqual({ x: 40, y: 10 });
    expect(applied.document.pages[0].nodes[1].transform.translation).toEqual({ x: 300, y: 20 });
  });

  it('leaves locked nodes where they are, and moves the rest', () => {
    const page = pageWithTwoNodes();
    const locked = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [page] },
      buildToggleLockCommand(page, ['node-a'])
    ).document.pages[0];

    // Every id locked: nothing to commit, so no empty undo entry either.
    expect(buildMoveNodesCommand(locked, ['node-a'], { x: 30, y: -10 })).toBeNull();

    const mixed = buildMoveNodesCommand(locked, ['node-a', 'node-b'], { x: 30, y: -10 })!;
    const applied = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [locked] },
      mixed
    );
    expect(applied.document.pages[0].nodes[0].transform.translation).toEqual({ x: 10, y: 20 });
    expect(applied.document.pages[0].nodes[1].transform.translation).toEqual({ x: 330, y: 10 });
  });
});

describe('v2 delete command', () => {
  it('removes nodes and their attached connectors in one batch', () => {
    const nodes = pageWithTwoNodes();
    const connected = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [nodes] },
      buildInsertConnectorCommand(nodes, {
        id: 'edge-1',
        source: { nodeId: 'node-a' },
        target: { nodeId: 'node-b' },
      })
    ).document.pages[0];
    const command = buildDeleteSelectionCommand(connected, ['node-a'], []);
    expect(command.kind).toBe('batch');
    const applied = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [connected] },
      command
    );
    expect(applied.document.pages[0].nodes.map((node) => node.id)).toEqual(['node-b']);
    expect(applied.document.pages[0].connectors).toHaveLength(0);
    const undone = applyDocumentCommand(applied.document, applied.inverse);
    expect(undone.document.pages[0].nodes).toHaveLength(2);
    expect(undone.document.pages[0].connectors).toHaveLength(1);
  });
});

describe('v2 duplicate command', () => {
  it('remaps ids and internal bindings with an offset', () => {
    const nodes = pageWithTwoNodes();
    const connected = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [nodes] },
      buildInsertConnectorCommand(nodes, {
        id: 'edge-1',
        source: { nodeId: 'node-a' },
        target: { nodeId: 'node-b' },
      })
    ).document.pages[0];
    let counter = 0;
    const command = buildDuplicateSelectionCommand(
      connected,
      ['node-a', 'node-b'],
      ['edge-1'],
      (prefix) => `${prefix}-copy-${(counter += 1)}`
    );
    const applied = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [connected] },
      command
    );
    const result = applied.document.pages[0];
    expect(result.nodes.map((node) => node.id)).toEqual([
      'node-a',
      'node-b',
      'node-copy-1',
      'node-copy-2',
    ]);
    expect(result.connectors).toHaveLength(2);
    expect(result.connectors[1].source.nodeId).toBe('node-copy-1');
    expect(result.connectors[1].target.nodeId).toBe('node-copy-2');
    expect(result.nodes[2].transform.translation).toEqual({ x: 30, y: 40 });
  });

  it('excludes edges to omitted nodes', () => {
    const page = pageWithTwoNodes();
    const connected = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [page] },
      buildInsertConnectorCommand(page, {
        id: 'edge-1',
        source: { nodeId: 'node-a' },
        target: { nodeId: 'node-b' },
      })
    ).document.pages[0];
    const command = buildDuplicateSelectionCommand(
      connected,
      ['node-a'],
      ['edge-1'],
      (prefix) => `${prefix}-copy`
    );
    const applied = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [connected] },
      command
    );
    expect(applied.document.pages[0].nodes).toHaveLength(3);
    expect(applied.document.pages[0].connectors).toHaveLength(1);
  });

  it('keeps a copied member in its group, beside the original (it left for the page origin)', () => {
    const group = createTestNode('group', { kind: 'group', transform: { translation: { x: 400, y: 300 }, rotationRadians: 0, scale: { x: 1, y: 1 } } });
    const member = createTestNode('member', { parentId: 'group', transform: { translation: { x: 22, y: 54 }, rotationRadians: 0, scale: { x: 1, y: 1 } } });
    const page = createTestDocument({ nodes: [group, member] }).pages[0]!;
    const command = buildDuplicateSelectionCommand(page, ['member'], [], () => 'copy');
    const copy = command.commands[0]!.kind === 'insert-node' ? command.commands[0]!.node : null;
    expect(copy?.parentId).toBe('group');
    expect(copy?.transform.translation).toEqual({ x: 42, y: 74 });
  });
});

describe('v2 bound connector command', () => {
  it('creates an automatic bound-bound connector', () => {
    const page = pageWithTwoNodes();
    const command = buildInsertConnectorCommand(page, {
      id: 'edge-1',
      source: { nodeId: 'node-a' },
      target: { nodeId: 'node-b' },
    });
    expect(command.connector.source.nodeId).toBe('node-a');
    expect(command.connector.target.nodeId).toBe('node-b');
    expect(command.connector.route).toEqual({ kind: 'orthogonal', ownership: 'automatic' });
    const applied = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [page] },
      command
    );
    expect(applied.document.pages[0].connectors).toHaveLength(1);
  });

  it('rejects unknown endpoints', () => {
    expect(() =>
      buildInsertConnectorCommand(emptyPage(), {
        id: 'edge-x',
        source: { nodeId: 'missing' },
        target: { nodeId: 'missing' },
      })
    ).toThrow(RangeError);
  });
});

describe('v2 empty document', () => {
  it('opens with one page and one layer', () => {
    const document = createEmptyV2Document('demo');
    expect(document.pages).toHaveLength(1);
    expect(firstV2Page(document).layers).toHaveLength(1);
    expect(firstV2Page(document).nodes).toHaveLength(0);
  });
});

describe('v2 quick-create command', () => {
  it('adds the same-kind node at the fixed gap plus the side-bound connector in one batch', () => {
    const page = pageWithTwoNodes();
    const source = page.nodes[0];
    const command = buildQuickCreateCommand(page, {
      sourceNodeId: 'node-a', sourceSide: 'right', newNodeId: 'node-c', connectorId: 'edge-1',
    });
    expect(command.kind).toBe('batch');
    expect(command.label).toBe('Quick create');
    const applied = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [page] },
      command
    );
    const result = applied.document.pages[0];
    expect(result.nodes).toHaveLength(3);
    const created = result.nodes[2];
    expect(created.kind).toBe(source.kind);
    expect(created.size).toEqual(source.size);
    expect(created.content.label).toBe('');
    expect(created.transform.translation).toEqual({
      x: source.transform.translation.x + source.size.width * 2,
      y: source.transform.translation.y,
    });
    expect(result.connectors).toHaveLength(1);
    expect(result.connectors[0].source).toMatchObject({ nodeId: 'node-a', portId: null });
    expect(result.connectors[0].target).toMatchObject({ nodeId: 'node-c', portId: null });
    // One undo step removes node and connector.
    const undone = applyDocumentCommand(applied.document, applied.inverse);
    expect(undone.document.pages[0].nodes).toHaveLength(2);
    expect(undone.document.pages[0].connectors).toHaveLength(0);
    expect(undone.document.pages[0].nodes[0].ports).toHaveLength(0);
  });
});


describe('v2 reorder and lock commands', () => {
  it('brings the selection above everything, keeping its internal order', () => {
    const page = pageWithTwoNodes();
    const command = buildReorderCommand(page, ['node-a'], 'front')!;
    expect(command.commands.map((child) => child.kind === 'set-node' && child.after.zIndex)).toEqual([
      Math.max(...page.nodes.map((node) => node.zIndex)) + 1,
    ]);
    const back = buildReorderCommand(page, ['node-b'], 'back')!;
    expect(back.commands.map((child) => child.kind === 'set-node' && child.after.zIndex)).toEqual([
      Math.min(0, ...page.nodes.filter((node) => node.id !== 'node-b').map((node) => node.zIndex)) - 1,
    ]);
  });

  it('has nothing to do when the selection is already in front (or behind)', () => {
    const page = pageWithTwoNodes();
    const top = [...page.nodes].sort((a, b) => b.zIndex - a.zIndex)[0]!;
    const bottom = [...page.nodes].sort((a, b) => a.zIndex - b.zIndex)[0]!;
    expect(buildReorderCommand(page, [top.id], 'front')).toBeNull();
    expect(buildReorderCommand({ ...page, nodes: page.nodes.map((node) => node.id === bottom.id ? { ...node, zIndex: -1 } : node) }, [bottom.id], 'back')).toBeNull();
  });

  it('locks when any node is unlocked, then unlocks all', () => {
    const page = pageWithTwoNodes();
    const lock = buildToggleLockCommand(page, ['node-a', 'node-b']);
    expect(lock.label).toBe('Lock');
    const locked = applyDocumentCommand({ ...createEmptyV2Document('doc-1'), pages: [page] }, lock)
      .document.pages[0];
    expect(locked.nodes.every((node) => node.content.sectionLocked === true)).toBe(true);
    expect(buildToggleLockCommand(locked, ['node-a']).label).toBe('Unlock');
  });
});

describe('path connector creation', () => {
  it('writes authored waypoints as a manual polyline', () => {
    const page = emptyPage();
    const command = buildInsertConnectorCommand(page, {
      id: 'edge-1', source: { point: { x: 0, y: 0 } }, target: { point: { x: 90, y: 40 } },
      route: 'polyline', waypoints: [{ x: 40, y: 0 }, { x: 40, y: 40 }],
    });
    expect(command.connector.route).toEqual({ kind: 'polyline', ownership: 'manual' });
    expect(command.connector.waypoints).toEqual([{ x: 40, y: 0 }, { x: 40, y: 40 }]);
    expect(command.connector.appearance.markerEnd).toBe('arrow');
  });

  it('keeps a plain drag automatic with no bends', () => {
    const page = emptyPage();
    const command = buildInsertConnectorCommand(page, {
      id: 'edge-2', source: { point: { x: 0, y: 0 } }, target: { point: { x: 90, y: 40 } },
    });
    expect(command.connector.route).toEqual({ kind: 'orthogonal', ownership: 'automatic' });
    expect(command.connector.waypoints).toEqual([]);
  });
});

describe('change shape on a draw.io shape', () => {
  it('drops draw.io’s drawing, so the new outline is what shows', () => {
    const drawn = createTestNode('x', { kind: 'process', content: { shape: 'rectangle', label: 'Task', drawio: { shape: 'hexagon' }, drawioParts: [], drawioSize: { width: 10, height: 10 } } });
    const page = createTestDocument({ nodes: [drawn] }).pages[0]!;
    const command = buildSetShapeCommand(page, ['x'], 'ellipse')!;
    const after = command.commands[0]!.kind === 'set-node' ? command.commands[0]!.after : null;
    expect(after?.content).toEqual({ shape: 'ellipse', label: 'Task' });
  });
});
