import { describe, expect, it } from 'vitest';
import { createTestConnector, createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import type { JsonObject } from '../document/json';
import type { ScenePage } from '../document/types';
import type { FrameState } from './types';
import { projectPageConnectors } from '../connectors/routeProjection';
import { frameDrawList, type DrawOp, type DrawPathOp, type DrawTextOp } from './drawList';

const VIEW_BOX = { x: -24, y: -24, width: 400, height: 300 };

function frameOf(
  nodes: FrameState['nodes'] = {}, connectors: FrameState['connectors'] = {},
  camera: FrameState['camera'] = null,
): FrameState {
  return { timeMs: 0, durationMs: 1000, activeStepIndex: 0, nodes, connectors, camera };
}

function pageOf(options: Parameters<typeof createTestDocument>[0]): ScenePage {
  return createTestDocument(options).pages[0]!;
}

const kinds = (ops: readonly DrawOp[]): readonly string[] => ops.map((op) => op.kind);
const paths = (ops: readonly DrawOp[]): readonly DrawPathOp[] =>
  ops.filter((op): op is DrawPathOp => op.kind === 'path');
const texts = (ops: readonly DrawOp[]): readonly DrawTextOp[] =>
  ops.filter((op): op is DrawTextOp => op.kind === 'text');

describe('frame draw list', () => {
  it('paints the themed background first and nothing else on an empty page', () => {
    const ops = frameDrawList(pageOf({}), frameOf(), 'light', VIEW_BOX);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'rect', fill: { color: '#ffffff' }, transform: { tx: 0, ty: 0 } });
    expect(frameDrawList(pageOf({}), frameOf(), 'dark', VIEW_BOX)[0]).toMatchObject({ fill: { color: '#191b19' } });
  });

  it('draws a node as its outline then its label, in node-local coordinates', () => {
    const node = createTestNode('a', { size: { width: 100, height: 50 }, content: { label: 'Alpha', shape: 'rectangle' } });
    const ops = frameDrawList(pageOf({ nodes: [node] }), frameOf(), 'light', VIEW_BOX);
    expect(kinds(ops)).toEqual(['rect', 'path', 'text']);
    const [outline] = paths(ops);
    expect(outline!.commands[0]).toEqual({ kind: 'move', point: { x: 0, y: 0 } });
    expect(outline!.closed).toBe(true);
    const [label] = texts(ops);
    expect(label).toMatchObject({ text: 'Alpha', x: 50, y: 25, align: 'center', baseline: 'middle' });
  });

  it('draws a draw.io shape and a draw.io line as the parts draw.io’s code drew, in their own colours', () => {
    const fold = { path: [{ kind: 'move', x: 0, y: 0 }, { kind: 'line', x: 10, y: 10 }], fill: null, stroke: '#ff0000', strokeWidth: 2, dash: [], fillOpacity: 1, strokeOpacity: 1 };
    const note = createTestNode('a', { size: { width: 100, height: 50 }, content: { label: '', drawio: { shape: 'note' }, drawioParts: [fold], drawioSize: { width: 100, height: 50 } } });
    const ops = paths(frameDrawList(pageOf({ nodes: [note] }), frameOf(), 'light', VIEW_BOX));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ closed: false, fill: null, stroke: { color: '#ff0000' }, strokeWidth: 3, commands: [{ kind: 'move', point: { x: 0, y: 0 } }, { kind: 'line', point: { x: 10, y: 10 } }] });

    const b = createTestNode('b', { transform: { ...createTestNode('x').transform, translation: { x: 300, y: 0 } } });
    const plain = createTestConnector('a-b', 'a', 'b');
    const page = pageOf({ nodes: [createTestNode('a'), b], connectors: [plain] });
    const points = projectPageConnectors(page)[0]!.samples;
    const band = { ...fold, path: [{ kind: 'move', x: 1, y: 1 }, { kind: 'line', x: 2, y: 2 }, { kind: 'close' }], fill: 'fill', stroke: 'stroke' };
    const shaped = { ...plain, extensions: { drawioLine: { style: { shape: 'flexArrow' }, fill: '#123456', points, parts: [band] } as unknown as JsonObject } };
    const drawn = paths(frameDrawList({ ...page, connectors: [shaped] }, frameOf(), 'light', VIEW_BOX)).filter((op) => op.closed && op.fill?.color === '#123456');
    expect(drawn).toHaveLength(1);
  });

  it('draws a label that wraps by its sizing policy in the lines the canvas wraps it to', () => {
    const policy = { version: 1, mode: 'fixed', minSize: { width: 24, height: 24 }, maxSize: { width: 1600, height: 1200 }, overflow: 'wrap', clipContent: false, maxLines: 4 };
    const node = createTestNode('a', {
      size: { width: 260, height: 80 },
      content: { label: 'Validate the incoming payment request', shape: 'rectangle', sizingPolicy: policy },
    });
    const labels = texts(frameDrawList(pageOf({ nodes: [node] }), frameOf(), 'light', VIEW_BOX));
    expect(labels.map((op) => op.text)).toEqual(['Validate the incoming payment', 'request']);
    expect(labels[1]!.y - labels[0]!.y).toBeCloseTo(16.8);
    expect((labels[0]!.y + labels[1]!.y) / 2).toBeCloseTo(40);
  });

  it('bakes the frame opacity, the pop scale about the node centre and the camera', () => {
    const node = createTestNode('a', { size: { width: 100, height: 50 } });
    const frame = frameOf({ a: { opacity: 0.5, scale: 0.92, drawProgress: 1 } }, {}, { x: 0, y: 0, width: 100, height: 50 });
    const ops = frameDrawList(pageOf({ nodes: [node] }), frame, 'light', VIEW_BOX);
    const [outline] = paths(ops);
    // pop about (50, 25), then the camera fit (scale 4, tx -24, ty 26).
    expect(outline!.opacity).toBe(0.5);
    expect(outline!.transform.a).toBeCloseTo(3.68);
    expect(outline!.transform.tx).toBeCloseTo(-8);
    expect(outline!.transform.ty).toBeCloseTo(34);
    expect(ops[0]).toMatchObject({ kind: 'rect', transform: { a: 1, tx: 0, ty: 0 } });
  });

  it('marks a chart page as a fallback frame', () => {
    const chart = createTestNode('chart-1', { kind: 'chart', content: { chart: 'bar' } });
    expect(frameDrawList(pageOf({ nodes: [chart] }), frameOf(), 'light', VIEW_BOX)).toEqual([{ kind: 'fallback' }]);
  });

  it('marks an ink page as a fallback frame but not a hidden one', () => {
    const pen = createTestNode('pen-1', {
      kind: 'pen', content: { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    });
    expect(frameDrawList(pageOf({ nodes: [pen] }), frameOf(), 'light', VIEW_BOX)).toEqual([{ kind: 'fallback' }]);
    const hidden = createTestNode('pen-2', {
      kind: 'pen', content: { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], sectionHidden: true },
    });
    expect(kinds(frameDrawList(pageOf({ nodes: [hidden] }), frameOf(), 'light', VIEW_BOX))).toEqual(['rect']);
  });

  it('draws containers as a plain rectangle with their title in the header band', () => {
    const group = createTestNode('g', {
      kind: 'section', size: { width: 200, height: 120 }, content: { label: 'Boundary' },
    });
    const ops = frameDrawList(pageOf({ nodes: [group] }), frameOf(), 'light', VIEW_BOX);
    expect(kinds(ops)).toEqual(['rect', 'path', 'text']);
    expect(paths(ops)[0]!.commands).toHaveLength(4);
    // Where the canvas draws it: 16px in, centred in the 40px title band.
    expect(texts(ops)[0]).toMatchObject({ text: 'Boundary', align: 'start', x: 16, y: 20 });
  });

  it('layers containers under the connectors and every other node over them, as the file does', () => {
    const at = (x: number, y: number) => ({ ...createTestNode('x').transform, translation: { x, y } });
    const group = createTestNode('g', { kind: 'section', zIndex: 0, size: { width: 200, height: 400 }, transform: at(0, 0) });
    const a = createTestNode('a', { zIndex: 1, size: { width: 100, height: 50 }, transform: at(50, 60), content: { shape: 'rectangle' } });
    const b = createTestNode('b', { zIndex: 1, size: { width: 100, height: 50 }, transform: at(50, 260), content: { shape: 'rectangle' } });
    const page = pageOf({ nodes: [group, a, b], connectors: [createTestConnector('a->b', 'a', 'b')] });
    const ops = paths(frameDrawList(page, frameOf(), 'light', VIEW_BOX));
    // The container's outline, then the line (stroke only, slate), then the two node outlines.
    expect(ops[0]!.commands).toHaveLength(4);
    expect(ops[1]).toMatchObject({ fill: null, stroke: { color: '#64748b' } });
    expect(ops.slice(2).every((op) => op.fill !== null || op.stroke?.color !== '#64748b')).toBe(true);
  });

  it('marks a text node page as a fallback frame', () => {
    const text = createTestNode('t', { kind: 'text', content: { label: 'note' } });
    expect(frameDrawList(pageOf({ nodes: [text] }), frameOf(), 'light', VIEW_BOX)).toEqual([{ kind: 'fallback' }]);
  });

  it('draws connectors before nodes, with draw-on as a unit dash', () => {
    const a = createTestNode('a', { transform: { ...createTestNode('x').transform, translation: { x: 0, y: 0 } } });
    const b = createTestNode('b', { size: { width: 100, height: 50 }, transform: { ...createTestNode('x').transform, translation: { x: 0, y: 200 } } });
    const edge = createTestConnector('a->b', 'a', 'b', {
      labels: [{ id: 'l', text: 'POST', pathRatio: 0.5, offset: { x: 0, y: 0 }, metadata: {} }],
    });
    const page = pageOf({ nodes: [a, b], connectors: [edge] });
    const ops = frameDrawList(page, frameOf({}, { 'a->b': { opacity: 1, scale: 1, drawProgress: 0.25 } }), 'light', VIEW_BOX);
    expect(ops.slice(1, 4).map((op) => op.kind)).toEqual(['path', 'rect', 'text']);
    const [path] = paths(ops);
    // The route runs from a's bottom (50, 50) to b's top (50, 200): length 150.
    expect(path!.dash).toEqual([150, 150]);
    expect(path!.dashOffset).toBeCloseTo((1 - 0.25) * 150);
    expect(path!.stroke).toMatchObject({ color: '#64748b', alpha: 1 });
    // The label sits on a white plate, centred on the line, as on the canvas.
    expect(ops[2]).toMatchObject({ kind: 'rect', fill: { color: '#ffffff' }, radius: 4 });
    expect(texts(ops)[0]).toMatchObject({ text: 'POST', fontSize: 12, color: '#334155', baseline: 'middle' });
  });

  it('carries the pulse phase as a travelling dash', () => {
    const a = createTestNode('a', { transform: { ...createTestNode('x').transform, translation: { x: 0, y: 0 } } });
    const b = createTestNode('b', { transform: { ...createTestNode('x').transform, translation: { x: 0, y: 200 } } });
    const edge = createTestConnector('a->b', 'a', 'b');
    const ops = frameDrawList(pageOf({ nodes: [a, b], connectors: [edge] }),
      frameOf({}, { 'a->b': { opacity: 1, scale: 1, drawProgress: 1, pulsePhase: 0.5 } }), 'light', VIEW_BOX);
    const [path] = paths(ops);
    // Pixels, not a fraction of the path: every connector's light is the same size and speed.
    expect(path!.dash).toEqual([8, 6]);
    expect(path!.dashOffset).toBeCloseTo(-21);
  });

  it('draws markers with the shared glyph geometry', () => {
    const a = createTestNode('a', { transform: { ...createTestNode('x').transform, translation: { x: 0, y: 0 } } });
    const b = createTestNode('b', { transform: { ...createTestNode('x').transform, translation: { x: 0, y: 200 } } });
    const edge = createTestConnector('a->b', 'a', 'b', { appearance: { markerEnd: 'arrow' } });
    const ops = frameDrawList(pageOf({ nodes: [a, b], connectors: [edge] }), frameOf(), 'light', VIEW_BOX);
    const markers = paths(ops).slice(1, 2);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.commands).toHaveLength(3);
    expect(markers[0]!.lineJoin).toBe('round');
  });

  // Found 2026-10-11: a video frame drew a hollow circle unfilled, so the line showed through it.
  it('fills a hollow marker with the page, as the canvas and the SVG do', () => {
    const a = createTestNode('a', { transform: { ...createTestNode('x').transform, translation: { x: 0, y: 0 } } });
    const b = createTestNode('b', { transform: { ...createTestNode('x').transform, translation: { x: 0, y: 200 } } });
    const edge = createTestConnector('a->b', 'a', 'b', { appearance: { markerEnd: 'circle' } });
    for (const [theme, page] of [['light', '#ffffff'], ['dark', '#191b19']] as const) {
      const ops = frameDrawList(pageOf({ nodes: [a, b], connectors: [edge] }), frameOf(), theme, VIEW_BOX);
      expect(ops.find((op) => op.kind === 'rect' && op.radius === 4 && op.width === 8)).toMatchObject({ fill: { color: page } });
    }
  });

  it('skips hidden nodes and their connectors', () => {
    const visible = createTestNode('visible');
    const hidden = createTestNode('hidden', { content: { label: 'hidden', sectionHidden: true } });
    const page = pageOf({ nodes: [visible, hidden], connectors: [createTestConnector('e', 'hidden', 'visible')] });
    const ops = frameDrawList(page, frameOf(), 'light', VIEW_BOX);
    expect(paths(ops)).toHaveLength(1);
    expect(texts(ops).map((op) => op.text)).toEqual(['visible']);
  });
});
