import { isContainerNodeKind } from '../opencanvas/domain/nodes/containerNodePresentation';
import type { SceneConnector, SceneNode } from '../opencanvas/domain/document/types';
import type { Point2d, Size2d } from '../opencanvas/domain/geometry/types';
import type { JsonObject } from '../opencanvas/domain/document/json';
import type { DslDiagnostic, DslDirection } from './ast';
import { animateRefDiagnostics, animateToJson, extractAnimateBlock } from './animate';
import { createCommentTracker, parseDocument, type CommentTracker, type DslIconsMode } from './document';
import { inferIcon } from './autoIcon';
import { familyFor } from './families';
import type { FamilyContext, FamilyScene } from './families/types';
import { deterministicLayout, layoutRunner, type LayoutPort } from './layout';
import { measureGroupSize } from './sizing';
import { diagramPalette, paletteResolver, type DiagramPaletteName } from '../opencanvas/domain/nodes/nodePalette';
import { dslFamilyDirection } from './vocabulary';
import { slugifyDslId } from './text';

export interface CompileOptions {
  origin?: Point2d;
  layout?: LayoutPort;
  signal?: AbortSignal;
  measureLabel?: (label: string, kind: string) => Size2d;
  resolveIcon?: (id: string) => { packId: string; shapeId: string } | null;
  /** Palette override; an authored `appearance:` directive wins when present. */
  appearance?: { palette?: DiagramPaletteName };
  /** Icons from labels when the text has no `icons:` directive; needs `resolveIcon`. */
  autoIcons?: boolean;
}

interface CompileMeta {
  family: string;
  direction?: string;
  version: number;
  source: string;
  hash: string;
  title?: string;
  /** Set only for a non-default palette, so default output stays unchanged. */
  appearance?: { palette: DiagramPaletteName };
  /** Authored `icons:` directive, kept so the serializer writes it back. */
  icons?: DslIconsMode;
  /**
   * The host's "icons from labels" setting this frame was drawn with, when it decided (no `icons:` line, a
   * host that resolves icons), so a later recompile of the same text draws the same icons. Never serialized.
   */
  autoIcons?: boolean;
}

export interface CompileResult {
  frame: SceneNode;
  /** Data nodes: everything that is not a container. */
  nodes: SceneNode[];
  /** Container nodes (dsl `group` blocks and family frames). */
  groups: SceneNode[];
  connectors: SceneConnector[];
  diagnostics: DslDiagnostic[];
  meta: CompileMeta;
}

/** One view of a compiled workspace: a C4 model view page, or the family's only frame. */
interface CompileViewResult {
  /** Stable view id; empty for single-frame families. */
  viewId: string;
  /** Page name for workspace views. */
  name: string;
  result: CompileResult;
}

export interface CompileWorkspaceResult {
  family: string;
  views: readonly CompileViewResult[];
}

export function hashDslScene(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;

/**
 * 64-bit FNV-1a over the UTF-16 code units, as 16 hex digits: for an id an agent holds and hands back, where the
 * 32-bit hashDslScene would let two texts share one (about one pair in 77,000). Same output on every platform.
 */
export function hashText64(value: string): string {
  let hash = FNV64_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(index))) * FNV64_PRIME);
  }
  return hash.toString(16).padStart(16, '0');
}

export { slugifyDslId } from './text';

interface AssembleOptions {
  scene: FamilyScene;
  family: string;
  origin: Point2d;
  palette: DiagramPaletteName;
  frameId: string;
  text: string;
  direction?: DslDirection;
  title?: string;
  animate?: JsonObject;
  icons?: DslIconsMode;
  autoIcons?: boolean;
  comments: CommentTracker;
  diagnostics: DslDiagnostic[];
}

/**
 * text → scene(s). One parse, one family, one frame per view. The frame and its
 * metadata are assembled here so every family gets identical identity, hashing
 * and code-panel behaviour, and a C4 workspace gets one page per view.
 */
