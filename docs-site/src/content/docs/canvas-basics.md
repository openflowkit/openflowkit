---
title: Canvas basics
description: Select, move, resize, arrange and recover — the direct-manipulation half of OpenFlowKit.
---

The canvas is direct manipulation: everything you can do with a mouse has a keyboard form,
and every gesture is one undo step.

## Selecting

| Do this | To get |
| --- | --- |
| Click a shape | That shape selected (in a multi-selection: just that one, unless you drag) |
| `Shift`/`⌘` + click | Add to or remove from the selection; drag straight on to move them all |
| Double-click a group | Select the shape inside it under the pointer; clicks then pick inside the group |
| Drag on empty canvas | Box-select everything the box touches |
| `Shift`/`⌘` + drag on empty canvas | Add the box to the selection |
| `⌘`/`Ctrl + A` | Select all on the page |
| `Esc` | Cancel the gesture in progress; then close the open panel; then return to Select; then from inside a group back to the group; then clear the selection |

## Moving and transforming

| Do this | Effect |
| --- | --- |
| Drag | Move the selection |
| `Shift` + drag | Move along one axis |
| `Alt` + drag | Drop a copy, the original stays |
| Arrow keys / `Shift + arrows` | Nudge 1 px / 10 px |
| Drag a corner or edge handle | Resize |
| `Shift` + resize | Lock the aspect ratio |
| `Alt` + resize | Resize from the centre |
| Drag the rotate handle | Rotate |
| `Shift` + rotate | Snap to 15° increments |
| `Shift` / `Alt` + drag with a shape tool | Draw it 1:1 / from the centre |
| `Shift` + drag with the connector tool or pen | A straight line, on the nearest 45° for a connector |

Modifiers work held before the press or pressed mid-drag: the drag updates the moment they change.
A paste lands just off the copied shapes, or in the middle of the view when they are out of sight.

Snapping pulls edges and centres to other shapes and to the grid, with alignment guides shown
while you drag. Hold `⌘`/`Ctrl` during a drag to bypass snapping. Grid and snap toggles live in
[Settings](/settings/).

## Edges of the keyboard

| Shortcut | Action |
| --- | --- |
| `⌘C` / `⌘X` / `⌘V` | Copy, cut, paste |
| `⌘Alt + C` / `⌘Alt + V` | Copy style, paste style |
| `⌘D` | Duplicate |
| `Backspace` | Delete the selection — on a [model view](/architecture-c4/), unplace it instead |
| `⌘Shift + Backspace` | Remove the element from the model everywhere |
| `⌘]` / `⌘[` | Bring forward / send backward |
| `]` / `[` (or `⌘Alt + ]` / `⌘Alt + [`) | Bring to front / send to back |
| `⌘G` / `⌘Shift + G` | Group / ungroup |
| `⌘Alt + G` | Wrap in a section |
| `⌘L` | Lock / unlock (locked shapes ignore moves, resizes and style changes) |
| `⌘Z` / `⌘Shift + Z` (or `⌘Y`) | Undo / redo |

Bold, italic and underline toggles (`⌘B`, `⌘I`, `⌘U`) apply to the labels of the selected
shapes.

## Navigating

| Shortcut | Action |
| --- | --- |
| `Space + drag` or `H` | Pan |
| `⌘`/`Ctrl + scroll`, trackpad pinch | Zoom at the pointer |
| `Shift + 1` | Zoom to fit |
| `Shift + 2` | Zoom to the selection |
| `⌘0`, `Shift + 0` or `⌘1` | Zoom to 100% |
| `⌘=` / `⌘-` | Zoom in / out |

## Find

`⌘F` opens **Find on canvas**. It searches the text of the shapes on the current page:
labels, chart titles, C4 descriptions, class and ER rows, and chart categories. It does not
search connector labels. `Enter` and `Shift + Enter` step through the matches, selecting and
framing each one. `Esc` closes the bar and puts the selection and view back where they were;
the close button keeps you on the last match.

## Comments

Press `C` to pick the **Comment** tool and click where the comment belongs (on a shape, it follows the shape).
With the keyboard alone, press `Enter` instead: the thread opens on the selected shape, or in the middle of the
canvas when nothing is selected. Type, then `Enter` to send. A pin opens its thread, where you can reply, edit,
resolve or delete; drag a pin to move it, or focus it and press `⌥ + Arrow` (`⇧⌥ + Arrow` for ten times as far). Pins live on the page, not in the picture: PNG, SVG and PDF exports never
show them, and a JSON export includes comments only when **Include comments** is ticked.

## Structure

- **Layers** (`L`) lists the page's objects front to back, with visibility and lock toggles. A row
  selects and brings its shape into view; double-click or `F2` renames it; its menu duplicates,
  reorders and deletes. Drag a row to reorder it, or onto a frame or section to move the shape in
  (it stays where it is on the canvas); `Esc` cancels the drag. A hidden object is dimmed and cannot
  be selected or dragged until it is shown; locked ones do not drag.
- **Pages** live in the document bar: add, rename, duplicate, reorder, delete.
- **Groups** wrap a selection in a container; containers clip their children and move as one.
- **Frames** are what generated diagrams live in; each page can hold several diagrams.

## Text

Double-click empty canvas to place a text node. Double-click a shape to edit its label, or
press `Enter`/`F2` with it selected. A selected shape with no label yet takes what you type as
its label, so `R`, click, then type names a new rectangle. Once a shape has a label, letters
are tool shortcuts again; use `Enter` to edit it. Labels support line breaks and the text
style toggles; the [context bar](/properties-panel/) adjusts size and alignment.

## Touch

On a tablet, two fingers pinch and pan, a quick second tap is a double-tap, and a still press
opens the context menu. The chrome itself is desktop-sized; there is no separate mobile layout.

## What it cannot do

- **No layers like a paint program.** The Layers panel is the page's node tree, ordered by
  z-order; there is no separate layer system to create or rename.
- **No rulers, guides or coordinates panel.** Snapping and alignment guides are the geometry
  tools.
- **Lock is not delete protection.** A locked shape ignores moves, resizes, restyling,
  aligning and shape, icon and chart changes, and stays selectable so you can unlock it. It
  can still be deleted.

## Where to go next

- [Shapes and connectors](/shapes-and-connectors/) — what you are manipulating.
- [Properties panel](/properties-panel/) — exact values for the selection.
- [Keyboard shortcuts](/keyboard-shortcuts/) — the generated full map.
