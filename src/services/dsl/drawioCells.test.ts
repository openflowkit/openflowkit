import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { num, pageCells, pageModel } from './drawioCells';
import { parseXml, type XmlElement } from './xmlReader';

const xml = (text: string): XmlElement => {
  const parsed = parseXml(text);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.root;
};

describe('drawioCells', () => {
  it('reads plain and wrapped cells, with their geometry', () => {
    const cells = pageCells(xml(`<mxGraphModel><root><mxCell id="0"/>
      <mxCell id="a" value="A" style="ellipse" vertex="1" parent="0"><mxGeometry x="5" y="6" width="7" height="8" as="geometry"/></mxCell>
      <UserObject id="u" label="%status%" status="New" placeholders="1"><mxCell vertex="1" parent="0"/></UserObject>
      <mxCell value="no id"/></root></mxGraphModel>`));
    expect(cells.map((cell) => cell.id)).toEqual(['0', 'a', 'u']);
    expect(cells[1]).toMatchObject({ value: 'A', vertex: true, style: { ellipse: '' }, geometry: { x: 5, y: 6, width: 7, height: 8 } });
    expect(cells[2]).toMatchObject({ value: '%status%', placeholders: true, data: { status: 'New' } });
  });

  it('draws no words for a cell marked noLabel=1', () => {
    const cells = pageCells(xml(`<mxGraphModel><root><mxCell id="0"/>
      <mxCell id="a" value="Hidden" style="noLabel=1;" vertex="1" parent="0"/></root></mxGraphModel>`));
    expect(cells[1]!.value).toBe('');
  });

  it('inflates a compressed page and says when it cannot', async () => {
    const inner = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
    const packed = deflateRawSync(Buffer.from(encodeURIComponent(inner))).toString('base64');
    expect(await pageModel(xml(`<diagram>${packed}</diagram>`))).toMatchObject({ name: 'mxGraphModel' });
    expect(await pageModel(xml('<diagram>not base64 at all!</diagram>'))).toHaveProperty('error');
    expect(await pageModel(xml('<diagram/>'))).toEqual({ error: 'a page is empty' });
  });

  it('reads numbers, falling back on anything not finite', () => {
    expect(num('12.5')).toBe(12.5);
    expect(num('NaN', 3)).toBe(3);
    expect(num(undefined, 4)).toBe(4);
  });
});
