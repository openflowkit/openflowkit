<p align="center">
  <a href="https://app.openflowkit.com"><img src="public/Logo_openflowkit.svg" width="72" height="72" alt="OpenFlowKit logo"></a>
</p>

<h1 align="center">OpenFlowKit</h1>

<p align="center">
  <b>Architecture diagrams you draw, write as code, or hand to your agent.</b><br>
  Free, open source and local-first. Paste a GitHub repo and get its map, every arrow cited to a line of code.
</p>

<p align="center">
  <a href="https://app.openflowkit.com"><b>Open the app</b></a> &nbsp;·&nbsp;
  <a href="https://docs.openflowkit.com/">Docs</a> &nbsp;·&nbsp;
  <a href="#connect-your-agent">MCP setup</a> &nbsp;·&nbsp;
  <a href="https://github.com/openflowkit/openflowkit/discussions">Discussions</a> &nbsp;·&nbsp;
  <a href="https://github.com/openflowkit/openflowkit/issues">Issues</a>
</p>

<p align="center">
  <a href="https://github.com/openflowkit/openflowkit/actions/workflows/quality.yml"><img src="https://github.com/openflowkit/openflowkit/actions/workflows/quality.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <a href="https://www.npmjs.com/package/@openflowkit/openflowkit-mcp"><img src="https://img.shields.io/npm/v/@openflowkit/openflowkit-mcp?label=mcp%20server" alt="MCP server version on npm"></a>
  <a href="https://www.npmjs.com/package/openflowkit"><img src="https://img.shields.io/npm/v/openflowkit?label=cli" alt="CLI version on npm"></a>
</p>

<p align="center">
  <a href="https://www.producthunt.com/products/openflowkit"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.producthunt.com/widgets/embed-image/v1/top-post-topic-badge.svg?post_id=1081019&theme=dark&period=weekly&topic_id=44">
    <img src="https://api.producthunt.com/widgets/embed-image/v1/top-post-topic-badge.svg?post_id=1081019&theme=light&period=weekly&topic_id=44" width="200" height="43" alt="OpenFlowKit: #4 Product of the Week in Design Tools on Product Hunt">
  </picture></a>
</p>

<p align="center">
  <a href="https://app.openflowkit.com"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/hero-dark.gif">
    <source media="(prefers-color-scheme: light)" srcset="assets/readme/hero-light.gif">
    <img src="assets/readme/hero-light.gif" width="900" alt="An agent draws an architecture diagram on the OpenFlowKit canvas, live; the user drags a box, edits one line of text and regenerates">
  </picture></a>
</p>

## Why OpenFlowKit

### 1. Your agent draws on your canvas, live

