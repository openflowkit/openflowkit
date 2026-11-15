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
  it('draws a library shape, and a resource icon with its icon inside, as native shapes by draw.io’s own code', async () => {
    const { drawioToDocument } = await import('./drawio');
    const file = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="a" value="Lambda" style="shape=mxgraph.aws4.lambda_function;fillColor=#ED7100;strokeColor=#ffffff;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="78" height="78" as="geometry"/></mxCell>
      <mxCell id="b" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#ED7100;strokeColor=#ffffff;" vertex="1" parent="1"><mxGeometry x="200" y="10" width="78" height="78" as="geometry"/></mxCell>
      <mxCell id="c" style="shape=mxgraph.nowhere.at_all;" vertex="1" parent="1"><mxGeometry x="400" y="10" width="40" height="40" as="geometry"/></mxCell>
    </root></mxGraphModel>`;
    const result = await drawioToDocument(file, 'doc', '2026-11-11T00:00:00.000Z', diskStencils);
    if ('error' in result) throw new Error(result.error);
    const nodes = result.document.pages[0]!.nodes;
    const node = (id: string) => nodes.find((each) => each.id === id)!;
    const parts = (id: string) => node(id).content.drawioParts as unknown as { fill: string | null; stroke: string | null; path: unknown[] }[];
    expect(node('a').content.drawio).toMatchObject({ shape: 'mxgraph.aws4.lambda_function' });
    expect(parts('a').length).toBeGreaterThan(0);
    // The resource icon is its coloured square in the node's fill, and the Lambda icon on it in the node's line.
    expect(node('b').appearance).toMatchObject({ fill: '#ed7100', stroke: '#ffffff' });
    expect(parts('b').some((part) => part.fill === 'fill')).toBe(true);
    const icon = parts('b').find((part) => part.fill === 'stroke' || part.stroke === 'stroke');
    expect(icon?.path.length).toBeGreaterThan(10);
    // A shape draw.io has no drawing for is a box, and says so.
    expect(node('c').content.drawio).toBeUndefined();
    expect(result.losses.join(' ')).toContain('mxgraph.nowhere.at_all');
  });
});

describe('a library shape on a dark canvas', () => {
  it('is painted in its colours flipped, as draw.io’s dark mode paints it', async () => {
    const { invertForDark } = await import('../../opencanvas/domain/color/adaptiveColor');
    const node = { content: { stencilSvg: '<svg>#fe0001 #fe0002 #FFFFFF</svg>' }, appearance: { fill: '#ed7100', stroke: '#ffffff', darkColors: 'invert' } };
    expect(stencilPictureUrl(node, '#0f172a')).toContain(encodeURIComponent(invertForDark('#ed7100')));
    // A colour the stencil sets itself flips too.
    expect(stencilPictureUrl(node, '#0f172a')).not.toContain('FFFFFF');
    expect(stencilPictureUrl(node, '#ffffff')).toContain('FFFFFF');
    expect(stencilPictureUrl(node, '#ffffff')).not.toContain(encodeURIComponent(invertForDark('#ed7100')));
  });

  it('is marked to flip when imported, so cisco_2’s icons lighten on a dark canvas as in draw.io', async () => {
    const { drawioToDocument } = await import('./drawio');
    const file = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="r" style="shape=mxgraph.cisco.misc.route_switch_processor;html=1;fillColor=#036897;strokeColor=#ffffff;" vertex="1" parent="1"><mxGeometry width="64" height="86" as="geometry"/></mxCell>
    </root></mxGraphModel>`;
    const result = await drawioToDocument(file, 'doc', '2026-11-13T00:00:00.000Z', diskStencils);
    if ('error' in result) throw new Error(result.error);
    const node = result.document.pages[0]!.nodes.find((each) => each.id === 'r')!;
    expect(node.appearance).toMatchObject({ darkColors: 'invert' });
  });
});
