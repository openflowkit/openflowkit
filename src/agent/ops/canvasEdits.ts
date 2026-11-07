// Canvas edits the text does not carry. A regenerate (the code panel's ⌘↵ or update_diagram) rebuilds a
// frame from its text, so a recolour, a drag, a rename or a deletion made on the canvas is replaced. The code
// panel says so in a banner; an agent gets the list: each node or connector that differs from what the
// frame's authored text compiles to, and the attributes that keep it where the language can say it.
import { areStructurallyEqual } from '../../opencanvas/domain/commands/equality';
import type { CompileOptions, CompileResult, CompileWorkspaceResult } from '../../dsl/compile';
import { frameEdited } from '../../dsl/frameScene';
import { dslFrameMeta, dslFrameRaw, type DslFrameScene } from '../../dsl/sceneMeta';
import { quote } from '../../dsl/text';
import type { SceneConnector, SceneNode } from '../../opencanvas/domain/document/types';
import { HEADLESS_LAYOUT_LIMITS, type OpCapabilities } from './types';

export interface CanvasEdit {
  readonly id: string;
  readonly label: string;
  readonly kind: 'node' | 'connector';
  /**
   * Canvas value per edited key: appearance keys (fill, stroke…), `position` ({x, y}, as `pin:` reads it),
   * `size`, `label`, `icon`, `kind`, `parent`, `rotation`, `scale`, `order`, `content.<key>`; on a connector
   * `waypoints`, `route`, `label`, `source`, `target`. `added: true` / `removed: true` for a whole record.
   */
  readonly changed: Readonly<Record<string, unknown>>;
  /** Attributes to merge into the node's `[ … ]` list to keep it (`#fde68a, pin: "844,155"`); null when the language cannot say it. */
  readonly carry: string | null;
}

/** The edits, or null and why they could not be compared. */
export type CanvasEditsResult =
  | { readonly edits: readonly CanvasEdit[]; readonly note?: string }
  | { readonly edits: null; readonly note: string };

type Record_ = SceneNode | SceneConnector;
const isNode = (record: Record_): record is SceneNode => 'transform' in record;

const ICON_CONTENT = /^(icon|arch|assetPresentation)/;

function nodeLabel(node: SceneNode): string {
  return typeof node.content.label === 'string' && node.content.label ? node.content.label : node.id;
}

/** Records of one frame by the id they were compiled with: placing may rename `x` to `<frameId>-x`. */
function indexed(scene: { readonly frame: SceneNode; readonly nodes: readonly SceneNode[]; readonly groups?: readonly SceneNode[]; readonly connectors: readonly SceneConnector[] }) {
  const nodes = [...(scene.groups ?? []), ...scene.nodes];
  const byId = new Map<string, Record_>([...nodes, ...scene.connectors].map((record) => [record.id, record]));
  const find = (id: string) => byId.get(id) ?? byId.get(`${scene.frame.id}-${id}`);
  return { nodes, connectors: scene.connectors, frameId: scene.frame.id, find };
}
type Indexed = ReturnType<typeof indexed>;

function labelOf(record: Record_, at: Indexed): string {
  if (isNode(record)) return nodeLabel(record);
  const text = record.labels[0]?.text;
  if (text) return text;
  const end = (id: string | null) => {
    const node = id ? at.find(id) : undefined;
    return node && isNode(node) ? nodeLabel(node) : id ?? '?';
  };
  return `${end(record.source.nodeId)} -> ${end(record.target.nodeId)}`;
}

/** An id as the other scene names it (the frame, or a record renamed on placing). */
const counterpart = (id: string | null, from: Indexed, to: Indexed): string | null => {
  if (id === null) return null;
  if (id === from.frameId) return to.frameId;
  const record = from.find(id);
  const there = record ? to.find(record.id.startsWith(`${from.frameId}-`) ? record.id.slice(from.frameId.length + 1) : record.id) : undefined;
  return there?.id ?? id;
};

