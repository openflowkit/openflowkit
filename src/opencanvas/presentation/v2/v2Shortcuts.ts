// The keyboard map as data: rendered by the `?` panel and checked against the
// dispatcher by v2Shortcuts.test.ts, so a new shortcut cannot ship undocumented.
// `tokens` are the raw event.key / event.code literals the handler reads.
export interface ShortcutRow {
  readonly label: string;
  /** Display form, already platform-aware via `platformKeys`. */
  readonly keys: string;
  readonly tokens: readonly string[];
}

export interface ShortcutGroup {
  readonly title: string;
  readonly rows: readonly ShortcutRow[];
}

export const isApplePlatform = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** `⌘` on Apple platforms, `Ctrl` everywhere else. */
export const COMMAND = (): string => (isApplePlatform() ? '⌘' : 'Ctrl');

const MAC_ORDER = '⌃⌥⇧⌘';
const PC_NAMES: Readonly<Record<string, string>> = { '⌃': 'Ctrl', '⌘': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift' };
const PC_ORDER = ['Ctrl', 'Alt', 'Shift'];
const PC_KEYS: Readonly<Record<string, string>> = { '⌫': 'Backspace', '↵': 'Enter' };
/**
 * The one shortcut formatter. Hints are written in Mac glyphs, alternatives split by " / " (`⌘Z / ⇧⌘Z`).
 * Apple: glyphs in Apple's order ⌃⌥⇧⌘, no "+". Elsewhere: `Ctrl+Shift+Z`, `Backspace`, `Enter`.
 */
export function platformKeys(glyphs: string, apple = isApplePlatform()): string {
  return glyphs.split(' / ').map((chord) => {
    const [, modifiers = '', key = ''] = /^([⌃⌥⇧⌘]*)(.*)$/su.exec(chord) ?? [];
    if (apple) return [...modifiers].sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b)).join('') + key;
    const names = [...new Set([...modifiers].map((glyph) => PC_NAMES[glyph]!))].sort((a, b) => PC_ORDER.indexOf(a) - PC_ORDER.indexOf(b));
    return [...names, ...(key ? [PC_KEYS[key] ?? key] : [])].join('+');
  }).join(' / ');
}

/** A shortcut sheet row's keys by its label, for a tooltip that must not restate them. */
export const shortcutFor = (label: string): string | undefined =>
  shortcutGroups().flatMap((group) => group.rows).find((row) => row.label === label)?.keys;

type GlyphRow = readonly [label: string, glyphs: string, tokens: readonly string[]];

