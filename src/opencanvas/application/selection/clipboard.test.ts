import { describe, expect, it } from 'vitest';
import { applyDocumentCommand } from '../../domain/commands/execute';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { buildPasteProductionSelectionCommand, copyProductionSelection, pastePlacement } from './clipboard';
import type { ScenePage } from '../../domain/document/types';
import { buildNodeWorldMatrices, nodeWorldBounds } from '../../domain/scene/worldGeometry';
import { excalidrawScene, readExcalidraw } from '../../../services/dsl/excalidraw';

describe('production clipboard', () => {
  it('copies a hierarchy and internal connectors, remaps ids, offsets, and reverses atomically', () => {
    const root = createTestNode('root', { zIndex: 1 });
    const child = createTestNode('child', { parentId: 'root', zIndex: 2 });
    const outside = createTestNode('outside');
    const document = createTestDocument({ nodes: [root, child, outside], connectors: [{
      id: 'edge', source: { nodeId: 'root', portId: null, anchor: null, point: null },
      target: { nodeId: 'child', portId: null, anchor: null, point: null },
      route: { kind: 'direct', ownership: 'automatic' }, waypoints: [], labels: [],
      appearance: {}, semantics: {}, metadata: {}, extensions: {},
    }] });
    const snapshot = copyProductionSelection(document.pages[0], ['root']);
    let sequence = 0;
    const result = buildPasteProductionSelectionCommand(document.pages[0], snapshot,
      (kind) => `${kind}-copy-${++sequence}`, { offset: { x: 10, y: 20 }, keepParents: true });
    const applied = applyDocumentCommand(document, result.command);
    expect(result.pastedNodeIds).toEqual(['node-copy-1', 'node-copy-2']);
    expect(applied.document.pages[0].nodes.at(-1)).toMatchObject({ id: 'node-copy-2', parentId: 'node-copy-1' });
    expect(applied.document.pages[0].connectors.at(-1)).toMatchObject({
      id: 'connector-copy-3', source: { nodeId: 'node-copy-1' }, target: { nodeId: 'node-copy-2' },
    });
    expect(applyDocumentCommand(applied.document, applied.inverse).document).toEqual(document);
  });

  it('pastes an arrow with a free end, the free end moving with the paste (Excalidraw copies these)', () => {
    const document = createTestDocument({ nodes: [] });
    const snapshot = { version: 1 as const, nodes: [createTestNode('box')], connectors: [{
      id: 'loose', source: { nodeId: 'box', portId: null, anchor: null, point: null },
      target: { nodeId: null, portId: null, anchor: null, point: { x: 300, y: 40 } },
      route: { kind: 'direct' as const, ownership: 'automatic' as const }, waypoints: [], labels: [],
      appearance: {}, semantics: {}, metadata: {}, extensions: {},
    }] };
    let sequence = 0;
    const result = buildPasteProductionSelectionCommand(document.pages[0], snapshot,
      (kind) => `${kind}-${++sequence}`, { offset: { x: 10, y: 20 }, keepParents: false });
    const applied = applyDocumentCommand(document, result.command);
    expect(applied.document.pages[0].connectors[0]).toMatchObject({
      source: { nodeId: 'node-1' }, target: { nodeId: null, point: { x: 310, y: 60 } },
    });
  });

  it('pastes Excalidraw’s clipboard into an ordinary diagram, on its layer', () => {
    const document = createTestDocument({ nodes: [createTestNode('mine')] });
    const scene = readExcalidraw(JSON.stringify({ type: 'excalidraw/clipboard', files: {}, elements: [
      { id: 'box', type: 'rectangle', x: 0, y: 0, width: 120, height: 60, angle: 0, isDeleted: false },
    ] }))!;
    const { nodes, connectors } = excalidrawScene(scene);
    const result = buildPasteProductionSelectionCommand(document.pages[0], { version: 1, nodes, connectors },
      (kind) => `${kind}-pasted`, { offset: { x: 0, y: 0 }, keepParents: false });
    expect(applyDocumentCommand(document, result.command).document.pages[0].nodes).toHaveLength(2);
  });

  it('pastes a hand-made Excalidraw clipboard whose frame is its own frame', () => {
    const document = createTestDocument({ nodes: [createTestNode('mine')] });
    const scene = readExcalidraw(JSON.stringify({ type: 'excalidraw/clipboard', files: {}, elements: [
      { id: 'loop', type: 'frame', frameId: 'loop', x: 0, y: 0, width: 200, height: 200, angle: 0, isDeleted: false },
    ] }))!;
    const { nodes, connectors } = excalidrawScene(scene);
    const result = buildPasteProductionSelectionCommand(document.pages[0], { version: 1, nodes, connectors },
      (kind) => `${kind}-pasted`, { offset: { x: 0, y: 0 }, keepParents: false });
    expect(applyDocumentCommand(document, result.command).document.pages[0].nodes[1]).toMatchObject({ kind: 'frame', parentId: null });
  });

  it('moves a pasted connector’s bends with its ends', () => {
    const document = createTestDocument({ nodes: [] });
    const snapshot = { version: 1 as const, nodes: [createTestNode('box')], connectors: [{
      id: 'bent', source: { nodeId: 'box', portId: null, anchor: null, point: null },
      target: { nodeId: null, portId: null, anchor: null, point: { x: 300, y: 40 } },
      route: { kind: 'polyline' as const, ownership: 'imported-fixed' as const }, waypoints: [{ x: 200, y: 100 }], labels: [],
      appearance: {}, semantics: {}, metadata: {}, extensions: {},
    }] };
    const result = buildPasteProductionSelectionCommand(document.pages[0], snapshot,
      (kind) => `${kind}-1`, { offset: { x: 10, y: 20 }, keepParents: false });
    expect(applyDocumentCommand(document, result.command).document.pages[0].connectors[0]!.waypoints).toEqual([{ x: 210, y: 120 }]);
  });

  it('pastes a big copy onto a big page in one pass (a whole Excalidraw drawing pastes at once)', () => {
    const page = { ...createTestDocument({ nodes: [] }).pages[0]!,
      nodes: Array.from({ length: 150_000 }, (_, i) => createTestNode(`on-page-${i}`, { zIndex: i })) };
    const snapshot = { version: 1 as const, connectors: [], nodes: Array.from({ length: 20_000 }, (_, i) => createTestNode(`copied-${i}`)) };
    const started = performance.now();
    const { command } = buildPasteProductionSelectionCommand(page, snapshot, (kind, id) => `${kind}:${id}`);
    // One pass: well under a second. Scanning the page per pasted shape took seconds, and spreading it overflowed the stack.
    expect(performance.now() - started).toBeLessThan(2_000);
    const zIndexes = command.kind === 'batch' ? command.commands.map((child) => (child.kind === 'insert-node' ? child.node.zIndex : 0)) : [];
    expect([zIndexes[0], zIndexes.at(-1)]).toEqual([150_000, 169_999]);
  });
});