export async function compileWorkspace(text: string, options: CompileOptions = {}): Promise<CompileWorkspaceResult> {
  const document = parseDocument(text);
  const diagnostics = [...document.diagnostics];
  // The animate block is family-neutral: it is pulled out before the family
  // parser runs, so `step a -> c` inside it can never become a real edge.
  const { block: animate, segments } = extractAnimateBlock(document.segments, diagnostics);
  const family = familyFor(document.family);
  const comments = createCommentTracker(document.comments);
  const origin = options.origin ?? { x: 0, y: 0 };
  const palette = diagramPalette(document.appearance ?? options.appearance?.palette);
  // Only an id the host can draw counts, so an auto icon never warns or dangles.
  const resolveIcon = options.resolveIcon;
  const autoIcons = (document.icons ?? (options.autoIcons ? 'auto' : 'off')) === 'auto' && resolveIcon;
  const context: FamilyContext = {
    text,
    origin,
    direction: document.direction ?? dslFamilyDirection(document.family),
    header: document.header,
    ...(document.title ? { title: document.title } : {}),
    ...(document.appearance || document.icons ? {
      authored: { ...(document.appearance ? { palette: document.appearance } : {}), ...(document.icons ? { icons: document.icons } : {}) },
    } : {}),
    comments,
    diagnostics,
    swatch: paletteResolver(palette),
    layout: layoutRunner(options.layout ?? deterministicLayout),
    ...(options.measureLabel ? { measureLabel: options.measureLabel } : {}),
    ...(resolveIcon ? { resolveIcon } : {}),
    ...(autoIcons ? {
      inferIcon: (label: string, hint?: string) => {
        const id = inferIcon(label, hint);
        return id && resolveIcon(id) ? id : null;
      },
    } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };

  const frameIdBase = `dsl-${hashDslScene(text)}`;
  const familyViews = family.compileViews
    ? await family.compileViews(segments, context)
    : [{ id: '', name: document.title ?? '', scene: await family.compile(segments, context) }];
  // A step that names no node would animate nothing: say so where validate and the code panel look.
  if (animate) diagnostics.push(...animateRefDiagnostics(animate, familyViews.flatMap((view) => view.scene.nodes)));

  return {
    family: document.family,
    views: familyViews.map((view) => {
      const frameId = familyViews.length === 1 || !view.id ? frameIdBase : `${frameIdBase}-${slugifyDslId(view.id)}`;
      return {
        viewId: view.id,
        name: view.name,
        result: assembleResult({
          scene: view.scene, family: document.family, origin, palette, frameId, text,
          ...(document.direction ? { direction: document.direction } : {}),
          ...(document.title ? { title: document.title } : {}),
          ...(animate ? { animate: animateToJson(animate) } : {}),
          ...(document.icons ? { icons: document.icons } : {}),
          ...(!document.icons && resolveIcon ? { autoIcons: Boolean(options.autoIcons) } : {}),
          comments,
          diagnostics,
        }),
      };
    }),
  };
}

/** The single-frame front door: the first view of the workspace. */
export async function compile(text: string, options: CompileOptions = {}): Promise<CompileResult> {
  const workspace = await compileWorkspace(text, options);
  return workspace.views[0]!.result;
}

function assembleResult(options: AssembleOptions): CompileResult {
  const { scene, family, origin, palette, frameId, text, direction, title, animate, icons, autoIcons, comments, diagnostics } = options;
  // The palette rides on every record, not just the frame: renderers and the
  // serializer read a node without its page, so key-based families stay themed.
  const themed = <T extends SceneNode | SceneConnector>(record: T): T => palette === 'pastel' ? record : {
    ...record,
    metadata: {
      ...record.metadata,
      dsl: { ...(record.metadata.dsl as Record<string, unknown> | undefined ?? {}), appearance: { palette } },
    },
  };
  const all = scene.nodes
    .map((node) => (node.parentId === null ? { ...node, parentId: frameId } : node))
    .map(themed);
  const groups = all.filter((node) => isContainerNodeKind(node.kind));
  const nodes = all.filter((node) => !isContainerNodeKind(node.kind));
  const connectors = scene.connectors.map(themed);
  const hash = hashDslScene(JSON.stringify({ nodes, groups, connectors }));
  const meta: CompileMeta = {
    family, version: 1, source: text, hash,
    ...(direction ? { direction } : {}),
    ...(title ? { title } : {}),
    ...(palette === 'pastel' ? {} : { appearance: { palette } }),
    ...(icons ? { icons } : {}),
    ...(autoIcons === undefined ? {} : { autoIcons }),
  };
  const trailing = comments.remaining();
  const label = typeof scene.meta?.viewTitle === 'string' ? scene.meta.viewTitle : title ?? '';
  // A chart prints its title inside the plot and hides the frame header; every other title must fit its band.
  const headerShows = Boolean(label) && !(family === 'chart' && title);
  const frame: SceneNode = {
    id: frameId, kind: 'frame', parentId: null, layerId: 'default', zIndex: 0,
    transform: { translation: { ...origin }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    size: headerShows ? { ...scene.size, width: Math.max(scene.size.width, measureGroupSize(label, true).width) } : scene.size,
    content: { label,
      ...(typeof scene.meta?.viewKey === 'string' ? {subLabel: scene.meta.viewKey} : {}),
      // A chart prints its title inside the plot; the frame header would print it twice, over the axis.
      ...(family === 'chart' && title ? { showHeader: false } : {}),
    },
    appearance: {}, ports: [],
    metadata: {
      dsl: {
        ...scene.meta,
        ...meta,
        ...(animate ? { animate } : {}),
        ...(trailing.length ? { comments: trailing } : {}),
      },
    },
    extensions: {},
  };
  return { frame, nodes, groups, connectors, diagnostics, meta };
}
