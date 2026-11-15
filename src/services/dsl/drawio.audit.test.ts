import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { SceneDocumentV1 } from '../../opencanvas/domain/document/types';
import { resolveNodeStyle } from '../../opencanvas/domain/nodes/nodeStyle';
import { paintOver } from '../../opencanvas/domain/color/adaptiveColor';
import { contrastRatio } from '../../lib/colorUtils';
import { drawioToDocument } from './drawio';

// Problems found by importing draw.io's own templates (.work audit): each kept from coming back.

async function open(text: string): Promise<{ document: SceneDocumentV1; losses: readonly string[] }> {
  const result = await drawioToDocument(text, 'doc', '2026-11-08T00:00:00.000Z');
  if ('error' in result) throw new Error(result.error);
  return result;
}
const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const cell = (id: string, style: string, x: number, parent = '1', more = '', w = 120, h = 60) =>
  `<mxCell id="${id}" value="${id}" vertex="1" parent="${parent}" style="${style}"${more}><mxGeometry x="${x}" y="0" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const stencil = (paths: string) => deflateRawSync(Buffer.from(encodeURIComponent(`<shape w="100" h="100"><foreground>${paths}</foreground></shape>`))).toString('base64');

describe('draw.io templates as the audit found them', () => {
  it('gives an ink-less label on a light container dark ink, so it reads in the dark theme too', async () => {
    const { document } = await open(model([
      cell('table', 'swimlane;fillColor=#dae8fc;', 0, '1', '', 400, 200),
      cell('row', 'text;html=1;', 20, 'table'),
      cell('hollow', 'fillColor=none;', 200, 'table'),
    ].join('')));
    const nodes = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    for (const canvas of ['#191b19', '#f7f7f5']) {
      const lane = resolveNodeStyle(nodes.get('table')!, canvas);
      const under = paintOver(lane.fill, canvas, lane.opacity);
      for (const id of ['row', 'hollow']) {
        const own = resolveNodeStyle(nodes.get(id)!, canvas);
        expect(contrastRatio(own.textColor, paintOver(own.fill, under, own.opacity)), `${id} on ${canvas}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('gives dark ink to words that lie over a light shape they are not inside', async () => {
    const { document } = await open(model([
      cell('card', 'rounded=1;fillColor=#fff2cc;', 0, '1', '', 400, 200),
      cell('note', 'text;html=1;', 20),
      cell('icon', 'shape=mxgraph.azure.sql_database;verticalLabelPosition=bottom;', 200, '1', '', 60, 60),
    ].join('')));
    const nodes = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    for (const canvas of ['#191b19', '#f7f7f5']) {
      const card = resolveNodeStyle(nodes.get('card')!, canvas);
      const under = paintOver(card.fill, canvas, card.opacity);
      for (const id of ['note', 'icon:label']) {
        const own = resolveNodeStyle(nodes.get(id)!, canvas);
        expect(contrastRatio(own.textColor, paintOver(own.fill, under, own.opacity)), `${id} on ${canvas}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('leaves out hidden shapes, their children and their connectors, and says so', async () => {
    const { document, losses } = await open(model([
      cell('shown', '', 0),
      cell('hidden', '', 200, '1', ' visible="0"'),
      cell('inside', '', 0, 'hidden'),
      '<mxCell id="e" edge="1" parent="1" source="shown" target="hidden"><mxGeometry relative="1" as="geometry"/></mxCell>',
      '<mxCell id="h" edge="1" parent="1" source="shown" target="shown" visible="0"><mxGeometry relative="1" as="geometry"/></mxCell>',
    ].join('')));
    expect(document.pages[0]!.nodes.map((node) => node.id)).toEqual(['shown']);
    expect(document.pages[0]!.connectors).toEqual([]);
    expect(losses).toEqual(['4 shapes or connectors hidden in draw.io were left out']);
  });

  it('reads an older freehand line (no lineShape) and one of several strokes as pen strokes', async () => {
    const one = stencil('<path><move x="0" y="0"/><line x="100" y="100"/></path>');
    const two = stencil('<path><move x="0" y="0"/><line x="100" y="0"/></path><path><move x="0" y="100"/><line x="100" y="100"/></path>');
    const { document, losses } = await open(model([
      cell('legacy', `shape=stencil(${one});fillColor=none;strokeColor=#ff0000;`, 0),
      cell('pair', `shape=stencil(${two});lineShape=1;`, 200),
    ].join('')));
    const nodes = document.pages[0]!.nodes;
    expect(nodes.map((node) => [node.id, node.kind])).toEqual([['legacy', 'pen'], ['pair', 'pen'], ['pair:stroke-2', 'pen']]);
    expect(nodes[2]!.content.points).toEqual([{ x: 0, y: 60 }, { x: 120, y: 60 }]);
    expect(losses).toEqual([]);
  });

  it('never prints a packed stencil in a loss', async () => {
    const filled = stencil('<path><move x="0" y="0"/><line x="100" y="0"/><line x="50" y="100"/><close/></path>');
    const { losses } = await open(model(cell('custom', `shape=stencil(${filled});fillColor=#ff0000;`, 0)));
    expect(losses).toEqual(['1 custom draw.io stencil is drawn as a box']);
  });

  it('draws a stand-in for an icon as an outline in its colour, not a filled slab', async () => {
    const { document } = await open(model(cell('wall', 'shape=mxgraph.floorplan.wallCorner;fillColor=#000000;', 0)
      + cell('lock', 'shape=mxgraph.aws4.door_lock;fillColor=#277116;strokeColor=none;', 200)));
    const [wall, lock] = document.pages[0]!.nodes;
    // A wall corner is drawn by draw.io's own code, in its own colour; only a shape nothing draws stands in.
    expect(wall!.content.drawio).toMatchObject({ shape: 'mxgraph.floorplan.wallCorner' });
    expect(wall!.appearance).toMatchObject({ fill: '#000000' });
    expect(lock!.appearance).toMatchObject({ fill: 'transparent', stroke: '#277116', strokeStyle: 'dashed' });
  });

  it('outlines a picture from draw.io’s library in its line colour, not its unpainted white fill', async () => {
    const { document } = await open(model(cell('pic', 'image;image=img/lib/clip_art/computers/Netbook_128x128.png;fillColor=#FFFFFF;strokeColor=#000000;', 0)
      + cell('bare', 'image;image=img/lib/clip_art/computers/Netbook_128x128.png;fillColor=#FFFFFF;', 200)));
    const byId = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    const [pic, bare] = [byId.get('pic'), byId.get('bare')];
    expect(pic!.appearance).toMatchObject({ fill: 'transparent', stroke: '#000000', strokeStyle: 'dashed' });
    expect(bare!.appearance).toMatchObject({ stroke: '#000000' });
  });

  it('names a set of icons drawn as boxes once, not one line per icon', async () => {
    const icons = ['door_lock', 'car', 'camera', 'car', 'bus', 'tree'].map((name, index) => cell(`i${index}`, `shape=mxgraph.aws4.${name};`, index * 100)).join('');
    const { losses } = await open(model(icons + cell('one', 'shape=mxgraph.flowchart.parallel_mode;', 0)));
    expect(losses).toEqual([
      '6 icons from draw.io’s “aws4” set are drawn as boxes (door lock, car, camera and 2 more)',
      'draw.io’s “mxgraph.flowchart.parallel_mode” shape is drawn as a box',
    ]);
  });

  it('keeps words made bold or coloured inside a label, and leaves a label of only line breaks plain', async () => {
    const { document, losses } = await open(model('<mxCell id="a" value="&lt;b&gt;Bold&lt;/b&gt; &lt;font color=&quot;#f00&quot;&gt;red&lt;/font&gt;" style="html=1;" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>'
      + '<mxCell id="b" value="line&lt;br&gt;break" style="html=1;" vertex="1" parent="1"><mxGeometry x="100" width="80" height="40" as="geometry"/></mxCell>'));
    const [a, b] = document.pages[0]!.nodes;
    expect(a!.content).toMatchObject({ label: 'Bold red', richLabel: [{ kind: 'text', runs: [{ bold: true, text: 'Bold' }, { text: ' ' }, { color: '#ff0000', text: 'red' }] }] });
    expect(b!.content.richLabel).toBeUndefined();
    expect(losses).toEqual([]);
  });

  it('keeps a line over the shapes drawn before it that it crosses, and under the ones drawn after', async () => {
    const edge = '<mxCell id="e" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>';
    const { document } = await open(model(cell('a', '', 0) + cell('band', 'fillColor=#dae8fc;', 140) + edge + cell('b', '', 300) + cell('cover', 'fillColor=#ffe6cc;', 200)));
    const under = document.pages[0]!.nodes.filter((node) => node.content.underLines === true).map((node) => node.id);
    expect(under).toEqual(['band']);
  });

  it('draws a line with a shape of its own as draw.io’s code draws it, and names one it can’t draw', async () => {
    const line = (id: string, style: string) => `<mxCell id="${id}" edge="1" parent="1" source="a" target="b" style="${style}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
    const { document, losses } = await open(model(cell('a', '', 0) + cell('b', '', 300)
      + line('arrow', 'shape=flexArrow;fillColor=#dae8fc;') + line('odd', 'shape=no.such.line;')));
    const [arrow, odd] = document.pages[0]!.connectors;
    expect(arrow!.extensions.drawioLine).toMatchObject({ style: { shape: 'flexArrow' }, fill: '#dae8fc' });
    expect((arrow!.extensions.drawioLine as { parts: unknown[] }).parts.length).toBeGreaterThan(0);
    expect(odd!.extensions.drawioLine).toBeUndefined();
    expect(losses).toContain('draw.io’s “no.such.line” line is drawn as a plain line');
  });

  it('flips a lane’s title band with the rest of it on a dark canvas, so its title stays readable', async () => {
    const { document } = await open(model(cell('t', 'swimlane;startSize=26;fillColor=#e0e0e0;swimlaneFillColor=#ffffff;', 0, '1', '', 200, 120)));
    const nodes = new Map(document.pages[0]!.nodes.map((node) => [node.id, node]));
    // draw.io's swimlane code draws the band in the lane's colour, which flips with the rest of it.
    expect(nodes.get('t:shape')!.appearance).toMatchObject({ fill: '#e0e0e0', darkColors: 'invert' });
    const band = resolveNodeStyle(nodes.get('t:shape')!, '#191b19');
    const title = resolveNodeStyle(nodes.get('t:label') ?? nodes.get('t')!, '#191b19');
    expect(contrastRatio(title.textColor, band.fill)).toBeGreaterThanOrEqual(4.5);
  });

  it('says an empty file is empty', async () => {
    expect(await drawioToDocument('  ', 'doc')).toEqual({ error: 'It’s empty.' });
  });
});
