import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { SceneDocumentV1 } from '../../opencanvas/domain/document/types';
import { DEFAULT_SCENE_LAYER_ID } from '../../opencanvas/domain/document/defaults';
import { validateSceneDocumentV1 } from '../../opencanvas/domain/document/validation';
import { drawioToDocument, looksLikeDrawio } from './drawio';
import flow from './fixtures/drawio/flow.drawio?raw';

const NOW = '2026-10-18T00:00:00.000Z';

async function open(text: string): Promise<{ document: SceneDocumentV1; losses: readonly string[] }> {
  const result = await drawioToDocument(text, 'doc', NOW);
  if ('error' in result) throw new Error(result.error);
  return result;
}

/** How draw.io compresses a page: URI-encode, raw-deflate, base64. */
const compress = (xml: string) => deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64');

describe('looksLikeDrawio', () => {
  it('knows an mxfile and a bare graph model, and nothing else', () => {
    expect(looksLikeDrawio(flow)).toBe(true);
    expect(looksLikeDrawio('<?xml version="1.0" encoding="UTF-8"?>\n<mxGraphModel><root/></mxGraphModel>')).toBe(true);
    expect(looksLikeDrawio('{"format":"openflowkit.scene"}')).toBe(false);
    expect(looksLikeDrawio('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(false);
  });
});

describe('drawioToDocument', () => {
  it('keeps each page, with its shapes where draw.io put them', async () => {
    const { document } = await open(flow);
    expect(document.pages.map((page) => page.name)).toEqual(['Checkout', 'Services']);
    const [checkout] = document.pages;
    const byId = new Map(checkout!.nodes.map((node) => [node.id, node]));
    expect(byId.get('start')).toMatchObject({
      kind: 'process', content: { shape: 'ellipse', label: 'Start' },
      transform: { translation: { x: 40, y: 40 } }, size: { width: 120, height: 60 },
      appearance: { fill: '#d5e8d4', stroke: '#82b366' },
    });
    expect(byId.get('check')!.content.shape).toBe('diamond');
    expect(byId.get('pay')).toMatchObject({ content: { shape: 'rounded', label: 'Take\npayment' }, appearance: { fontWeight: 700, textColor: '#333333' } });
    expect(byId.get('db')!.content.shape).toBe('cylinder');
  });

  it('turns edges into connectors with their labels, heads, dashes and bends', async () => {
    const { document } = await open(flow);
    const connectors = new Map(document.pages[0]!.connectors.map((connector) => [connector.id, connector]));
    expect(connectors.get('e1')).toMatchObject({
      source: { nodeId: 'start' }, target: { nodeId: 'check' },
      route: { kind: 'orthogonal', ownership: 'automatic' }, appearance: { markerEnd: 'arrow' },
    });
    expect(connectors.get('e2')).toMatchObject({
      labels: [{ text: 'yes', pathRatio: 0.5 }], waypoints: [{ x: 380, y: 20 }],
      route: { kind: 'polyline', ownership: 'imported-fixed' },
      appearance: { markerEnd: 'arrow', dashPattern: 'dashed', stroke: '#ff0000' },
    });
    expect(connectors.get('e3')).toMatchObject({ labels: [{ text: 'writes', pathRatio: 0.25 }], appearance: { markerStart: 'circle' } });
    expect(connectors.get('e3')!.appearance.markerEnd).toBeUndefined();
    // An edge ending on empty canvas keeps its free end.
    expect(connectors.get('loose')!.target).toEqual({ nodeId: null, portId: null, anchor: null, point: { x: 600, y: 300 } });
  });

  it('keeps containers, their children in container space, layers and their visibility', async () => {
    const { document, losses } = await open(flow);
    const services = document.pages[1]!;
    expect(services.layers).toEqual([
      { id: 'default', name: 'Base', visible: true, locked: false },
      { id: 'layer:2', name: 'Annotations', visible: false, locked: false },
    ]);
    const byId = new Map(services.nodes.map((node) => [node.id, node]));
    expect(byId.get('lane')).toMatchObject({ kind: 'swimlane', content: { label: 'Backend' }, parentId: null });
    expect(byId.get('api')).toMatchObject({ parentId: 'lane', transform: { translation: { x: 20, y: 40 } } });
    expect(byId.get('worker')).toMatchObject({ parentId: 'lane', content: { label: 'Worker', shape: 'rectangle' } });
    expect(byId.get('note')).toMatchObject({ kind: 'text', layerId: 'layer:2', content: { label: 'TODO' } });
    // A bend inside a container is container space in draw.io, page space here.
    expect(services.connectors[0]!.waypoints).toEqual([{ x: 240, y: 220 }]);
    expect(losses).toContain('Services: draw.io’s “mxgraph.aws4.lambda_function” shape is drawn as a box');
  });

  it('reads compressed pages the way draw.io writes them', async () => {
    const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
      + '<mxCell id="a" value="Hello &amp; welcome" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="10" y="20" width="80" height="40" as="geometry"/></mxCell>'
      + '</root></mxGraphModel>';
    const { document, losses } = await open(`<mxfile><diagram name="Zipped" id="z">${compress(model)}</diagram></mxfile>`);
    expect(document.pages[0]!.nodes[0]).toMatchObject({ id: 'a', content: { label: 'Hello & welcome', shape: 'rectangle' } });
    expect(losses).toEqual([]);
  });

  it('says what came across badly instead of dropping it silently', async () => {
    const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
    const { losses } = await open(model(
      '<mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="b" value="B" vertex="1" parent="1"><mxGeometry x="200" width="80" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="e" value="nowhere" edge="1" parent="1" source="a"><mxGeometry relative="1" as="geometry"/></mxCell>'
      + '<mxCell id="o" edge="1" style="edgeStyle=orthogonalEdgeStyle;" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="5" y="5"/></Array></mxGeometry></mxCell>',
    ));
    expect(losses).toEqual([
      'connector “nowhere”: it has a loose end, so it was left out',
      '1 right-angle connector is re-routed, so its bends may move',
    ]);
  });

  it('turns shapes about their centre, lets unwrapped labels spill as draw.io does, and names each unknown shape once', async () => {
    const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
    const { document, losses } = await open(model(
      '<mxCell id="bar" value="80x40" style="shape=rect;rotation=270;" vertex="1" parent="1"><mxGeometry x="100" y="100" width="200" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="t" value="Desired &#xa;functionality" style="text;align=center" vertex="1" parent="1"><mxGeometry x="100" y="300" width="30" height="20" as="geometry"/></mxCell>'
      + '<mxCell id="w" value="Wrapped text" style="text;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="30" height="20" as="geometry"/></mxCell>'
      + '<mxCell id="c1" style="shape=mxgraph.cabinets.cb_1p;" vertex="1" parent="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell>'
      + '<mxCell id="c2" style="shape=mxgraph.cabinets.cb_1p;" vertex="1" parent="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell>',
    ));
    const byId = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    const bar = byId.get('bar')!;
    expect(bar).toMatchObject({ content: { shape: 'rectangle' }, size: { width: 200, height: 40 } });
    expect(bar.transform.rotationRadians).toBeCloseTo((3 * Math.PI) / 2);
    // Its centre stays at (200, 120): the corner, turned 270°, sits at (180, 220).
    expect(bar.transform.translation.x).toBeCloseTo(180);
    expect(bar.transform.translation.y).toBeCloseTo(220);
    // A tiny text cell grows to its words around the same centre, at draw.io's 12px.
    const text = byId.get('t')!;
    expect(text).toMatchObject({ kind: 'text', content: { label: 'Desired \nfunctionality', fontSize: 12 } });
    expect(text.size.width).toBeGreaterThan(60);
    expect(text.transform.translation.x + text.size.width / 2).toBeCloseTo(115);
    // A wrapping one keeps its width unless a single word is wider.
    expect(byId.get('w')!.size.width).toBeGreaterThan(30);
    expect(byId.get('w')!.size.width).toBeLessThan(text.size.width);
    expect(losses).toEqual(['draw.io’s “mxgraph.cabinets.cb_1p” shape is drawn as a box (2 shapes)']);
  });

  it('places wireframe parts as draw.io does: by fraction of their parent, carets by direction, checkbox labels beside, icon labels below', async () => {
    const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
    const { document } = await open(model(
      '<mxCell id="tab" value="People" style="shape=mxgraph.bootstrap.rect;" vertex="1" parent="1"><mxGeometry x="100" y="0" width="120" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="badge" value="84" style="shape=mxgraph.bootstrap.rrect;" vertex="1" parent="tab"><mxGeometry x="1" y="0.5" width="25" height="16" relative="1" as="geometry"><mxPoint x="-30" y="-8" as="offset"/></mxGeometry></mxCell>'
      + '<mxCell id="caret" style="shape=triangle;direction=south;" vertex="1" parent="1"><mxGeometry x="10" y="100" width="10" height="5" as="geometry"/></mxCell>'
      + '<mxCell id="play" style="triangle;" vertex="1" parent="1"><mxGeometry x="10" y="200" width="10" height="20" as="geometry"/></mxCell>'
      + '<mxCell id="box" value="Top Management" style="shape=mxgraph.bootstrap.checkbox;labelPosition=right;align=left;spacingLeft=5;" vertex="1" parent="1"><mxGeometry x="70" y="300" width="14" height="14" as="geometry"/></mxCell>'
      + '<mxCell id="icon" value="Finance" style="ellipse;verticalLabelPosition=bottom;verticalAlign=top;" vertex="1" parent="1"><mxGeometry x="300" y="300" width="40" height="40" as="geometry"/></mxCell>',
    ));
    const byId = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    // x 1, y 0.5 of a 120×40 tab, then the offset: (120 - 30, 20 - 8), in the tab's own space.
    expect(byId.get('badge')).toMatchObject({ parentId: 'tab', transform: { translation: { x: 90, y: 12 } } });
    expect(byId.get('caret')!.transform.rotationRadians).toBeCloseTo(Math.PI);
    expect(byId.get('caret')!.size).toEqual({ width: 10, height: 5 });
    // draw.io's default triangle points east: ours, turned a quarter, in a box with its sides swapped.
    const play = byId.get('play')!;
    expect(play.size).toEqual({ width: 20, height: 10 });
    expect(play.transform.rotationRadians).toBeCloseTo(Math.PI / 2);
    expect(byId.get('box')).toMatchObject({ content: { label: '' }, size: { width: 14, height: 14 } });
    const label = byId.get('box:label')!;
    expect(label).toMatchObject({ kind: 'text', content: { label: 'Top Management' } });
    expect(label.transform.translation.x).toBeCloseTo(70 + 14 + 7);
    // An icon's label below it: centred under the icon, its top just past the icon's bottom.
    const under = byId.get('icon:label')!;
    expect(byId.get('icon')!.content.label).toBe('');
    expect(under.transform.translation.x + under.size.width / 2).toBeCloseTo(320);
    expect(under.transform.translation.y).toBeCloseTo(342);
  });

  it('brings pictures across as images, and says which ones only draw.io has', async () => {
    const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
    const { document, losses } = await open(model(
      '<mxCell id="logo" value="Logo" style="shape=image;image=data:image/svg+xml,PHN2Zy8+;verticalLabelPosition=bottom;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="40" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="lib" style="image;image=img/lib/ibm/vpc/Router.svg;" vertex="1" parent="1"><mxGeometry x="100" y="10" width="40" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="lib2" style="image;image=img/lib/clip_art/Cloud.svg;" vertex="1" parent="1"><mxGeometry x="200" y="10" width="40" height="40" as="geometry"/></mxCell>',
    ));
    const byId = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    expect(byId.get('logo')).toMatchObject({ kind: 'image', content: { imageUrl: 'data:image/svg+xml;base64,PHN2Zy8+' } });
    expect(byId.get('logo:label')).toMatchObject({ kind: 'text', content: { label: 'Logo' } });
    expect(byId.get('lib')).toMatchObject({ content: { shape: 'rectangle' } });
    expect(losses).toEqual(['2 pictures come from draw.io’s own image library, so they are drawn as a box']);
  });

  it('fills %placeholders% from the cell or its container, and titles a hairline lane above it', async () => {
    const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
    const { document } = await open(model(
      '<object label="TO DO" status="New" id="lane"><mxCell style="swimlane;startSize=1;html=0;fillColor=#A0522D;" vertex="1" parent="1"><mxGeometry x="0" y="40" width="180" height="400" as="geometry"/></mxCell></object>'
      + '<object label="Task 1&lt;br&gt;%status%" placeholders="1" id="card"><mxCell style="html=1;fillColor=swimlane;" vertex="1" parent="lane"><mxGeometry x="20" y="21" width="140" height="80" as="geometry"/></mxCell></object>'
      + '<object label="Task 2 %owner% %missing%" owner="Ann" placeholders="1" id="own"><mxCell style="html=1;" vertex="1" parent="lane"><mxGeometry x="20" y="121" width="140" height="80" as="geometry"/></mxCell></object>'
      + '<object label="%status%" status="kept" id="off"><mxCell vertex="1" parent="1"><mxGeometry x="300" width="80" height="40" as="geometry"/></mxCell></object>',
    ));
    const byId = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    expect(byId.get('card')!.content.label).toBe('Task 1\nNew');
    // `fillColor=swimlane` takes the lane's colour.
    expect(byId.get('card')!.appearance.fill).toBe('#a0522d');
    expect(byId.get('own')!.content.label).toBe('Task 2 Ann %missing%');
    expect(byId.get('off')!.content.label).toBe('%status%');
    // The lane draws no band over its cards; its title sits just above it.
    expect(byId.get('lane')).toMatchObject({ kind: 'swimlane', content: { label: 'TO DO', showHeader: false } });
    const title = byId.get('lane:label')!;
    expect(title).toMatchObject({ kind: 'text', content: { label: 'TO DO' } });
    expect(title.transform.translation.y + title.size.height).toBeCloseTo(40 - 2);
  });

  it('reads an entity table: title in its own band, rows set left, crow’s-foot ends', async () => {
    const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
    const table = (id: string, x: number) => `<mxCell id="${id}" value="Section" style="swimlane;startSize=22;" vertex="1" parent="1"><mxGeometry x="${x}" y="100" width="140" height="110" as="geometry"/></mxCell>`
      + `<mxCell id="${id}r1" value="Row 1" style="text;whiteSpace=wrap;spacingLeft=4;" vertex="1" parent="${id}"><mxGeometry y="22" width="140" height="26" as="geometry"/></mxCell>`;
    const { document } = await open(model(table('a', 0) + table('b', 300)
      + '<mxCell id="rel" value="relation" style="startArrow=ERoneToMany;endArrow=ERmandOne;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>'));
    const byId = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    expect(byId.get('a')).toMatchObject({ kind: 'swimlane', content: { showHeader: false } });
    // The title is centred in draw.io's 22px band, not under our 40px one.
    const title = byId.get('a:label')!;
    expect(title.transform.translation.y + title.size.height / 2).toBeCloseTo(100 + 11);
    // A row starts at the table's left edge and its own top, hugging its words.
    const row = byId.get('ar1')!;
    expect(row.transform.translation).toEqual({ x: 0, y: 22 });
    expect(row.size.width).toBeLessThan(140);
    expect(document.pages[0]!.connectors[0]).toMatchObject({ semantics: { erRelation: '}|--||' } });
  });

  it('refuses what it cannot read, saying why', async () => {
    expect(await drawioToDocument('<mxfile><diagram>', 'doc', NOW)).toEqual({ error: 'It isn’t a readable draw.io file (<diagram> is never closed).' });
    expect(await drawioToDocument('<mxfile></mxfile>', 'doc', NOW)).toEqual({ error: 'It has no draw.io pages in it.' });
    expect(await drawioToDocument('<mxfile><diagram name="P">!!!not base64</diagram></mxfile>', 'doc', NOW))
      .toEqual({ error: 'None of its pages could be read: “P”: a page is compressed in a way OpenFlowKit can’t read, so it was left out' });
    expect(await drawioToDocument('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>', 'doc', NOW))
      .toEqual({ error: 'It has no shapes or connectors in it.' });
  });
});

describe('broken draw.io input', () => {
  const page = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
  const box = (id: string, parent = '1') =>
    `<mxCell id="${id}" value="${id}" style="rounded=1;" vertex="1" parent="${parent}"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell>`;

  it('never throws: a parent loop, a self-parent and a missing parent each say what was left out', async () => {
    const loop = page(`${box('a', 'b')}${box('b', 'a')}${box('ok')}`);
    const self = page(`${box('s', 's')}${box('ok')}`);
    const missing = page(`${box('m', 'nowhere')}${box('ok')}`);
    expect(await open(loop)).toMatchObject({ losses: ['2 shapes or connectors sit in a parent loop or under a missing parent, so they were left out'] });
    expect(await open(self)).toMatchObject({ losses: ['1 shape or connector sits in a parent loop or under a missing parent, so it was left out'] });
    expect(await open(missing)).toMatchObject({ losses: ['1 shape or connector sits in a parent loop or under a missing parent, so it was left out'] });
  });

  it('says when two cells share an id and keeps the first', async () => {
    const { document, losses } = await open(page(`${box('dup')}${box('dup')}`));
    expect(document.pages[0]!.nodes.map((node) => node.id)).toEqual(['dup']);
    expect(losses).toEqual(['two cells share the id “dup”, so the later one was left out']);
  });

  it('refuses an empty file, text that is not XML, and XML that is not draw.io, each with a reason', async () => {
    expect(await drawioToDocument('', 'doc', NOW)).toHaveProperty('error');
    expect(await drawioToDocument('just some text', 'doc', NOW)).toHaveProperty('error');
    expect(await drawioToDocument('<svg xmlns="http://www.w3.org/2000/svg"/>', 'doc', NOW)).toEqual({ error: 'It has no draw.io pages in it.' });
  });
});

describe('draw.io import fits ordinary documents', () => {
  const page = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;

  it('puts the first layer on the default layer id, so content from Diagram as code or AI pastes in', async () => {
    const { document } = await open(page('<mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>'));
    const [first] = document.pages;
    expect(first!.layers[0]!.id).toBe(DEFAULT_SCENE_LAYER_ID);
    const pasted = { ...first!.nodes[0]!, id: 'from-dsl', layerId: DEFAULT_SCENE_LAYER_ID };
    const withPaste = { ...document, pages: [{ ...first!, nodes: [...first!.nodes, pasted] }] };
    expect(validateSceneDocumentV1(withPaste).success).toBe(true);
  });

  it('treats style words like "constructor" and "__proto__" as plain unknowns, not as code', async () => {
    const cell = (id: string, style: string) =>
      `<mxCell id="${id}" value="${id}" style="${style}" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>`;
    const result = await drawioToDocument(page(
      cell('a', 'constructor;')
      + cell('b', 'shape=toString;labelPosition=constructor;verticalLabelPosition=hasOwnProperty')
      + cell('c', 'triangle;direction=constructor')
      + cell('d', '__proto__=x;fillColor=#ff0000')
      + '<mxCell id="e" edge="1" source="a" target="b" parent="1" style="startArrow=constructor;endArrow=toString"><mxGeometry as="geometry"/></mxCell>',
    ), 'doc', NOW);
    if ('error' in result) throw new Error(result.error);
    const nodes = result.document.pages[0]!.nodes;
    expect(nodes.map((node) => node.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(nodes.every((node) => node.kind === 'process')).toBe(true);
    expect(result.document.pages[0]!.connectors).toHaveLength(1);
    expect(result.losses).toEqual(expect.arrayContaining(['draw.io’s “constructor” shape is drawn as a box', 'draw.io’s “toString” shape is drawn as a box']));
  });
});

describe('big and deep draw.io files', () => {
  const wrap = (cells: string[]) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel>`;
  const vertex = (id: string, parent: string, style = '') =>
    `<mxCell id="${id}" value="${id}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell>`;

  it('opens 50,000 cells in groups, with connectors, in one pass', async () => {
    const cells: string[] = [];
    for (let group = 0; group < 1_000; group += 1) {
      cells.push(vertex(`g${group}`, '1', 'group'));
      for (let box = 0; box < 25; box += 1) {
        cells.push(vertex(`g${group}b${box}`, `g${group}`));
        if (box) cells.push(`<mxCell id="g${group}e${box}" edge="1" source="g${group}b${box - 1}" target="g${group}b${box}" parent="g${group}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
      }
    }
    const text = wrap(cells);
    const started = performance.now();
    const { document } = await open(text);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(document.pages[0]!.nodes).toHaveLength(26_000);
    expect(document.pages[0]!.connectors).toHaveLength(24_000);
  });

  it('opens groups nested 5,000 deep and a 100,000-word wrapped label without overflowing the stack', async () => {
    const cells = [vertex('n0', '1')];
    for (let depth = 1; depth < 5_000; depth += 1) cells.push(vertex(`n${depth}`, `n${depth - 1}`));
    const words = Array.from({ length: 100_000 }, () => 'word').join(' ');
    cells.push(`<mxCell id="t" value="${words}" style="text;whiteSpace=wrap" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>`);
    const { document } = await open(wrap(cells));
    expect(document.pages[0]!.nodes).toHaveLength(5_001);
  });
});
