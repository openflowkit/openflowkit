// The editor's WebMCP tools: every op in the registry, with the input schema the MCP server advertises, plus two
// only a browser can answer (what the person is looking at, and showing them what the agent means). Loaded only
// in a browser that has a model context; the editor supplies the live session through WebMcpEditor.
import { z, type ZodRawShape } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { SceneDocumentV1, ScenePage } from '../opencanvas/domain/document/types';
import { buildNodeStateMap, connectorVisible } from '../opencanvas/domain/scene/nodeState';
import { CAPABILITY_MANIFEST } from './manifest';
import { AGENT_OPS, MAX_IMAGE_KB, PAGELESS_OPS, base64Kb, opInputShape } from './ops';
import type { WebMcpTool } from './webMcp';

export interface WebMcpEditorView {
  readonly document: SceneDocumentV1;
  /** The page the editor shows. */
  readonly pageId: string;
  /** What the canvas draws: the page, or in Map mode the map of its model. */
  readonly scene: ScenePage;
  readonly mode: 'canvas' | 'map';
  readonly readOnly: boolean;
  /** Node and connector ids the person has selected. */
  readonly selection: readonly string[];
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  /** Top-level node ids drawn at least partly on screen now. */
  readonly onScreen: readonly string[];
}

export interface WebMcpEditor {
  /** One op through the shared live runner (runLiveAgentOp); rejects with a message for the agent. `signal` is the call's own. */
  readonly run: (name: string, input: Record<string, unknown>, pageId?: string, signal?: AbortSignal) => Promise<unknown>;
  /** Null until a document is open. */
  readonly view: () => WebMcpEditorView | null;
  readonly select: (nodeIds: readonly string[], connectorIds: readonly string[], reveal: boolean) => void;
}

/** Results that carry the person's own text (labels, names, DSL, a picture of them): data for the agent, never instructions. */
const USER_CONTENT = new Set(['get_document', 'list_threads', 'get_diagram', 'list_diagrams', 'list_pages', 'export', 'screenshot', 'get_view']);
/** Raster animation runs to megabytes: far past what a tool result carries. */
const MOTION_RASTER = new Set(['gif', 'mp4', 'webm']);
const pageIdField = z.string().min(1).optional()
  .describe('Page to act on (see list_pages); defaults to the page the editor shows. A repo map page is read from the code: a change for it lands on the map\'s drawing, which the editor shows.');
/** At most this many on-screen shapes are named; the count says how many there are. */
const ON_SCREEN_LIMIT = 100;

/** The MCP SDK's conversion, so a browser agent sees the schema an MCP client does. A `$ref` would be a bug (see pointSchema). */
export function jsonSchemaOf(shape: ZodRawShape): object {
  return zodToJsonSchema(z.object(shape), { strictUnions: true, pipeStrategy: 'input' });
}

const describeNode = (scene: ScenePage, id: string) => {
  const node = scene.nodes.find((candidate) => candidate.id === id);
  if (node) return { id, kind: node.kind, label: typeof node.content.label === 'string' ? node.content.label : '' };
  const connector = scene.connectors.find((candidate) => candidate.id === id);
  return connector ? { id, kind: 'connector', label: connector.labels[0]?.text ?? '' } : null;
};

function requireView(editor: WebMcpEditor): WebMcpEditorView {
  const view = editor.view();
  if (!view) throw new Error('The editor has no document open.');
  return view;
}

const getView = (editor: WebMcpEditor) => {
  const view = requireView(editor);
  const page = view.document.pages.find((candidate) => candidate.id === view.pageId);
  const named = (ids: readonly string[]) => ids.flatMap((id) => describeNode(view.scene, id) ?? []);
  return {
    documentId: view.document.id,
    name: view.document.name,
    pageId: view.pageId,
    pageName: page?.name ?? '',
    pageIndex: view.document.pages.findIndex((candidate) => candidate.id === view.pageId),
    pages: view.document.pages.length,
    mode: view.mode,
    readOnly: view.readOnly,
    selection: named(view.selection),
    camera: view.camera,
    onScreen: named(view.onScreen.slice(0, ON_SCREEN_LIMIT)),
    onScreenCount: view.onScreen.length,
  };
};

const selectShape = { ids: z.array(z.string().min(1)).describe('Node and connector ids on the page in view (get_view, get_document); [] clears the selection.'),
  reveal: z.boolean().default(true).describe('Glide the camera to them when any is off screen.') };
const selectSchema = z.object(selectShape);

