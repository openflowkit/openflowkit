import { describe, expect, it } from 'vitest';
import type { ConnectorEndpoint, SceneDocumentV1 } from '../../opencanvas/domain/document/types';
import { resolveNodeStyle } from '../../opencanvas/domain/nodes/nodeStyle';
import { paintOver } from '../../opencanvas/domain/color/adaptiveColor';
import { contrastRatio } from '../../lib/colorUtils';
import { drawioToDocument } from './drawio';
import flowchart from './fixtures/drawio/flowchart.drawio?raw';
import swimlanes from './fixtures/drawio/swimlanes.drawio?raw';
import architectureImages from './fixtures/drawio/architecture-images.drawio?raw';
import awsCompressed from './fixtures/drawio/aws-compressed.drawio?raw';
import multiPage from './fixtures/drawio/multi-page.drawio?raw';
import darkDrawn from './fixtures/drawio/dark-drawn.drawio?raw';

const NOW = '2026-11-08T00:00:00.000Z';

const end = (endpoint: ConnectorEndpoint) =>
  endpoint.nodeId ?? (endpoint.point ? `(${Math.round(endpoint.point.x)},${Math.round(endpoint.point.y)})` : '?');

/** One line per page, node and connector: what a person would check by eye against draw.io. */
function golden(document: SceneDocumentV1, losses: readonly string[]): string {
  const lines: string[] = [];
  for (const page of document.pages) {
    lines.push(`page "${page.name}": ${page.layers.length} layer(s), ${page.nodes.length} nodes, ${page.connectors.length} connectors`);
    for (const node of page.nodes) {
      const { x, y } = node.transform.translation;
      const shape = typeof node.content.shape === 'string' ? ` ${node.content.shape}` : '';
      const label = typeof node.content.label === 'string' && node.content.label ? ` "${node.content.label.replace(/\n/g, '⏎')}"` : '';
      const fill = typeof node.appearance.fill === 'string' ? ` fill ${node.appearance.fill}` : '';
      const color = node.appearance.textColor ?? node.content.customColor;
      const ink = typeof color === 'string' ? ` ink ${color}` : '';
      const parent = node.parentId ? ` in ${node.parentId}` : '';
      lines.push(`  ${node.kind}${shape}${label} @${Math.round(x)},${Math.round(y)} ${Math.round(node.size.width)}x${Math.round(node.size.height)}${fill}${ink}${parent}`);
    }
    for (const connector of page.connectors) {
      const labels = connector.labels.map((label) => ` "${label.text.replace(/\n/g, '⏎')}"`).join('');
      lines.push(`  ${end(connector.source)} -> ${end(connector.target)}${labels} ${connector.route.kind}, ${connector.waypoints.length} bends`);
    }
  }
  lines.push(`losses: ${losses.length ? losses.join('; ') : 'none'}`);
  return `${lines.join('\n')}\n`;
}

describe('drawioToDocument on files saved by draw.io', () => {
  it.each([
    ['flowchart', flowchart],
    ['swimlanes', swimlanes],
    ['architecture-images', architectureImages],
    ['aws-compressed', awsCompressed],
    ['multi-page', multiPage],
    ['dark-drawn', darkDrawn],
  ])('%s imports as its golden says', async (name, text) => {
    const result = await drawioToDocument(text, 'doc', NOW);
    if ('error' in result) throw new Error(result.error);
    await expect(golden(result.document, result.losses)).toMatchFileSnapshot(`./fixtures/drawio/golden/${name}.txt`);
  });
});

/** Each label against what lies under its centre, painted bottom-up, on one canvas. */
function contrasts(document: SceneDocumentV1, canvas: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const page of document.pages) {
    const byId = new Map(page.nodes.map((node) => [node.id, node]));
    const origin = (id: string | null): { x: number; y: number } => {
      const node = id ? byId.get(id) : undefined;
      if (!node) return { x: 0, y: 0 };
      const up = origin(node.parentId);
      return { x: up.x + node.transform.translation.x, y: up.y + node.transform.translation.y };
    };
    const box = page.nodes.map((node) => ({ node, at: origin(node.id) }));
    box.forEach(({ node, at }, index) => {
      if (typeof node.content.label !== 'string' || !node.content.label.trim()) return;
      const cx = at.x + node.size.width / 2;
      const cy = at.y + node.size.height / 2;
      const below = box.slice(0, index).filter(({ node: other, at: o }) =>
        other.id !== node.id && cx >= o.x && cx <= o.x + other.size.width && cy >= o.y && cy <= o.y + other.size.height);
      const backdrop = below.reduce((under, { node: other }) => {
        const { fill, opacity } = resolveNodeStyle(other, canvas);
        return paintOver(fill, under, opacity);
      }, canvas);
      const own = resolveNodeStyle(node, canvas);
      out.set(`${page.name}/${node.id} "${node.content.label}"`, contrastRatio(own.textColor, paintOver(own.fill, backdrop, own.opacity)));
    });
  }
  return out;
}

describe('draw.io labels in the dark theme', () => {
  it.each([
    ['flowchart', flowchart], ['swimlanes', swimlanes], ['architecture-images', architectureImages],
    ['aws-compressed', awsCompressed], ['multi-page', multiPage], ['dark-drawn', darkDrawn],
  ])('%s: no label reads worse on the dark canvas than draw.io drew it on white', async (_name, text) => {
    const result = await drawioToDocument(text, 'doc', NOW);
    if ('error' in result) throw new Error(result.error);
    const light = contrasts(result.document, '#f7f7f5');
    const dark = contrasts(result.document, '#191b19');
    const worse = [...dark].filter(([key, ratio]) => ratio < Math.min(4.5, light.get(key)! - 0.01)).map(([key, ratio]) => `${key} ${ratio.toFixed(2)} (light ${light.get(key)!.toFixed(2)})`);
    expect(worse).toEqual([]);
  });
});
