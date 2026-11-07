// The op surface as MCP tools. One tool per op, generated from the shared
// manifest, plus the document/whoami tools that say where a call lands:
//
//   • live mode  — an editor is paired through the local bridge; the op runs in
//                  that window, against the document the user sees.
//   • file mode  — a `.openflow.json` document opened in this process; the op
//                  runs here with the file host capabilities (no raster).
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  AGENT_OPS, LOOKUP_OPS as LOOKUPS, MAX_IMAGE_KB, PAGELESS_OPS as PAGELESS, base64Kb, createAgentDocument, opInputShape, runAgentOp,
  type SceneDocumentV1,
} from '../lib/agent.js';
import type { DocumentStore } from '../lib/documentStore.js';
import { NOT_PAIRED, type LiveBridge } from '../lib/bridge.js';
import { loadFileCapabilities } from '../lib/fileCapabilities.js';
import { svgBeside, tryWriteSvgBeside } from '../lib/svgBeside.js';
import { toolError } from '../lib/errors.js';
import { clientShowsApps, diagramCard, VIEWER_TOOL_META, type Card } from '../lib/card.js';
import { DEFAULT_APP_ORIGIN, openUrl } from '../lib/openLink.js';

export interface OpToolDeps {
  readonly store: DocumentStore;
  readonly bridge: LiveBridge;
}

const documentIdField = z.string().min(1).optional()
  .describe('File-mode document id from openflow_open or openflow_create; omit to use the paired editor (or, in file mode, the document opened or created last).');

const SCRATCH = createAgentDocument('scratch');
const pageIdField = z.string().min(1).optional()
  .describe('Page to act on (see list_pages); defaults to the page the editor shows, or the first page in file mode. A repo map page is read from the code: a change for it lands on the map\'s drawing, which the editor shows.');

