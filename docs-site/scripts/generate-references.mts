// Generates the two pages that mirror code instead of prose: the keyboard
// reference (src/opencanvas/presentation/v2/v2Shortcuts.ts) and the MCP
// chapter (src/agent/manifest.ts + src/agent/ops + the tool registrations in
// mcp-server/src). Run by predev/prebuild, so a new shortcut, op or tool
// without a docs row breaks the build instead of shipping an undocumented one.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITY_MANIFEST, type CapabilityRow } from '../../src/agent/manifest';
import { AGENT_OPS } from '../../src/agent/ops';
import { shortcutGroups } from '../../src/opencanvas/presentation/v2/v2Shortcuts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const OUT_DIR = resolve(HERE, '..', 'src', 'content', 'docs');
const MCP_SRC = resolve(REPO_ROOT, 'mcp-server', 'src');

const GENERATED = (sources: string): string => `:::note[Always current]
Built from the app's own source (${sources}) on every docs build, so it can't drift. To change it, edit the source.
:::

`;

function frontmatter(title: string, description: string): string {
  return `---\ntitle: ${title}\ndescription: ${description}\n---\n\n`;
}

// --- zod → readable type, for the op argument tables -------------------------

interface ZodLike {
  readonly def?: { readonly type?: string } & Record<string, unknown>;
  readonly shape?: Record<string, ZodLike>;
}

const shapeOf = (schema: ZodLike): Record<string, ZodLike> => schema.shape ?? {};

function typeOf(schema: ZodLike): string {
  const def = schema?.def;
  if (!def) return 'unknown';
  switch (def.type) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'literal': return (def.values as unknown[]).map((value) => JSON.stringify(value)).join(' \\| ');
    case 'enum': return Object.values(def.entries as Record<string, string>).map((value) => `\`${value}\``).join(' \\| ');
    case 'optional': return `${typeOf(def.innerType as ZodLike)} *(optional)*`;
    case 'default': return `${typeOf(def.innerType as ZodLike)} *(default \`${JSON.stringify(def.defaultValue)}\`)*`;
    case 'array': return `${typeOf(def.element as ZodLike)}[]`;
    case 'nullable': return `${typeOf(def.innerType as ZodLike)} or null`;
    case 'pipe': return typeOf(def.out as ZodLike);
    case 'union': return (def.options as ZodLike[]).map(typeOf).join(' \\| ');
    case 'object': return `object: ${Object.entries(shapeOf(schema))
      .map(([key, value]) => `${key} (${typeOf(value)})`).join(', ')}`;
    case 'record': return `map of ${typeOf(def.valueType as ZodLike)}`;
    case 'any': return 'any';
    default: return def.type ?? 'value';
  }
}

function argumentRows(schema: ZodLike): string {
  const shape = shapeOf(schema);
  const rows = Object.entries(shape);
  if (rows.length === 0) return '| — | — |\n';
  return rows.map(([name, value]) => `| \`${name}\` | ${typeOf(value)} |`).join('\n') + '\n';
}

// --- the pages ---------------------------------------------------------------

function keyboardPage(): string {
  const groups = shortcutGroups(true);
  const sections = groups.map(({ title, rows }) =>
    `## ${title}\n\n| Action | Keys |\n| --- | --- |\n${rows.map(({ label, keys }) =>
      `| ${label} | ${keys === '' ? '—' : `\`${keys}\``} |`).join('\n')}\n`,
  ).join('\n');
  return frontmatter(
    'Keyboard shortcuts',
    'Every keyboard shortcut in the editor, generated from the shortcut map the app itself renders.',
  )
    + GENERATED('`src/opencanvas/presentation/v2/v2Shortcuts.ts`')
    + `Keys are shown with \`⌘\`; on Windows and Linux read the same rows as \`Ctrl\`. This list is made from the same table as the ? sheet in the app.\n\n`
    + sections;
}

