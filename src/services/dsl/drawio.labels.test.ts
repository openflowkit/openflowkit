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
    // spacingTop=-5 on draw.io's 2 lifts the words 3px and makes the box 1px taller; the sides keep 2px each.
    expect(place(node)).toEqual({ x: 22, y: 147, width: 526, height: 251 });
    expect(node.appearance).toMatchObject({ fill: 'transparent', stroke: 'transparent', textAlign: 'start', textVerticalAlign: 'top', textPadding: 0, fontWeight: 400 });
    expect(node.content.sizingPolicy).toMatchObject({ overflow: 'wrap', maxLines: 100 });
  });

  it('runs unwrapped words on past a tiny box from the side they are set against', async () => {
    const node = (await nodes(vertex('16', 'Yesterday', 'text;spacingTop=-5;align=right', 760, 310, 30, 20))).get('16')!;
    expect(place(node)).toEqual({ x: 762, y: 307, width: 26, height: 21 });
    expect(node.appearance).toMatchObject({ textAlign: 'end', textVerticalAlign: 'top' });
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
    expect(place(page.get('p:label')!)).toEqual({ x: 167, y: 300, width: 76, height: 80 });
    expect(page.get('p:label')!.appearance).toMatchObject({ textAlign: 'center', textVerticalAlign: 'top' });
  });

  it('gives words set beside a shape their own box there', async () => {
    const page = await nodes(vertex('c', 'Remember me', 'shape=mxgraph.ios.iCheckbox;labelPosition=right;align=left;', 0, 0, 20, 20));
    expect(page.get('c')!.content.label).toBe('');
    expect(place(page.get('c:label')!)).toEqual({ x: 22, y: 2, width: 20, height: 16 });
  });
});