/** Tool results are plain JSON: agents parse them, humans read them. */
function text(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

type Picture = { readonly mime?: unknown; readonly base64?: unknown };

/**
 * An op result with every PNG (screenshot, image export) lifted into an MCP image block the client
 * can show; base64 inside JSON is over most clients' output cap and unreadable to the model anyway.
 */
function opResult(output: unknown, wrap: (output: unknown) => unknown): CallToolResult {
  const images: { type: 'image'; data: string; mimeType: string }[] = [];
  const lift = <T extends Picture>(file: T): T | Omit<T, 'base64'> & ({ image: number } | { tooLarge: string }) => {
    if (typeof file.base64 !== 'string' || typeof file.mime !== 'string' || !file.mime.startsWith('image/')) return file;
    const { base64, ...rest } = file;
    // A block this size is over most clients' cap: say how to get it instead.
    const kb = base64Kb(base64);
    if (kb > MAX_IMAGE_KB) return { ...rest, tooLarge: `The image is ${kb} KB, too large to show here. Call export with path to write it to a file, or use a lower scale.` };
    images.push({ type: 'image', data: base64, mimeType: file.mime });
    return { ...rest, image: images.length };
  };
  const record = output as (Picture & { files?: unknown }) | null;
  const lifted = record && typeof record === 'object'
    ? lift({ ...record, ...(Array.isArray(record.files) ? { files: record.files.map((file: Picture) => lift(file)) } : {}) })
    : output;
  const result = text(wrap(lifted));
  return images.length ? { content: [...result.content, ...images] } : result;
}

const exportPathField = z.string().min(1).optional()
  .describe("Write the file here instead of returning it (relative to, and inside, the server's working directory).");

type ExportFile = { mime: string; text?: string; base64?: string };

/** realpath of the nearest existing ancestor plus the not-yet-created tail, so a symlink anywhere on the way is followed. */
async function realTarget(path: string): Promise<string> {
  try { return await realpath(path); } catch {
    const parent = dirname(path);
    return parent === path ? path : join(await realTarget(parent), basename(path));
  }
}

/** The one rule for every file the server writes for an agent: resolved (symlinks included) inside the working directory. */
async function insideWorkingDirectory(target: string): Promise<string> {
  const root = process.cwd();
  const resolved = resolve(root, target);
  const inside = relative(await realpath(root), await realTarget(resolved));
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error(`path must be inside the server's working directory (${root}); "${target}" resolves outside it, symlinks included. Use a relative path such as "diagram.openflow.json".`);
  return resolved;
}

/** openflow_save writes documents only: an agent steered by a shared diagram must not overwrite ~/.zshrc or a script. */
async function savePathFor(target: string): Promise<string> {
  if (!/\.(json|ofk)$/i.test(target)) throw new Error(`openflow_save writes .openflow.json, .ofk or .json files only; "${target}" is none of them. Rename it, e.g. "${basename(target)}.openflow.json".`);
  return insideWorkingDirectory(target);
}

/** Writes the one exported file to `target` inside the working directory; the server owns disk IO in both modes. */
async function saveExport(output: unknown, target: string): Promise<{ saved: string; bytes: number; mime: string }> {
  const saved = await insideWorkingDirectory(target);
  const files = (output as { files?: readonly ExportFile[] }).files ?? [];
  if (files.length !== 1) throw new Error(`This export is ${files.length} files; pass scope: "page" (or a pageId) to write one.`);
  const [file] = files as [ExportFile];
  const bytes = file.base64 !== undefined ? Buffer.from(file.base64, 'base64') : Buffer.from(file.text ?? '', 'utf8');
  await mkdir(dirname(saved), { recursive: true });
  await writeFile(saved, bytes);
  return { saved, bytes: bytes.length, mime: file.mime };
}

/** The ops that draw a diagram: their result carries the card and, in file mode, a link to open it in the app. */
const DRAWING_OPS = new Set(['create_diagram', 'update_diagram']);
/** Longer links stay out of the text: the model reads every character of it. */
const MAX_TEXT_LINK = 4096;

type DrawnOutput = {
  pageId?: string; frameId?: string; title?: string | null; nodes?: number; connectors?: number;
  diagnostics?: readonly { severity: string; line: number; message: string }[];
  converted?: { dsl?: string; losses?: readonly { line: number; message: string }[] };
};

/** The DSL a drawing op ended up with: the converted text for Mermaid, D2 or Structurizr, else what was passed. */
const drawnDsl = (input: Record<string, unknown>, output: DrawnOutput): string => output.converted?.dsl ?? String(input.dsl ?? '');

/** The card for a drawn frame. The picture is best effort: the diagram is already drawn, so a failed export is a note, not an error. */
async function cardFor(input: Record<string, unknown>, output: DrawnOutput, picture: (frameId: string, pageId: string) => Promise<string>): Promise<Card> {
  let svg: string | null = null;
  if (output.frameId && output.pageId) svg = await picture(output.frameId, output.pageId).catch(() => null);
  return diagramCard({
    title: output.title || 'Diagram', svg, dsl: drawnDsl(input, output), appOrigin: DEFAULT_APP_ORIGIN,
    nodes: output.nodes ?? 0, connectors: output.connectors ?? 0,
    diagnostics: (output.diagnostics ?? []).filter(({ severity }) => severity !== 'info').map(({ severity, line, message }) => ({ severity, line, message })),
    losses: (output.converted?.losses ?? []).map((loss) => `line ${loss.line}: not converted: ${loss.message}`),
  });
}

const svgText = (exported: unknown): string => {
  const text = (exported as { files?: readonly { text?: string }[] }).files?.[0]?.text;
  if (!text) throw new Error('no SVG');
  return text;
};

/** Live editor wins whenever one is paired; file mode takes documentId, else the document opened or created last. */
export function registerOpTools(server: McpServer, deps: OpToolDeps): void {
  for (const op of AGENT_OPS) {
    server.registerTool(op.name, {
      title: op.title,
      description: op.description,
      inputSchema: {
        // Lookups read no document, so they take no documentId.
        ...(PAGELESS.has(op.name) ? {} : { pageId: pageIdField }), ...opInputShape(op), ...(LOOKUPS.has(op.name) ? {} : { documentId: documentIdField }),
        ...(op.name === 'export' ? { path: exportPathField } : {}),
      },
      ...(DRAWING_OPS.has(op.name) ? { _meta: VIEWER_TOOL_META } : {}),
    }, async (raw: Record<string, unknown>): Promise<CallToolResult> => {
      const { documentId, path: savePath, ...input } = raw;
      const agent = server.server.getClientVersion()?.name;
      const requestedPage = typeof input.pageId === 'string' ? input.pageId : undefined;
      const respond = async (output: unknown, wrap: (output: unknown) => unknown = (value) => value) => typeof savePath === 'string'
        ? text(wrap(await saveExport(output, savePath)))
        : opResult(output, wrap);
      // Only a host that can show the card gets it (see clientShowsApps); the text result is unchanged for everyone else.
      const withCard = async (result: CallToolResult, output: unknown, picture: (frameId: string, pageId: string) => Promise<string>): Promise<CallToolResult> =>
        DRAWING_OPS.has(op.name) && clientShowsApps(server.server.getClientCapabilities())
          ? { ...result, structuredContent: { ...await cardFor(input, output as DrawnOutput, picture) } }
          : result;
      try {
        if (!documentId && !deps.bridge.connected) await deps.bridge.retryPort();
        if (!documentId && deps.bridge.connected) {
          const output = await deps.bridge.call(op.name, input, requestedPage, agent);
          // Live: the diagram is on the user's canvas already, so no link; the card shows the frame as the editor drew it.
          return await withCard(await respond(output), output, async (frameId, pageId) =>
            svgText(await deps.bridge.call('export', { format: 'svg', scope: 'selection', ids: [frameId] }, pageId, agent)));
        }
        const id = (typeof documentId === 'string' ? documentId : undefined) ?? deps.store.latest()?.id;
        if (!id && !LOOKUPS.has(op.name)) {
          throw new Error(deps.bridge.unpairedReason ?? NOT_PAIRED);
        }
        // Grammar and icon lookups read no document, so an agent may call them before it has one.
        const document = id ? deps.store.get(id) as unknown as SceneDocumentV1 : SCRATCH;
        const pageId = requestedPage ?? document.pages[0]?.id ?? '';
        const capabilities = await loadFileCapabilities();
        const result = await runAgentOp(op, input, { document, pageId, capabilities, ...(agent ? { client: agent } : {}) });
        if (result.changed) deps.store.set(result.document as never);
        // File mode: the diagram lives only in this process until openflow_save, so the link is how a person sees it now.
        const link = DRAWING_OPS.has(op.name) ? openUrl(drawnDsl(input, result.output as DrawnOutput)) : null;
        const openInApp = link && link.length <= MAX_TEXT_LINK ? { openUrl: link } : {};
        return await withCard(
          await respond(result.output, (output) => ({ documentId: id, changed: result.changed, output, ...openInApp })),
          result.output,
          async (frameId, pageId) => svgText((await runAgentOp(AGENT_OPS.find(({ name }) => name === 'export')!,
            { format: 'svg', scope: 'selection', ids: [frameId] }, { document: result.document as SceneDocumentV1, pageId, capabilities })).output),
        );
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
      }
    });
  }
}

export type DocumentToolDeps = OpToolDeps;

export function registerDocumentTools(server: McpServer, deps: DocumentToolDeps): void {
  server.registerTool('openflow_create', {
    title: 'New document',
    description: 'Create an empty file-mode document in this process.',
    inputSchema: { name: z.string().min(1).default('Untitled diagram') },
  }, async ({ name }) => text(deps.store.create(name)));

  server.registerTool('openflow_open', {
    title: 'Open a .openflow.json',
    description: 'Load a canonical document from disk into file mode and return its id.',
    inputSchema: { path: z.string().min(1).describe('Absolute or cwd-relative path to a .openflow.json file.') },
  }, async ({ path }) => {
    try {
      const document = await deps.store.open(path);
      return text({ documentId: document.id, name: document.name, pages: document.pages.map(({ id, name: pageName }) => ({ id, name: pageName })) });
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool('openflow_save', {
    title: 'Save to .openflow.json',
    description: 'Write a document to disk (svg: true also writes the first page as a .svg beside it). With a paired editor and no documentId, saves what the editor currently shows.',
    inputSchema: {
      path: z.string().min(1).describe("Inside the server's working directory; .openflow.json, .ofk or .json only."),
      documentId: z.string().min(1).optional().describe('File-mode document; omit to save the paired editor document (or, in file mode, the one opened or created last).'),
      svg: z.boolean().default(false).describe('Also write the first page as <same name>.svg next to the file.'),
    },
  }, async ({ path: requested, documentId, svg }) => {
    try {
      const path = await savePathFor(requested);
      const agent = server.server.getClientVersion()?.name;
      if (!documentId && !deps.bridge.connected) await deps.bridge.retryPort();
      if (!documentId && deps.bridge.connected) {
        // Live mode: the editor owns the document, so ask it for canonical
        // JSON and write the bytes here (the server owns disk IO).
        const exported = await deps.bridge.call('export', { format: 'json', scope: 'document' }, undefined, agent) as {
          files?: readonly { text?: string }[];
        };
        const json = exported.files?.[0]?.text;
        if (!json) throw new Error('The editor did not return canonical JSON.');
        await writeFile(path, json, 'utf8');
        if (!svg) return text({ saved: path, mode: 'live-editor' });
        try {
          // The first page, as file mode and the docs say, not whichever page the editor shows.
          const picture = await deps.bridge.call('export', { format: 'svg', scope: 'page' }, deps.bridge.health().pages[0]?.pageId, agent) as { files?: readonly { text?: string }[] };
          const svgText = picture.files?.[0]?.text;
          if (!svgText) throw new Error('The editor did not return an SVG.');
          await writeFile(svgBeside(path), svgText, 'utf8');
          return text({ saved: path, svg: svgBeside(path), mode: 'live-editor' });
        } catch (error) {
          return text({ saved: path, svgError: error instanceof Error ? error.message : String(error), mode: 'live-editor' });
        }
      }
      const id = documentId ?? deps.store.latest()?.id;
      if (!id) throw new Error('Nothing to save: pass a documentId, or call openflow_create or openflow_open first.');
      await deps.store.save(id, path);
      if (!svg) return text({ saved: path, documentId: id });
      return text({ saved: path, ...await tryWriteSvgBeside(path, deps.store.get(id)), documentId: id });
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
  });

  server.registerTool('whoami', {
    title: 'Who am I talking to',
    description: 'Local-only status: whether an editor is paired, and the documents this server holds.',
    inputSchema: {},
  }, async () => {
    await deps.bridge.retryPort();
    const health = deps.bridge.health();
    const bridge = deps.bridge.status();
    return text({
      server: `${health.name} ${health.version}`,
      cloud: 'none — everything is local',
      bridge,
      mode: health.connected ? 'live-editor' : 'file',
      editor: health.connected
        ? { documentId: health.documentId, name: health.documentName, pageId: health.pageId, pages: health.pages, lastSeenMs: health.lastSeenMs }
        : null,
      documents: deps.store.list().map(({ id, name }) => ({ documentId: id, name })),
      hint: health.connected
        ? `Ops act on the paired editor${bridge.shared?.side === 'guest' ? `, through the OpenFlowKit server on port ${bridge.port} that other agent sessions share` : ''}. Pass documentId to target a file-mode document instead.`
        : deps.bridge.unpairedReason ?? NOT_PAIRED,
    });
  });
}