/** Every comparable value of a record, keyed as `changed` reports it. `ids` maps its references into the other scene. */
function facets(record: Record_, ids: (id: string | null) => string | null): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record.appearance)) out.set(key, value);
  if (isNode(record)) {
    out.set('position', record.transform.translation);
    out.set('size', record.size);
    out.set('rotation', record.transform.rotationRadians);
    out.set('scale', record.transform.scale);
    out.set('kind', record.kind);
    out.set('parent', ids(record.parentId));
    out.set('order', record.zIndex);
    const icon: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record.content)) {
      if (key === 'label') out.set('label', value);
      else if (ICON_CONTENT.test(key)) icon[key] = value;
      else out.set(`content.${key}`, value);
    }
    out.set('icon', typeof icon.icon === 'string' ? icon : Object.keys(icon).length ? icon : 'none');
    // A card put back to top clears its layout, and a cleared value is skipped: the placement is compared as a word.
    if (record.content.assetPresentation === 'icon') {
      const layout = record.content.contentLayout as { iconPlacement?: unknown } | undefined;
      out.set('iconpos', layout?.iconPlacement === 'left' ? 'left' : 'top');
    }
  } else {
    out.set('waypoints', record.waypoints);
    out.set('route', record.route);
    out.set('label', record.labels.map((label) => label.text).join(' '));
    out.set('source', ids(record.source.nodeId));
    out.set('target', ids(record.target.nodeId));
  }
  return out;
}

/** The value `changed` reports for a facet: what the canvas holds (an icon by its id). */
const shown = (key: string, value: unknown): unknown => key === 'icon' && value && typeof value === 'object'
  ? (value as { icon?: unknown }).icon ?? 'none' : value;

function carryOf(changed: Readonly<Record<string, unknown>>, kind: 'node' | 'connector'): string | null {
  if (kind !== 'node' || changed.added || changed.removed) return null;
  const attrs: string[] = [];
  if (typeof changed.fill === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(changed.fill)) attrs.push(changed.fill.toLowerCase());
  if (typeof changed.icon === 'string') attrs.push(`icon: ${changed.icon}`);
  if (typeof changed.iconpos === 'string') attrs.push(`iconpos: ${changed.iconpos}`);
  if (typeof changed.label === 'string') attrs.push(`label: ${quote(changed.label)}`);
  const at = changed.position as { x: number; y: number } | undefined;
  if (at) attrs.push(`pin: "${Math.round(at.x)},${Math.round(at.y)}"`);
  const size = changed.size as { width: number; height: number } | undefined;
  // A placement change resizes the card to what its text hugs; the text already says that, so the size is not pinned.
  if (size && !changed.iconpos) attrs.push(`width: ${Math.round(size.width)}`, `height: ${Math.round(size.height)}`);
  return attrs.length ? attrs.join(', ') : null;
}

function edit(record: Record_, at: Indexed, changed: Record<string, unknown>): CanvasEdit {
  const kind = isNode(record) ? 'node' : 'connector';
  return { id: record.id, label: labelOf(record, at), kind, changed, carry: carryOf(changed, kind) };
}

/** `scene` against what its authored text compiles to (`baseline`); empty when the canvas still matches the text. */
export function diffCanvasEdits(scene: DslFrameScene, baseline: CompileResult): readonly CanvasEdit[] {
  const now = indexed(scene);
  const then = indexed({ frame: baseline.frame, nodes: baseline.nodes, groups: baseline.groups, connectors: baseline.connectors });
  const matched = new Set<string>();
  const edits: CanvasEdit[] = [];
  for (const record of [...then.nodes, ...then.connectors]) {
    const current = now.find(record.id);
    if (!current || isNode(current) !== isNode(record)) {
      edits.push({ ...edit(record, then, { removed: true }), carry: null });
      continue;
    }
    matched.add(current.id);
    const before = facets(record, (id) => counterpart(id, then, now));
    const after = facets(current, (id) => id);
    const changed: Record<string, unknown> = {};
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const value = after.get(key);
      // A value the canvas cleared (a removed fill) has nothing to carry: only what the canvas holds is reported.
      if (value === undefined || value === null || areStructurallyEqual(value, before.get(key))) continue;
      changed[key] = shown(key, value);
    }
    if (Object.keys(changed).length) edits.push(edit(current, now, changed));
  }
  for (const record of [...now.nodes, ...now.connectors]) {
    if (!matched.has(record.id)) edits.push(edit(record, now, { added: true }));
  }
  return edits;
}

/** Compiles each authored text once per op run, however many of its view frames ask. */
export type BaselineCache = Map<string, Promise<CompileWorkspaceResult>>;

const tooBig = (scene: DslFrameScene) => (scene.nodes.length + (scene.groups?.length ?? 0) > HEADLESS_LAYOUT_LIMITS.nodes
  || scene.connectors.length > HEADLESS_LAYOUT_LIMITS.edges);

