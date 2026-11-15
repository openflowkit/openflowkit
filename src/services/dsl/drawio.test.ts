import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { SceneDocumentV1 } from '../../opencanvas/domain/document/types';
import { DEFAULT_SCENE_LAYER_ID } from '../../opencanvas/domain/document/defaults';
import { validateSceneDocumentV1 } from '../../opencanvas/domain/document/validation';
import { resolveNodeStyle } from '../../opencanvas/domain/nodes/nodeStyle';
import { paintOver } from '../../opencanvas/domain/color/adaptiveColor';
import { projectConnector } from '../../opencanvas/domain/connectors/routeProjection';
import { contrastRatio } from '../../lib/colorUtils';
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
    expect(byId.get('pay')).toMatchObject({ content: { shape: 'rounded', label: 'Take\npayment' }, appearance: { fontWeight: 700 } });
    // Its #333333 is kept, and flips light in the dark theme as draw.io's does.
    expect(byId.get('pay')!.appearance).toMatchObject({ textColor: '#333333', darkColors: 'invert' });
    // A cylinder is drawn by draw.io's own code, as draw.io draws it.
    expect(byId.get('db')!.content.drawio).toMatchObject({ shape: 'cylinder3' });
  });

  it('turns edges into connectors with their labels, heads, dashes and bends', async () => {
    const { document } = await open(flow);
    const connectors = new Map(document.pages[0]!.connectors.map((connector) => [connector.id, connector]));
    expect(connectors.get('e1')).toMatchObject({
      source: { nodeId: 'start' }, target: { nodeId: 'check' },
      // draw.io's own line, fixed: the two shapes are in line, so its right-angle route is one straight run.
      route: { kind: 'direct', ownership: 'imported-fixed' }, appearance: { markerEnd: 'triangle-filled' },
    });
    expect(connectors.get('e2')).toMatchObject({
      labels: [{ text: 'yes', pathRatio: 0.5 }], waypoints: [{ x: 380, y: 20 }],
      route: { kind: 'polyline', ownership: 'imported-fixed' },
      appearance: { markerEnd: 'triangle-filled', dashPattern: 'dashed', stroke: '#ff0000' },
    });
    expect(connectors.get('e3')).toMatchObject({ labels: [{ text: 'writes', pathRatio: 0.25 }], appearance: { markerStart: 'circle-filled' } });
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
    expect(byId.get('note')).toMatchObject({ layerId: 'layer:2', content: { label: 'TODO' }, appearance: { fill: 'transparent', stroke: 'transparent' } });
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

  it('draws a freehand line as a pen stroke over its box, not as a box', async () => {
    // draw.io keeps a freehand line as a stencil: a path on a 0–100 grid, stretched over the cell.
    const path = '<shape strokewidth="inherit"><foreground><path><move x="0" y="0"/><line x="50" y="100"/><line x="100" y="50"/></path><stroke/></foreground></shape>';
    const stencil = (style: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>`
      + `<mxCell id="s" value="" style="shape=stencil(${compress(path)});${style}" vertex="1" parent="1"><mxGeometry x="10" y="20" width="200" height="40" as="geometry"/></mxCell>`
      + '</root></mxGraphModel>';
    const { document, losses } = await open(stencil('lineShape=1;strokeColor=#ff0000;strokeWidth=3;'));
    expect(document.pages[0]!.nodes).toEqual([expect.objectContaining({
      id: 's', kind: 'pen', transform: expect.objectContaining({ translation: { x: 10, y: 20 } }), size: { width: 200, height: 40 },
      content: { points: [{ x: 0, y: 0 }, { x: 100, y: 40 }, { x: 200, y: 20 }], strokeColor: '#ff0000', strokeWidth: 3 },
    })]);
    expect(losses).toEqual([]);
    // draw.io's default ink is left to the theme, as lines are.
    const plain = await open(stencil('lineShape=1;strokeColor=default;'));
    expect(plain.document.pages[0]!.nodes[0]!.content).toEqual({ points: [{ x: 0, y: 0 }, { x: 100, y: 40 }, { x: 200, y: 20 }], strokeWidth: 1 });
  });

  it('draws a freehand outline, as draw.io saves a pen stroke, as one line down its middle at its width', async () => {
    // Out along one edge and back along the other, 4 apart: draw.io fills it, a pen draws its middle 4 wide.
    const outline = '<shape strokewidth="inherit"><foreground><path><move x="0" y="0"/><line x="50" y="0"/><line x="100" y="0"/>'
      + '<line x="100" y="40"/><line x="50" y="40"/><line x="0" y="40"/><line x="0" y="0"/></path><fillstroke/></foreground></shape>';
    const { document } = await open('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
      + `<mxCell id="s" style="shape=stencil(${compress(outline)});lineShape=1;" vertex="1" parent="1"><mxGeometry width="100" height="10" as="geometry"/></mxCell>`
      + '</root></mxGraphModel>');
    expect(document.pages[0]!.nodes[0]!.content).toEqual({ points: [{ x: 0, y: 2 }, { x: 50, y: 2 }, { x: 100, y: 2 }], strokeWidth: 4 });
  });

  it('sizes a container draw.io lays out on open around its children, with its title centred in its band', async () => {
    // A layout container is saved with no geometry: draw.io runs ELK on open and wraps the children in its padding.
    const layout = encodeURIComponent('[{"layout":"elkLayered","config":{"elk.padding":"[top=40,left=20,bottom=20,right=20]"}}]');
    const { document } = await open('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
      + `<mxCell id="c" value="Vertical Flow Layout" style="swimlane;html=1;startSize=20;containerType=tree;childLayout=${layout};" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell>`
      + '<mxCell id="a" value="Start" vertex="1" parent="c"><mxGeometry x="136" y="330" width="100" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="b" value="End" vertex="1" parent="c"><mxGeometry x="120" y="510" width="230" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="e" edge="1" parent="c" source="a" target="b" style="endArrow=none;"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="186" y="450"/></Array></mxGeometry></mxCell>'
      + '</root></mxGraphModel>');
    const byId = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    const [container, title, start, end] = ['c', 'c:label', 'a', 'b'].map((id) => byId.get(id));
    // draw.io's own swimlane code draws the lane, the line under its title band with it.
    expect(byId.get('c:shape')).toMatchObject({ parentId: 'c', content: { drawio: { shape: 'swimlane' } } });
    expect(container).toMatchObject({ id: 'c', transform: { translation: { x: 100, y: 290 } }, size: { width: 270, height: 280 } });
    // Children stay where draw.io drew them on the page: their own coordinates are inside the container now.
    expect(start).toMatchObject({ id: 'a', parentId: 'c', transform: { translation: { x: 36, y: 40 } } });
    expect(end).toMatchObject({ id: 'b', parentId: 'c', transform: { translation: { x: 20, y: 220 } } });
    expect(document.pages[0]!.connectors[0]!.waypoints).toEqual([{ x: 186, y: 450 }]);
    // The title belongs to the container and fills its band less draw.io's 2px a side, so its words centre across it.
    expect(title).toMatchObject({ id: 'c:label', parentId: 'c', transform: { translation: { x: 2, y: 2 } }, size: { width: 266 } });
  });

  it('outlines a shape we draw as a stand-in box dashed, and draws table cells as cells', async () => {
    const { document, losses } = await open('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
      + '<mxCell id="p" style="shape=mxgraph.flowchart.parallel_mode;fillColor=#ff0000;" vertex="1" parent="1"><mxGeometry width="95" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="c" style="shape=partialRectangle;top=0;left=0;bottom=0;right=0;fillColor=none;" vertex="1" parent="1"><mxGeometry x="200" width="60" height="40" as="geometry"/></mxCell>'
      + '</root></mxGraphModel>');
    const [standIn, cell] = document.pages[0]!.nodes;
    expect(standIn!.appearance).toMatchObject({ fill: 'transparent', stroke: '#ff0000', strokeStyle: 'dashed' });
    expect(cell!.appearance.strokeStyle).toBeUndefined();
    expect(losses).toEqual(['draw.io’s “mxgraph.flowchart.parallel_mode” shape is drawn as a box']);
  });

  it('draws an uncoloured container neutral, not in a colour picked from its id', async () => {
    // Our swimlanes cycle colours by the digits in their id; draw.io's are plain, and its ids are full of digits.
    const { document } = await open('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
      + '<mxCell id="8kCe2PUUIjDvka_Ryf0c-3" value="Lane" style="swimlane;" vertex="1" parent="1"><mxGeometry width="200" height="100" as="geometry"/></mxCell>'
      + '</root></mxGraphModel>');
    expect(document.pages[0]!.nodes[0]!.content.color).toBe('slate');
  });

  it('says a gradient to the page colour is drawn solid', async () => {
    const { losses } = await open('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
      + '<mxCell id="a" style="ellipse;fillColor=#60a917;gradientColor=default;" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>'
      + '</root></mxGraphModel>');
    expect(losses).toEqual(['gradient fills are drawn solid']);
  });

  it('says what came across badly instead of dropping it silently', async () => {
    const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
    const { losses } = await open(model(
      '<mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="b" value="B" vertex="1" parent="1"><mxGeometry x="200" width="80" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="e" value="nowhere" edge="1" parent="1" source="a"><mxGeometry relative="1" as="geometry"/></mxCell>'
      + '<mxCell id="o" edge="1" style="edgeStyle=orthogonalEdgeStyle;" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="5" y="5"/></Array></mxGeometry></mxCell>',
    ));
    // The right-angle connector keeps draw.io's own route, so nothing is said about it.
    expect(losses).toEqual([
      'connector “nowhere”: it has a loose end, so it was left out',
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
    // A tiny text cell keeps draw.io's box, its words centred along the top and running on past it, as draw.io's do.
    const text = byId.get('t')!;
    expect(text).toMatchObject({ content: { label: 'Desired \nfunctionality', sizingPolicy: { overflow: 'visible' } } });
    // Top-set words sit draw.io's 2px spacing and mxText's 5px down.
    expect(text.appearance).toMatchObject({ fontSize: 12, textAlign: 'center', textVerticalAlign: 'top', textPadding: 7 });
    expect({ ...text.transform.translation, ...text.size }).toEqual({ x: 100, y: 300, width: 30, height: 20 });
    // A wrapping one wraps at draw.io's label box: the cell less 2px a side.
    expect(byId.get('w')!.size).toEqual({ width: 26, height: 16 });
    expect(byId.get('w')!.content.sizingPolicy).toMatchObject({ overflow: 'wrap' });
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
    // Triangles are drawn by draw.io's own code, which turns them by `direction`: the box is draw.io's, unturned.
    const caret = byId.get('caret')!;
    expect(caret.transform.rotationRadians).toBe(0);
    expect(caret.size).toEqual({ width: 10, height: 5 });
    const tip = (caret.content.drawioParts as unknown as { path: { x?: number; y?: number }[] }[])[0]!.path[1]!;
    expect([tip.x, tip.y]).toEqual([5, 5]);
    const play = byId.get('play')!;
    expect(play.size).toEqual({ width: 10, height: 20 });
    expect(play.transform.rotationRadians).toBe(0);
    expect(byId.get('box')).toMatchObject({ content: { label: '' }, size: { width: 14, height: 14 } });
    const label = byId.get('box:label')!;
    expect(label).toMatchObject({ content: { label: 'Top Management' }, appearance: { textAlign: 'start' } });
    // Placed from the checkbox's own corner: past its 14px, then spacingLeft 5 and draw.io's 2.
    expect(label.parentId).toBe('box');
    expect(label.transform.translation.x).toBeCloseTo(14 + 7);
    // An icon's label below it: centred under the icon, its top just past the icon's bottom.
    const under = byId.get('icon:label')!;
    expect(byId.get('icon')!.content.label).toBe('');
    expect(under.parentId).toBe('icon');
    expect(under.transform.translation.x + under.size.width / 2).toBeCloseTo(20);
    // 40 down the icon, draw.io's 2px spacing, and mxText's 5px for top-set words.
    expect(under.transform.translation.y).toBeCloseTo(47);
  });

  it('fades a shape draw.io’s code draws once, in its parts, and not its words', async () => {
    const { document } = await open('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
      + '<mxCell id="c" value="A" style="ellipse;rounded=1;fillColor=#1699D3;strokeColor=none;opacity=50;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="100" as="geometry"/></mxCell>'
      + '</root></mxGraphModel>');
    const circle = document.pages[0]!.nodes.find((node) => node.id === 'c')!;
    expect(circle.content.drawioParts).toBeDefined();
    expect(circle.appearance.opacity).toBeUndefined();
    const parts = circle.content.drawioParts as unknown as { fillOpacity: number }[];
    expect(parts.map((part) => part.fillOpacity)).toContain(0.5);
  });

  it('brings pictures across as images, draw.io’s own library loaded from draw.io’s server', async () => {
    const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
    const { document, losses } = await open(model(
      '<mxCell id="logo" value="Logo" style="shape=image;image=data:image/svg+xml,PHN2Zy8+;verticalLabelPosition=bottom;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="40" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="lib" style="image;image=img/lib/ibm/vpc/Router.svg;" vertex="1" parent="1"><mxGeometry x="100" y="10" width="40" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="lib2" style="image;image=img/lib/clip_art/Cloud.svg;" vertex="1" parent="1"><mxGeometry x="200" y="10" width="40" height="40" as="geometry"/></mxCell>',
    ));
    const byId = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    expect(byId.get('logo')).toMatchObject({ kind: 'image', content: { imageUrl: 'data:image/svg+xml;base64,PHN2Zy8+' } });
    expect(byId.get('logo:label')).toMatchObject({ content: { label: 'Logo' } });
    expect(byId.get('lib')).toMatchObject({ kind: 'image', content: { imageUrl: 'https://app.diagrams.net/img/lib/ibm/vpc/Router.svg' } });
    expect(losses).toEqual([]);
  });

  it('stretches a picture to its box where draw.io says imageAspect=0, and keeps its proportions otherwise', async () => {
    const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
    const picture = (id: string, extra: string) => `<mxCell id="${id}" style="shape=image;image=data:image/svg+xml,PHN2Zy8+;${extra}" vertex="1" parent="1"><mxGeometry x="10" y="10" width="80" height="20" as="geometry"/></mxCell>`;
    const { document } = await open(model(picture('wide', 'imageAspect=0;') + picture('kept', '')));
    const byId = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    expect(byId.get('wide')!.content.imageFit).toBe('stretch');
    expect(byId.get('kept')!.content.imageFit).toBeUndefined();
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
    // The lane draws no band over its cards; its title is centred on draw.io's 1px band along its top.
    expect(byId.get('lane')).toMatchObject({ kind: 'swimlane', content: { label: 'TO DO', showHeader: false } });
    const title = byId.get('lane:label')!;
    expect(title).toMatchObject({ content: { label: 'TO DO' } });
    expect(title.parentId).toBe('lane');
    expect(title.transform.translation.y + title.size.height / 2).toBeCloseTo(1);
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
    expect(title.parentId).toBe('a');
    expect(title.transform.translation.y + title.size.height / 2).toBeCloseTo(11);
    // A row's words start where draw.io sets them: 6px in (its own 4 and draw.io's 2) and 7 down (2 and mxText's 5),
    // wrapping at the row's width.
    const row = byId.get('ar1')!;
    expect({ ...row.transform.translation, ...row.size }).toEqual({ x: 6, y: 29, width: 132, height: 22 });
    expect(row.appearance).toMatchObject({ textAlign: 'start', textPadding: 0 });
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
    // A bare word draw.io's sheet doesn't have names nothing (draw.io ignores it); `shape=` names a shape.
    expect(result.losses).toEqual(expect.arrayContaining(['draw.io’s “toString” shape is drawn as a box']));
    expect(result.losses).not.toContain('draw.io’s “constructor” shape is drawn as a box');
  });
});

describe('draw.io connector ends and labels', () => {
  const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>`
    + '<mxCell id="a" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="60" as="geometry"/></mxCell>'
    + '<mxCell id="b" vertex="1" parent="1"><mxGeometry x="300" y="0" width="100" height="60" as="geometry"/></mxCell>'
    + `${cells}</root></mxGraphModel>`;
  const edge = (style: string, geometry = '<mxGeometry relative="1" as="geometry"/>', value = '') =>
    `<mxCell id="e" edge="1" parent="1" source="a" target="b" value="${value}" style="${style}">${geometry}</mxCell>`;

  it('leaves and enters shapes where draw.io pinned it', async () => {
    const { document } = await open(model(edge('exitX=1;exitY=0.25;entryX=0.5;entryY=1;')));
    const connector = document.pages[0]!.connectors[0]!;
    expect(connector.source.anchor).toEqual({ kind: 'normalized', x: 1, y: 0.25 });
    expect(connector.target.anchor).toEqual({ kind: 'normalized', x: 0.5, y: 1 });
    expect(connector.route).toEqual({ kind: 'direct', ownership: 'imported-fixed' });
  });

  it('moves a pin inside the shape out to its outline, as draw.io does, and keeps it there with exitPerimeter=0', async () => {
    const { document } = await open(model(edge('exitX=0.3;exitY=0.6;')));
    const connector = document.pages[0]!.connectors[0]!;
    // From the centre through (0.3, 0.6) the outline is met on the left side, three quarters down.
    expect(connector.source.anchor).toMatchObject({ kind: 'normalized', x: 0 });
    expect((connector.source.anchor as { y: number }).y).toBeCloseTo(0.75);
    // The unpinned end aims at the other and stops on the outline.
    expect(connector.target.anchor).toMatchObject({ kind: 'normalized', x: 0 });
    const kept = (await open(model(edge('exitX=0.3;exitY=0.6;exitPerimeter=0;')))).document.pages[0]!.connectors[0]!;
    expect(kept.source.anchor).toEqual({ kind: 'normalized', x: 0.3, y: 0.6 });
  });

  it('treats a pin that is not a number as no pin, and brings one outside the shape back to its outline', async () => {
    const { document } = await open(model(edge('exitX=abc;exitY=0.5;entryX=7;entryY=-2;')));
    const connector = document.pages[0]!.connectors[0]!;
    // Unpinned, the source aims at the target's end and leaves by its right side.
    expect(connector.source.anchor).toMatchObject({ kind: 'normalized', x: 1 });
    const target = connector.target.anchor as { x: number; y: number };
    expect(target.x).toBe(1);
    expect(target.y).toBeGreaterThanOrEqual(0);
    expect(target.y).toBeLessThanOrEqual(1);
    expect(validateSceneDocumentV1(document).success).toBe(true);
  });

  // geometry y sets the label 10 off the line, square to it (above a line running right), then the offset moves it.
  it('puts the line’s own label where it was dragged along the line', async () => {
    const geometry = '<mxGeometry x="-0.5" y="10" relative="1" as="geometry"><mxPoint x="4" y="-6" as="offset"/></mxGeometry>';
    const { document } = await open(model(edge('', geometry, 'go')));
    expect(document.pages[0]!.connectors[0]!.labels).toEqual([
      { id: 'e:label', text: 'go', pathRatio: 0.25, offset: { x: 4, y: -16 }, metadata: {} },
    ]);
  });

  it('connects shapes that sit in different groups', async () => {
    const cells = '<mxCell id="g" vertex="1" parent="1" style="group"><mxGeometry x="0" y="200" width="200" height="100" as="geometry"/></mxCell>'
      + '<mxCell id="c" vertex="1" parent="g"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="e2" edge="1" parent="g" source="c" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>';
    const { document } = await open(model(cells));
    const connector = document.pages[0]!.connectors.find((each) => each.id === 'e2');
    expect(connector).toMatchObject({ source: { nodeId: 'c' }, target: { nodeId: 'b' } });
  });
});

describe('draw.io containers and groups', () => {
  const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
  const vertex = (id: string, parent: string, at: string, extra = '') =>
    `<mxCell id="${id}" value="${id}" vertex="1" parent="${parent}" ${extra}><mxGeometry ${at} as="geometry"/></mxCell>`;

  it('keeps groups inside groups, each child placed in its own parent’s space', async () => {
    const { document } = await open(model(
      vertex('outer', '1', 'x="100" y="100" width="400" height="300"', 'style="group"')
      + vertex('inner', 'outer', 'x="20" y="30" width="200" height="150"', 'style="group"')
      + vertex('leaf', 'inner', 'x="5" y="7" width="60" height="40"'),
    ));
    const byId = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    expect(byId.get('outer')).toMatchObject({ kind: 'group', parentId: null, transform: { translation: { x: 100, y: 100 } } });
    expect(byId.get('inner')).toMatchObject({ kind: 'group', parentId: 'outer', transform: { translation: { x: 20, y: 30 } } });
    expect(byId.get('leaf')).toMatchObject({ parentId: 'inner', transform: { translation: { x: 5, y: 7 } } });
  });

  it('sets a sideways lane’s title up its left band instead of over its children', async () => {
    const { document } = await open(model(
      vertex('lane', '1', 'x="0" y="0" width="600" height="200"', 'style="swimlane;horizontal=0;startSize=30;"')
      + vertex('task', 'lane', 'x="40" y="10" width="100" height="40"'),
    ));
    const byId = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    expect(byId.get('lane')!.content.showHeader).toBe(false);
    const title = byId.get('lane:label')!;
    expect(title).toMatchObject({ content: { label: 'lane' } });
    expect(title.transform.rotationRadians).toBeCloseTo(-Math.PI / 2);
    // Turned about its centre, the title's centre is the band's centre: (15, 100).
    const { width, height } = title.size;
    const angle = title.transform.rotationRadians;
    const centre = {
      x: title.transform.translation.x + (width / 2) * Math.cos(angle) - (height / 2) * Math.sin(angle),
      y: title.transform.translation.y + (width / 2) * Math.sin(angle) + (height / 2) * Math.cos(angle),
    };
    expect(centre.x).toBeCloseTo(15);
    expect(centre.y).toBeCloseTo(100);
  });

  it('opens a folded container at its unfolded size and says so', async () => {
    const folded = '<mxCell id="box" value="Box" vertex="1" parent="1" collapsed="1" style="swimlane;">'
      + '<mxGeometry x="0" y="0" width="120" height="30" as="geometry"><mxRectangle width="400" height="250" as="alternateBounds"/></mxGeometry></mxCell>'
      + vertex('inside', 'box', 'x="20" y="60" width="80" height="40"');
    const { document, losses } = await open(model(folded));
    const box = document.pages[0]!.nodes.find((node) => node.id === 'box')!;
    expect(box.size).toEqual({ width: 400, height: 250 });
    expect(losses).toContain('“Box” was folded in draw.io, so it opens unfolded');
  });

  it('keeps the folded size when the unfolded one is missing or not a number', async () => {
    const folded = '<mxCell id="box" value="Box" vertex="1" parent="1" collapsed="1" style="swimlane;">'
      + '<mxGeometry x="0" y="0" width="120" height="30" as="geometry"><mxRectangle width="NaN" height="-5" as="alternateBounds"/></mxGeometry></mxCell>';
    const { document } = await open(model(folded));
    expect(document.pages[0]!.nodes.find((node) => node.id === 'box')!.size).toEqual({ width: 120, height: 30 });
    expect(validateSceneDocumentV1(document).success).toBe(true);
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
    // draw.io's own shape code loads once, on the first file that needs it; the test runner transforms its
    // 115,000 lines on that load, which is not the import's time. A two-box file loads it first.
    await open(wrap([vertex('w', '1'), vertex('w2', '1'), '<mxCell id="we" edge="1" source="w" target="w2" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>']));
    const started = performance.now();
    const { document } = await open(text);
    expect(performance.now() - started).toBeLessThan(3_000);
    // 25,000 boxes and 1,000 groups, each group's title a node of its own.
    expect(document.pages[0]!.nodes).toHaveLength(27_000);
    expect(document.pages[0]!.connectors).toHaveLength(24_000);
  });

  it('opens groups nested 5,000 deep and a 100,000-word wrapped label without overflowing the stack', async () => {
    const cells = [vertex('n0', '1')];
    for (let depth = 1; depth < 5_000; depth += 1) cells.push(vertex(`n${depth}`, `n${depth - 1}`));
    const words = Array.from({ length: 100_000 }, () => 'word').join(' ');
    cells.push(`<mxCell id="t" value="${words}" style="text;whiteSpace=wrap" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>`);
    const { document } = await open(wrap(cells));
    // Each painted box holding the next stays a shape with its own words: 5,000 boxes and the text.
    expect(document.pages[0]!.nodes).toHaveLength(5_001);
    expect(document.pages[0]!.nodes.find((node) => node.id === 'n1')!.parentId).toBe('n0');
  });
});

describe('draw.io colours in either theme', () => {
  const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
  const box = (id: string, style: string, x: number, y: number, parent = '1', w = 120, h = 60) =>
    `<mxCell id="${id}" value="${id}" vertex="1" parent="${parent}" style="${style}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;

  it('keeps every label readable on what is painted under it, light and dark', async () => {
    const { document } = await open(model([
      box('plain', 'rounded=0;whiteSpace=wrap;html=1;', 0, 0),
      box('defaults', 'fillColor=default;strokeColor=default;fontColor=default;', 140, 0),
      box('black-on-white', 'fillColor=#ffffff;fontColor=#000000;strokeColor=#000000;', 280, 0),
      box('black-on-pastel', 'fillColor=#dae8fc;fontColor=#000000;', 420, 0),
      box('black-on-teal', 'fillColor=#12b886;fontColor=#000000;', 560, 0),
      box('white-on-dark', 'fillColor=#333333;fontColor=#ffffff;', 700, 0),
      box('black-on-deep', 'fillColor=#006666;fontColor=#000000;', 840, 0),
      box('hollow', 'fillColor=none;fontColor=#000000;', 0, 100),
      box('faint', 'fillColor=#a5d8ff;opacity=30;fontColor=#000000;', 140, 100),
      box('words', 'text;html=1;fontColor=#000000;', 280, 100),
      box('lane', 'swimlane;fillColor=#fff2cc;fontColor=#000000;', 0, 200, '1', 600, 200),
      box('in-lane', 'fillColor=none;fontColor=#000000;', 20, 60, 'lane'),
      box('words-in-lane', 'text;html=1;fontColor=#000000;', 160, 60, 'lane'),
      box('white-in-lane', 'fillColor=#ffffff;fontColor=#000000;', 300, 60, 'lane'),
    ].join('')));
    const nodes = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    // What shows under each label: its own fill over its containers' fills, bottom up, over the canvas.
    const stacks: Record<string, readonly string[]> = {
      plain: ['plain'], defaults: ['defaults'], 'black-on-white': ['black-on-white'], 'black-on-pastel': ['black-on-pastel'],
      'black-on-teal': ['black-on-teal'], 'white-on-dark': ['white-on-dark'], hollow: ['hollow'], faint: ['faint'], words: [],
      'in-lane': ['lane', 'in-lane'], 'words-in-lane': ['lane'], 'white-in-lane': ['lane', 'white-in-lane'],
    };
    for (const canvas of ['#191b19', '#f7f7f5']) {
      const paint = (below: string, id: string) => {
        const { fill, opacity } = resolveNodeStyle(nodes.get(id)!, canvas);
        return paintOver(fill, below, opacity);
      };
      for (const [id, stack] of Object.entries(stacks)) {
        const backdrop = stack.reduce(paint, canvas);
        expect(contrastRatio(resolveNodeStyle(nodes.get(id)!, canvas).textColor, backdrop), `${id} on ${canvas}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Colours the author picked that read in both themes stay as picked.
    expect(nodes.get('black-on-teal')!.appearance.textColor).toBe('#000000');
    expect(nodes.get('white-on-dark')!.appearance.textColor).toBe('#ffffff');
    // A deep fill stays solid in the dark theme, so the author's black on it stays as drawn.
    expect(nodes.get('black-on-deep')!.appearance.textColor).toBe('#000000');
  });

  it('keeps every colour as drawn and flips it in the dark theme as draw.io does, keeping the words readable', async () => {
    const { document, losses } = await open(model([
      box('navy-words', 'text;html=1;fontColor=#232F3E;', 0, 0),
      box('red-on-washed-blue', 'fillColor=#BAC8D3;opacity=40;fontColor=#AE4132;', 140, 0),
      box('red-on-solid-blue', 'fillColor=#BAC8D3;fontColor=#AE4132;', 280, 0),
      box('red-on-misty-blue', 'fillColor=#BAC8D3;opacity=70;fontColor=#AE4132;', 420, 0),
      box('short-hex', 'fillColor=#BCD;opacity=70;fontColor=#A43;', 560, 0),
      box('grey-box', 'fillColor=#f5f5f5;strokeColor=#666666;', 700, 0),
    ].join('')));
    const nodes = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    expect(nodes.get('navy-words')!.appearance.textColor).toBe('#232f3e');
    expect(nodes.get('red-on-solid-blue')!.appearance).toMatchObject({ textColor: '#ae4132', darkColors: 'invert' });
    // coc.xml's light grey boxes turn near-black on the dark canvas, their grey lines light: draw.io's own colours.
    const grey = resolveNodeStyle(nodes.get('grey-box')!, '#191b19');
    expect([grey.fill, grey.stroke]).toEqual(['#212321', '#989998']);
    expect(resolveNodeStyle(nodes.get('grey-box')!, '#f7f7f5').fill).toBe('#f5f5f5');
    for (const id of ['navy-words', 'red-on-washed-blue', 'red-on-solid-blue', 'red-on-misty-blue', 'short-hex']) {
      const style = resolveNodeStyle(nodes.get(id)!, '#191b19');
      expect(contrastRatio(style.textColor, paintOver(style.fill, '#191b19', style.opacity)), id).toBeGreaterThanOrEqual(3);
    }
    expect(losses.some((loss) => loss.includes('label colour'))).toBe(false);
  });

  it('keeps draw.io’s black lines black, flipped light on a dark canvas as draw.io’s dark mode flips them', async () => {
    const { document } = await open(model([
      box('a', 'strokeColor=#000000;', 0, 0), box('b', 'strokeColor=#b85450;', 200, 0), box('d', 'strokeColor=default;fillColor=default;', 400, 0),
      '<mxCell id="e" edge="1" source="a" target="b" parent="1" style="strokeColor=#000000;"><mxGeometry relative="1" as="geometry"/></mxCell>',
    ].join('')));
    const page = document.pages[0]!;
    const node = (id: string) => page.nodes.find((each) => each.id === id)!;
    expect(node('a').appearance).toMatchObject({ stroke: '#000000', darkColors: 'invert' });
    expect(node('b').appearance.stroke).toBe('#b85450');
    // draw.io's `default` is its own white fill and black line.
    expect(node('d').appearance).toMatchObject({ fill: '#ffffff', stroke: '#000000' });
    expect(page.connectors[0]!.appearance).toMatchObject({ stroke: '#000000', darkColors: 'invert' });
    // On a dark canvas the black line is drawn light, as draw.io's dark mode draws it.
    expect(resolveNodeStyle(node('a'), '#191b19').stroke).not.toBe('#000000');
  });

});

describe('what a draw.io file loses, named', () => {
  const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
  const box = (id: string, style: string, x: number) =>
    `<mxCell id="${id}" value="${id}" vertex="1" parent="1" style="${style}"><mxGeometry x="${x}" y="0" width="120" height="60" as="geometry"/></mxCell>`;

  it('says once, with a count, each style it couldn’t keep', async () => {
    const { document, losses } = await open(model([
      box('a', 'glass=1;gradientColor=default;', 0), box('b', 'glass=1;', 200), box('c', 'rounded=1;', 400),
      '<mxCell id="e" edge="1" source="a" target="b" parent="1" style="endArrow=box;"><mxGeometry relative="1" as="geometry"/></mxCell>',
    ].join('')));
    expect([...losses].sort()).toEqual(['gradient fills are drawn solid', 'the glass shine is left off (2 places)']);
    // Its `box` end is draw.io's own, drawn by its connector code, not a stand-in.
    expect(document.pages[0]!.connectors[0]!.extensions.drawioLine).toMatchObject({ style: { shape: 'connector', endArrow: 'box' } });
    expect(losses.some((loss) => loss.includes('rounded'))).toBe(false);
  });

  it('draws a line’s ends with draw.io’s own code until its look is changed here, then as ours', async () => {
    const { document } = await open(model([
      box('a', '', 0), box('b', '', 200),
      '<mxCell id="e" edge="1" source="a" target="b" parent="1" style="endArrow=halfCircle;"><mxGeometry relative="1" as="geometry"/></mxCell>',
    ].join('')));
    const page = document.pages[0]!;
    const line = page.connectors[0]!;
    const drawn = projectConnector(page, line)!.drawn!;
    // draw.io's half circle: a curve, which none of our glyphs is.
    expect(drawn.parts.some((part) => part.path.some((command) => command.kind === 'quad' || command.kind === 'cubic'))).toBe(true);
    const thicker = { ...line, appearance: { ...line.appearance, strokeWidth: 4 } };
    expect(projectConnector({ ...page, connectors: [thicker] }, thicker)!.drawn).toBeUndefined();
  });

  it('keeps the bold, colour and size set on words in a connector’s label', async () => {
    const { document, losses } = await open(`<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="a" vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="40" as="geometry"/></mxCell>
      <mxCell id="b" vertex="1" parent="1"><mxGeometry x="200" y="0" width="40" height="40" as="geometry"/></mxCell>
      <mxCell id="e" value="&lt;b&gt;calls&lt;/b&gt; &lt;font color=&quot;#ff0000&quot;&gt;API&lt;/font&gt;" style="html=1;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
      <mxCell id="p" value="plain" style="html=1;" edge="1" parent="1" source="b" target="a"><mxGeometry relative="1" as="geometry"/></mxCell>
    </root></mxGraphModel>`);
    const connectors = new Map(document.pages[0]!.connectors.map((connector) => [connector.id, connector]));
    const runs = (connectors.get('e')!.labels[0]!.richLabel as { runs: { text: string; bold?: boolean; color?: string }[] }[])[0]!.runs;
    expect(runs.find((run) => run.text.includes('calls'))).toMatchObject({ bold: true });
    expect(runs.find((run) => run.text.includes('API'))).toMatchObject({ color: '#ff0000' });
    expect(losses.join(' ')).not.toContain('drawn plain');
  });
});