Connect Claude Code, Cursor or any MCP client and ask for a diagram. The agent reads the page,
draws, restyles and takes a screenshot to check its own work while you watch. Every change it
makes is one undo step, like your own. [Connect your agent ↓](#connect-your-agent)

### 2. Text and canvas are the same diagram

```
flowchart right
  Client [blue] -> "API Gateway" [emerald] : HTTPS
  "API Gateway" -> Queue [queue, amber]
  Queue -> Worker
  Worker -> Store [cylinder, red, bold]
```

Open the code panel (<kbd>⌥C</kbd>), paste this into it and press <kbd>⌘↵</kbd>. Drag things
around on the canvas or edit the text; <kbd>⌘↵</kbd> regenerates the frame from the text as
one undo step. Paste Mermaid, Structurizr or D2 and it converts.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/code-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/readme/code-light.png">
    <img src="assets/readme/code-light.png" width="800" alt="The code panel beside the canvas: the same diagram as text and as shapes">
  </picture>
</p>

### 3. Paste a GitHub repo, get its map

Type `owner/repo` into the box on an empty canvas and press **Map repo**, or open
`app.openflowkit.com/#/map/github/<owner>/<repo>`
([try a sample](https://app.openflowkit.com/#/map/github/dockersamples/example-voting-app)).
Your browser reads the repo from GitHub and draws its parts. Boxes open in place, and every
arrow lists the `file:line` behind it, linked to the code. No key and no install. For a private
repo, add a read-only GitHub token on the page, or map a checkout: `npx openflowkit map . --html map.html`
([private repos](https://docs.openflowkit.com/map-mode/#private-repos)).

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/map-dark.gif">
    <source media="(prefers-color-scheme: light)" srcset="assets/readme/map-light.gif">
    <img src="assets/readme/map-light.gif" width="900" alt="The map of GoogleCloudPlatform/microservices-demo: a click on checkoutservice opens it in place, showing the files inside, while the side panel lists what it talks to">
  </picture>
</p>

### 4. Export it, including the animation

PNG, SVG, PDF, JSON, or **Copy as Mermaid** for a README. Add an `animate` block to the text
above to name the steps, and the export renders animated SVG, GIF, MP4 or WebM in your browser.

```
animate build 6s loop {
  step Client
  step Client -> "API Gateway" : HTTPS
  step Queue, Worker
  step Store hold 2s
}
```

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/motion/flow-build-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/motion/flow-build-light.svg">
    <img src="assets/motion/flow-build-light.svg" width="900" alt="The diagram above building step by step, exported as an animated SVG">
  </picture>
</p>

<sub>That animation is the two snippets above, exported by the app as an animated SVG. GitHub plays it like an image.</sub>

## Ten diagram types, one language

Every type is the same short, forgiving text, with per-line errors that say how to fix them.
Each picture below is the first example on its docs page, rendered by the `openflowkit` CLI.

<table>
  <tr>
    <td width="50%"><a href="https://docs.openflowkit.com/diagram-architecture/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/types/architecture-dark.png"><img src="assets/readme/types/architecture-light.png" alt="Architecture diagram with Node.js and AWS Lambda icons"></picture></a><br><b>Architecture</b> · cloud icons, groups, a C4 model with views</td>
    <td width="50%"><a href="https://docs.openflowkit.com/diagram-sequence/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/types/sequence-dark.png"><img src="assets/readme/types/sequence-light.png" alt="Sequence diagram of a login"></picture></a><br><b>Sequence</b> · alt / opt / loop, notes, activations</td>
  </tr>
  <tr>
    <td><a href="https://docs.openflowkit.com/diagram-flowchart/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/types/flowchart-dark.png"><img src="assets/readme/types/flowchart-light.png" alt="Flowchart"></picture></a><br><b>Flowchart</b> · shapes, decisions, groups</td>
    <td><a href="https://docs.openflowkit.com/diagram-erd/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/types/erd-dark.png"><img src="assets/readme/types/erd-light.png" alt="Entity-relationship diagram"></picture></a><br><b>ERD</b> · columns, keys, crow's-foot cardinality</td>
  </tr>
  <tr>
    <td><a href="https://docs.openflowkit.com/diagram-state/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/types/state-dark.png"><img src="assets/readme/types/state-light.png" alt="State machine"></picture></a><br><b>State</b> · start and end, composite states</td>
    <td><a href="https://docs.openflowkit.com/diagram-class/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/types/class-dark.png"><img src="assets/readme/types/class-light.png" alt="Class diagram"></picture></a><br><b>Class</b> · members, stereotypes, relations</td>
  </tr>
  <tr>
    <td><a href="https://docs.openflowkit.com/diagram-mindmap/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/types/mindmap-dark.png"><img src="assets/readme/types/mindmap-light.png" alt="Mind map"></picture></a><br><b>Mind map</b> · indentation is the tree</td>
    <td><a href="https://docs.openflowkit.com/diagram-gitgraph/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/types/gitgraph-dark.png"><img src="assets/readme/types/gitgraph-light.png" alt="Git graph"></picture></a><br><b>Git graph</b> · branches, merges, tags</td>
  </tr>
  <tr>
    <td><a href="https://docs.openflowkit.com/diagram-chart/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/types/chart-dark.png"><img src="assets/readme/types/chart-light.png" alt="Bar chart"></picture></a><br><b>Chart</b> · data written as text, editable in a table</td>
    <td><a href="https://docs.openflowkit.com/diagram-wireframe/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/types/wireframe-dark.png"><img src="assets/readme/types/wireframe-light.png" alt="Phone wireframe"></picture></a><br><b>Wireframe</b> · 35 controls on phone, tablet or desktop screens</td>
  </tr>
</table>

The language is versioned and written down in one file: **[src/dsl/grammar.md](src/dsl/grammar.md)**
([docs](https://docs.openflowkit.com/openflow-dsl/)). The same text powers the code panel, the
assistant, the MCP tools and the CLI.

## Quick start

**In the browser:** [app.openflowkit.com](https://app.openflowkit.com). Nothing to install, no account.

**In a terminal:** `npx openflowkit` (Node 20.11+).

**Run it locally** (Node 22.22+):

```bash
git clone https://github.com/openflowkit/openflowkit.git
cd openflowkit
npm install && npm run dev      # http://localhost:3000
```

### Connect your agent

OpenFlowKit has one set of agent tools. Pick the row for where your agent runs:

| Your agent runs… | How to connect | What it can do |
| --- | --- | --- |
| **On your computer**: Claude Code, Cursor, VS Code, Claude Desktop, Windsurf | The MCP server, below | Everything: draws on your open canvas (one undo step per change), edits `.openflow.json` files in your repo, maps a codebase, takes screenshots |
| **In a chat app**: claude.ai, Claude Desktop, ChatGPT | Add a custom connector: `https://mcp.openflowkit.com/mcp`, choose **No sign-in** | Draws a diagram in the chat as a card, with **Open in OpenFlowKit**. Not on your open canvas |
| **In your browser** (experimental) | Nothing to install: open a diagram in a browser whose agent supports [WebMCP](https://docs.openflowkit.com/webmcp/) | Reads and edits the diagram you have open |

<a href="https://cursor.com/en/install-mcp?name=openflowkit&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm9wZW5mbG93a2l0IiwibWNwIl19"><img src="https://cursor.com/deeplink/mcp-install-dark.svg" height="32" alt="Add OpenFlowKit to Cursor"></a>
<a href="https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522openflowkit%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522openflowkit%2522%252C%2522mcp%2522%255D%257D"><img src="https://img.shields.io/badge/VS_Code-Install_OpenFlowKit-0098FF?logo=visualstudiocode&logoColor=white" height="32" alt="Install OpenFlowKit in VS Code"></a>

For Claude Code, one line:

```bash
claude mcp add -s user openflowkit -- npx -y openflowkit mcp
```

For Codex: `codex mcp add openflowkit -- npx -y openflowkit mcp`.

For Claude Desktop, Windsurf and any other MCP client:

```json
{
  "mcpServers": {
    "openflowkit": { "command": "npx", "args": ["-y", "openflowkit", "mcp"] }
  }
}
```

Restart the agent, then click **Connect agent** in the app, or open
[app.openflowkit.com/#/connect](https://app.openflowkit.com/#/connect). That panel has the steps for each client
and copies the same config with a pairing token. With no app open, the same tools edit `.openflow.json` files in
your repo. Every client, step by step, with fixes: [Connect your agent](https://docs.openflowkit.com/connect-your-agent/).

<details>
<summary><b>Plugins: Claude Code and Codex</b> (server and skill in one install)</summary>

```bash
# Claude Code
claude plugin marketplace add openflowkit/openflowkit
claude plugin install openflowkit@openflowkit

# Codex: add the marketplace, then install OpenFlowKit from the Plugins Directory
codex plugin marketplace add openflowkit/openflowkit
```

The skill ([`skills/openflowkit/SKILL.md`](skills/openflowkit/SKILL.md)) tells an agent when a
diagram helps, how to write it, and to save it beside the code. Agents that read the web get the
same text at `https://app.openflowkit.com/llms.txt`.
</details>

## Working with agents

The MCP server gives your agent the operations you have, on the live canvas or on files.

| It can | With |
|---|---|
| **Draw** a diagram from text or Mermaid, then change it | `create_diagram`, `update_diagram`, `add_shape` |
| **Read** every page, the text behind a diagram, and what you selected | `get_document`, `get_diagram`, `list_pages` |
| **Restyle and move** what is already there | `style`, `move`, `delete` |
| **See** its own result | `screenshot` returns a real image the model can look at |
| **Hand you files** | `export`: SVG, PNG, PDF, JSON or an animated SVG |
| **Read your repo** | `discover_architecture`, `drift_report`, `explain_element` |

Things to ask for:

- *"Draw the architecture of this repository."*
- *"Make the boxes I selected red and add a cache in front of the API."*
- *"Turn the Mermaid in our README into a diagram I can edit."*
- *"Compare architecture.ofk with the code and tell me what drifted."*

Your canvas edits are safe: if you moved, restyled or renamed something and the agent regenerates
from text, `get_diagram` hands it the text that keeps each edit, and `update_diagram` reports
anything it had to drop. Every agent change is one undo step, and the Connect panel shows the
last one with an **Undo** button.

<details>
<summary><b>All 29 tools</b></summary>

Sixteen editor operations, which also work on files: `create_diagram`, `update_diagram`,
`get_diagram`, `list_diagrams`, `get_syntax`, `search_icons`, `find_icons_for`, `move`, `style`,
`delete`, `add_shape`, `export`, `screenshot`, `fit_view`, `get_document`, `list_pages`.

Thirteen for files and repositories: `openflow_create`, `openflow_open`, `openflow_save`, `whoami`,
`server_info`, `validate_openflow_dsl`, `list_diagram_node_types`, `list_starter_templates`,
`get_starter_template`, `analyze_codebase`, `discover_architecture`, `drift_report`,
`explain_element`.

Arguments and examples: [MCP server docs](https://docs.openflowkit.com/mcp-server/). The op
manifest is [`src/agent/manifest.ts`](src/agent/manifest.ts). Requires Node 20.11+.
</details>

**Bring your own key instead:** <kbd>⌘J</kbd> opens the assistant. Pick Claude, OpenAI, Gemini,
Groq, Mistral, Cerebras, NVIDIA, OpenRouter, Ollama or any OpenAI-compatible endpoint (LM Studio…)
and paste a key. The key stays in this browser, and the reply arrives as a proposal you apply or
dismiss.

## Bring the diagrams you already have

Paste into the code panel and it converts, with an honest list of anything it couldn't carry. A draw.io
file opens through **Import**.
Mermaid pasted straight onto the canvas draws in place.

| From | What converts |
|---|---|
| **Mermaid** | flowchart / graph, sequenceDiagram, stateDiagram, erDiagram, classDiagram, mindmap, architecture, gitGraph |
| **Structurizr DSL** | the model, views and styles, as a C4 workspace with one page per view |
| **D2** | shapes, connections and containers |
| **draw.io** | `.drawio` / `.xml` files and `.drawio.svg` / `.drawio.png`, every page, with shapes kept where they were |

Going back out, **Copy as Mermaid** writes a flowchart or sequence diagram as Mermaid text for a
README or wiki. [Mermaid](https://docs.openflowkit.com/mermaid-import/) ·
[coming from Structurizr](https://docs.openflowkit.com/coming-from-structurizr/)

## In your repo and CI

The `openflowkit` CLI runs the same engine as the app, from any terminal or CI job:

```bash
npx openflowkit render diagram.ofk -o diagram.svg   # Mermaid, D2, Structurizr or DSL → SVG
npx openflowkit validate diagram.ofk --strict       # exit 1 on an error
npx openflowkit convert flow.mmd -o flow.openflow.json
npx openflowkit discover . --out architecture.ofk   # draft a C4 model of this repo
npx openflowkit drift .                             # exit 1 when the code moved on
```

<p align="center">
  <img src="assets/readme/cli-welcome.png" width="720" alt="Running npx openflowkit: a welcome box, OPEN FLOWKIT in orange block letters, and three commands to try">
</p>

Commit `architecture.ofk` next to the code and `drift` keeps it honest in CI. The **PR diagrams
Action** comments on a pull request with how its diagrams changed: node and connector counts, the
text diff, and drift for `.ofk` models.
[CLI](https://docs.openflowkit.com/cli/) · [GitHub Action](https://docs.openflowkit.com/github-action/)

## Exports and sharing

| Format | Notes |
|---|---|
| PNG | 1× or 2×; light, dark or print theme; transparent background optional |
| SVG, PDF | vector, with icons and the Inter font embedded |
| JSON | the whole document, every page; opens in any browser |
| Animated SVG, GIF, MP4, WebM | made in your browser from the `animate` block or the connector order |
| Copy as Mermaid | flowchart and sequence |
| Share links | a view-only link, encrypted in your browser; or an editable copy, the code inside the link, nothing uploaded |

## Keyboard

Every action has a key, and <kbd>?</kbd> lists them all in the app.

<details>
<summary><b>The ones you'll use first</b></summary>

| Key | Action |
|---|---|
| <kbd>V</kbd> <kbd>R</kbd> <kbd>O</kbd> <kbd>T</kbd> <kbd>A</kbd> | select, rectangle, ellipse, text, connector |
| <kbd>⌥C</kbd> · <kbd>⌘↵</kbd> | code panel · generate from text |
| <kbd>⌘J</kbd> | AI assistant |
| <kbd>M</kbd> | switch Canvas and Map |
| <kbd>⌘F</kbd> | find on the canvas |
| <kbd>⇧1</kbd> · <kbd>⇧2</kbd> | fit everything · zoom to selection |
| <kbd>⌘G</kbd> · <kbd>⌘D</kbd> | group · duplicate |
| <kbd>Enter</kbd> | edit the selected shape's label |

On Windows and Linux, <kbd>Ctrl</kbd> and <kbd>Alt</kbd> replace <kbd>⌘</kbd> and <kbd>⌥</kbd>.
</details>

## How it works

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/how-it-works-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/readme/how-it-works-light.svg">
    <img src="assets/readme/how-it-works-light.svg" width="900" alt="You, your agent and imported Mermaid, Structurizr or D2 all become OpenFlow DSL; the compiler turns it into one undo step on the scene document, which feeds the canvas, the exports and browser storage">
  </picture>
</p>

<sub>This diagram is OpenFlowKit text too: <a href="assets/readme/how-it-works.ofk">how-it-works.ofk</a>, exported as an animated SVG with the pulse preset.</sub>

You and your agent can also draw straight on the canvas; every edit, from text or by hand, is a
command on the same document.

Any frame on the canvas writes back out as canonical text, and `format(format(x)) == format(x)`
holds in the tests. The language and document code is plain TypeScript with no React, Pixi or
DOM, which is why the same compiler runs in the browser, the MCP server and the CLI. The full
tour: **[ARCHITECTURE.md](ARCHITECTURE.md)**.

<details>
<summary><b>Repository layout</b></summary>

| Path | What |
|---|---|
| `src/dsl/` | the language: grammar, parser, diagram families, compile and serialize, repo discovery |
| `src/opencanvas/` | the editor: document model and commands, Pixi renderer, exporters, React UI |
| `src/agent/` | the operations agents call, the bridge protocol, the op manifest |
| `mcp-server/` | the published MCP server and `openflowkit` CLI |
| `cli/` | `openflowkit` on npm: the short name for the CLI |
| `plugin/`, `skills/` | the Claude Code and Codex plugins, and the agent skill |
| `action/` | the PR diagrams GitHub Action |
| `worker/` | the share-link Worker (stores ciphertext only) |
| `stats/` | the private usage dashboard Worker |
| `docs-site/` | the docs site |
</details>

## Self-host

```bash
docker build -t openflowkit . && docker run --rm -p 3045:3045 openflowkit   # http://localhost:3045
```

The image is the static build behind nginx, with the same headers as the hosted app. Content
security policy, AI providers on your own network, and share links:
[self-hosting](https://docs.openflowkit.com/self-hosting/).

## Privacy

Your diagrams stay in your browser. Something leaves it only when you choose: AI with your own key
goes to that provider, a share link uploads an encrypted copy, a repo map reads from GitHub.
No account needed. We collect basic usage stats to improve OpenFlowKit; turn them off in Settings.
Back up everything at once with **Download all diagrams** on Home; **Import** restores it in any browser.

<details>
<summary><b>FAQ</b></summary>

**Is it free?** Yes: MIT licensed, free to use and to self-host. A Pro plan for teams is planned;
the waitlist is in the app.

**Does it work offline?** Once the page is open, drawing, the code panel and exports run in the
page. AI, share links and repo maps need the network. For no internet at all, self-host it.

**Which browsers?** A current desktop browser with WebGL. The automated tests run in Chromium.

**Can my team edit together?** Not in real time. A view-only link is a snapshot, an editable
link hands each person their own copy, and `.openflow.json` and `.ofk` files live happily in git.

More: [FAQ](https://docs.openflowkit.com/faq/).
</details>

## Contributing

Issues, ideas and PRs are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup and
the checks, and [ARCHITECTURE.md](ARCHITECTURE.md) for how the code fits together. Questions go to
[Discussions](https://github.com/openflowkit/openflowkit/discussions). What changed in each
version: [CHANGELOG.md](CHANGELOG.md).

Report security issues privately, as [SECURITY.md](SECURITY.md) describes. MIT licensed, see
[LICENSE](LICENSE).

<a href="https://github.com/openflowkit/openflowkit/graphs/contributors"><img src="https://contrib.rocks/image?repo=openflowkit/openflowkit&max=100" alt="Contributors"></a>

---

<p align="center">
  <a href="https://app.openflowkit.com"><img src="public/Logo_openflowkit.svg" width="40" height="40" alt="OpenFlowKit logo"></a>
</p>
<p align="center">
  <b>If OpenFlowKit saved you a diagram, <a href="https://github.com/openflowkit/openflowkit">give it a ⭐ on GitHub</a>.</b><br>
  <sub>It's how other people find it.</sub>
</p>
<p align="center">
  <a href="https://app.openflowkit.com">Open the app</a> &nbsp;·&nbsp;
  <a href="https://docs.openflowkit.com/">Docs</a> &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md">Contribute</a> &nbsp;·&nbsp;
  <a href="https://github.com/openflowkit/openflowkit/discussions">Discussions</a> &nbsp;·&nbsp;
  <a href="https://github.com/openflowkit/openflowkit/issues/new/choose">Report a bug</a>
</p>
