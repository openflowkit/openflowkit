import { describe, expect, it } from 'vitest';
import type { SceneNode } from '../../opencanvas/domain/document/types';
import { drawioToDocument } from './drawio';

// Words land where draw.io lays them out: its label box (drawioLabelBox), set against the side they are aligned
// to, wrapped only when the cell says so. Cells taken from the blog wireframe template, where words landed centred,
// resized and spilling up over the header.

const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const vertex = (id: string, value: string, style: string, x: number, y: number, width: number, height: number) =>
  `<mxCell id="${id}" value="${value}" vertex="1" parent="1" style="${style}"><mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/></mxCell>`;

async function nodes(cells: string): Promise<Map<string, SceneNode>> {
  const result = await drawioToDocument(model(cells), 'doc', '2026-11-08T00:00:00.000Z');
  if ('error' in result) throw new Error(result.error);
  return new Map(result.document.pages[0]!.nodes.map((node) => [node.id, node]));
}
const place = (node: SceneNode) => ({ ...node.transform.translation, ...node.size });

describe('draw.io labels sit in draw.io’s label box', () => {
  it('keeps a wrapped paragraph in its box, set top-left, wrapping at the box and never spilling up', async () => {
    const page = await nodes(vertex('9', 'Lorem ipsum dolor sit amet', 'text;spacingTop=-5;whiteSpace=wrap;align=left', 20, 150, 530, 250));
    const node = page.get('9')!;
    // draw.io sets top-aligned words 5px below their spacing, so spacingTop=-5 on its 2 leaves them 2px in from
    // the top as from the sides: the cell's own box carries them, inset 2.
    expect(place(node)).toEqual({ x: 20, y: 150, width: 530, height: 250 });
    expect(node.appearance).toMatchObject({ fill: 'transparent', stroke: 'transparent', textAlign: 'start', textVerticalAlign: 'top', textPadding: 2, fontWeight: 400 });
    expect(node.content.sizingPolicy).toMatchObject({ overflow: 'wrap', maxLines: 100 });
  });

  it('runs unwrapped words on past a tiny box from the side they are set against', async () => {
    const node = (await nodes(vertex('16', 'Yesterday', 'text;spacingTop=-5;align=right', 760, 310, 30, 20))).get('16')!;
    expect(place(node)).toEqual({ x: 760, y: 310, width: 30, height: 20 });
    expect(node.appearance).toMatchObject({ textAlign: 'end', textVerticalAlign: 'top', textPadding: 2 });
    expect(node.content.sizingPolicy).toMatchObject({ overflow: 'visible' });
  });

  it('keeps a plain shape’s words on the shape, inset by draw.io’s spacing, in draw.io’s weight', async () => {
    const node = (await nodes(vertex('a', 'Start', 'rounded=1;whiteSpace=wrap;', 0, 0, 120, 60))).get('a')!;
    expect(node.content.label).toBe('Start');
    expect(place(node)).toEqual({ x: 0, y: 0, width: 120, height: 60 });
    expect(node.appearance).toMatchObject({ textPadding: 2, fontWeight: 400 });
  });

  it('sets a picture’s words below it, as draw.io’s image style does', async () => {
    const page = await nodes(vertex('p', 'Ethernet Switch', 'image;image=https://example.com/s.png;', 165, 218, 80, 80));
    expect(page.get('p:label')!.content.label).toBe('Ethernet Switch');
    // The words belong to the picture, so they are placed from its corner: 2px in, 80 down, and mxText’s 5px lower.
    expect(page.get('p:label')!.parentId).toBe('p');
    expect(place(page.get('p:label')!)).toEqual({ x: 2, y: 87, width: 76, height: 80 });
    expect(page.get('p:label')!.appearance).toMatchObject({ textAlign: 'center', textVerticalAlign: 'top' });
  });

  it('gives words set beside a shape their own box there', async () => {
    const page = await nodes(vertex('c', 'Remember me', 'shape=mxgraph.ios.iCheckbox;labelPosition=right;align=left;', 0, 0, 20, 20));
    expect(page.get('c')!.content.label).toBe('');
    expect(place(page.get('c:label')!)).toEqual({ x: 22, y: 2, width: 20, height: 16 });
  });

  it('names the shape whose words sit beside it, so editing either edits both', async () => {
    const page = await nodes(vertex('box', 'Message Endpoint', 'rounded=0;verticalLabelPosition=bottom;verticalAlign=top;fillColor=#c0f5a9', 0, 0, 120, 60));
    expect(page.get('box:label')!.content).toMatchObject({ label: 'Message Endpoint', labelOf: 'box' });
  });

  it('keeps a painted box holding shapes a shape, and an invisible one holding shapes a group', async () => {
    const child = (id: string, parent: string) => `<mxCell id="${id}" value="" vertex="1" parent="${parent}" style="rounded=0"><mxGeometry x="10" y="10" width="20" height="20" as="geometry"/></mxCell>`;
    const page = await nodes(vertex('endpoint', 'Endpoint', 'rounded=0;fillColor=#c0f5a9', 0, 0, 120, 60) + child('port', 'endpoint')
      + vertex('group', '', 'fillColor=none;strokeColor=none', 200, 0, 120, 60) + child('inside', 'group'));
    expect(page.get('endpoint')).toMatchObject({ kind: 'process', content: { label: 'Endpoint' } });
    expect(page.get('port')!.parentId).toBe('endpoint');
    expect(page.get('group')!.kind).toBe('section');
    expect(page.get('inside')!.parentId).toBe('group');
  });
});
