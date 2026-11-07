---
title: Local-first diagramming
description: Where documents live, how saving and recovery work, and what opening a file actually does.
---

Local-first means the document is yours and the app is a tool: storage is in your browser and
there is no account. Your diagrams stay in your browser. Something leaves it only when you
choose: AI with your own key goes to that provider, a [share link](/share-links/) uploads an
encrypted copy, a [repo map](/map-mode/) reads from GitHub.

## Where a document lives

A document is an IndexedDB record on the origin you opened the app from, addressed by the
`#/d/<document-id>` URL. That is the only copy — there is no server-side backup. Clearing site
data for the app's origin deletes your documents; export the JSON first if you care about it.

## Saving

Every edit is autosaved. The cloud icon in the document bar shows the state (hover it for the
words):

| State | Meaning |
| --- | --- |
| Saved | The record matches the canvas |
| Saving… | A write is in flight |
| Another tab saved first — reload, or save yours as a copy | Another tab wrote a newer version first. **Reload** takes that version; **Save as copy** keeps yours as a new document |
| Save failed — storage is full / unavailable | The browser refused the write, with a **Retry** action |

Each save is compare-and-swap: it only lands if the record is still the version this tab
loaded. There is no merge; the conflict state exists so two tabs cannot silently overwrite each
other.

## Recovery

Each save keeps the previous good record as a fallback. If the primary record is damaged, the
app loads the fallback and says so; if neither can be read, the document opens as "This diagram
is damaged" with **Download raw data** (the stored records, as JSON) and **Download diagnostic
report**, rather than pretending the diagram is empty.

## Opening and importing files

Home → **Import** (or dropping files on Home) takes `.json`, Excalidraw drawings (`.excalidraw`),
plus diagram text in `.mmd`, `.mermaid`, `.d2`, `.dsl`, `.ofk` and `.txt` files. A text file (one at
a time) opens as a new diagram; Mermaid, D2 and Structurizr are converted first. In the editor,
the canvas menu's **Open file…** takes the same files. A `.json` file can be:

- our own export, any schema version the app still supports — it is migrated on open;
- a V1 OpenFlowKit file (`{ nodes, edges }`), projected onto the 2.0 document model one time.

An Excalidraw drawing keeps its layout: each shape, arrow, text, freehand stroke, picture and
frame lands where it was drawn, arrows stay tied to their shapes, and Excalidraw's default black
ink follows the theme. Shapes copied in Excalidraw paste straight onto the canvas (`⌘V`). What
has no counterpart (hatched fills, groups, filled lines, some arrowheads) is named in a toast.

A document written by a newer app version opens read-only: the app preserves it instead of
migrating it backwards. Opening never overwrites the document it came from: the file is saved
under a fresh id and the app navigates to it.

## Multi-page documents

A document holds pages; the document bar names the active page and opens the page menu. Pages
are created, renamed, duplicated, reordered and deleted there. Exports can cover the current
page, the selection, or every page (one file per page).

## No account

There is no sign-in and no license check. Basic usage stats help us improve the app (turn them off
in Settings). Your diagrams stay on your machine unless you export them, share them (encrypted; the
server never sees the key), send them to the AI provider you picked, or connect an agent, which
talks to a local bridge on `127.0.0.1` (see [MCP Server](/mcp-server/)). The [FAQ](/faq/#what-leaves-my-browser) lists
every request the app makes.

## What it cannot do

- **No sync between devices or browsers.** The record is per-origin.
- **No named versions.** Recovery keeps the previous good save, not a history; use Git or
  exports for milestones.
- **No folder of documents.** Export JSON files to keep a portable archive.
- **No server-side collaboration.** See [the manifest](/mcp-server/) for what the local bridge
  does and does not do.

## Where to go next

- [Exporting](/exporting/) — what a portable copy can be.
- [Settings](/settings/) — grid, snapping, theme and the agent bridge.
