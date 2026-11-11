import { describe, expect, it } from 'vitest';
import type { SceneDocumentV1 } from '../../opencanvas/domain/document/types';
import { drawioToDocument } from './drawio';

// Cells taken from draw.io's mindmap and kanban templates, which came across with stray arrows, flat branch names,
// a boxed root and lanes painted solid: lines draw.io doesn't paint, words turned along their branch, a container
// that is an ellipse, and a lane whose colour is only its title band's.

const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const box = (id: string, x: number, style = '') =>
  `<mxCell id="${id}" vertex="1" parent="1" style="${style}"><mxGeometry x="${x}" y="0" width="100" height="60" as="geometry"/></mxCell>`;
const edge = (id: string, style: string, inner = '', value = '') =>
  `<mxCell id="${id}" value="${value}" edge="1" parent="1" source="a" target="b" style="${style}"><mxGeometry relative="1" as="geometry"/></mxCell>${inner}`;

async function open(cells: string): Promise<SceneDocumentV1['pages'][number]> {
  const result = await drawioToDocument(model(cells), 'doc', '2026-11-11T00:00:00.000Z');
  if ('error' in result) throw new Error(result.error);
  return result.document.pages[0]!;
}

describe('draw.io cells that paint nothing, or paint turned', () => {
  it('leaves out a line draw.io doesn’t paint (strokeColor=none), keeping its words where they were', async () => {
    const page = await open(box('a', 0) + box('b', 300) + edge('ghost', 'strokeColor=none;endArrow=classicThin;')
      + edge('said', 'strokeColor=none;', '', 'still here') + edge('seen', 'strokeColor=#ff0000;'));
    expect(page.connectors.map((connector) => connector.id)).toEqual(['seen']);
    const words = page.nodes.find((node) => node.id === 'said:label')!;
    expect(words.content.label).toBe('still here');
    // Centred on the middle of the line from (100, 30) to (300, 30).
    expect(words.transform.translation.x + words.size.width / 2).toBeCloseTo(200);
    expect(words.transform.translation.y + words.size.height / 2).toBeCloseTo(30);
  });

  it('draws a block arrow with no line colour in its fill, since draw.io paints it by that', async () => {
    const page = await open(box('a', 0) + box('b', 300) + edge('flex', 'shape=flexArrow;strokeColor=none;fillColor=#0066CC;')
      + edge('empty', 'shape=flexArrow;strokeColor=none;fillColor=none;'));
    expect(page.connectors.map((connector) => [connector.id, connector.appearance.stroke])).toEqual([['flex', '#0066cc']]);
  });

  it('keeps words turned along a line as turned words, and unturned ones as the line’s label', async () => {
    const riding = (id: string, rotation: string) =>
      `<mxCell id="${id}" value="${id}" style="text;align=center;verticalAlign=middle;${rotation}" vertex="1" connectable="0" parent="e"><mxGeometry relative="1" as="geometry"><mxPoint y="-10" as="offset"/></mxGeometry></mxCell>`;
    const page = await open(box('a', 0) + box('b', 300) + edge('e', '', riding('flat', 'rotation=0;') + riding('turned', 'rotation=-30;')));
    expect(page.connectors[0]!.labels.map((label) => label.text)).toEqual(['flat']);
    const turned = page.nodes.find((node) => node.id === 'turned')!;
    expect(turned.content.label).toBe('turned');
    expect(turned.transform.rotationRadians).toBeCloseTo(-Math.PI / 6);
    expect(turned.appearance).toMatchObject({ fill: 'transparent', stroke: 'transparent', textAlign: 'center', textVerticalAlign: 'middle' });
    // Turned about its own point, 10 above the line's middle: the 1px box's centre stays there.
    const { x, y } = turned.transform.translation;
    const [cos, sin] = [Math.cos(-Math.PI / 6), Math.sin(-Math.PI / 6)];
    expect(Math.abs(x + (cos * turned.size.width - sin * turned.size.height) / 2 - 200)).toBeLessThan(1);
    expect(Math.abs(y + (sin * turned.size.width + cos * turned.size.height) / 2 - 20)).toBeLessThan(1);
  });

  it('draws a container in its own shape: an ellipse stays an ellipse, with its children inside it', async () => {
    const page = await open('<mxCell id="root" value="MIND" style="ellipse;whiteSpace=wrap;container=1;strokeWidth=2;" vertex="1" parent="1"><mxGeometry x="273" y="172" width="108" height="53" as="geometry"/></mxCell>'
      + '<mxCell id="kid" value="k" vertex="1" parent="root"><mxGeometry x="10" y="10" width="20" height="20" as="geometry"/></mxCell>'
      + '<mxCell id="plain" value="Group" style="container=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="60" as="geometry"/></mxCell>');
    const byId = new Map(page.nodes.map((node) => [node.id, node]));
    expect(byId.get('root')).toMatchObject({ kind: 'process', content: { shape: 'ellipse', label: 'MIND' }, size: { width: 108, height: 53 } });
    expect(byId.get('kid')).toMatchObject({ parentId: 'root', transform: { translation: { x: 10, y: 10 } } });
    // A plain box that holds things is still our container.
    expect(byId.get('plain')!.kind).toBe('section');
  });

  it('paints nothing for a container with no width or no height, as draw.io does', async () => {
    const page = await open('<mxCell id="tick" style="rounded=1;arcSize=50;container=1;" vertex="1" parent="1"><mxGeometry x="471" y="158" height="1" as="geometry"/></mxCell>'
      + box('a', 0));
    expect(page.nodes.find((node) => node.id === 'tick')!.appearance).toMatchObject({ fill: 'transparent', stroke: 'transparent' });
  });

  it('paints a lane’s colour on its title band only, and its body in swimlaneFillColor or not at all', async () => {
    const lane = (id: string, x: number, style: string) =>
      `<mxCell id="${id}" value="${id}" style="swimlane;${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="180" height="400" as="geometry"/></mxCell>`;
    const page = await open(lane('todo', 0, 'startSize=30;fillColor=#A0522D;strokeColor=#333333;')
      + lane('side', 200, 'startSize=30;horizontal=0;fillColor=#A0522D;swimlaneFillColor=#EEEEEE;') + lane('bare', 400, 'startSize=30;fillColor=none;')
      + lane('none', 600, 'startSize=0;fillColor=#A0522D;'));
    const byId = new Map(page.nodes.map((node) => [node.id, node]));
    expect(byId.get('todo')!.appearance.fill).toBe('transparent');
    expect(byId.get('todo:band')).toMatchObject({
      parentId: 'todo', transform: { translation: { x: 0, y: 0 } }, size: { width: 180, height: 30 }, appearance: { fill: '#a0522d' }, content: { label: '' },
    });
    // The band is painted before the title, so the words stay on top of it.
    expect(page.nodes.findIndex((node) => node.id === 'todo:band')).toBeLessThan(page.nodes.findIndex((node) => node.id === 'todo:label'));
    // Turned, the band runs down the left side.
    expect(byId.get('side')!.appearance.fill).toBe('#eeeeee');
    expect(byId.get('side:band')!.size).toEqual({ width: 30, height: 400 });
    // No colour, or no band at all: nothing extra is drawn.
    expect(byId.has('bare:band')).toBe(false);
    expect(byId.has('none:band')).toBe(false);
  });
});
