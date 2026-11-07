import { describe, expect, it } from 'vitest';
import { nodePaletteName } from '../opencanvas/domain/nodes/nodePalette';
import { createAgentDocument } from './index';
import manifestText from '../../mcp-server/data/icons.json?raw';
import { AUTO_ICON_IDS } from '../dsl/autoIcon';
import { resolveDslIcon } from '../services/dsl/iconResolver';
import { headlessElkLayout } from './headlessLayout';
import { createFileCapabilities, grammarSection, manifestIconResolver } from './host';
import type { IconMatch } from './ops/types';

const MANIFEST = JSON.parse(manifestText) as IconMatch[];
import { findAgentOp } from './ops';
import { addThread } from '../opencanvas/domain/threads/threads';

const GRAMMAR = `# OpenFlow DSL

## 4. Core statements

flowchart

## 8. Families

### 8.2 Sequence
`;

const document = () => createAgentDocument('Host fixture', 'doc-host');

describe('file host', () => {
  it('narrows the grammar to the requested family and returns it whole otherwise', () => {
    expect(grammarSection(GRAMMAR)).toBe(GRAMMAR);
    const sequence = grammarSection(GRAMMAR, 'sequence');
    expect(sequence).toContain('### 8.2 Sequence');
    expect(sequence).not.toContain('## 4. Core statements');
    expect(sequence).not.toContain('## 8. Families');
    // A `##` heading that names the family wins over its `###` subsections.
    expect(grammarSection(GRAMMAR, 'families')).toContain('## 8. Families');
    // An unknown family degrades to the full reference rather than nothing.
    expect(grammarSection(GRAMMAR, 'bpmn')).toBe(GRAMMAR);
  });

  it('honours a palette override and records it on the frame', async () => {
    const host = createFileCapabilities({ layout: headlessElkLayout, grammar: GRAMMAR });
    const pageWith = async (input: Record<string, unknown>) => {
      const outcome = await findAgentOp('create_diagram')!.run(input, {
        document: document(), pageId: 'doc-host:page-1', capabilities: host,
      });
      if (!outcome.command || outcome.command.kind !== 'set-page') throw new Error('expected a page command');
      return outcome.command.after;
    };
    const plain = await pageWith({ dsl: 'flowchart\n  A [blue] -> B' });
    expect(nodePaletteName(plain.nodes.find((node) => node.kind === 'frame')!)).toBe('pastel');

    const themed = await pageWith({ dsl: 'flowchart\n  A [blue] -> B', palette: 'mono' });
    expect(nodePaletteName(themed.nodes.find((node) => node.kind === 'frame')!)).toBe('mono');
    expect(nodePaletteName(themed.nodes.find((node) => node.id === 'a')!)).toBe('mono');
  });

  it('searches icons by provider, slug, label and token overlap', async () => {
    const host = createFileCapabilities({
      layout: headlessElkLayout,
      grammar: GRAMMAR,
      icons: [
        { provider: 'aws', slug: 'lambda', label: 'Lambda', category: 'Compute' },
        { provider: 'aws', slug: 'rds', label: 'RDS', category: 'Database' },
        { provider: 'azure', slug: 'functions', label: 'Functions', category: 'Compute' },
      ],
    });
    expect((await host.searchIcons('lambda', 5)).map(({ slug }) => slug)).toEqual(['lambda']);
    // Category matches tie, so the order is the documented slug tiebreak.
    expect((await host.searchIcons('compute', 5)).map(({ slug }) => slug).sort()).toEqual(['functions', 'lambda']);
    expect((await host.searchIcons('rds', 5)).map(({ provider }) => provider)).toEqual(['aws']);
    expect(await host.searchIcons('kubernetes', 5)).toEqual([]);
    expect((await host.searchIcons('aws lambda', 1)).length).toBe(1);
    // The editor's ranking, alias table included: the acronym an agent types finds the service.
    expect((await createFileCapabilities({ layout: headlessElkLayout, grammar: GRAMMAR, icons: [{ provider: 'aws', slug: 'application-integration-simple-queue-service', label: 'Simple Queue Service' }] }).searchIcons('sqs', 3)).map(({ slug }) => slug)).toEqual(['application-integration-simple-queue-service']);
  });

  it('resolves every auto-icon id through the shipped MCP manifest, exactly as the editor does', () => {
    const resolve = manifestIconResolver(MANIFEST);
    const differing = AUTO_ICON_IDS.filter((id) => resolve(id)?.shapeId !== id.split('/')[1]
      || JSON.stringify(resolve(id)) !== JSON.stringify(resolveDslIcon(id)));
    expect(differing).toEqual([]);
    expect(resolve('aws/lambda')).toEqual(resolveDslIcon('aws/lambda'));
  });

  it('puts icons from labels on file-mode diagrams, and honours icons: off', async () => {
    const host = createFileCapabilities({ layout: headlessElkLayout, grammar: GRAMMAR, icons: MANIFEST });
    const nodesOf = async (dsl: string) => {
      const outcome = await findAgentOp('create_diagram')!.run({ dsl }, {
        document: document(), pageId: 'doc-host:page-1', capabilities: host,
      });
      if (!outcome.command || outcome.command.kind !== 'set-page') throw new Error('expected a page command');
      return Object.fromEntries(outcome.command.after.nodes.map((node) => [node.id, node.content]));
    };
    const on = await nodesOf('flowchart\n  Web app [tech: React] -> Postgres -> Orders DB\n  Validate order');
    expect(on['web-app']).toMatchObject({ icon: 'developer/frontend-reactjs', archIconPackId: 'developer-icons-v1' });
    expect(on['orders-db']).toMatchObject({ icon: 'tabler/database', archIconPackId: 'tabler-outline-v3' });
    expect(on['validate-order']?.icon).toBeUndefined();
    const off = await nodesOf('flowchart\nicons: off\n  Postgres');
    expect(off.postgres?.icon).toBeUndefined();
  });

  it('exports svg, json and print html from the same source, and refuses png', async () => {
    const host = createFileCapabilities({ layout: headlessElkLayout, grammar: GRAMMAR });
    const created = await findAgentOp('create_diagram')!.run(
      { dsl: 'flowchart\n  A [blue] -> B' },
      { document: document(), pageId: 'doc-host:page-1', capabilities: host });
    if (!created.command || created.command.kind !== 'set-page') throw new Error('expected a page command');
    const documentWithFrame = { ...document(), pages: [created.command.after] };

    const svg = await host.exportFiles!({ document: documentWithFrame, format: 'svg', scope: 'page', pageId: 'doc-host:page-1', scale: 2 });
    expect(svg[0]?.text).toContain('<svg');
    expect(svg[0]?.text).toContain('data-pixel-ratio="2"');

    const json = await host.exportFiles!({ document: documentWithFrame, format: 'json', scope: 'document', pageId: 'doc-host:page-1' });
    expect(JSON.parse(json[0]!.text!)).toMatchObject({ id: 'doc-host' });
    // Comment threads are private conversation: the host never writes them into a file.
    const commented = addThread(documentWithFrame, {
      pageId: 'doc-host:page-1', threadId: 't1', nodeId: null, point: { x: 0, y: 0 },
      comment: { id: 'm1', author: { kind: 'human', name: 'Ada' }, body: 'private note', createdAt: '2026-10-26T12:00:00.000Z' },
    });
    const withThread = await host.exportFiles!({ document: commented, format: 'json', scope: 'document', pageId: 'doc-host:page-1' });
    expect(withThread[0]!.text).not.toContain('private note');

    const pdf = await host.exportFiles!({ document: documentWithFrame, format: 'pdf', scope: 'page', pageId: 'doc-host:page-1' });
    expect(pdf[0]?.mime).toBe('text/html');
    expect(pdf[0]?.text).toContain('@page');

    await expect(host.exportFiles!({ document: documentWithFrame, format: 'png', scope: 'page', pageId: 'doc-host:page-1' }))
      .rejects.toThrow(/live editor/);

    // Animated SVG is the one motion format a browserless host can serve.
    const animated = await host.exportFiles!({ document: documentWithFrame, format: 'svg-animated', scope: 'page', pageId: 'doc-host:page-1', preset: 'pulse' });
    expect(animated[0]?.text).toContain('@keyframes');
    expect(animated[0]?.text).toContain('prefers-reduced-motion');
    for (const format of ['gif', 'mp4', 'webm'] as const) {
      await expect(host.exportFiles!({ document: documentWithFrame, format, scope: 'page', pageId: 'doc-host:page-1' }))
        .rejects.toThrow(/live editor/);
    }
  });

  it('has no viewport to fit', () => {
    expect(createFileCapabilities({ layout: headlessElkLayout, grammar: GRAMMAR }).fitView).toBeUndefined();
  });
});
