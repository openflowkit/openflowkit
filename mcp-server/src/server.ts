import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerViewer } from './lib/card.js';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from './lib/version.js';
import { CONNECT_URL, LiveBridge } from './lib/bridge.js';
import { DocumentStore } from './lib/documentStore.js';
import { registerValidateDsl } from './tools/validateDsl.js';
import { registerAnalyzeCodebase } from './tools/analyzeCodebase.js';
import { registerListTemplates } from './tools/listTemplates.js';
import { registerGetTemplate } from './tools/getTemplate.js';
import { registerDiscoveryTools } from './tools/discovery.js';
import { registerArchitectureTools } from './tools/architecture.js';
import { registerDocumentTools, registerOpTools, type OpToolDeps } from './tools/ops.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';

export interface ServerOptions extends Partial<OpToolDeps> {
  /** Bridge port; defaults to OPENFLOWKIT_BRIDGE_PORT or 43119. */
  readonly port?: number;
  readonly log?: (message: string) => void;
}

export interface CreatedServer {
  readonly server: McpServer;
  readonly bridge: LiveBridge;
  readonly store: DocumentStore;
}

/** What the model reads before any tool: how a drawing reaches the user. */
export const INSTRUCTIONS = [
  'OpenFlowKit draws diagrams from a small text DSL (get_syntax for the grammar, validate_openflow_dsl to check it).',
  'How a drawing reaches the user: when an OpenFlowKit editor tab is paired with this server (whoami says mode "live-editor"),'
    + ' create_diagram, update_diagram and the other drawing tools draw live on that canvas, where the user sees them at once.',
  `When no editor is paired, ask the user to open ${CONNECT_URL} and press Connect, then call the tool again.`
    + ' Or use file mode: openflow_create (or openflow_open with a .openflow.json path), draw, then openflow_save;'
    + ' a file-mode drawing also returns an openUrl the user can open to see it.',
  'Several agent sessions can share one canvas: whoami shows bridge.shared when this server draws through another one.',
  'Threads: list_threads reads the conversations people pinned on the canvas (filter by threadId, or unanswered: true for the ones waiting on you); reply_to_thread adds a comment, resolve_thread closes one and start_thread opens one.',
  'Call whoami when unsure which mode you are in.',
].join('\n');

/**
 * Builds the MCP server and its live bridge. The bridge is started separately
 * (see index.ts) so tests can pair a fake editor without opening a socket.
 */
export function createServerWithDeps(options: ServerOptions = {}): CreatedServer {
  const store = options.store ?? new DocumentStore();
  const log = options.log ?? ((message: string) => console.error(message));
  const bridge = options.bridge ?? new LiveBridge({
    port: options.port ?? (Number.parseInt(process.env.OPENFLOWKIT_BRIDGE_PORT ?? '', 10) || 43119),
    ...(process.env.OPENFLOWKIT_BRIDGE_TOKEN ? { token: process.env.OPENFLOWKIT_BRIDGE_TOKEN } : {}),
    log,
  });
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const deps: OpToolDeps = { store, bridge };

  registerValidateDsl(server);
  registerAnalyzeCodebase(server);
  registerListTemplates(server);
  registerGetTemplate(server);
  registerDiscoveryTools(server, bridge);
  registerArchitectureTools(server, store);
  registerDocumentTools(server, deps);
  registerOpTools(server, deps);
  registerResources(server);
  // Beside this module in src/ and in dist/ (scripts/build-dist.mjs copies it).
  registerViewer(server, () => readFile(new URL('./viewer/viewer.html', import.meta.url), 'utf8'));
  registerPrompts(server);

  return { server, bridge, store };
}

export function createServer(): McpServer {
  return createServerWithDeps().server;
}