/** What the frame's authored text compiles to, or null and why it could not be compiled. */
export type FrameBaselineResult =
  | { readonly baseline: CompileResult; readonly note?: undefined }
  | { readonly baseline: null; readonly note: string };

/**
 * The frame's authored text compiled with the palette and the icons setting it was made with: the canvas
 * as it was before anyone edited it. Never throws: what stops the compile comes back as a note.
 */
export async function frameBaseline(scene: DslFrameScene, capabilities: OpCapabilities, cache: BaselineCache = new Map()): Promise<FrameBaselineResult> {
  const meta = dslFrameMeta(scene.frame);
  const raw = dslFrameRaw(scene.frame);
  if (typeof meta.source !== 'string') return { baseline: null, note: 'Not compared: this frame has no authored text to compare the canvas against.' };
  if (tooBig(scene)) {
    return { baseline: null, note: `Not compared: over ${HEADLESS_LAYOUT_LIMITS.nodes} shapes or ${HEADLESS_LAYOUT_LIMITS.edges} connections. Treat every canvas edit as one update_diagram replaces.` };
  }
  const palette = meta.appearance?.palette;
  const options: CompileOptions = {
    // Children sit relative to their frame, so where the baseline lands does not matter: one compile serves every view.
    origin: { x: 0, y: 0 },
    ...(palette ? { appearance: { palette: palette as NonNullable<CompileOptions['appearance']>['palette'] } } : {}),
    ...(typeof raw.autoIcons === 'boolean' ? { autoIcons: raw.autoIcons } : {}),
  };
  const key = JSON.stringify([meta.source, palette ?? null, raw.autoIcons ?? null]);
  try {
    let pending = cache.get(key);
    if (!pending) { pending = capabilities.compileWorkspace(meta.source, options); cache.set(key, pending); }
    const workspace = await pending;
    // A C4 view: the view this frame shows; a single diagram: its only view.
    const viewId = (raw.arch as { view?: unknown } | undefined)?.view;
    const view = workspace.views.find((candidate) => candidate.viewId === viewId) ?? workspace.views[0];
    if (!view) return { baseline: null, note: 'Not compared: the authored text no longer compiles to this view.' };
    return { baseline: view.result };
  } catch (error) {
    return { baseline: null, note: `Not compared: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * The frame's canvas edits: the frame against its authored text (see frameBaseline). Never throws: anything
 * that stops the comparison comes back as `edits: null` and a note, and the read or regenerate that asked carries on.
 */
export async function frameCanvasEdits(scene: DslFrameScene, capabilities: OpCapabilities, cache: BaselineCache = new Map()): Promise<CanvasEditsResult> {
  if (typeof dslFrameMeta(scene.frame).source === 'string' && !frameEdited(scene)) return { edits: [] };
  const compiled = await frameBaseline(scene, capabilities, cache);
  if (compiled.baseline === null) return { edits: null, note: compiled.note };
  const edits = diffCanvasEdits(scene, compiled.baseline);
  return edits.length ? { edits } : { edits, note: 'The canvas differs from the text only in ways not listed here (ports or metadata); update_diagram replaces those too.' };
}

/**
 * What a regenerate threw away: each canvas edit the new frame does not have. A record is found by id, else
 * by label (a renamed id keeps its edits only if the text carries them); one the new text no longer has loses
 * its edits with it, and they are listed too: deleting a shape the user restyled is worth saying.
 */
export function discardedEdits(edits: readonly CanvasEdit[], after: DslFrameScene | null): readonly CanvasEdit[] {
  if (!after) return edits;
  const now = indexed(after);
  const sameLabel = (edit: CanvasEdit) => [...now.nodes, ...now.connectors]
    .find((record) => (isNode(record) ? 'node' : 'connector') === edit.kind && labelOf(record, now) === edit.label);
  return edits.flatMap((edit) => {
    const current = now.find(edit.id) ?? sameLabel(edit);
    // Added on the canvas: a regenerate keeps only what the text says, so it is gone unless the text drew it.
    if (edit.changed.added) return current ? [] : [edit];
    if (edit.changed.removed) return current ? [edit] : [];
    if (!current) return [edit];
    const values = facets(current, (id) => id);
    const lost = Object.entries(edit.changed).filter(([key, value]) => !areStructurallyEqual(shown(key, values.get(key)), value));
    if (lost.length === 0) return [];
    const changed = Object.fromEntries(lost);
    return [{ ...edit, changed, carry: carryOf(changed, edit.kind) }];
  });
}