const select = (editor: WebMcpEditor, raw: unknown) => {
  const { ids, reveal } = selectSchema.parse(raw ?? {});
  const view = requireView(editor);
  const nodeIds = ids.filter((id) => view.scene.nodes.some((node) => node.id === id));
  const connectorIds = ids.filter((id) => view.scene.connectors.some((connector) => connector.id === id));
  const missing = ids.filter((id) => !nodeIds.includes(id) && !connectorIds.includes(id));
  if (missing.length) throw new RangeError(`Not on the page in view (${view.pageId}): ${missing.join(', ')}. get_view says what the person is looking at.`);
  // The rule Layers and the renderer use: a hidden shape, a hidden connector, or one to a hidden shape is not on screen.
  const states = buildNodeStateMap(view.scene);
  const hidden = [
    ...nodeIds.filter((id) => states.get(id)?.visible === false),
    ...view.scene.connectors.filter((connector) => connectorIds.includes(connector.id) && !connectorVisible(connector, states)).map(({ id }) => id),
  ];
  if (hidden.length) throw new RangeError(`Hidden, so the person cannot see them selected: ${hidden.join(', ')}. Leave them out, or ask the person to show them.`);
  editor.select(nodeIds, connectorIds, reveal);
  return { pageId: view.pageId, selected: ids };
};

type FileBody = { readonly base64?: unknown; readonly [key: string]: unknown };

/** A file body past MAX_IMAGE_KB says so instead of carrying the bytes (the MCP server's rule, with this transport's way out). */
function capped<T extends FileBody>(file: T): T | Omit<T, 'base64'> & { tooLarge: string } {
  if (typeof file.base64 !== 'string' || base64Kb(file.base64) <= MAX_IMAGE_KB) return file;
  const { base64, ...rest } = file;
  return { ...rest, tooLarge: `The file is ${base64Kb(base64)} KB, too large to return here. Use a lower scale, a page or selection scope, or SVG.` };
}

function cappedOutput(output: unknown): unknown {
  if (!output || typeof output !== 'object') return output;
  const record = capped(output as FileBody);
  return Array.isArray(record.files) ? { ...record, files: record.files.map((file: FileBody) => capped(file)) } : record;
}

/** A tool's failure goes back as the result: a rejected execute reaches the agent as a bare OperationError. */
const answered = (run: () => unknown) => async (): Promise<unknown> => {
  try { return await run(); } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
};

/** Every op (only the reads when the document is read-only) and the browser's own tools. */
export function webMcpTools(editor: WebMcpEditor, { readOnly }: { readonly readOnly: boolean }): WebMcpTool[] {
  const mutates = new Map(CAPABILITY_MANIFEST.map((row) => [row.action, row.mutates]));
  const ops = AGENT_OPS.filter((op) => !(readOnly && mutates.get(op.name) !== false)).map<WebMcpTool>((op) => ({
    name: op.name,
    title: op.title,
    description: op.description,
    inputSchema: jsonSchemaOf({ ...(PAGELESS_OPS.has(op.name) ? {} : { pageId: pageIdField }), ...opInputShape(op) }),
    execute: (input, options) => answered(async () => {
      if (op.name === 'export' && MOTION_RASTER.has(String(input?.format))) {
        throw new Error(`${String(input?.format).toUpperCase()} is too large to return to a browser agent. Use svg-animated, or Export in the editor.`);
      }
      return cappedOutput(await editor.run(op.name, input ?? {}, typeof input?.pageId === 'string' ? input.pageId : undefined, options?.signal));
    })(),
    annotations: { readOnlyHint: mutates.get(op.name) === false, untrustedContentHint: USER_CONTENT.has(op.name) },
  }));
  return [
    ...ops,
    {
      name: 'get_view',
      title: 'What the person sees',
      description: 'What the person is looking at in the editor now: the page, Canvas or Map mode, their selection (ids, kinds, labels), '
        + 'the camera, and the top-level shapes on screen. Use it to resolve "this", "here" or "the one I selected" before acting.',
      inputSchema: jsonSchemaOf({}),
      execute: answered(() => getView(editor)),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
    },
    {
      name: 'select',
      title: 'Select and show',
      description: 'Select shapes and connectors on the page in view and bring them on screen, so the person sees what you mean '
        + '("these three"). Changes the view only, not the document; the person can carry on from the selection.',
      inputSchema: jsonSchemaOf(selectShape),
      execute: (input) => answered(() => select(editor, input))(),
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    },
  ];
}
