import { describe, expect, it } from 'vitest';
import type { SceneDocumentV1 } from '../../opencanvas/domain/document/types';
import { resolveNodeStyle } from '../../opencanvas/domain/nodes/nodeStyle';
import { contrastRatio } from '../../lib/colorUtils';
import { excalidrawScene, excalidrawToDocument, looksLikeExcalidraw, readExcalidraw } from './excalidraw';
import architecture from './fixtures/excalidraw/architecture.excalidraw?raw';
import dbSchema from './fixtures/excalidraw/db-schema.excalidraw?raw';
import linkedList from './fixtures/excalidraw/linked-list.excalidraw?raw';
import freehandFrameImage from './fixtures/excalidraw/freehand-frame-image.excalidraw?raw';

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

  it('keeps Excalidraw’s own lines where it wrapped the words and we would not: fixed-width text, a label in a diamond', () => {
    const { document } = open(file([
      { ...base, id: 'wrap', type: 'text', x: 0, y: 0, width: 120, height: 125, fontSize: 20, fontFamily: 5, autoResize: false,
        textAlign: 'left', containerId: null, originalText: 'The quick brown fox jumps over the lazy dog again',
        text: 'The quick\nbrown fox\njumps over\nthe lazy dog\nagain' },
      { ...base, id: 'gem', type: 'diamond', x: 300, y: 0, width: 120, height: 120 },
      { ...base, id: 'gem-label', type: 'text', x: 330, y: 35, width: 60, height: 50, fontSize: 20, containerId: 'gem',
        originalText: 'Approve the order', text: 'Approve\nthe order' },
      // A rectangle wraps its own label to its width, so it keeps the words as typed and rewraps when resized.
      { ...base, id: 'box', type: 'rectangle', x: 500, y: 0, width: 100, height: 80 },
      { ...base, id: 'box-label', type: 'text', x: 510, y: 15, width: 80, height: 50, fontSize: 20, containerId: 'box',
        originalText: 'Ship the order', text: 'Ship the\norder' },
    ]));
    const [wrap, gem, box] = document.pages[0]!.nodes;
    expect(wrap!.content.label).toBe('The quick\nbrown fox\njumps over\nthe lazy dog\nagain');
    // About Excalidraw's 120 px (ours keeps a margin and a wider handwriting face), not one 600 px line.
    expect(wrap!.size.width).toBeLessThan(240);
    expect(gem!.content.label).toBe('Approve\nthe order');
    expect(box!.content.label).toBe('Ship the order');
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

  it('keeps every label readable on the dark canvas as on the light one', () => {
    const words = (id: string, x: number, y: number, label: string, containerId: string | null = null) =>
      ({ ...base, id, type: 'text', x, y, width: 120, height: 25, text: label, originalText: label, fontSize: 20, containerId });
    const box = (id: string, x: number, y: number, backgroundColor: string) =>
      ({ ...base, id, type: 'rectangle', x, y, width: 160, height: 80, backgroundColor });
    const { document } = open(file([
      // Excalidraw's default shape has no fill; white boxes wash to the canvas in our dark theme; teal and blue stay.
      box('plain', 0, 0, 'transparent'), words('plain-label', 20, 28, 'plain', 'plain'),
      box('white', 200, 0, '#ffffff'), words('white-label', 220, 28, 'white', 'white'),
      box('short', 400, 0, '#fff'), words('short-label', 420, 28, 'short', 'short'),
      box('teal', 600, 0, '#15aabf'), words('teal-label', 620, 28, 'teal', 'teal'),
      box('under-white', 0, 150, '#ffffff'), words('on-white', 20, 178, 'free on white'),
      box('under-blue', 200, 150, '#a5d8ff'), words('on-blue', 220, 178, 'free on blue'),
      words('loose', 400, 178, 'free on the canvas'),
    ]));
    const node = (id: string) => document.pages[0]!.nodes.find((candidate) => candidate.id === id)!;
    for (const canvas of ['#191b19', '#f7f7f5']) {
      // What the words sit on: a fill that stays solid, else the canvas (a wash is 8% over it).
      const backdrop = (id: string) => {
        const fill = resolveNodeStyle(node(id), canvas).fill;
        return fill.startsWith('#') ? fill : canvas;
      };
      for (const [id, under] of [['plain', 'plain'], ['white', 'white'], ['short', 'short'], ['teal', 'teal'],
        ['on-white', 'under-white'], ['on-blue', 'under-blue'], ['loose', 'loose']] as const) {
        expect(contrastRatio(resolveNodeStyle(node(id), canvas).textColor, backdrop(under)), `${id} on ${canvas}`).toBeGreaterThanOrEqual(4.5);
      }
    }
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
    expect(losses).toEqual([
      'groups come in as separate shapes (18 times)', 'hatched fills are drawn solid (17 times)', 'filled lines are drawn as outlines (3 times)',
    ]);
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

  it('names an unknown type or head in at most 24 characters, without control characters', () => {
    const { losses } = open(file([
      { ...base, id: 'odd', type: `\u202e${'x'.repeat(300)}`, x: 0, y: 0, width: 40, height: 40 },
      { ...base, id: 'go', type: 'arrow', x: 0, y: 100, width: 50, height: 0, points: [[0, 0], [50, 0]], endArrowhead: 'y'.repeat(300) },
    ]));
    expect(losses).toEqual([
      `Excalidraw’s “${'x'.repeat(23)}…” element is drawn as a box`, `the “${'y'.repeat(23)}…” arrowhead is drawn as a plain end`,
    ]);
  });

  it('names what it drops: groups, links, a second bound text, a repeated id', () => {
    const { document, losses } = open(file([
      { ...base, id: 'a', type: 'rectangle', x: 0, y: 0, width: 50, height: 50, groupIds: ['g1'], link: 'https://example.com' },
      { ...base, id: 'b', type: 'rectangle', x: 100, y: 0, width: 50, height: 50, groupIds: ['g1', 'g2'] },
      { ...base, id: 'b', type: 'ellipse', x: 200, y: 0, width: 50, height: 50 },
      { ...base, id: 't1', type: 'text', x: 0, y: 0, width: 20, height: 20, text: 'one', containerId: 'a' },
      { ...base, id: 't2', type: 'text', x: 0, y: 20, width: 20, height: 20, text: 'two', containerId: 'a' },
    ]));
    expect(document.pages[0]!.nodes.map((node) => [node.id, node.content.label])).toEqual([['a', 'one'], ['b', '']]);
    expect(losses).toEqual([
      'links on shapes were left out', 'elements sharing an earlier element’s id were left out',
      'a second text bound to the same shape was left out', 'groups come in as separate shapes (2 times)',
    ]);
  });

  it('names a fill it can’t draw, a cropped or flipped picture and an element without an id; keeps text and picture opacity', () => {
    const loop = [[0, 0], [80, -40], [160, 0], [80, 60], [0, 0]];
    const { document, losses } = open(file([
      // Excalidraw fills a line or a stroke that closes on itself; ours draw only the outline.
      { ...base, id: 'poly', type: 'line', x: 0, y: 0, width: 160, height: 100, backgroundColor: '#40c057', points: loop },
      { ...base, id: 'blob', type: 'freedraw', x: 200, y: 0, width: 160, height: 100, backgroundColor: '#ffc9c9', points: loop },
      { ...base, id: 'shape', type: 'line', x: 400, y: 0, width: 160, height: 40, backgroundColor: '#a5d8ff', polygon: true, points: [[0, 0], [80, 40], [160, 0]] },
      // An open line has nothing to fill, whatever its background says.
      { ...base, id: 'open', type: 'line', x: 0, y: 200, width: 160, height: 40, backgroundColor: '#40c057', points: [[0, 0], [80, 40], [160, 0]] },
      { ...base, id: 'pic', type: 'image', x: 0, y: 300, width: 64, height: 64, fileId: 'f', opacity: 50, scale: [-1, 1], crop: null },
      { ...base, id: 'cut', type: 'image', x: 100, y: 300, width: 64, height: 64, fileId: 'f', crop: { x: 0, y: 0, width: 32, height: 32 } },
      { ...base, id: 'faint', type: 'text', x: 0, y: 400, width: 60, height: 25, text: 'faint', originalText: 'faint', opacity: 40 },
      { ...base, id: '', type: 'rectangle', x: 0, y: 500, width: 10, height: 10 },
      { ...base, id: 7, type: 'rectangle', x: 0, y: 500, width: 10, height: 10 },
    ], { f: { dataURL: 'data:image/png;base64,iVBOR' } }));
    const node = (id: string) => document.pages[0]!.nodes.find((candidate) => candidate.id === id)!;
    expect(node('pic').content.transparency).toBe(0.5);
    expect(node('faint').appearance.opacity).toBe(0.4);
    expect(losses).toEqual([
      'elements without an id were left out (2 times)', 'filled lines are drawn as outlines (3 times)',
      'cropped or flipped pictures come in whole and unflipped (2 times)',
    ]);
  });

  it('never nests a frame, and keeps text bound to something that holds no label as text', () => {
    const frame = { ...base, type: 'frame', y: 0, width: 100, height: 100 };
    const words = { ...base, type: 'text', y: 200, width: 40, height: 20, fontSize: 16 };
    const { document } = open(file([
      // Hand-made: a frame in itself, two frames in each other. Excalidraw's frames don't nest.
      { ...frame, id: 'self', x: 0, frameId: 'self' },
      { ...frame, id: 'f', x: 200, frameId: 'g' }, { ...frame, id: 'g', x: 400, frameId: 'f' },
      // Text bound to itself, to another text, or to a picture has no shape to label.
      { ...words, id: 'me', x: 0, text: 'me', containerId: 'me' },
      { ...words, id: 'a', x: 100, text: 'a', containerId: 'b' }, { ...words, id: 'b', x: 200, text: 'b', containerId: 'a' },
      { ...base, id: 'pic', type: 'image', x: 300, y: 200, width: 40, height: 40, fileId: 'gone' },
      { ...words, id: 'caption', x: 300, text: 'caption', containerId: 'pic' },
    ]));
    const nodes = document.pages[0]!.nodes;
    expect(nodes.filter(({ kind }) => kind === 'frame').map(({ parentId }) => parentId)).toEqual([null, null, null]);
    expect(nodes.filter(({ kind }) => kind === 'text').map(({ content }) => content.label)).toEqual(['me', 'a', 'b', 'caption']);
  });

  it('turns a line by its angle, and places freehand drawn up and left by its lowest point', () => {
    const { document } = open(file([
      // A flat 100px line turned a quarter about its centre (50, 0) stands upright from (50, -50) to (50, 50).
      { ...base, id: 'turned', type: 'arrow', x: 0, y: 0, width: 100, height: 0, angle: Math.PI / 2, points: [[0, 0], [100, 0]] },
      { ...base, id: 'pen', type: 'freedraw', x: 100, y: 100, width: 30, height: 20, points: [[0, 0], [-30, -20]] },
    ]));
    const [turned] = document.pages[0]!.connectors;
    expect(turned!.source.point!.x).toBeCloseTo(50);
    expect(turned!.source.point!.y).toBeCloseTo(-50);
    expect(turned!.target.point!.y).toBeCloseTo(50);
    expect(document.pages[0]!.nodes[0]).toMatchObject({ transform: { translation: { x: 70, y: 80 } },
      content: { points: [{ x: 30, y: 20 }, { x: 0, y: 0 }] } });
  });

  it('opens a real export with freehand drawn upward, a picture and a frame', () => {
    // Its picture is swapped for a 1×1 PNG, to keep the fixture small.
    const source = JSON.parse(freehandFrameImage) as { elements: { id: string; type: string; x: number; y: number; isDeleted: boolean; points?: number[][] }[] };
    const { document, losses } = open(freehandFrameImage);
    const nodes = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    for (const element of source.elements.filter(({ type, isDeleted }) => type === 'freedraw' && !isDeleted)) {
      const pen = nodes.get(element.id)!;
      const low = Math.min(...element.points!.map(([, y]) => y!));
      // Drawn upward from its start: placed by its highest point, every point at or below the top.
      expect(pen.transform.translation.y).toBeCloseTo(element.y + low);
      expect(Math.min(...(pen.content.points as { y: number }[]).map(({ y }) => y))).toBeCloseTo(0);
    }
    expect([...nodes.values()].filter(({ kind }) => kind === 'image')).toHaveLength(1);
    const frame = [...nodes.values()].find(({ kind }) => kind === 'frame')!;
    expect([...nodes.values()].filter(({ parentId }) => parentId === frame.id)).toHaveLength(3);
    expect(losses).toEqual(['hatched fills are drawn solid (2 times)']);
  });

  it('builds a big drawing in linear time: twenty-five thousand filled boxes with a word on each', () => {
    const elements = Array.from({ length: 25_000 }, (_, i) => {
      const x = (i % 200) * 50;
      const y = Math.floor(i / 200) * 50;
      return [
        { ...base, id: `box${i}`, type: 'rectangle', x, y, width: 40, height: 40, backgroundColor: '#ffec99' },
        { ...base, id: `word${i}`, type: 'text', x: x + 5, y: y + 10, width: 30, height: 20, text: 'n', originalText: 'n', fontSize: 16, containerId: null },
      ];
    }).flat();
    const started = performance.now();
    const { nodes } = excalidrawScene({ elements, files: {} });
    // Linear, this takes well under half a second; scanning every placed node per shape and per word took seconds.
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(nodes).toHaveLength(50_000);
    expect(nodes.at(-1)!.content.customColor).toBe('#1e1e1e');
  });

  it('opens strokes and texts too long to spread into Math.min (200 000 points, 200 000 lines)', () => {
    const points = Array.from({ length: 200_000 }, (_, i) => [i % 100, -(i % 37)]);
    const { document } = open(file([
      { ...base, id: 'pen', type: 'freedraw', x: 0, y: 0, width: 100, height: 37, points },
      { ...base, id: 'zig', type: 'line', x: 0, y: 100, width: 100, height: 37, points },
      { ...base, id: 'long', type: 'text', x: 0, y: 200, width: 10, height: 10, text: Array(200_000).fill('a').join('\n') },
    ]));
    const node = (id: string) => document.pages[0]!.nodes.find((candidate) => candidate.id === id)!;
    expect(node('pen').transform.translation.y).toBe(-36);
    expect(node('zig').size).toEqual({ width: 99, height: 36 });
  });

  it('says why it can’t open something', () => {
    expect(excalidrawToDocument('{}', 'doc', NOW)).toEqual({ error: 'It isn’t an Excalidraw drawing.' });
    expect(excalidrawToDocument(file([]), 'doc', NOW)).toEqual({ error: 'The drawing is empty.' });
  });
});
