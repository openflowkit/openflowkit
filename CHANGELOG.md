# Changelog

What changed in OpenFlowKit, newest first. Each release has a version number (major.minor.patch,
[Semantic Versioning](https://semver.org/)) and a matching [GitHub release](https://github.com/openflowkit/openflowkit/releases).
Work that has landed but not shipped yet sits under **Unreleased**.

The MCP server and CLI (`openflowkit` on npm) have their own version line, because agents install it
separately; its changes are listed under *For developers* in each release.

## [Unreleased]

### Added

- **Private repos in the browser.** On the "not found, or it is private" screen, **Private repo? Use a GitHub token**
  takes a fine-grained token with Contents read-only access; the files are then read through the GitHub API. The
  token stays in this tab.
- **AI proxy for self-hosted servers.** Start the Docker image with `OPENFLOWKIT_AI_UPSTREAM` set to an
  OpenAI-compatible endpoint, and the **Custom** provider can use Base URL `/ai-proxy` to reach a model only the server
  can see, with no CORS setup. Only the model list and chat are forwarded, replies stream, and the upstream is fixed
  by the server. Off unless set.
- **Connect agent: paste a prompt.** Step 1 can be a prompt you paste into your agent, which then adds OpenFlowKit
  itself, or the command, config or one-click link as before.

### Changed

- **A map's drawing follows the map until you edit it.** Opening boxes on the map, then **Canvas**, redraws an
  untouched drawing to match (one undo step). An edited drawing stays yours; when the map shows boxes it has not got,
  **New copy** makes a fresh one.

- **Map and its drawing, both ways.** On a repo map, **Canvas** (or `M`) opens an editable drawing of the map, made
  from the map on screen the first time, in the same place. The drawing's **Canvas | Map** switch (or `M`) goes back
  to the same map with the camera kept. **Edit as drawing** (`⇧M`) makes a fresh numbered copy; undoing a new drawing
  returns to the map, and the repo's address always opens the map.
- **One reveal when the editor opens.** The loader stays until the canvas, the type and the map are ready, then fades
  into the finished editor, instead of the chrome painting piece by piece.
- **Edit in model** is no longer offered on a repo map's boxes, which are read from the code.

### Fixed

- **The canvas no longer breaks when Safari drops the drawing context.** Safari can take WebGL away (a GPU reset,
  memory pressure); the next frame threw "Argument 1 ('shader') to WebGL2RenderingContext.shaderSource must be an
  instance of WebGLShader". Frames now wait for the context to come back, then draw as before.
- **Reorder works on the canvas** ([#92](https://github.com/openflowkit/openflowkit/issues/92)). Bring to front,
  Send to back and the step versions changed the order but the canvas kept drawing shapes in the order they were made.
  A shape in front now covers the text and images of the shapes behind it too, overlapping images keep their order
  whichever loads first, and clicks and exports agree with what you see.

### For developers: MCP server and CLI 0.2.4 (on npm since 2026-10-13, tag `mcp-v0.2.4`)

- **MCP server and CLI 0.2.4.** Drawn diagrams now show as a card in chat apps that support MCP Apps (Claude, Claude
  Desktop, VS Code): the picture, zoom, and Open in OpenFlowKit. Clients without MCP Apps get the same text as
  before, plus an `openUrl` in file mode, so a terminal agent can hand you a link to the diagram.
- **Hosted endpoint for chat apps:** `https://mcp.openflowkit.com/mcp` serves `render_diagram` and `get_syntax` to
  claude.ai, ChatGPT and other remote MCP clients. It runs on Cloudflare Workers, needs no login and stores nothing.

## [2.1.0] — 2026-10-13

The first public release of the new editor.

### Highlights

- **Map any GitHub repo.** Paste `owner/repo` and get its architecture. Click into any part, and every arrow shows the
  file and line it came from.
- **Hand it to your agent.** Claude Code, Cursor, VS Code and other MCP clients edit the same canvas you see.
- **Draw, write or ask.** An infinite canvas, diagrams as code (paste Mermaid, D2 or Structurizr), and an AI
  assistant with your own key or a local model.
- **Share two ways:** a view-only link, or an editable copy.
- **A home for your diagrams:** recents, stars, templates and search. Your v1 diagrams come with you.
- **Export anywhere:** PNG, SVG, PDF, JSON, Mermaid, and animated GIF, MP4, WebM or SVG.

### Added

- **Hand your diagram to an agent in one click.** The Connect panel has Add to Cursor and Add to VS Code buttons, and
  agents running in the browser can use OpenFlowKit through WebMCP (experimental).
- **Figma-style editing.** Hold Shift while resizing to keep proportions, Alt to resize from the centre; Shift-drag
  moves along one axis, Alt-drag leaves a copy; Shift- or ⌘-click adds to the selection; double-click enters a group
  and Escape climbs out.
- **Square** is the first basic shape and the rail's default.
- **Layers panel** follows the canvas: rename, drag to reorder or into a section, hide, and select either way.
- **Official Google Cloud icons**, found by product name in the icon library and drawn automatically from labels.
- **Feedback from inside the app:** Send feedback… in the main menu, and an occasional one-tap question after you use a feature.
- **Basic usage stats** help us see what people use; turn them off in Settings.
- **OpenFlowKit Pro waitlist** on the home screen: pick a plan, tell us what you'd pay for, and lock in a founding
  price. Nothing is for sale yet, and everything you use today stays free and open source.
- **Map mode.** A Canvas | Map switch on every document (`M`) draws the architecture model as boxes that open in
  place: Top level, One level in or All levels; arrow keys walk, Enter opens, Escape backs out, ⌘F finds. An arrow
  lists the relations (or, on a repo map, the `file:line` evidence) behind it. Edit as drawing (⇧M) copies the map to
  an ordinary page in one undo step. Browsing never changes the document.
- **Repo maps and repo → diagram.** `#/map/github/<owner>/<repo>` (or the "Map a GitHub repo" field on an empty
  canvas) reads a public repo in the browser from GitHub and maps it; `#/from/github/<owner>/<repo>` opens it as a C4
  model, evidence links pinned to the commit read. The address parser takes `owner/repo`, github.com URLs with or
  without `https://` and `www.`, `/tree/` and `/blob/` links, `.git` and `git@` remotes. An optional GitHub token stays in the tab and
  goes to `api.github.com` only.
- **C4 views are pages.** Every view of an architecture workspace (and of an imported Structurizr workspace) is its
  own page, grouped by level; regenerating matches pages by stable id.
- **Two kinds of share link.** A *view-only link* encrypts the whole document in your browser and stores only
  the encrypted copy (the key stays in the link); viewers can look, or make their own copy, and you can delete the
  link later. An *editable copy* puts one diagram's code in the link itself, so nothing is uploaded.
- **PR diagrams Action** (`action/`): comments on a pull request with node/connector counts, the DSL diff and drift,
  and refreshes stale committed SVGs.
- **Copy as Mermaid** in the Export panel, for flowchart and sequence diagrams, listing what Mermaid cannot carry.
- **Find on canvas** (⌘F): step through matches with Enter / Shift+Enter; Escape restores the selection and view.
- **Claude Code and Codex plugins** (`plugin/`, marketplace in `.claude-plugin/`): the MCP server plus the diagram skill.
- Pasting Mermaid onto the canvas (⌘V) converts it and draws it in place, with its source open in the code panel.
- Saves are compare-and-swap: a second tab that saved first shows "Another tab saved first" with Reload and Save as
  copy. A damaged diagram offers Download raw data.

- **A real home page.** A sidebar with Recents, Starred, Templates and Archive, search (`/`), your starred diagrams,
  a dated What's new page, and links to request a feature or star the project (with its live star count). Diagrams show as a grid
  or a list with a live thumbnail, sorted by last edited or name. Each card has star, rename, duplicate, open in a
  new tab and archive, from its menu or a right-click. Select several with ⌘/Ctrl- or Shift-click, the
  checkbox, Shift+arrows or ⌘A, then star or archive them from the bar. Arrow keys walk the cards (Space, S, F2,
  Delete). Archiving takes a diagram off the list with an Undo and keeps it until you
  delete it forever. ⌘K finds any diagram, template or
  action. Import (or drop anywhere) OpenFlowKit `.json` files, or a Mermaid, D2, Structurizr or OpenFlow DSL file,
  which opens drawn. A first visit gets four ways in and the templates as pictures. `N` starts a new diagram.
  In the editor the logo is now the menu, and its first item is Back to home.
- **Tips at the moment they help.** Draw three shapes and Diagram as code offers to do it from text; select two shapes for the connect shortcut; a first export points at
  animation; a growing diagram without an AI key points at the assistant. One a session, each once, never over an
  open panel, Escape closes it.

- **Your v1 diagrams move over by themselves.** On first boot, every diagram from the
  previous editor (IndexedDB, the localStorage fallback and the pre-March tabs store) is
  copied into the new document store, read-only; the old rows are never touched. A home
  list shows them tagged "From v1", the document menu offers a v1 backup download, and
  Open file accepts that backup. Bring-your-own-key settings carry over.
- Old links resolve: `#/flow/:id` opens the imported diagram, `#/view?flow=…` explains
  what it was, and the other v1 routes land on home. The v1 service worker removes itself.
- **D2 import** in the code panel and the agent tools: flowchart with groups, sequence, or erd
  from `sql_table`s, tested on the D2 project's own example files.
- **Agent skill** (`skills/openflowkit/SKILL.md`) and a `llms.txt` that describes v2 (it still
  described the 1.x DSL). `npm run eval:validity` measures how often a model's diagrams compile.
- **The assistant edits hand-drawn shapes, not only diagrams.** "Make the selected box red and move it right" now
  works: `move_shapes`, `style_shapes`, `delete_shapes`, `add_shape` and `list_shapes` queue into the same review as
  diagram changes, each row rebuilt on the page the rows before it leave, and apply as one undo step. Shapes inside a
  generated diagram still change through its text; locked shapes and shapes outside the selection are left alone.
- **Start from a template, no API key.** The empty canvas offers the five starter diagrams the MCP server ships;
  one click draws it and opens the text that drew it.
- The provider dialog's model field lists the provider's own models (fetched when you focus it, chat models only,
  kept for the session). A wrong key, a closed port or a refused request quietly keeps the built-in suggestions.

### Changed

- **Zoom shortcuts match other design tools:** ⌘0 is 100%, ⇧1 fits everything.
- **Tips and notifications look finished.** Toasts stack (up to three), pause on hover and merge repeats; tips appear
  only on an idle canvas and step aside from open panels.
- Clearer page title and description for search results and link previews.
- The code panel (Diagram as code) opens with ⌥C; ⌥A / D / W / S stay align left / right / top / bottom.
- **A diagram names its document.** Starting from a template, an import or Generate in an untitled document names
  it after the diagram's `title:`, in the same undo step, so Home is not a wall of "Untitled diagram".
- Home and first paint load less than half the JavaScript they did (566 KB → 231 KB): the v1 importer, the agent
  op registry and the Structurizr/D2 converters load when first used.
- **Failures say what happened and what to do.** No WebGL: the canvas says how to turn it on, hides the drawing
  tools and offers Diagram as code and All diagrams (the old link went nowhere). Blocked or full storage, a damaged
  diagram, an unreadable old link, a broken file, and an agent bridge with nothing listening (it names the port) each
  have their own copy, an illustration and a way back. Home notices carry a tone; a backup opening is no longer an alert.
- The canvas welcome's templates are one tidy row of chips, and on a phone the welcome starts below the rail.

- **Edges can end on a group.** `Client -> Payments` next to `group Payments { … }` connects to the
  group's frame instead of drawing a second box called Payments. D2 containers and Mermaid
  subgraphs (`subgraph one [Group One]`, `c --> one`) import the same way, with no loss note.
- Bring-your-own-key defaults: Claude `claude-sonnet-5-5` (Opus 5.5 is one pick away; mid-tier is the cheaper surprise), OpenAI `gpt-6.1-sol`.
- **The agent bridge is token-gated by default.** The editor makes a pairing token once; "Copy MCP configuration"
  puts it in the config's `env`, so the server and the window pair without typing. The token travels in the query
  string (a plain request), so servers that predate it still pair, and a server started without a token stays open.
  The server also answers browser preflights now, for clients that send the token as a header, and the editor says
  so when a server rejects the token.
- Edits at 5,000 nodes cost about half as much: the document is checked once per command, not twice.

### Fixed

- **Ollama:** the provider dialog lists the installed models on open and defaults to one when `gemma4` is not
  installed; the Think chip is hidden (Ollama is sent no think flag); the OLLAMA_ORIGINS advice shows only on a page
  not served from localhost.
- The Docker image's CSP blocked the local agent bridge and custom AI endpoints; it now matches the hosted one.
- Home asked GitHub for the star count on every visit while rate-limited or offline; a failed lookup now waits a day.
- **Code panel:** long lines wrap instead of scrolling sideways, with the highlight wrapping at the same places;
  ⌘Z undoes a Tab or an accepted completion (it did nothing); a CRLF file highlights and jumps to diagnostics on the
  right line; Enter during IME composition no longer picks a completion.
- The selection toolbar moves below the selection when it would cover the label of a connector arriving from above.
- The `auth-flow` starter template dropped its decision line (`Valid {"Valid?"}` opened a block).
- A full or blocked browser storage no longer resets every preference when the bridge token is first saved.
- **Agent pairing after a reload.** With the agent still enabled, a reload started the bridge before the document
  had loaded, and the editor never told the server about it: it looked connected while the agent saw no editor.
- DSL: a column named `title`, `direction` or `appearance` inside an entity (`courses { title text }`) was read as
  the diagram's title and dropped. Only top-level lines are directives now.
- Mermaid import keeps what models actually write: `interface X {}`, `abstract class` and `enum` become stereotyped
  classes; `database id[Label]` or `queue id[Label]` in an architecture diagram becomes a labelled service; both
  say what they assumed. "No valid architecture nodes" now shows the real node syntax.

- Mermaid: one-line flowcharts (`graph LR; A-->B; B-->C`) import; loss notes point at the
  real Mermaid line (they were numbered 1, 2, 3…); a label with a line break stays one
  label; our own `mindmap`, `architecture` and `gitgraph` DSL is no longer offered as
  Mermaid to convert.
- DSL: two nodes with the same label (`API` and `api-2 = API`) no longer merge on re-read;
  a node labelled `queue`, `person` or `...etc` survives a round trip; a quoted first word is
  never read as a keyword.
- C4 deployment views draw the model's relations between instances (they drew none).
- Structurizr import, checked against Structurizr's own example workspaces: `/* */` comments,
  `live = deploymentEnvironment`, instance references, a bare `autoLayout`, and AWS/Azure/GCP
  theme tags as icons.
- Icon ids: `tech/react` (in the docs) resolves, and `developer/react` no longer picks Preact.
- A quoted `\n` in a label stays a line break; it was flattened to a space on every re-read.
- Mermaid ids that differ only in case (`A`, `a`) stay two nodes; they merged into one.
- The v1 import lists exactly what v1 showed: an old localStorage or pre-March copy of a diagram
  deleted in v1 no longer comes back (it stays in the v1 backup download). The backup also reads
  the localStorage copies when IndexedDB will not open.

### Removed

- The Slides workspace button: it opened a mock-up that saved nothing. It returns when slides are real.
- The `gh-pages` deploy script and `public/CNAME`; the app deploys on Cloudflare Pages.

### For developers: MCP server 0.2.3 and the CLI

- **`npx openflowkit`.** The CLI has its own short npm name, `openflowkit`. The engine package moved
  to the `@openflowkit` npm org as `@openflowkit/openflowkit-mcp` (0.2.3); `@vrun-design/openflowkit-mcp`
  stops at 0.2.2 and is deprecated. Run with no command at a terminal, it shows a welcome screen
  and three commands to try; scripts and pipes still get the usage text and exit 2.
- **`npx -y openflowkit mcp`** starts the MCP server. Docs, the Connect panel, the plugins and the
  install buttons use it; configs with `@vrun-design/openflowkit-mcp` keep working on 0.2.2.
- The repository moved to [github.com/openflowkit/openflowkit](https://github.com/openflowkit/openflowkit);
  old links redirect. The MCP registry name is now `io.github.openflowkit/openflowkit-mcp`, published
  from the release workflow when an `mcp-v` tag is pushed.
- CLI: `openflowkit map <dir> [--depth overview|detailed|everything]` prints a repository's parts, files, lines, resolved and unresolved imports, and the folders that import each other. `--html out.html` writes the interactive map as one offline page (no network; evidence links to GitHub only for a github.com checkout root, at the commit HEAD). In a git checkout only tracked files are mapped.
- MCP (0.2.0): remote MCP Apps endpoint (`start:http`) with render_diagram + inline viewer; stores nothing.
- **MCP: Mermaid, Structurizr and D2 in.** `create_diagram`, `update_diagram` and
  `validate_openflow_dsl` take Mermaid (fenced or not, front matter included), Structurizr DSL
  or D2 and return `converted: { from, dsl, losses }`, losses on the agent's own line numbers.
  Unconvertible Mermaid families say which ones convert.
- **`openflowkit` CLI covers every op.** `openflowkit op <name>` runs any MCP op on a
  `.openflow.json` (new ops appear without CLI code), plus `render` (→ SVG), `convert`
  (→ `.openflow.json`), `validate` and `ops`. Stdin, `--json`, `--strict`, exit codes 0/1/2.
- **MCP: headless layout is ELK**, the editor's engine, so file mode and the CLI draw the same
  diagram as the app. Over 1000 shapes or 400 connections stops with a message.
- **MCP schema fix (0.2.0): `add_shape` advertises its fields.** Its refined schema exposed only
  `documentId`, so clients sent no `kind`/`label` and every call failed validation.
- **MCP (0.2.0, schema change): `openflow_save` takes an optional `svg` boolean** (default false). When true it also
  writes the first page as `<same name>.svg` next to the file and returns its path as `svg`. CLI: `--svg` on
  `convert -o` and `op --doc`; `openflowkit discover --out` now writes `<name>.svg` beside the model too (`--no-svg` to skip). If the SVG
  fails after the file is saved, the save stands: the CLI exits 1 naming the saved path, `openflow_save` returns `svgError`.
- **MCP (0.2.0, schema change): page-scoped ops take `pageId`** (`update_diagram`, `move`, `style`, `delete`,
  `add_shape`, joining `create_diagram`, `get_diagram`, `get_document`, `export`, `screenshot`), in file and live mode;
  a two-page C4 document could not be edited past page 1. `get_syntax`'s `family` is an enum of the families, so an
  unknown one is an error that lists them (it returned the whole grammar), and works before any document is open.
  `add_shape`'s `kind` lists `ellipse` once. Without a `documentId`, file mode targets the document opened or created last.
- **MCP (0.2.0, output change):** `screenshot` and PNG/GIF `export` return the picture as an MCP image block (the JSON
  keeps a short summary); base64 inside the text was over clients' output cap. `whoami` and `server_info` report
  `bridge: { port, state }` (`listening`, `paired`, `port-in-use`). `create_diagram` / `update_diagram` refuse DSL with
  nothing drawable (every line dropped) with its diagnostics, instead of leaving an empty frame.
- **MCP (0.2.0, schema change): `export` takes an optional `path`** (inside the server's working directory, in file
  and live mode) and writes the file there, returning `{ saved, bytes, mime }`. An image over 1 MB is not sent as a
  block; the summary says to pass `path` or a lower scale.
- **MCP: icons in headless exports.** File-mode SVG and animated SVG, and the
  `openflowkit build` site, draw the same icon art as the editor.
- **MCP server 0.2.0 is a breaking release** for 0.1.x users: `create_viewer_url` and
  `find_icon` are gone (use `create_diagram` + `export`, and `search_icons`), and the
  `convert_mermaid_to_openflow` prompt is gone because the tools take Mermaid directly.
- The `openflowkit build` CLI compiles with the editor's icon rule (icons from labels on).
- **MCP server (0.2.0).** Installed bins run: `openflowkit` and `start:http` compared the npm symlink to the real
  file and silently did nothing (so `openflowkit drift` never failed CI). `validate_openflow_dsl` runs the same
  parse-and-compile check as `openflowkit validate` (it skipped compiling, so dropped lines passed), and both warn when
  the first line is a misspelled family (`flowchrt`). `drift_report` / `explain_element` read `architecture.ofk` unless
  given a `documentId` (they took whichever document was open). The bridge refuses a `Host` other than
  127.0.0.1/localhost/[::1] on its port (DNS rebinding) and a malformed hello (a phantom editor); the token stays opt-in.
  Node 20.11+ (it said 18.3), `server_info` lists itself, the shipped grammar drops its research notes, the npm
  package carries the LICENSE. The editor shows a refused hello as an error and keeps an error up while it retries;
  "Copy" says when the clipboard refused.
- **MCP server and agent pairing.** The server exits when its client closes stdin (an orphan kept the bridge port and
  refused the next pairing). A closed or reloaded editor tab is noticed at once: calls say so instead of hanging 45 s.
  A second server on a taken port says another server owns it. The Connect panel offers a `claude mcp add` one-liner,
  says each change is one undo step (not "you review every change"), and shows only the fix for a rejected token.

### Thanks

V1's contributors: [@Ken-vdE](https://github.com/Ken-vdE) (edge dash animation loop, #76) and
[@Mr-Macharia](https://github.com/Mr-Macharia) (retired Groq model IDs, #79; one `AIProvider` type, #80).
Their work shipped in v1; v2 is a rewrite, so the code itself did not carry over. Thank you.

## [2.0.0] — 2026-09-22

A rebuild, not a release on top of 1.x. The React Flow editor is gone; the canvas,
the document model, the language and the agent surface were rewritten around one
idea: **the text is the hub, and the canvas is a view of it.**

### Added

- **Pixi/WebGL canvas.** Zoom-to-cursor, box select, move/resize/rotate, snapping
  with alignment guides, group and section framing, z-order, lock. One undo step
  per user intent, and every command has an inverse.
- **Connectors that hold.** Bind to a node side or a free point, orthogonal routing
  around obstacles recomputed live, manual waypoints that survive a bound node
  moving, parallel and reverse edges, labels and markers.
- **Diagram as code.** A forgiving line-oriented DSL with positional attributes,
  per-line warnings and a deterministic serializer with one canonical form.
  Eight families — flowchart, architecture, sequence, state, ERD, class, gitgraph,
  mindmap. The grammar is versioned at [`src/dsl/grammar.md`](src/dsl/grammar.md).
- **Mermaid import** with an honest loss report, and Structurizr → C4 workspaces.
- **Agents as a first-class surface.** An MCP server that drives the *live* editor
  over a local bridge or works on `.openflow.json` files, with one reversible
  command per operation. Bring-your-own-key generation lands as a reviewable
  proposal, never a silent edit.
- **Motion export.** An `animate` block in the text drives animated SVG, GIF, MP4
  and WebM, encoded in a worker.
- **Architecture layer.** C4 model with drill-down, flows, `discover` and `drift`.
- **Creation library.** 42 shapes, connector kinds, ink, images and emoji, charts,
  and 1,600+ icons.

### Changed

- Local-first storage on IndexedDB with a last-known-good copy for crash recovery.
- Keyboard for every action, with a `?` cheatsheet kept honest by a test that fails
  when the dispatcher reads a key the sheet does not document.

### Removed

- The React Flow editor, yjs collaboration, in-app i18n, rollout flags and the
  `/flow/:id` and `/_labs/*` routes. Translation bundles for the deleted i18n system
  were removed from `public/` in this release.

### Fixed

- A locked shape no longer moves on an arrow-key nudge or an agent `move` call.
- The keyboard cheatsheet advertised Alt for snap bypass; the canvas reads ⌘/Ctrl,
  and Alt resizes from the centre.

[2.0.0]: https://github.com/openflowkit/openflowkit/releases/tag/v2.0.0
