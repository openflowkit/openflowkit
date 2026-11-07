import { describe, expect, it } from 'vitest';
import { applyDocumentCommand } from '../../domain/commands/execute';
import type { DocumentCommand } from '../../domain/commands/types';
import { migrateSceneDocument } from '../../domain/document/migration';
import type { ScenePage } from '../../domain/document/types';
import { addThread } from '../../domain/threads/threads';
import { createEmptyV2Document } from './v2Document';
import {
  buildInsertConnectorCommand,
  buildInsertShapeCommand,
  buildSetNodeLabelCommand,
} from '../../domain/commands/sceneEdits';
import { buildV2Export, buildV2JsonExport, buildV2SvgExport, slug } from './v2Export';

function labeledConnectedDocument() {
  const steps: ((page: ScenePage) => DocumentCommand)[] = [
    (page) => buildInsertShapeCommand(page, { kind: 'rectangle', id: 'node-a', at: { x: 10, y: 20 } }),
    (page) => buildInsertShapeCommand(page, { kind: 'ellipse', id: 'node-b', at: { x: 300, y: 20 } }),
    (page) => buildSetNodeLabelCommand(page, 'node-a', 'Checkout flow'),
    (page) =>
      buildInsertConnectorCommand(page, {
        id: 'edge-1',
        source: { nodeId: 'node-a' },
        target: { nodeId: 'node-b' },
      }),
  ];
  return steps.reduce(
    (document, step) => applyDocumentCommand(document, step(document.pages[0])).document,
    createEmptyV2Document('journey-doc', 'Journey')
  );
}

describe('v2 export', () => {
  // The 04d gate: downloaded JSON re-imported through migration deep-equals
  // the session document.
  it('round-trips JSON through migration without loss', () => {
    const document = labeledConnectedDocument();
    const { filename, json } = buildV2JsonExport(document);
    const migrated = migrateSceneDocument(JSON.parse(json));
    expect(filename).toBe('journey-doc.json');
    expect(migrated.success).toBe(true);
    expect(migrated.success && migrated.document).toEqual(document);
  });

  it('names a single-element export after the element and a lone connection after its own', async () => {
    const document = labeledConnectedDocument();
    const pageId = document.pages[0]!.id;
    const [node] = await buildV2Export({ document, format: 'svg', scope: 'selection', pageId, selectedNodeIds: ['node-a'] });
    expect(node?.filename).toBe('journey-checkout-flow.svg');
    const [edge] = await buildV2Export({ document, format: 'svg', scope: 'selection', pageId, selectedNodeIds: [], selectedConnectorIds: ['edge-1'] });
    expect(edge?.filename).toBe('journey-connection.svg');
  });

  it('emits SVG containing the label text', () => {
    const { svg, filename } = buildV2SvgExport(labeledConnectedDocument());
    expect(filename).toBe('journey-doc.svg');
    expect(svg).toContain('Checkout flow');
    expect(svg).toContain('data-connector-id="edge-1"');
  });
});

describe('slug', () => {
  it('keeps letters and digits of any script, folds accents, and never returns empty', () => {
    expect(slug('Pipeline 🚀 «ünï» & <b>tags</b>', 'x')).toBe('pipeline-uni-b-tags-b');
    expect(slug('流程图 2', 'x')).toBe('流程图-2');
    expect(slug('Диаграмма', 'x')).toBe('диаграмма');
    expect(slug('🚀', 'diagram')).toBe('diagram');
  });
});

describe('comment threads in a JSON export', () => {
  const base = labeledConnectedDocument();
  const document = addThread(base, {
    pageId: base.pages[0]!.id, threadId: 't1', nodeId: null, point: { x: 0, y: 0 },
    comment: { id: 'm1', author: { kind: 'human', name: 'Ada' }, body: 'private note', createdAt: '2026-10-26T12:00:00.000Z' },
  });
  const request = { document, format: 'json' as const, scope: 'document' as const, pageId: base.pages[0]!.id };

  it('are left out by default and put in on request', async () => {
    const [plain] = await buildV2Export(request);
    expect(plain!.text).not.toContain('private note');
    const [included] = await buildV2Export({ ...request, includeThreads: true });
    expect(included!.text).toContain('private note');
    expect(buildV2JsonExport(request.document).json).not.toContain('private note');
    expect(buildV2JsonExport(request.document, { includeThreads: true }).json).toContain('private note');
  });
});