/** Rows are written in Mac glyphs once and formatted for this platform by `platformKeys`. */
export function shortcutGroups(apple = isApplePlatform()): readonly ShortcutGroup[] {
  const meta = apple ? 'meta' : 'ctrl';
  const groups: readonly { title: string; rows: readonly GlyphRow[] }[] = [
    {
      title: 'Tools',
      rows: [
        ['Select', 'V', ['v']],
        ['Hand', 'H', ['h']],
        ['Comment', 'C', ['c']],
        ['Rectangle', 'R', ['r']],
        ['Ellipse', 'O', ['o']],
        ['Shapes', 'S', ['s']],
        ['Connector', 'A', ['a']],
        ['Text', 'T', ['t']],
        ['Pen', 'P', ['p']],
        ['Highlighter', '⇧P', ['KeyP']],
        ['Eraser', 'X', ['x']],
        ['Laser pointer', 'K', ['k']],
        ['Frame', 'F', ['f']],
        ['Sticky note', 'N', ['n']],
        ['Place the armed shape at the centre', '↵', []],
        ['Place a comment at the selection or the centre', '↵', []],
        ['Move a focused comment pin (10× with Shift)', '⌥ Arrows', []],
        ['Connect two selected shapes', 'A', []],
        ['Insert: media, charts, frames, wireframe', '⇧S', ['KeyS']],
        ['Icons and emoji', 'I / E', ['i', 'e']],
        ['Image', '⇧I', ['KeyI']],
      ],
    },
    {
      title: 'Canvas',
      rows: [
        ['Pan (hold, then drag)', 'Space', [' ']],
        ['Zoom to fit', '⇧1', ['Digit1']],
        ['Zoom to selection', '⇧2', ['Digit2']],
        ['Zoom to 100%', '⇧0 / ⌘0 / ⌘1', ['0', '1', 'Digit0', meta]],
        ['Zoom in / out', '⌘= / ⌘−', ['=', '+', '-']],
        ['Find on canvas', '⌘F', ['f', meta]],
        ['Layers', 'L / ⇧L', ['l']],
        ['Canvas / Map (on a drawing: back to its map)', 'M', ['m']],
        ['Move between boxes (in Map)', 'Arrows', []],
        ['Edit as drawing, a fresh copy (in Map)', '⇧M', ['KeyM']],
        // The dispatcher reads metaKey/ctrlKey for this, never altKey: Alt is
        // taken by resize-from-centre.
        ['Snap bypass (hold while dragging)', '⌘', []],
        // Held at the press or pressed mid-drag, the same as Figma: the drag updates the moment it changes.
        ['Keep proportions, one axis, 45° lines, 15° turns (hold while dragging)', '⇧', []],
        ['From the centre (resize, draw); a copy (move) — hold while dragging', '⌥', []],
        ['Add to / remove from the selection', '⇧Click / ⌘Click', []],
        ['Select inside a group (Esc: back to the group)', 'Double-click', []],
        ['Cancel a drag or draw', 'Esc', []],
      ],
    },
    {
      title: 'Edit',
      rows: [
        ['Undo / redo', '⌘Z / ⇧⌘Z / ⌘Y', ['z', 'y']],
        ['Copy / cut / paste', '⌘C / ⌘X / ⌘V', ['c', 'x', 'KeyC']],
        ['Copy / paste style', '⌥⌘C / ⌥⌘V', []],
        ['Duplicate', '⌘D', ['d']],
        ['Delete / unplace', '⌫', ['Delete', 'Backspace']],
        ['Remove from model', '⇧⌘⌫', []],
        ['Nudge (10 px with Shift)', 'Arrows', ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']],
        ['Edit label', '↵ / F2 / ⇧↵ / ⌘↵', ['Enter', 'F2']],
        ['Name a blank selected shape by typing', 'Any letter', []],
        ['Select all', '⌘A', []],
        ['Lock / unlock', '⌘L', []],
        ['Bold / italic / underline', '⌘B / ⌘I / ⌘U', ['b', 'i', 'u']],
        ['Bring forward / send backward', '⌘] / ⌘[', ['BracketRight', 'BracketLeft']],
        // ⌥⌘] / ⌥⌘[ is the same reorder as ] / [ (the menus show it): one row, not a second "group" action.
        ['Bring to front / send to back', '] / [ / ⌥⌘] / ⌥⌘[', [']', '[']],
      ],
    },
    {
      title: 'Arrange',
      rows: [
        ['Group / ungroup', '⌘G / ⇧⌘G', ['g', 'KeyG']],
        ['Wrap in a section', '⌥⌘G', []],
        ['Align left/right/top/bottom', '⌥A / ⌥D / ⌥W / ⌥S', ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'alt']],
        ['Align centre', '⌥H / ⌥V', ['KeyH', 'KeyV']],
        ['Distribute', '⌥⇧H / ⌥⇧V', []],
        ['Flip horizontal / vertical', '⇧H / ⇧V', []],
      ],
    },
    {
      title: 'Architecture',
      rows: [
        ['Open element view', '↵', []],
        ['Step through a flow', '← / → / Space', []],
      ],
    },
    {
      title: 'Panels',
      rows: [
        ['Architecture model', '⌥M', ['KeyM']],
        ['Diagram as code', '⌥C', ['KeyC']],
        ['Generate the diagram (in the code panel)', '⌘↵', []],
        ['Convert pasted Mermaid / Structurizr / D2 (in the code panel)', '⇧⌘M', []],
        ['Inspect selection', '⌥I', ['KeyI']],
        ['AI assistant', '⌘J', ['j']],
        ['This cheatsheet', '?', ['?']],
        ['Dismiss panel', 'Esc', ['Escape']],
        ['Leave the code editor (again: close it)', 'Esc', []],
      ],
    },
  ];
  return groups.map(({ title, rows }) => ({
    title,
    rows: rows.map(([label, glyphs, tokens]) => ({ label, keys: platformKeys(glyphs, apple), tokens })),
  }));
}
