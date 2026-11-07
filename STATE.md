# State
What is done and what is next. Maintainers' plan and logs live in the untracked `docs/` folder.

## Now (2026-11-07): app 2.2.0 and MCP server + CLI 0.3.0
- 2.2.0: comments on the canvas, the Threads panel and agent thread tools (@svallory, #102/#104/#105/#103, landed
  through #111–#114 because his fork is org-owned and takes no maintainer pushes), Excalidraw import (@Mr-Macharia,
  #97), `get_diagram` `since`/`revision` (#94, #107), the placed frame id + palette fixes (#109), custom-colour ink
  (#108), dependency security updates and zod 4 (#115, #116). `main` by PR only; v2 = main plus merge commits.
- Repo: github.com/openflowkit/openflowkit. npm `openflowkit` (`npx -y openflowkit mcp`) pins the engine
  `@openflowkit/openflowkit-mcp` at the same version; `@vrun-design/openflowkit-mcp` is deprecated at 0.2.2.
- Hosting (Cloudflare Pages, production = `main`, every merge deploys): `ofk-app` app.openflowkit.com, `ofk-docs`
  docs.openflowkit.com, `ofk-site` openflowkit.com (website repo). Share Worker: share.openflowkit.com
  (`worker/README.md`). MCP Worker: mcp.openflowkit.com/mcp (`mcp-server/`: `deploy:remote`, `smoke:remote -- <url>`).
- Gate: `npm run verify` (typecheck, lint, unit, MCP tests + typecheck, headed `@gate`). CI: `quality`
  ∥ 4 e2e shards → `e2e-report`; `@local` specs (GPU budgets, `agent-live`) run only in `e2e:headed`.

## Release steps (MCP server + CLI, then the app tag)
Bump `mcp-server/package.json`, `src/lib/version.ts`, `server.json`, `cli/package.json` (version and the exact
engine pin), both plugin manifests and every `openflowkit@x.y.z` pin (`git grep 'openflowkit@0\.'`: the Action and
its docs); `src/agent/plugin.test.ts` fails on drift. Merge the bump only when ready to publish (the Action's default
`npx openflowkit@x.y.z` breaks until npm has it). Publish `mcp-server/` then `cli/` (2FA in the browser), deploy and
smoke the MCP Worker, push `mcp-vX.Y.Z` (registry), then the app tag `vX.Y.Z` (its Action pins the new CLI).

## Shipped in this cycle
- DSL families, Mermaid / Structurizr / D2 / Excalidraw import, headless ELK, exports, encrypted share links.
- Agents: one op registry for MCP, CLI, WebMCP, in-app assistant, PR Action, Claude Code / Codex plugins.
- Comment threads: pins on the canvas, the Threads panel, agent tools; a `.openflow.json` keeps them, exports and
  share links leave them out unless **Include comments**.

## Known ceilings (`// ponytail:` in code)
- Whole SVG re-emitted per export; GIF 256 colours ≤ 20 fps; headless layout 1000 shapes / 400 connections.
- Translucent `#rrggbbaa` fills count as opaque for label ink; off-screen comment pins are culled (out of Tab order).

## Next
- Small follow-ups from the 11-07 review: the code panel's palette picker ignores an `appearance:` line in the text;
  the custom picker could save `#rrggbb` when alpha is ff; CLI `--page` → `start_thread` `pageId`; #104's IME
  `composing()` in six other text fields; comment shortcuts missing from `keyboard-shortcuts.md`; an open comment card
  in its own layer (it lifts every pin above the toolbars now); `add_shape.kind` errors say only "Invalid input".
- Unconfirmed since 10-14: D1 migration 0004 applied before the share Worker deploy; origin check on `/e`.
- After launch: npm trusted publishing, owner click-through (`npm run e2e:headed` first).
