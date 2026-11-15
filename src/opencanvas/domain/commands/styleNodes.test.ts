import { describe, expect, it } from 'vitest';
import { createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { applyDocumentCommand } from './execute';
import { buildStyleNodesCommand } from './styleNodes';
import { buildV2SvgExport } from '../../presentation/v2/v2Export';

it('styles a selection atomically, preserves unrelated nodes, exports stroke and alpha', () => {
  const document = createTestDocument({ nodes: [createTestNode('a'), createTestNode('b')] });
  const page = document.pages[0];
  const patch = { fill: '#c9b8ed80', stroke: '#252724', strokeWidth: 3, strokeStyle: 'dashed' };
  const command = buildStyleNodesCommand(page, ['a'], patch)!;
  const applied = applyDocumentCommand(document, command);
  expect(applied.document.pages[0].nodes[0].appearance).toMatchObject(patch);
  expect(applied.document.pages[0].nodes[1]).toEqual(page.nodes[1]);
  const svg = buildV2SvgExport(applied.document).svg;
  expect(svg).toContain('fill="#c9b8ed80"');
  expect(svg).toContain('stroke-width="3" stroke-dasharray="12 9"');
  expect(applyDocumentCommand(applied.document, applied.inverse).document).toEqual(document);
});

describe('style no-ops', () => {
  it('does not create redundant history or mutate locked shapes', () => {
    const page = createTestDocument({ nodes: [createTestNode('a', { appearance: { fill: '#abcdef' } })] }).pages[0];
    expect(buildStyleNodesCommand(page, ['a'], { fill: '#abcdef' })).toBeNull();
    expect(buildStyleNodesCommand({ ...page, layers: page.layers.map((layer) => ({ ...layer, locked: true })) }, ['a'], { fill: '#fedcba' })).toBeNull();
  });
});

describe('icon card refit', () => {
  const tile = createTestNode('tile', {
    kind: 'architecture', size: { width: 148, height: 107 },
    content: { label: 'API', assetPresentation: 'icon', icon: 'tabler/server' },
  });
  const sizeAfter = (node: typeof tile, patch: Record<string, string | number>) => {
    const document = createTestDocument({ nodes: [node] });
    return applyDocumentCommand(document, buildStyleNodesCommand(document.pages[0], ['tile'], patch)!).document.pages[0].nodes[0].size;
  };

  it('re-fits a tile\'s height when the type size changes, keeping its width', () => {
    expect(sizeAfter(tile, { fontSize: 20 })).toEqual({ width: 148, height: Math.ceil(88 + 24 + 4) });
  });

  it('leaves a tile the author made taller alone when only its colour changes', () => {
    expect(sizeAfter({ ...tile, size: { width: 148, height: 200 } }, { fill: '#abcdef' })).toEqual({ width: 148, height: 200 });
  });
});

describe('a draw.io shape restyled', () => {
  it('shows the picked colours on a dark canvas, while the colours it came with still flip', async () => {
    const { resolveNodeStyle } = await import('../nodes/nodeStyle');
    const node = createTestNode('d', { kind: 'process', appearance: { fill: '#dae8fc', stroke: '#000000', textColor: '#000000', darkColors: 'invert' } });
    const page = createTestDocument({ nodes: [node] }).pages[0]!;
    const command = buildStyleNodesCommand(page, ['d'], { fill: '#fffbeb', stroke: '#fbbf24' })!;
    const after = applyDocumentCommand(createTestDocument({ nodes: [node] }), command).document.pages[0]!.nodes[0]!;
    const dark = resolveNodeStyle(after, '#191b19');
    expect([dark.fill, dark.stroke]).toEqual(['#fffbeb', '#fbbf24']);
    // A colour not picked here was set for draw.io's white page and still flips: a black line turns light.
    const fillOnly = applyDocumentCommand(createTestDocument({ nodes: [node] }), buildStyleNodesCommand(page, ['d'], { fill: '#fffbeb' })!).document.pages[0]!.nodes[0]!;
    expect(resolveNodeStyle(fillOnly, '#191b19').stroke).not.toBe('#000000');
  });
});
