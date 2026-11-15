import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { drawioFromPng, drawioFromSvg, isPng } from './drawioFile';

const xml = '<mxfile><diagram name="P" id="p"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>';
const escaped = xml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
/** A PNG chunk; we never check the CRC, so it's zeros. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.length);
  return join(length, bytes(type), data, new Uint8Array(4));
}
const png = (...chunks: Uint8Array[]) => join(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', new Uint8Array(13)), ...chunks, chunk('IEND', new Uint8Array()));
const encoded = encodeURIComponent(xml);

describe('drawioFromSvg', () => {
  it('reads the diagram draw.io keeps in an exported SVG', () => {
    expect(drawioFromSvg(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" content="${escaped}"><g/></svg>`)).toBe(xml);
  });

  it('finds nothing in an ordinary SVG or in text that is not one', () => {
    expect(drawioFromSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBeNull();
    expect(drawioFromSvg('<svg content="hello"></svg>')).toBeNull();
    expect(drawioFromSvg(xml)).toBeNull();
    expect(drawioFromSvg('<svg')).toBeNull();
  });
});

describe('drawioFromPng', () => {
  it('reads the diagram from a tEXt, zTXt or iTXt chunk keyed mxfile', async () => {
    expect(await drawioFromPng(png(chunk('tEXt', bytes(`mxfile\0${encoded}`))))).toBe(xml);
    expect(await drawioFromPng(png(chunk('zTXt', join(bytes('mxfile\0\0'), deflateSync(Buffer.from(encoded))))))).toBe(xml);
    expect(await drawioFromPng(png(chunk('iTXt', bytes(`mxfile\0\0\0\0\0${encoded}`))))).toBe(xml);
    expect(await drawioFromPng(png(chunk('iTXt', join(bytes('mxfile\0\x01\0\0\0'), deflateSync(Buffer.from(encoded))))))).toBe(xml);
  });

  it('skips other text chunks to reach the diagram', async () => {
    expect(await drawioFromPng(png(chunk('tEXt', bytes('Software\0draw.io')), chunk('tEXt', bytes(`mxfile\0${encoded}`))))).toBe(xml);
  });

  it('finds nothing in a plain PNG, a broken chunk, a cut-off file or something not a PNG', async () => {
    expect(await drawioFromPng(png())).toBeNull();
    expect(await drawioFromPng(png(chunk('zTXt', bytes('mxfile\0\0not deflate'))))).toBeNull();
    expect(await drawioFromPng(png(chunk('tEXt', bytes('mxfile\0%E0%A4%A'))))).toBeNull();
    expect(await drawioFromPng(png(chunk('tEXt', bytes(`mxfile\0${encoded}`))).subarray(0, 40))).toBeNull();
    expect(await drawioFromPng(bytes(xml))).toBeNull();
    expect(isPng(bytes(xml))).toBe(false);
  });
});
