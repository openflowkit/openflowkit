import { describe, expect, it } from 'vitest';
import type { SceneConnector } from '../../opencanvas/domain/document/types';
import { drawioToDocument } from './drawio';

// A connector comes across with draw.io's own numbers: its corners, its label's plate and type, and where the
// label sits beside the line. Taken from electrical_2, where every one of these was redrawn our way.

const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const box = (id: string, x: number, y: number) =>
  `<mxCell id="${id}" vertex="1" parent="1" style=""><mxGeometry x="${x}" y="${y}" width="40" height="40" as="geometry"/></mxCell>`;
const loose = (id: string, style: string, from: [number, number], to: [number, number], more = '') =>
  `<mxCell id="${id}" value="${id}" edge="1" parent="1" style="${style}"><mxGeometry x="-0.1429" y="20" relative="1" as="geometry">`
  + `<mxPoint x="${from[0]}" y="${from[1]}" as="sourcePoint"/><mxPoint x="${to[0]}" y="${to[1]}" as="targetPoint"/>${more}</mxGeometry></mxCell>`;

async function connectors(cells: string): Promise<Map<string, SceneConnector>> {
  const result = await drawioToDocument(model(cells), 'doc', '2026-11-08T00:00:00.000Z');
  if ('error' in result) throw new Error(result.error);
  return new Map(result.document.pages[0]!.connectors.map((connector) => [connector.id, connector]));
}

describe('draw.io connectors keep draw.io’s numbers', () => {
  it('rounds corners only as draw.io does: 10px by default, none for rounded=0, half of arcSize when set', async () => {
    const lines = await connectors(box('a', 0, 0) + box('b', 200, 100)
      + '<mxCell id="plain" edge="1" parent="1" source="a" target="b" style=""><mxGeometry relative="1" as="geometry"/></mxCell>'
      + '<mxCell id="square" edge="1" parent="1" source="a" target="b" style="rounded=0;"><mxGeometry relative="1" as="geometry"/></mxCell>'
      + '<mxCell id="arc" edge="1" parent="1" source="a" target="b" style="rounded=1;arcSize=30;"><mxGeometry relative="1" as="geometry"/></mxCell>');
    expect(lines.get('plain')!.appearance.cornerRadius).toBe(10);
    expect(lines.get('square')!.appearance.cornerRadius).toBe(0);
    expect(lines.get('arc')!.appearance.cornerRadius).toBe(15);
  });

  it('draws a label with no border, on no plate at all when labelBackgroundColor=none, in the line’s own type', async () => {
    const lines = await connectors(loose('I', 'labelBackgroundColor=none;fontSize=16;fontColor=#ff0000;', [230, 100], [300, 100])
      + loose('J', '', [230, 200], [300, 200]));
    expect(lines.get('I')!.appearance).toMatchObject({ labelBackground: 'transparent', labelBorder: 'transparent', labelFontSize: 16, labelColor: '#ff0000' });
    expect(lines.get('J')!.appearance).toMatchObject({ labelBorder: 'transparent', labelFontSize: 11 });
    expect(lines.get('J')!.appearance.labelBackground).toBeUndefined();
  });

  it('sets a label beside its line by draw.io’s geometry y, square to the line', async () => {
    const lines = await connectors(loose('I', '', [230, 100], [300, 100]) + loose('U', '', [190, 360], [190, 280])
      + loose('moved', '', [0, 0], [100, 0], '<mxPoint x="5" y="-3" as="offset"/>'));
    expect(lines.get('I')!.labels[0]!.offset).toEqual({ x: 0, y: -20 });
    expect(lines.get('U')!.labels[0]!.offset).toEqual({ x: -20, y: 0 });
    expect(lines.get('moved')!.labels[0]!.offset).toEqual({ x: 5, y: -23 });
  });
});
