import { describe, expect, it } from 'vitest';
import type { ScenePage } from '../opencanvas/domain/document/types';
import { compile } from './compile';
import { frameScene, frameSource, frameText } from './frameScene';

async function pageOf(source: string): Promise<ScenePage> {
  const compiled = await compile(source);
  return {
    id: 'page-1', name: 'Page 1', diagramKind: compiled.meta.family,
    layers: [{ id: 'default', name: 'Layer 1', visible: true, locked: false }],
    nodes: [compiled.frame, ...compiled.groups, ...compiled.nodes],
    connectors: compiled.connectors, metadata: {}, extensions: {},
  } as ScenePage;
}

describe('frameSource', () => {
  it('is the text that drew the frame while the canvas still matches it', async () => {
    const source = 'flowchart\n%% the checkout\nCart -> Payment\n';
    const page = await pageOf(source);
    expect(frameSource(frameScene(page, page.nodes[0]!.id)!)).toBe(source);
  });

  it('writes the canvas back as code once the canvas was edited', async () => {
    const page = await pageOf('flowchart\nCart -> Payment\n');
    const edited = { ...page, nodes: page.nodes.map((node) => node.content.label === 'Payment'
      ? { ...node, content: { ...node.content, label: 'Stripe' } } : node) };
    const code = frameSource(frameScene(edited, edited.nodes[0]!.id)!);
    expect(code).toContain('Stripe');
    expect(code).not.toContain('Payment');
  });
});

describe('frameText', () => {
  it('names a palette the source does not, so the text alone redraws the diagram', async () => {
    const compiled = await compile('flowchart\nCart -> Payment\n', { appearance: { palette: 'mono' } });
    const page = { ...(await pageOf('flowchart\nA -> B')), nodes: [compiled.frame, ...compiled.groups, ...compiled.nodes], connectors: compiled.connectors };
    const text = frameText(frameScene(page, compiled.frame.id)!);
    expect(text).toBe('flowchart\nCart -> Payment\nappearance: mono');
    expect((await compile(text)).meta.appearance).toEqual({ palette: 'mono' });
  });

  it('leaves text alone when it already names the palette, or the palette is the default', async () => {
    const named = 'flowchart\nappearance: paper\nCart -> Payment\n';
    const page = await pageOf(named);
    expect(frameText(frameScene(page, page.nodes[0]!.id)!)).toBe(named);
    const plain = await pageOf('flowchart\nCart -> Payment\n');
    expect(frameText(frameScene(plain, plain.nodes[0]!.id)!)).toBe('flowchart\nCart -> Payment\n');
  });
});
