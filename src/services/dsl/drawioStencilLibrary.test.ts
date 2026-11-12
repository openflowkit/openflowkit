import { stencilPictureUrl } from '../../opencanvas/domain/nodes/imageNode';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadStencils, stencilKey, type StencilSource } from './drawioStencilLibrary';

/** The app's own copy of draw.io's libraries, read from disk. */
const diskStencils: StencilSource = {
  async index() { return JSON.parse(readFileSync('public/drawio-stencils/index.json', 'utf8')) as Record<string, string>; },
  async library(file) {
    try { return new Uint8Array(readFileSync(`public/drawio-stencils/${file}.deflate`)); } catch { return null; }
  },
};

describe('loadStencils', () => {
  it('finds library shapes by draw.io’s names, in libraries named by their package', async () => {
    const found = await loadStencils(['mxgraph.aws4.lambda', 'mxgraph.pid.compressors_-_iso.compressor_(centrifugal)', 'mxgraph.cisco.routers.router', 'rounded'], diskStencils);
    expect(found.get('mxgraph.aws4.lambda')?.name).toBe('shape');
    expect(found.has('mxgraph.pid.compressors_-_iso.compressor_(centrifugal)')).toBe(true);
    expect(found.has('mxgraph.cisco.routers.router')).toBe(true);
  });

  it('comes back empty when the libraries can’t be reached, so shapes fall back to boxes', async () => {
    const away: StencilSource = { index: async () => null, library: async () => null };
    expect((await loadStencils(['mxgraph.aws4.lambda'], away)).size).toBe(0);
  });

  it('names a stencil as draw.io’s registry does', () => {
    expect(stencilKey('mxgraph.EIP', 'Message Channel')).toBe('mxgraph.eip.message_channel');
  });
});

describe('drawioToDocument with library shapes', () => {
  it('draws a library shape by its stencil, and a resource icon by its icon, instead of a box', async () => {
    const { drawioToDocument } = await import('./drawio');
    const file = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="a" value="Lambda" style="shape=mxgraph.aws4.lambda_function;fillColor=#ED7100;strokeColor=#ffffff;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="78" height="78" as="geometry"/></mxCell>
      <mxCell id="b" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#ED7100;strokeColor=#ffffff;" vertex="1" parent="1"><mxGeometry x="200" y="10" width="78" height="78" as="geometry"/></mxCell>
      <mxCell id="c" style="shape=mxgraph.nowhere.at_all;" vertex="1" parent="1"><mxGeometry x="400" y="10" width="40" height="40" as="geometry"/></mxCell>
    </root></mxGraphModel>`;
    const result = await drawioToDocument(file, 'doc', '2026-11-11T00:00:00.000Z', diskStencils);
    if ('error' in result) throw new Error(result.error);
    const nodes = result.document.pages[0]!.nodes;
    const kind = (id: string) => nodes.find((node) => node.id === id)?.kind;
    expect(kind('a')).toBe('image');
    expect(kind('b')).toBe('image');
    // The picture is painted by the node's own colours, so recolouring the node recolours the stencil.
    const icon = nodes.find((node) => node.id === 'b')!;
    expect(icon.appearance).toMatchObject({ fill: '#ed7100', stroke: '#ffffff' });
    expect(stencilPictureUrl(icon)).toContain(encodeURIComponent('#ed7100'));
    expect(stencilPictureUrl({ ...icon, appearance: { ...icon.appearance, fill: '#123456' } })).toContain(encodeURIComponent('#123456'));
    expect(stencilPictureUrl({ ...icon, appearance: { ...icon.appearance, fill: '#123456' } })).not.toContain(encodeURIComponent('#ed7100'));
    expect(kind('c')).not.toBe('image');
    expect(result.losses.join(' ')).toContain('mxgraph.nowhere.at_all');
  });
});
