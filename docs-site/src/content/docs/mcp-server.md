---
title: MCP Server
description: Drive the live editor or edit .openflow.json files from any MCP client — the full tool surface, generated from the manifest.
---

:::note[Always current]
Built from the app's own source (`src/agent/manifest.ts`, `src/agent/ops/` and the tool registrations under `mcp-server/src`) on every docs build, so it can't drift. To change it, edit the source.
:::

OpenFlowKit has one set of agent tools. Pick the row for where your agent runs:

| Your agent runs… | How to connect | What it can do |
| --- | --- | --- |
| **On your computer**: Claude Code, Cursor, VS Code, Claude Desktop, Windsurf | This MCP server | Everything: draws on your open canvas (one undo step per change), edits `.openflow.json` files, maps a codebase, takes screenshots |
| **In a chat app**: claude.ai, ChatGPT | Add a custom connector with `https://mcp.openflowkit.com/mcp` ([steps](/connect-your-agent/#claudeai-and-chatgpt)) | Draws a diagram in the chat as a card, with zoom and Open in OpenFlowKit |
| **In your browser** (experimental) | Nothing to install: [WebMCP](/webmcp/) | Reads and edits the diagram you have open |

The server is a stdio process on your machine. It needs no API key of its own and returns
deterministic results: your MCP client's model does the thinking.

**Where the diagram shows up.** In live mode (**Connect agent** in the app) it is drawn on the canvas you have open.
In file mode it is the `.openflow.json` you save, and the result carries an `openUrl` that opens it in the app. Hosts
that support MCP Apps (Claude Desktop, VS Code) also show a card under the tool call: the picture, zoom, and Open in
OpenFlowKit.

**In claude.ai or ChatGPT** the hosted endpoint draws cards in the chat, not on your canvas. It stores nothing and has
no file, live-editor or codebase tools, so use this server for those.

## Connect your client

Step by step for Claude Code, Claude Desktop, claude.ai, ChatGPT, Cursor, VS Code and Codex, with fixes for what goes
wrong: [Connect your agent](/connect-your-agent/). The short version, for Claude Code:

```bash
claude mcp add -s user openflowkit -- npx -y openflowkit mcp
```

Every other local client runs the same command, `npx -y openflowkit mcp` (Node 20.11 or newer). Then open the app and
click **Connect agent**, or open [app.openflowkit.com/#/connect](https://app.openflowkit.com/#/connect).

## Two modes

- **Live** — open the app, click **Connect agent**, and every op runs against the document
you see. The bridge listens on `127.0.0.1:43119` by default (change it in the Connect agent panel;
the server reads `OPENFLOWKIT_BRIDGE_PORT`), checks the request's host and origin, and can be gated
with a shared token (`OPENFLOWKIT_BRIDGE_TOKEN` on the server, the same token in the panel). Edits land as one undo step per
call; `screenshot` returns a real PNG; `fit_view` moves your view. One tab owns the connection, and several agent
sessions can draw on it through the first server: [how pairing works](/connect-your-agent/#how-drawing-reaches-your-canvas).
- **File** — `openflow_open` a `.openflow.json` path and the same ops run headlessly on
that document, with `openflow_save` writing it back. There is no canvas here, so PNG/GIF/
MP4/WebM export and `screenshot` ask you to connect the live editor; SVG, animated SVG,
JSON and PDF (a print-ready HTML page) export work.

If no editor is paired, pass `documentId` (from `openflow_open`) to target a file-mode
document; without it, tools use the paired editor or, in file mode, the document opened or
created last. Page-scoped ops take a `pageId` from `list_pages`.

## Document and server tools

| Tool | What it does |
| --- | --- |
| `analyze_codebase` | Scan a repository and suggest architecture elements |
| `discover_architecture` | Derive an architecture model from a repository |
| `drift_report` | Compare a model against the repository; matches by name and tech only |
| `explain_element` | What the model says about one element, plus linked ADR markdown |
| `get_starter_template` | One starter template, by name |
| `get_syntax` | The DSL grammar, whole or one family (unknown families are rejected); also listed as an op below |
| `list_diagram_node_types` | Family names, shape words and edge styles |
| `list_starter_templates` | List the starter DSL templates |
| `openflow_create` | Create an empty file-mode document |
| `openflow_open` | Load a .openflow.json from disk into file mode |
| `openflow_save` | Write a document back to disk |
| `render_diagram` | Hosted endpoint only (`https://mcp.openflowkit.com/mcp`, or self-host with `npm run start:http`): draw DSL or Mermaid inline in the chat, with an editor link |
| `server_info` | Server name, version and capabilities |
| `validate_openflow_dsl` | Parse DSL with the real parser and return its diagnostics |
| `whoami` | Which mode the server is in, and which documents it holds |

## Resources and prompts

The server also exposes MCP resources: `grammar`, `icons-by-provider`, `icons-catalog`, `template`, `templates-catalog` — the
grammar, the icon catalogs and the starter templates. Two prompts steer a client toward
the right tools: `flowchart_from_description` and `architecture_from_codebase`. Mermaid,
Structurizr DSL and D2 need no prompt: `create_diagram`, `update_diagram` and
`validate_openflow_dsl` take them directly.

## The operations

One MCP tool per operation; every mutating op has an inverse, and the live editor applies it
as a single undo step. The manifest names the human operation each one mirrors.

### `create_diagram`

Create diagram — mirrors **Generate diagram from code** in the code panel; changes the document (one undo step in live mode).

| Argument | Type |
| --- | --- |
| `dsl` | string |
| `pageId` | string *(optional)* |
| `at` | object: x (number), y (number) *(optional)* |
| `palette` | `pastel` \| `paper` \| `builder` \| `mono` *(optional)* |

### `update_diagram`

Update diagram — mirrors **Regenerate a diagram frame** in the code panel; changes the document (one undo step in live mode).

| Argument | Type |
| --- | --- |
| `frameId` | string |
| `dsl` | string |
| `palette` | `pastel` \| `paper` \| `builder` \| `mono` *(optional)* |
| `pageId` | string (MCP tool; the CLI says `--page`) |

### `get_diagram`

Read diagram — mirrors **Edit as code** in the context bar; read-only.

| Argument | Type |
| --- | --- |
| `frameId` | string *(optional)* |
| `pageId` | string *(optional)* |
| `diffOnly` | boolean *(optional)* |

### `list_diagrams`

List diagrams — an agent-only lookup; read-only.

Takes no arguments.

### `get_syntax`

Read the grammar — an agent-only lookup; read-only.

| Argument | Type |
| --- | --- |
| `family` | `architecture` \| `flowchart` \| `gitgraph` \| `sequence` \| `state` \| `erd` \| `class` \| `mindmap` \| `bpmn` \| `org` \| `gantt` \| `wireframe` \| `chart` \| `sankey` \| `journey` \| `timeline` *(optional)* |

### `search_icons`

Search icons — an agent-only lookup; read-only.

| Argument | Type |
| --- | --- |
| `query` | string |
| `limit` | number *(default `10`)* |

### `find_icons_for`

Find icons for a concept — an agent-only lookup; read-only.

| Argument | Type |
| --- | --- |
| `concept` | string |
| `limit` | number *(default `8`)* |

### `move`

Move shapes — mirrors **Move / nudge shapes** in a canvas gesture; changes the document (one undo step in live mode). Pass exactly one of `to` or `delta`.

| Argument | Type |
| --- | --- |
| `ids` | string[] |
| `to` | object: x (number), y (number) *(optional)* |
| `delta` | object: x (number), y (number) *(optional)* |
| `pageId` | string (MCP tool; the CLI says `--page`) |

### `style`

Style shapes — mirrors **Fill / stroke / width / dash / opacity** in the context bar; changes the document (one undo step in live mode).

| Argument | Type |
| --- | --- |
| `ids` | string[] |
| `fill` | string *(optional)* |
| `stroke` | string *(optional)* |
| `strokeWidth` | number *(optional)* |
| `strokeStyle` | `solid` \| `dashed` \| `dotted` *(optional)* |
| `opacity` | number *(optional)* |
| `textColor` | string *(optional)* |
| `iconPlacement` | `top` \| `left` *(optional)* |
| `pageId` | string (MCP tool; the CLI says `--page`) |

### `delete`

Delete shapes — mirrors **Delete selection** in a keyboard action; changes the document (one undo step in live mode).

| Argument | Type |
| --- | --- |
| `ids` | string[] |
| `kind` | `node` \| `connector` \| `any` *(default `"any"`)* |
| `pageId` | string (MCP tool; the CLI says `--page`) |

### `add_shape`

Add shape — mirrors **Create rectangle / ellipse / text** in the toolbar; changes the document (one undo step in live mode).

| Argument | Type |
| --- | --- |
| `kind` | `rectangle` \| `ellipse` \| `text` \| `rounded` \| `capsule` \| `circle` \| `diamond` \| `triangle` \| `trapezoid` \| `parallelogram` \| `hexagon` \| `octagon` \| `pentagon-tag` \| `chevron` \| `plus` \| `star` \| `heart` \| `cloud` \| `lightning` \| `bookmark` \| `speech-bubble` \| `page` \| `folder` \| `list-card` \| `filled-bar` \| `half-round` \| `cylinder` \| `document` \| `cube` \| `prism` \| `layer-stack` \| `target` \| `check-circle` \| `cross-circle` \| `numbered-circle` \| `brace` \| `bracket` \| `pin` \| `actor` \| `arrow-up` \| `arrow-down` \| `arrow-left` \| `arrow-right` \| `venn` \| `process` \| `start` \| `decision` \| `end` \| `custom` \| `image` \| `annotation` \| `sticky` \| `callout` \| `pen` \| `highlighter` \| `line` \| `arrow` \| `architecture` \| `provider_icon` \| `group` \| `section` \| `swimlane` \| `class` \| `er_entity` \| `mindmap` \| `journey` \| `sequence_participant` \| `sequence_note` \| `sequence_fragment` \| `browser` \| `mobile` \| "chart" \| "widget" \| "frame" *(default `"process"`)* |
| `label` | string *(optional)* |
| `x` | number *(default `0`)* |
| `y` | number *(default `0`)* |
| `id` | string *(optional)* |
| `chart` | object: kind (`bar` \| `line` \| `area` \| `scatter` \| `pie` \| `donut` \| `radar` \| `heatmap` \| `table` \| `quadrant` *(default `"bar"`)*), categories (string[] *(optional)*), series (object: name (string), values (number[])[] *(optional)*), points (object: label (string), x (number), y (number)[] *(optional)*) *(optional)* |
| `widget` | object: kind (`button` \| `input` \| `search` \| `checkbox` \| `radio` \| `toggle` \| `dropdown` \| `slider` \| `navbar` \| `tabs` \| `image` \| `avatar` \| `heading` \| `paragraph` \| `divider` \| `link` \| `textarea` \| `stepper` \| `badge` \| `progress` \| `breadcrumbs` \| `pagination` \| `rating` \| `card` \| `list` \| `alert` \| `menu` \| `tooltip` \| `accordion` \| `datepicker` \| `sidebar` \| `segmented` \| `tabbar` \| `statusbar` \| `fab`), checked (boolean *(optional)*), value (number *(optional)*), active (number *(optional)*), variant (`primary` \| `info` \| `success` \| `warning` \| `error` *(optional)*) *(optional)* |
| `preset` | `frame` \| `phone` \| `tablet` \| `browser` \| `window` *(optional)* |
| `parentId` | string *(optional)* |
| `pageId` | string (MCP tool; the CLI says `--page`) |

### `export`

Export — mirrors **Export PNG / SVG / PDF / JSON** in the document bar; read-only.

| Argument | Type |
| --- | --- |
| `format` | `svg` \| `png` \| `pdf` \| `json` \| `svg-animated` \| `gif` \| `mp4` \| `webm` *(default `"svg"`)* |
| `scope` | `selection` \| `page` \| `document` *(default `"document"`)* |
| `pageId` | string *(optional)* |
| `ids` | string[] *(optional)* |
| `scale` | 1 \| 2 \| 3 *(default `1`)* |
| `theme` | `light` \| `dark` \| `print` *(default `"light"`)* |
| `preset` | `build` \| `walkthrough` \| `pulse` *(default `"build"`)* |
| `order` | string *(optional)* |
| `durationMs` | number *(optional)* |
| `loop` | boolean *(default `false`)* |
| `size` | 720 \| 1080 \| 1440 *(default `1080`)* |
| `fps` | 12 \| 24 \| 30 *(default `24`)* |

### `screenshot`

Screenshot a diagram — an agent-only lookup; read-only.

| Argument | Type |
| --- | --- |
| `frameId` | string *(optional)* |
| `pageId` | string *(optional)* |
| `scale` | 1 \| 2 \| 3 *(default `2`)* |
| `theme` | `light` \| `dark` *(default `"light"`)* |

### `fit_view`

Fit the view — mirrors **Zoom to fit / zoom to selection** in a keyboard action; read-only.

| Argument | Type |
| --- | --- |
| `ids` | string[] *(optional)* |
| `frameId` | string *(optional)* |

### `get_document`

Read the page — mirrors **Read document, page and selection** in a canvas gesture; read-only.

| Argument | Type |
| --- | --- |
| `pageId` | string *(optional)* |

### `list_pages`

List pages — mirrors **Page list** in the document bar; read-only.

Takes no arguments.

## What it does not do

- **Local by default.** This server runs on your machine over stdio and calls no outside service. The hosted endpoint for chat apps (`https://mcp.openflowkit.com/mcp`) is separate, draws cards in the chat only and stores nothing.
- **No account or key.** Your MCP client's model is the only AI involved.
- **No raster in file mode.** PNG, GIF, MP4 and WebM need the live editor's canvas.
- **One tab at a time.** One editor tab pairs with the bridge. Several agent sessions can share it, but this is not multi-person collaboration.