async function sourceToolNames(): Promise<readonly string[]> {
  const names = new Set<string>();
  for (const file of await readdir(MCP_SRC, { recursive: true })) {
    if (!/\.ts$/.test(file)) continue;
    const text = await readFile(resolve(MCP_SRC, file), 'utf8');
    for (const match of text.matchAll(/registerTool\(\s*'([a-z_]+)'/g)) names.add(match[1]!);
  }
  return [...names].sort();
}

async function sourceResourceNames(): Promise<readonly string[]> {
  const names = new Set<string>();
  const text = await readFile(resolve(MCP_SRC, 'resources', 'index.ts'), 'utf8');
  for (const match of text.matchAll(/registerResource\(\s*'([^']+)'/g)) names.add(match[1]!);
  return [...names].sort();
}

// Page-scoped ops whose own schema has no pageId: the MCP server adds one (mcp-server/src/tools/ops.ts).
const MCP_PAGE_ID = new Set(['update_diagram', 'move', 'style', 'delete', 'add_shape']);

// Rules an argument table cannot show.
const OP_NOTES: Record<string, string> = { move: 'Pass exactly one of `to` or `delta`.' };

function opSections(): string {
  const rows = new Map(CAPABILITY_MANIFEST.map((row) => [row.action, row]));
  const surfaces: Record<string, string> = {
    toolbar: 'the toolbar',
    'context-bar': 'the context bar',
    keyboard: 'a keyboard action',
    'document-bar': 'the document bar',
    canvas: 'a canvas gesture',
    'code-panel': 'the code panel',
    agent: '',
  };
  return AGENT_OPS.map((op) => {
    const row: CapabilityRow = rows.get(op.name)!;
    const args = shapeOf(op.schema as unknown as ZodLike);
    const argumentTable = argumentRows(op.schema as unknown as ZodLike)
      + (MCP_PAGE_ID.has(op.name) ? '| `pageId` | string (MCP tool; the CLI says `--page`) |\n' : '');
    // `documentId` is added to every op tool by the MCP server; document it once.
    const where = row.writes === 'diagram' ? 'changes the diagram (one undo step in live mode)'
      : row.writes === 'threads' ? 'changes the comment threads (no undo step, not part of the diagram)'
        : 'read-only';
    const mirrors = row.surface === 'agent'
      ? 'an agent-only lookup'
      : `mirrors **${row.operation}** in ${surfaces[row.surface] ?? row.surface}`;
    const note = OP_NOTES[op.name] ? ` ${OP_NOTES[op.name]}` : '';
    return `### \`${op.name}\`\n\n${op.title} — ${mirrors}; ${where}.${note}\n\n`
      + (Object.keys(args).length > 0
        ? `| Argument | Type |\n| --- | --- |\n${argumentTable}`
        : 'Takes no arguments.\n');
  }).join('\n');
}

async function mcpPage(): Promise<string> {
  const tools = await sourceToolNames();
  const resources = await sourceResourceNames();
  return frontmatter(
    'MCP Server',
    'Drive the live editor or edit .openflow.json files from any MCP client — the full tool surface, generated from the manifest.',
  )
    + GENERATED('`src/agent/manifest.ts`, `src/agent/ops/` and the tool registrations under `mcp-server/src`')
    + `OpenFlowKit has one set of agent tools. Pick the row for where your agent runs:\n\n| Your agent runs… | How to connect | What it can do |\n| --- | --- | --- |\n| **On your computer**: Claude Code, Cursor, VS Code, Claude Desktop, Windsurf | This MCP server | Everything: draws on your open canvas (one undo step per change), edits \`.openflow.json\` files, maps a codebase, takes screenshots |\n| **In a chat app**: claude.ai, ChatGPT | Add a custom connector with \`https://mcp.openflowkit.com/mcp\` ([steps](/connect-your-agent/#claudeai-and-chatgpt)) | Draws a diagram in the chat as a card, with zoom and Open in OpenFlowKit |\n| **In your browser** (experimental) | Nothing to install: [WebMCP](/webmcp/) | Reads and edits the diagram you have open |\n\nThe server is a stdio process on your machine. It needs no API key of its own and returns\ndeterministic results: your MCP client's model does the thinking.\n\n**Where the diagram shows up.** In live mode (**Connect agent** in the app) it is drawn on the canvas you have open.\nIn file mode it is the \`.openflow.json\` you save, and the result carries an \`openUrl\` that opens it in the app. Hosts\nthat support MCP Apps (Claude Desktop, VS Code) also show a card under the tool call: the picture, zoom, and Open in\nOpenFlowKit.\n\n**In claude.ai or ChatGPT** the hosted endpoint draws cards in the chat, not on your canvas. It stores nothing and has\nno file, live-editor or codebase tools, so use this server for those.\n\n## Connect your client\n\nStep by step for Claude Code, Claude Desktop, claude.ai, ChatGPT, Cursor, VS Code and Codex, with fixes for what goes\nwrong: [Connect your agent](/connect-your-agent/). The short version, for Claude Code:\n\n\`\`\`bash\nclaude mcp add -s user openflowkit -- npx -y openflowkit mcp\n\`\`\`\n\nEvery other local client runs the same command, \`npx -y openflowkit mcp\` (Node 20.11 or newer). Then open the app and\nclick **Connect agent**, or open [app.openflowkit.com/#/connect](https://app.openflowkit.com/#/connect).\n\n`
    + `## Two modes\n\n`
    + `- **Live** — open the app, click **Connect agent**, and every op runs against the document\nyou see. The bridge listens on \`127.0.0.1:43119\` by default (change it in the Connect agent panel;\nthe server reads \`OPENFLOWKIT_BRIDGE_PORT\`), checks the request's host and origin, and can be gated\nwith a shared token (\`OPENFLOWKIT_BRIDGE_TOKEN\` on the server, the same token in the panel). Edits land as one undo step per\ncall; \`screenshot\` returns a real PNG; \`fit_view\` moves your view. One tab owns the connection, and several agent\nsessions can draw on it through the first server: [how pairing works](/connect-your-agent/#how-drawing-reaches-your-canvas).\n`
    + `- **File** — \`openflow_open\` a \`.openflow.json\` path and the same ops run headlessly on\nthat document, with \`openflow_save\` writing it back. There is no canvas here, so PNG/GIF/\nMP4/WebM export and \`screenshot\` ask you to connect the live editor; SVG, animated SVG,\nJSON and PDF (a print-ready HTML page) export work.\n\n`
    + `If no editor is paired, pass \`documentId\` (from \`openflow_open\`) to target a file-mode\ndocument; without it, tools use the paired editor or, in file mode, the document opened or
created last. Page-scoped ops take a \`pageId\` from \`list_pages\`.\n\n`
    + `## Document and server tools\n\n`
    + `| Tool | What it does |\n| --- | --- |\n`
    + tools.map((name) => {
      const descriptions: Record<string, string> = {
        validate_openflow_dsl: 'Parse DSL with the real parser and return its diagnostics',
        analyze_codebase: 'Scan a repository and suggest architecture elements',
        discover_architecture: 'Derive an architecture model from a repository',
        drift_report: 'Compare a model against the repository; matches by name and tech only',
        explain_element: 'What the model says about one element, plus linked ADR markdown',
        list_starter_templates: 'List the starter DSL templates',
        get_starter_template: 'One starter template, by name',
        list_diagram_node_types: 'Family names, shape words and edge styles',
        openflow_create: 'Create an empty file-mode document',
        openflow_open: 'Load a .openflow.json from disk into file mode',
        openflow_save: 'Write a document back to disk',
        whoami: 'Which mode the server is in, and which documents it holds',
        server_info: 'Server name, version and capabilities',
        render_diagram: 'Hosted endpoint only (`https://mcp.openflowkit.com/mcp`, or self-host with `npm run start:http`): draw DSL or Mermaid inline in the chat, with an editor link',
        get_syntax: 'The DSL grammar, whole or one family (unknown families are rejected); also listed as an op below',
      };
      return `| \`${name}\` | ${descriptions[name] ?? 'See the tool description in your client'} |`;
    }).join('\n') + '\n\n'
    + `## Resources and prompts\n\n`
    + `The server also exposes MCP resources: ${resources.map((name) => `\`${name}\``).join(', ')} — the\ngrammar, the icon catalogs and the starter templates. Two prompts steer a client toward\nthe right tools: \`flowchart_from_description\` and \`architecture_from_codebase\`. Mermaid,\nStructurizr DSL and D2 need no prompt: \`create_diagram\`, \`update_diagram\` and\n\`validate_openflow_dsl\` take them directly.\n\n`
    + `## The operations\n\n`
    + `One MCP tool per operation; every op that changes the diagram has an inverse, and the live editor\napplies it as a single undo step. The comment-thread ops change the threads outside undo history.\nThe manifest names the human operation each one mirrors.\n\n`
    + opSections()
    + `\n## What it does not do\n\n`
    + `- **Local by default.** This server runs on your machine over stdio and calls no outside service. The hosted endpoint for chat apps (\`https://mcp.openflowkit.com/mcp\`) is separate, draws cards in the chat only and stores nothing.\n`
    + `- **No account or key.** Your MCP client's model is the only AI involved.\n`
    + `- **No raster in file mode.** PNG, GIF, MP4 and WebM need the live editor's canvas.\n`
    + `- **One tab at a time.** One editor tab pairs with the bridge. Several agent sessions can share it, but this is not multi-person collaboration.\n`;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const pages: readonly (readonly [string, string])[] = [
    ['keyboard-shortcuts.md', keyboardPage()],
    ['mcp-server.md', await mcpPage()],
  ];
  for (const [name, content] of pages) {
    const path = resolve(OUT_DIR, name);
    await writeFile(path, content, 'utf8');
    console.log(`[references] wrote ${relative(REPO_ROOT, path)} (${content.length} bytes)`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
