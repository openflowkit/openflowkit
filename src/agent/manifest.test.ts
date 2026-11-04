import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyDocumentCommand } from '@/opencanvas/domain/commands/execute';
import type { SceneDocumentV1 } from '@/opencanvas/domain/document/types';
import { compile, compileWorkspace } from '@/dsl/compile';
import { deterministicLayout } from '@/dsl/layout';
import { AGENT_OPS, CAPABILITY_MANIFEST, MANIFEST_VERSION, manifestCoverage, unlistedOps } from './manifest';
import { resolveAgentOpCommand } from './runAction';
import { createAgentDocument } from './index';
import type { OpCapabilities, OpContext } from './ops/types';

// Capabilities a pure test host can honour. compile() runs the deterministic
// layout port so no worker is needed; export/screenshot hand back fake bytes.
const capabilities: OpCapabilities = {
  compile: (text, options) => compile(text, { ...options, layout: options?.layout ?? deterministicLayout }),
  compileWorkspace: (text, options) => compileWorkspace(text, { ...options, layout: options?.layout ?? deterministicLayout }),
  syntax: (family) => `grammar${family ? `:${family}` : ''}`,
  searchIcons: async (query, limit) => Array.from({ length: Math.min(limit, 2) }, (_, index) => ({
    provider: 'aws', slug: `${query}-${index}`, label: `${query} ${index}`,
  })),
  exportFiles: async (request) => [{
    filename: `diagram.${request.format === 'json' ? 'json' : request.format}`,
    mime: request.format === 'png' ? 'image/png' : 'text/plain',
    ...(request.format === 'png' ? { base64: 'AAAA' } : { text: 'body' }),
  }],
  fitView: () => undefined,
};

const frameIdOf = (document: SceneDocumentV1, pageId = document.pages[0]!.id): string =>
  document.pages.find((page) => page.id === pageId)!.nodes.find((node) => node.kind === 'frame')!.id;

/** Inputs that exercise every op, including the read-only ones. */
async function inputs(document: SceneDocumentV1): Promise<ReadonlyArray<{ op: string; input: unknown }>> {
  const pageId = document.pages[0]!.id;
  const frameId = frameIdOf(document);
  const nodes = document.pages[0]!.nodes.filter((node) => node.kind !== 'frame');
  const ids = nodes.slice(0, 2).map(({ id }) => id);
  return [
    { op: 'create_diagram', input: { dsl: 'flowchart\n  A -> B', pageId } },
    { op: 'update_diagram', input: { frameId, dsl: 'flowchart\n  A -> B -> C' } },
    { op: 'get_diagram', input: { frameId } },
    { op: 'list_diagrams', input: {} },
    { op: 'get_syntax', input: { family: 'sequence' } },
    { op: 'search_icons', input: { query: 'lambda', limit: 2 } },
    { op: 'find_icons_for', input: { concept: 'cache', limit: 2 } },
    { op: 'move', input: { ids, delta: { x: 10, y: 0 } } },
    { op: 'style', input: { ids, fill: '#ff0000', opacity: 0.5 } },
    { op: 'add_shape', input: { kind: 'process', label: 'Extra', x: 0, y: 0 } },
    { op: 'export', input: { format: 'svg', scope: 'page', pageId } },
    { op: 'screenshot', input: { frameId } },
    { op: 'fit_view', input: { frameId } },
    { op: 'get_document', input: { pageId } },
    { op: 'list_pages', input: {} },
    { op: 'delete', input: { ids: [frameId] } },
  ];
}

/** The fixture every case runs against: a real compiled diagram. */
async function fixtureDocument(): Promise<SceneDocumentV1> {
  const empty = createAgentDocument('Manifest fixture', 'doc-fixture');
  const context: OpContext = { document: empty, pageId: empty.pages[0]!.id, capabilities };
  const created = await resolveAgentOpCommand(
    AGENT_OPS.find(({ name }) => name === 'create_diagram')!, { dsl: 'flowchart\n  Client [blue] -> API [emerald]\n  API -> Store [cylinder, red]' }, context);
  return applyDocumentCommand(empty, created.command!).document;
}

describe('agent manifest', () => {
  it('describes every op with a name, a title, a description, a schema and a runner', () => {
    expect(AGENT_OPS.length).toBeGreaterThan(0);
    for (const op of AGENT_OPS) {
      expect(op.name, 'name').toMatch(/^[a-z][a-z0-9_]*$/);
      expect(op.title.length, `${op.name} title`).toBeGreaterThan(2);
      expect(op.description.length, `${op.name} description`).toBeGreaterThan(20);
      expect(typeof op.schema?.parse, `${op.name} schema`).toBe('function');
      expect(typeof op.run, `${op.name} runner`).toBe('function');
    }
    expect(new Set(AGENT_OPS.map(({ name }) => name)).size).toBe(AGENT_OPS.length);
    expect(MANIFEST_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('has a manifest row per op, with an existing proof file for every mutating op', () => {
    expect(unlistedOps()).toEqual([]);
    // 20 ops: 10 with a UI twin proven by ops.test.ts or threadOps.test.ts, 9 of them mutating.
    expect(manifestCoverage()).toEqual({ ops: AGENT_OPS.length, withEquivalentUiPath: 10, mutating: 9 });
    for (const row of CAPABILITY_MANIFEST) {
      if (!row.equivalenceTest) continue;
      const path = join(process.cwd(), row.equivalenceTest);
      expect(existsSync(path), row.equivalenceTest).toBe(true);
      expect(readFileSync(path, 'utf8'), `${row.equivalenceTest} covers ${row.action}`).toContain(row.action);
    }
  });

  it('keeps read-only ops command-free and mutating ops reversible', async () => {
    const document = await fixtureDocument();
    const cases = await inputs(document);
    for (const { op: name, input } of cases) {
      const op = AGENT_OPS.find((candidate) => candidate.name === name);
      expect(op, `${name} is registered`).toBeTruthy();
      const context: OpContext = { document, pageId: document.pages[0]!.id, capabilities };
      const outcome = await resolveAgentOpCommand(op!, input, context);
      const row = CAPABILITY_MANIFEST.find(({ action }) => action === name)!;
      if (!row.mutates) {
        expect(outcome.command, `${name} must not mutate`).toBeNull();
        continue;
      }
      expect(outcome.command, `${name} produces a command`).not.toBeNull();
      const applied = applyDocumentCommand(document, outcome.command!);
      expect(applied.document, `${name} changes the document`).not.toEqual(document);
      const restored = applyDocumentCommand(applied.document, applied.inverse!);
      expect(restored.document, `${name} inverse restores the document`).toEqual(document);
    }
  });
});
