import { describe, expect, it } from 'vitest';
import { applyDocumentCommand } from '../commands/execute';
import {
  commitDocumentCommand,
  createDocumentHistory,
  undoDocumentCommand,
} from '../../application/history/history';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import {
  createTransformCommand,
  createTransformSnapshot,
  moveTransform,
  resizeTransform,
  rotateTransform,
  transformBefore,
} from './transformSelection';

describe('selection transforms', () => {
  it('moves multiple nodes on the grid without mutating the snapshot', () => {
    const a = createTestNode('a', {
      transform: { translation: { x: 3, y: 5 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    });
    const b = createTestNode('b', {
      transform: { translation: { x: 103, y: 5 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    });
    const page = createTestDocument({ nodes: [a, b] }).pages[0];
    const snapshot = createTransformSnapshot(page, ['a', 'b']);
    const result = moveTransform(snapshot, { x: 11, y: 12 }, { gridSize: 10 });
    expect(result.nodes.map((node) => node.transform.translation)).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
    ]);
    expect(a.transform.translation).toEqual({ x: 3, y: 5 });
  });

  it('snaps a move to other objects after the grid and reports guides', () => {
    const a = createTestNode('a', {
      transform: { translation: { x: 0, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    });
    const page = createTestDocument({ nodes: [a] }).pages[0];
    const snapshot = createTransformSnapshot(page, ['a']);
    // Node is 100×50 at (5,7) → right edge 105 snaps to the other's left edge 103.
    const other = { x: 103, y: 300, width: 40, height: 40 };
    const result = moveTransform(snapshot, { x: 5, y: 7 }, {
      snap: false, objects: [other], objectThreshold: 6,
    });
    expect(result.bounds.x).toBe(3);
    expect(result.bounds.y).toBe(7);
    expect(result.guideX).toBe(103);
    expect(result.guideY).toBeNull();
    expect(result.snappedX).toBe(true);
    // Grid on: grid first (5 → 0), then object snap (right edge 100 vs 103 → snaps to 3).
    const gridded = moveTransform(snapshot, { x: 5, y: 7 }, { objects: [other], objectThreshold: 6 });
    expect(gridded.bounds.x).toBe(3);
    expect(gridded.guideX).toBe(103);
    // No objects option → no guide fields at all (legacy callers unchanged).
    expect(moveTransform(snapshot, { x: 5, y: 7 }).guideX).toBeUndefined();
  });

  it('⇧ locks a move to its dominant axis, live as the drag turns', () => {
    const page = createTestDocument({ nodes: [createTestNode('a')] }).pages[0];
    const snapshot = createTransformSnapshot(page, ['a']);
    expect(moveTransform(snapshot, { x: 30, y: 10 }, { snap: false, axisLock: true }).bounds).toMatchObject({ x: 30, y: 0 });
    expect(moveTransform(snapshot, { x: 5, y: -40 }, { snap: false, axisLock: true }).bounds).toMatchObject({ x: 0, y: -40 });
    // The locked axis stays put even with object snapping on.
    const other = { x: 33, y: 3, width: 40, height: 40 };
    expect(moveTransform(snapshot, { x: 30, y: 10 }, { snap: false, axisLock: true, objects: [other], objectThreshold: 6 }).bounds.y).toBe(0);
  });

  it('resizes around the opposite corner and enforces a minimum', () => {
    const node = createTestNode('a');
    const page = createTestDocument({ nodes: [node] }).pages[0];
    const snapshot = createTransformSnapshot(page, ['a']);
    const expanded = resizeTransform(snapshot, {
      handle: 'south-east',
      pointer: { x: 200, y: 100 },
      snap: false,
    });
    // The box changes, never the scale, so labels wrap to the new width.
    expect(expanded.nodes[0].size).toEqual({ width: 200, height: 100 });
    expect(expanded.nodes[0].transform.scale).toEqual({ x: 1, y: 1 });
    const clamped = resizeTransform(snapshot, {
      handle: 'north-west',
      pointer: { x: 99, y: 79 },
      snap: false,
    });
    expect(clamped.bounds).toMatchObject({ width: 24, height: 24 });
  });

  it('⇧ keeps the aspect ratio and ⌥ grows from the centre', () => {
    const node = createTestNode('a');
    const page = createTestDocument({ nodes: [node] }).pages[0];
    const snapshot = createTransformSnapshot(page, ['a']);
    const aspect = resizeTransform(snapshot, {
      handle: 'east', pointer: { x: 200, y: 25 }, snap: false, keepAspect: true,
    });
    expect(aspect.bounds).toEqual({ x: 0, y: -25, width: 200, height: 100 });
    const centred = resizeTransform(snapshot, {
      handle: 'south-east', pointer: { x: 120, y: 60 }, snap: false, fromCenter: true,
    });
    expect(centred.bounds).toEqual({ x: -20, y: -10, width: 140, height: 70 });
    expect(centred.nodes[0].transform.translation).toEqual({ x: -20, y: -10 });
  });

  it('rotates a node around its center and snaps to 15 degrees', () => {
    const node = createTestNode('a');
    const page = createTestDocument({ nodes: [node] }).pages[0];
    const snapshot = createTransformSnapshot(page, ['a']);
    const result = rotateTransform(page, snapshot, { x: 100, y: 40 }, { x: 90, y: 80 });
    expect(result.nodes[0].transform.rotationRadians).toBeCloseTo(Math.PI / 6);
    expect(result.nodes[0].transform.translation.x).not.toBe(0);
  });

  it('commits a multi-node transform as one reversible batch', () => {
    const document = createTestDocument({ nodes: [createTestNode('a'), createTestNode('b')] });
    const page = document.pages[0];
    const snapshot = createTransformSnapshot(page, ['a', 'b']);
    const moved = moveTransform(snapshot, { x: 16, y: 16 }, { snap: false });
    const command = createTransformCommand(page.id, snapshot.nodes, moved.nodes, 'Move', 'move');
    const applied = applyDocumentCommand(document, command);
    expect(command.kind).toBe('batch');
    expect(applyDocumentCommand(applied.document, applied.inverse).document).toEqual(document);
    const history = commitDocumentCommand(createDocumentHistory(document), command);
    expect(history.past).toHaveLength(1);
    expect(undoDocumentCommand(history).present).toEqual(document);
  });
});

describe('container resize', () => {
  it('grows the box and keeps members in place', () => {
    const section = createTestNode('s', {
      kind: 'section', size: { width: 200, height: 200 },
      transform: { translation: { x: 100, y: 100 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    });
    const child = createTestNode('c', {
      parentId: 's', transform: { translation: { x: 40, y: 60 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    });
    const page = createTestDocument({ nodes: [section, child] }).pages[0];
    const snapshot = createTransformSnapshot(page, ['s']);
    expect(snapshot.members.map((node) => node.id)).toEqual(['c']);
    // Drag the north-west corner 50px up-left: origin moves, child compensates.
    const result = resizeTransform(snapshot, { handle: 'north-west', pointer: { x: 50, y: 50 }, snap: false });
    const [resized, member] = result.nodes;
    expect(resized.size).toEqual({ width: 250, height: 250 });
    expect(resized.transform.scale).toEqual({ x: 1, y: 1 });
    expect(resized.transform.translation).toEqual({ x: 50, y: 50 });
    expect(member.transform.translation).toEqual({ x: 90, y: 110 });
    expect(transformBefore(snapshot).map((node) => node.id)).toEqual(['s', 'c']);
  });
});

describe('resizing a shape inside a container', () => {
  it('keeps the shape where it is: the dragged corner moves, the opposite one stays put', () => {
    const section = createTestNode('s', {
      kind: 'section', size: { width: 600, height: 400 },
      transform: { translation: { x: 300, y: 200 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    });
    const child = createTestNode('c', {
      parentId: 's', size: { width: 100, height: 60 },
      transform: { translation: { x: 40, y: 60 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    });
    const page = createTestDocument({ nodes: [section, child] }).pages[0];
    // On the canvas the shape spans (340, 260)–(440, 320); drag its south-east corner out to (480, 340).
    const result = resizeTransform(createTransformSnapshot(page, ['c']), { handle: 'south-east', pointer: { x: 480, y: 340 }, snap: false });
    expect(result.nodes[0]!.size).toEqual({ width: 140, height: 80 });
    expect(result.nodes[0]!.transform.translation).toEqual({ x: 40, y: 60 });
  });
});

describe('rotating a shape inside a container', () => {
  it('turns it in place', () => {
    const section = createTestNode('s', { kind: 'section', size: { width: 600, height: 400 }, transform: { translation: { x: 300, y: 200 }, rotationRadians: 0, scale: { x: 1, y: 1 } } });
    const child = createTestNode('c', { parentId: 's', size: { width: 100, height: 100 }, transform: { translation: { x: 40, y: 60 }, rotationRadians: 0, scale: { x: 1, y: 1 } } });
    const page = createTestDocument({ nodes: [section, child] }).pages[0];
    // A half turn about its own centre (390, 310) leaves a square where it was.
    const result = rotateTransform(page, createTransformSnapshot(page, ['c']), { x: 500, y: 310 }, { x: 280, y: 310 });
    const { x, y } = result.nodes[0]!.transform.translation;
    expect([Math.round(x), Math.round(y)]).toEqual([140, 160]);
  });
});
