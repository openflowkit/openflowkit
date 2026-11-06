import { describe, expect, it } from 'vitest';
import type { SceneDocumentV1 } from '../../opencanvas/domain/document/types';
import { excalidrawToDocument, looksLikeExcalidraw, readExcalidraw } from './excalidraw';
import architecture from './fixtures/excalidraw/architecture.excalidraw?raw';
import dbSchema from './fixtures/excalidraw/db-schema.excalidraw?raw';
import linkedList from './fixtures/excalidraw/linked-list.excalidraw?raw';

const NOW = '2026-10-24T00:00:00.000Z';

const base = { angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2,
  strokeStyle: 'solid', opacity: 100, roundness: null, isDeleted: false, groupIds: [], frameId: null };
const file = (elements: readonly object[], files: object = {}) =>
  JSON.stringify({ type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements, appState: {}, files });

function open(text: string): { document: SceneDocumentV1; losses: readonly string[] } {
  const result = excalidrawToDocument(text, 'doc', NOW);
  if ('error' in result) throw new Error(result.error);
  return result;
}

describe('excalidrawToDocument', () => {
  it('knows Excalidraw’s file and clipboard JSON from anything else', () => {
    expect(looksLikeExcalidraw(file([]))).toBe(true);
    expect(looksLikeExcalidraw(JSON.stringify({ type: 'excalidraw/clipboard', elements: [] }))).toBe(true);
    expect(looksLikeExcalidraw(JSON.stringify({ format: 'openflowkit.scene' }))).toBe(false);
    expect(looksLikeExcalidraw('{"type":"excalidraw"')).toBe(false);
    expect(looksLikeExcalidraw('graph TD; A-->B')).toBe(false);
  });

  it('keeps each shape where it was drawn, with its paint and its bound text as its label', () => {
    const { document, losses } = open(file([
      { ...base, id: 'box', type: 'rectangle', x: 100, y: 50, width: 160, height: 80, roundness: { type: 3 },
        backgroundColor: '#ffec99', strokeColor: '#e03131', strokeStyle: 'dashed', boundElements: [{ id: 't', type: 'text' }] },
      { ...base, id: 't', type: 'text', x: 120, y: 75, width: 120, height: 25, text: 'Checkout', originalText: 'Checkout',
        fontSize: 20, fontFamily: 5, textAlign: 'center', verticalAlign: 'middle', containerId: 'box', strokeColor: '#1971c2' },
      { ...base, id: 'round', type: 'ellipse', x: 400, y: 50, width: 80, height: 80 },
      { ...base, id: 'gone', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: true },
    ]));
    const nodes = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    expect([...nodes.keys()]).toEqual(['box', 'round']);
    expect(nodes.get('box')).toMatchObject({
      transform: { translation: { x: 100, y: 50 } }, size: { width: 160, height: 80 },
      content: { shape: 'rounded', label: 'Checkout' },
      appearance: { fill: '#ffec99', stroke: '#e03131', strokeStyle: 'dashed', textColor: '#1971c2', fontSize: 20, fontFamily: 'hand' },
    });
    expect(nodes.get('round')).toMatchObject({ content: { shape: 'circle' } });
    expect(losses).toEqual([]);
  });

  it('turns a shape about its centre, as Excalidraw does', () => {
    const { document } = open(file([{ ...base, id: 'r', type: 'rectangle', x: 100, y: 100, width: 200, height: 40, angle: Math.PI / 2 }]));
    const node = document.pages[0]!.nodes[0]!;
    expect(node.transform.rotationRadians).toBeCloseTo(Math.PI / 2);
    // The centre stays at (200, 120): the top-left corner, turned a quarter, sits at (220, 20).
    expect(node.transform.translation.x).toBeCloseTo(220);
    expect(node.transform.translation.y).toBeCloseTo(20);
  });

  it('widens free text about its centre, so words over a box stay centred on it', () => {
    const { document } = open(file([{ ...base, id: 't', type: 'text', x: 44, y: 28, width: 60, height: 25,
      text: 'Client', originalText: 'Client', fontSize: 20, fontFamily: 5, textAlign: 'center', containerId: null }]));
    const node = document.pages[0]!.nodes[0]!;
    expect(node.size.width).toBeGreaterThan(60);
    expect(node.transform.translation.x + node.size.width / 2).toBeCloseTo(74);
  });

  it('keeps free text’s alignment, growing away from the edge it is set against', () => {
    const words = { ...base, type: 'text', y: 0, width: 100, height: 25, text: 'id: uuid', originalText: 'id: uuid', fontSize: 20, containerId: null };
    const { document } = open(file([
      { ...words, id: 'l', x: 60, textAlign: 'left' },
      { ...words, id: 'r', x: 300, textAlign: 'right' },
    ]));
    const [left, right] = document.pages[0]!.nodes;
    // Our text keeps 8px clear each side, so the words start where Excalidraw drew them.
    expect(left).toMatchObject({ appearance: { textAlign: 'start' }, transform: { translation: { x: 52 } } });
    expect(right!.appearance.textAlign).toBe('end');
    expect(right!.transform.translation.x + right!.size.width).toBeCloseTo(408);
  });

  it('leaves default-ink free text to the theme, but keeps it dark on a filled shape', () => {
    const words = { ...base, type: 'text', width: 20, height: 25, text: 'A', originalText: 'A', fontSize: 20, containerId: null };
    const { document } = open(file([
      { ...base, id: 'dot', type: 'ellipse', x: 0, y: 0, width: 60, height: 60, backgroundColor: '#ffd43b' },
      { ...words, id: 'on', x: 20, y: 18 },
      { ...words, id: 'off', x: 200, y: 18 },
    ]));
    const color = (id: string) => document.pages[0]!.nodes.find((node) => node.id === id)!.content.customColor;
    expect(color('on')).toBe('#1e1e1e');
    expect(color('off')).toBeUndefined();
  });

  it('binds arrows to the shapes they were drawn between, with their label, bends and heads', () => {
    const { document, losses } = open(file([
      { ...base, id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 60 },
      { ...base, id: 'b', type: 'diamond', x: 300, y: 0, width: 100, height: 60 },
      { ...base, id: 'go', type: 'arrow', x: 100, y: 30, width: 200, height: 40, points: [[0, 0], [100, 40], [200, 0]],
        startBinding: { elementId: 'a', focus: 0, gap: 1 }, endBinding: { elementId: 'b', focus: 0, gap: 1 },
        startArrowhead: 'dot', endArrowhead: 'triangle', strokeStyle: 'dotted', boundElements: [{ id: 'l', type: 'text' }] },
      { ...base, id: 'l', type: 'text', x: 180, y: 60, width: 40, height: 20, text: 'pays', originalText: 'pays', containerId: 'go' },
      { ...base, id: 'loose', type: 'arrow', x: 0, y: 200, width: 50, height: 0, points: [[0, 0], [50, 0]], startArrowhead: null, endArrowhead: 'bar' },
    ]));
    const [go, loose] = document.pages[0]!.connectors;
    expect(go).toMatchObject({
      source: { nodeId: 'a' }, target: { nodeId: 'b' },
      route: { kind: 'polyline', ownership: 'imported-fixed' }, waypoints: [{ x: 200, y: 70 }],
      labels: [{ text: 'pays' }], appearance: { markerStart: 'circle', markerEnd: 'arrow', dashPattern: 'dotted' },
    });
    // The label text is the arrow's, not a node of its own.
    expect(document.pages[0]!.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(loose).toMatchObject({ source: { nodeId: null, point: { x: 0, y: 200 } }, target: { point: { x: 50, y: 200 } } });
    expect(loose!.appearance.markerEnd).toBeUndefined();
    expect(losses).toEqual(['the “bar” arrowhead is drawn as a plain end']);
  });

  it('keeps freehand strokes and loose lines as drawn, pictures as images, and frames around their members', () => {
    const { document, losses } = open(file([
      { ...base, id: 'f', type: 'frame', x: 0, y: 0, width: 400, height: 300, name: 'Sketch' },
      { ...base, id: 'pen', type: 'freedraw', x: 10, y: 20, width: 30, height: 10, points: [[0, 0], [15, 10], [30, 5]], frameId: 'f' },
      { ...base, id: 'zig', type: 'line', x: 100, y: 100, width: 40, height: 20, points: [[0, 0], [20, -20], [40, 0]] },
      { ...base, id: 'pic', type: 'image', x: 200, y: 200, width: 64, height: 64, fileId: 'file1' },
      { ...base, id: 'web', type: 'embeddable', x: 500, y: 0, width: 200, height: 100, link: 'https://example.com' },
    ], { file1: { mimeType: 'image/png', id: 'file1', dataURL: 'data:image/png;base64,iVBOR' } }));
    const nodes = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    expect(nodes.get('f')).toMatchObject({ kind: 'frame', content: { label: 'Sketch' } });
    expect(nodes.get('pen')).toMatchObject({ kind: 'pen', parentId: 'f', transform: { translation: { x: 10, y: 20 } },
      content: { points: [{ x: 0, y: 0 }, { x: 15, y: 10 }, { x: 30, y: 5 }], strokeWidth: 2 } });
    // A line drawn up from its start is placed by its highest point.
    expect(nodes.get('zig')).toMatchObject({ kind: 'line', transform: { translation: { x: 100, y: 80 } },
      content: { points: [{ x: 0, y: 20 }, { x: 20, y: 0 }, { x: 40, y: 20 }] } });
    expect(nodes.get('pic')).toMatchObject({ kind: 'image', content: { imageUrl: 'data:image/png;base64,iVBOR' } });
    expect(nodes.get('web')).toMatchObject({ content: { shape: 'rectangle', label: 'https://example.com' } });
    expect(losses).toEqual(['embedded web pages are drawn as a box with their link']);
  });

  it('reads the clipboard JSON Excalidraw copies', () => {
    const scene = readExcalidraw(JSON.stringify({ type: 'excalidraw/clipboard', elements: [{ ...base, id: 'x', type: 'rectangle' }], files: {} }));
    expect(scene?.elements).toHaveLength(1);
  });

  it('opens a real excalidraw.com export as drawn', () => {
    const { document, losses } = open(architecture);
    const [page] = document.pages;
    const labelled = (label: string) => page!.nodes.find((node) => node.content.label === label);
    // 81 live elements: 8 arrows are connectors, one text is its rectangle's label, the other 72 are nodes.
    expect(page!.nodes).toHaveLength(72);
    expect(page!.connectors).toHaveLength(8);
    expect(labelled('API\nGateway')).toMatchObject({ kind: 'process', content: { shape: 'rounded' }, appearance: { fill: '#15aabf', fontFamily: 'hand' } });
    expect(labelled('CDN')).toMatchObject({ kind: 'text', content: { fontFamily: 'hand', fontSize: 20 } });
    const gateway = labelled('API\nGateway')!;
    expect(page!.connectors.filter((connector) => connector.target.nodeId === gateway.id)).toHaveLength(4);
    expect(losses).toEqual(['hatched fills are drawn solid (17 times)']);
  });

  it('opens real exports whose words and arrows are loose, not bound', () => {
    const color = (page: SceneDocumentV1['pages'][number], label: string) =>
      page.nodes.find((node) => node.content.label === label)!.content.customColor;
    const schema = open(dbSchema).document.pages[0]!;
    // 3 tables and 18 words; the two arrows end in free points.
    expect(schema.nodes).toHaveLength(21);
    expect(schema.connectors.map((connector) => [connector.source.nodeId, connector.target.nodeId])).toEqual([[null, null], [null, null]]);
    // A field over its table keeps Excalidraw's dark ink; an arrow's “1:N” on the canvas follows the theme.
    expect(color(schema, 'Users')).toBe('#1e1e1e');
    expect(color(schema, '1:N')).toBeUndefined();
    const list = open(linkedList).document.pages[0]!;
    expect(list.nodes).toHaveLength(13);
    expect(list.connectors).toHaveLength(3);
    expect(color(list, '3')).toBe('#1e1e1e');
    expect(color(list, 'head')).toBeUndefined();
  });

  it('draws hand-edited types and heads named like Object’s keys as a box and a plain end', () => {
    const { document, losses } = open(file([
      { ...base, id: 'odd', type: 'constructor', x: 0, y: 0, width: 40, height: 40 },
      { ...base, id: 'go', type: 'arrow', x: 0, y: 100, width: 50, height: 0, points: [[0, 0], [50, 0]], endArrowhead: 'toString' },
    ]));
    expect(document.pages[0]!.nodes[0]).toMatchObject({ content: { shape: 'rectangle' } });
    expect(losses).toContain('the “toString” arrowhead is drawn as a plain end');
  });

  it('says why it can’t open something', () => {
    expect(excalidrawToDocument('{}', 'doc', NOW)).toEqual({ error: 'It isn’t an Excalidraw drawing.' });
    expect(excalidrawToDocument(file([]), 'doc', NOW)).toEqual({ error: 'The drawing is empty.' });
  });
});