describe('where a paste lands', () => {
  const at = (id: string, x: number, y: number, overrides: Parameters<typeof createTestNode>[1] = {}) =>
    createTestNode(id, { transform: { translation: { x, y }, rotationRadians: 0, scale: { x: 1, y: 1 } }, ...overrides });
  const view = { x: 0, y: 0, width: 1000, height: 800 };
  const paste = (page: ScenePage, ids: readonly string[], viewport = view) => {
    const snapshot = copyProductionSelection(page, ids);
    let sequence = 0;
    const result = buildPasteProductionSelectionCommand(page, snapshot, (kind) => `${kind}-p${++sequence}`, pastePlacement(snapshot, viewport));
    const document = createTestDocument({ nodes: [...page.nodes], connectors: [...page.connectors] });
    const applied = applyDocumentCommand(document, result.command);
    const next = applied.document.pages[0]!;
    const world = (id: string) => nodeWorldBounds(next.nodes.find((node) => node.id === id)!, buildNodeWorldMatrices(next).get(id)!);
    const parent = (id: string) => next.nodes.find((node) => node.id === id)!.parentId;
    return { ids: result.pastedNodeIds, world, parent, undone: applyDocumentCommand(applied.document, applied.inverse).document, document };
  };
  // Two sections, each holding one shape: s1 at (100,100) with a at local (24,56); s2 at (500,100) with b at local (24,56).
  const sections = () => createTestDocument({ nodes: [
    at('s1', 100, 100, { kind: 'section', size: { width: 200, height: 160 } }), at('a', 24, 56, { parentId: 's1' }),
    at('s2', 500, 100, { kind: 'section', size: { width: 200, height: 160 } }), at('b', 24, 56, { parentId: 's2' }),
  ] }).pages[0]!;

  it('steps off the original while that spot is in view', () => {
    const page = createTestDocument({ nodes: [at('n', 100, 100)] }).pages[0]!;
    expect(pastePlacement(copyProductionSelection(page, ['n']), view)).toEqual({ offset: { x: 24, y: 24 }, keepParents: true });
  });

  it('lands in the middle of the view, on the page itself, when the original is out of sight (Figma, tldraw)', () => {
    const page = createTestDocument({ nodes: [at('n', 5000, -3000)] }).pages[0]!;
    // The 100×50 node is centred on (500, 400).
    expect(pastePlacement(copyProductionSelection(page, ['n']), view)).toEqual({ offset: { x: 450 - 5000, y: 375 + 3000 }, keepParents: false });
  });

  it('places arrows copied without shapes (Excalidraw) by their free ends, and pastes them as connectors', () => {
    const free = (x: number, y: number) => ({ nodeId: null, portId: null, anchor: null, point: { x, y } });
    const snapshot = { version: 1 as const, nodes: [], connectors: [{ id: 'go', source: free(5000, -3000), target: free(5200, -3000),
      route: { kind: 'direct' as const, ownership: 'automatic' as const }, waypoints: [], labels: [],
      appearance: {}, semantics: {}, metadata: {}, extensions: {} }] };
    const placement = pastePlacement(snapshot, view);
    // The 200 px arrow is centred on the view's (500, 400).
    expect(placement).toEqual({ offset: { x: 400 - 5000, y: 400 + 3000 }, keepParents: false });
    const document = createTestDocument({ nodes: [] });
    const result = buildPasteProductionSelectionCommand(document.pages[0]!, snapshot, (kind) => `${kind}-1`, placement);
    expect(result).toMatchObject({ pastedNodeIds: [], pastedConnectorIds: ['connector-1'] });
    expect(applyDocumentCommand(document, result.command).document.pages[0]!.connectors[0]!.source.point).toEqual({ x: 400, y: 400 });
  });

  it('a shape copied out of a section lands a step off where it is on the canvas, in that section (as ⌘D does), one undo', () => {
    const { ids: [copy], world, parent, undone, document } = paste(sections(), ['a']);
    expect(world(copy!)).toMatchObject({ x: 100 + 24 + 24, y: 100 + 56 + 24 });
    expect(parent(copy!)).toBe('s1');
    expect(undone).toEqual(document);
  });

  it('out of sight, it lands at the view centre on the page, at its own size', () => {
    const { ids: [copy], world, parent } = paste(sections(), ['a'], { x: 5000, y: 5000, width: 1000, height: 800 });
    expect(parent(copy!)).toBeNull();
    expect(world(copy!)).toEqual({ x: 5450, y: 5375, width: 100, height: 50 });
  });

  it('a whole section pastes with its children where they were relative to it', () => {
    const { ids, world, parent } = paste(sections(), ['s1']);
    const [section, child] = ids;
    expect(parent(section!)).toBeNull();
    expect(parent(child!)).toBe(section);
    expect(world(section!)).toMatchObject({ x: 124, y: 124 });
    expect(world(child!)).toMatchObject({ x: 148, y: 180 });
  });

  it('a selection across two sections lands each shape a step off itself, in its own section', () => {
    const { ids: [copyA, copyB], world, parent } = paste(sections(), ['a', 'b']);
    expect([parent(copyA!), parent(copyB!)]).toEqual(['s1', 's2']);
    expect(world(copyA!)).toMatchObject({ x: 148, y: 180 });
    expect(world(copyB!)).toMatchObject({ x: 548, y: 180 });
  });

  it('a section that is gone (another page, deleted) leaves the copy on the page at its canvas spot', () => {
    const page = sections();
    const snapshot = copyProductionSelection(page, ['a']);
    const elsewhere = createTestDocument({ nodes: [] }).pages[0]!;
    const result = buildPasteProductionSelectionCommand(elsewhere, snapshot, (kind) => `${kind}-x`, pastePlacement(snapshot, view));
    const inserted = result.command.kind === 'batch' && result.command.commands[0]!.kind === 'insert-node' ? result.command.commands[0].node : null;
    expect(inserted).toMatchObject({ parentId: null, transform: { translation: { x: 148, y: 180 } } });
  });
});
