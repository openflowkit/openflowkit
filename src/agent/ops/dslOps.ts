// DSL ops: an agent talks the language first. create/update compile through
// the host's layout port and land as ONE reversible page command; get/list
// read the frames back, honest about drift and losses.
import { z } from 'zod';
import { buildDslPageCommand, nextDslFrameOrigin, placedFrameId } from '../../opencanvas/application/dsl/dslPageCommand';
import { buildWorkspacePagesCommand, workspaceViewFrames, type WorkspacePagesOptions } from '../../opencanvas/application/dsl/architectureCommands';
import { frameEdited, frameScene, frameText, dslFrames } from '../../dsl/frameScene';
import { serializeLosses } from '../../dsl/losses';
import { dslFrameMeta } from '../../dsl/sceneMeta';
import { applyDocumentCommand } from '../../opencanvas/domain/commands/execute';
import type { CompileResult, CompileWorkspaceResult } from '../../dsl/compile';
import type { Point2d } from '../../opencanvas/domain/geometry/types';
import type { SceneDocumentV1 } from '../../opencanvas/domain/document/types';
import type { DocumentCommand } from '../../opencanvas/domain/commands/types';
import { readAgentSource, type AgentSource } from '../lint';
import { discardedEdits, frameCanvasEdits, type BaselineCache, type CanvasEdit } from './canvasEdits';
import { defineOp, pointOf, pointSchema, requireFrame, requirePage, type OpContext } from './types';

const DSL_HELP = 'OpenFlow DSL source. Mermaid, Structurizr DSL and D2 are accepted too: they convert first, and the '
  + 'result carries `converted.dsl` (keep editing that) and `converted.losses`. Call get_syntax when unsure. '
  + 'A node whose tech: or label names a technology (Postgres, React, S3) gets its icon automatically; '
  + '`icon: none` opts one node out, `icons: off` the whole diagram.';

const FRAME_ID = 'Diagram frame id, from create_diagram or list_diagrams.';
const PALETTE = 'Diagram palette; defaults to the one the DSL names (`appearance:`), else pastel.';

/** What a foreign input became, so the agent can keep editing in DSL. */
function convertedOutput(source: AgentSource) {
  return source.converted ? { converted: { ...source.converted, dsl: source.dsl } } : {};
}

function withConverted<T extends { output: object }>(outcome: T, source: AgentSource): T {
  return { ...outcome, output: { ...outcome.output, ...convertedOutput(source) } };
}

function diagramOutput(pageId: string, frameId: string, compiled: CompileResult) {
  return {
    pageId,
    frameId,
    family: compiled.meta.family,
    title: compiled.meta.title ?? null,
    nodes: compiled.nodes.length + compiled.groups.length,
    connectors: compiled.connectors.length,
    // What icons from labels added, so an agent can see it and correct a wrong guess.
    inferredIcons: compiled.nodes.flatMap((node) => {
      const inferred = (node.metadata.dsl as { autoIcon?: unknown } | undefined)?.autoIcon;
      return typeof inferred === 'string' && node.content.icon === inferred
        ? [{ label: String(node.content.label ?? node.id), icon: inferred }] : [];
    }),
    diagnostics: compiled.diagnostics,
  };
}

const mintPageId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

/**
 * Nothing drawable (every line dropped, or none written) is a failed call, not an empty frame. The diagnostics ride on the
 * error so a checker (`openflowkit validate`) can report them as its own.
 */
function requireDrawable(compiled: CompileResult): CompileResult {
  const notable = compiled.diagnostics.filter(({ severity }) => severity !== 'info');
  if (compiled.nodes.length + compiled.groups.length > 0) return compiled;
  if (notable.length === 0) {
    throw Object.assign(new RangeError('Nothing to draw: the DSL has a header but no statements. Add at least one node or edge, e.g. `A -> B`.'), { diagnostics: [] });
  }
  const lines = notable.map(({ line, col, code, message }) => `line ${line}:${col} ${code} ${message}`);
  throw Object.assign(new RangeError(`Nothing to draw:\n${lines.join('\n')}`), { diagnostics: notable });
}

/**
 * A C4 workspace lands as one page per view, like ⌘↵ does.
 * The output describes the first view like a single diagram and lists the rest.
 */
function workspaceOutcome(document: SceneDocumentV1, workspace: CompileWorkspaceResult, where: Omit<WorkspacePagesOptions, 'mintId'> = {}) {
  const command = buildWorkspacePagesCommand(document, workspace, { mintId: mintPageId, ...where });
  const result = command ? applyDocumentCommand(document, command).document : document;
  const placed = workspaceViewFrames(result, workspace, where.replaceFrameId);
  const views = workspace.views.map((view, index) => ({ viewId: view.viewId, name: view.name, ...placed[index]! }));
  const first = workspace.views[0]!.result;
  return {
    command,
    output: {
      ...diagramOutput(views[0]!.pageId, views[0]!.frameId, first),
      views,
    },
  };
}

export const createDiagram = defineOp({
  name: 'create_diagram',
  title: 'Create diagram',
  description: 'Draw a new diagram frame from text, placed right of what the page already holds (or at `at`). '
    + 'One undo step. To change a diagram that exists, use update_diagram with its frameId instead of drawing another.',
  schema: z.object({
    dsl: z.string().min(1).describe(DSL_HELP),
    pageId: z.string().min(1).optional().describe('Page to draw on (see list_pages); defaults to the page the editor shows, or the first page in file mode.'),
    at: pointSchema().optional().describe('Top-left corner of the new frame in page coordinates; omit to place it beside what is there.'),
    palette: z.enum(['pastel', 'paper', 'builder', 'mono']).optional().describe(PALETTE),
  }),
  async run({ dsl, pageId, at, palette }, context) {
    const page = requirePage(context.document, pageId ?? context.pageId);
    const source = readAgentSource(dsl);
    const compileAt = (origin: Point2d) => context.capabilities.compileWorkspace(source.dsl, {
      origin,
      ...(palette ? { appearance: { palette } } : {}),
    });
    const origin: Point2d = at ? pointOf(at) : nextDslFrameOrigin(page);
    let workspace = await compileAt(origin);
    if (workspace.views.length > 1 || workspace.views[0]!.viewId.startsWith('view:')) {
      // Views live on their own pages: a regenerate keeps the frame where it is, not right of whatever the target page holds.
      const held = at ? undefined : workspaceViewFrames(context.document, workspace)[0];
      const there = held && context.document.pages.find((entry) => entry.id === held.pageId)
        ?.nodes.find((node) => node.id === held.frameId)?.transform.translation;
      if (there && (there.x !== origin.x || there.y !== origin.y)) workspace = await compileAt(there);
      return withConverted(workspaceOutcome(context.document, workspace, { intoPageId: page.id }), source);
    }
    const compiled = requireDrawable(workspace.views[0]!.result);
    return {
      command: buildDslPageCommand(page, compiled),
      output: { ...diagramOutput(page.id, placedFrameId(page, compiled), compiled), views: [], ...convertedOutput(source) },
    };
  },
});

export const updateDiagram = defineOp({
  name: 'update_diagram',
  title: 'Update diagram',
  description: 'Redraw an existing diagram frame from new text, in place: same frame id and position, one undo step '
    + '(a C4 workspace redraws every view page it owns). The text replaces the frame, as Generate in the code panel does, '
    + 'so canvas edits it does not carry (get_diagram lists them as `canvasEdits`) are dropped; `discarded` names any that '
    + 'were, each with its frameId.',
  schema: z.object({
    frameId: z.string().min(1).describe(FRAME_ID),
    dsl: z.string().min(1).describe(DSL_HELP),
    palette: z.enum(['pastel', 'paper', 'builder', 'mono']).optional().describe(PALETTE),
  }),
  async run({ frameId, dsl, palette }, context) {
    const page = requirePage(context.document, context.pageId);
    const frame = requireFrame(page, frameId);
    const source = readAgentSource(dsl);
    const workspace = await context.capabilities.compileWorkspace(source.dsl, {
      origin: frame.transform.translation,
      ...(palette ? { appearance: { palette } } : {}),
    });
    const views = workspace.views.length > 1 || workspace.views[0]!.viewId.startsWith('view:');
    const outcome = views
      ? withConverted(workspaceOutcome(context.document, workspace, { replaceFrameId: frameId }), source)
      : (() => {
        const compiled = requireDrawable(workspace.views[0]!.result);
        return {
          command: buildDslPageCommand(page, compiled, frameId),
          output: { ...diagramOutput(page.id, frameId, compiled), views: [] as unknown[], ...convertedOutput(source) },
        };
      })();
    // A workspace redraws every view frame its text drew, not only the one named.
    const replaced = views ? framesOfSource(context.document, frame) : [{ page, frame }];
    const { discarded, note } = await discardedBy(context, outcome.command, replaced);
    return { ...outcome, output: { ...outcome.output, discarded, ...(note ? { discardedNote: note } : {}) } };
  },
});

type FrameAt = { readonly page: SceneDocumentV1['pages'][number]; readonly frame: SceneDocumentV1['pages'][number]['nodes'][number] };

/** Every DSL frame drawn from the same authored text as `frame` (a C4 workspace's view frames), on any page. */
function framesOfSource(document: SceneDocumentV1, frame: FrameAt['frame']): readonly FrameAt[] {
  const source = dslFrameMeta(frame).source;
  return document.pages.flatMap((page) => dslFrames(page)
    .filter((candidate) => candidate.id === frame.id || (typeof source === 'string' && dslFrameMeta(candidate).source === source))
    .map((candidate) => ({ page, frame: candidate })));
}

/** The canvas edits on `frames` that `command` did not keep, each with its frame; a note when some could not be compared. */
async function discardedBy(context: OpContext, command: DocumentCommand | null, frames: readonly FrameAt[]) {
  const cache: BaselineCache = new Map();
  const after = command ? applyDocumentCommand(context.document, command).document : null;
  const notes: string[] = [];
  const discarded: (CanvasEdit & { frameId: string })[] = [];
  for (const { page, frame } of frames) {
    const scene = frameScene(page, frame.id);
    if (!scene || !after) continue;
    const result = await frameCanvasEdits(scene, context.capabilities, cache);
    if (result.edits === null) { notes.push(result.note); continue; }
    if (result.edits.length === 0) continue;
    const afterPage = after.pages.find((candidate) => candidate.nodes.some((node) => node.id === frame.id));
    discarded.push(...discardedEdits(result.edits, afterPage ? frameScene(afterPage, frame.id) : null).map((edit) => ({ ...edit, frameId: frame.id })));
  }
  return { discarded, note: [...new Set(notes)].join(' ') };
}

export const getDiagram = defineOp({
  name: 'get_diagram',
  title: 'Read diagram',
  description: 'The DSL text of one diagram frame: what was authored while the canvas still matches it, else text regenerated '
    + 'from the canvas (`edited: true`); either way it names the palette, so the text alone redraws the diagram. '
    + '`canvasEdits` lists what was changed on the canvas against the authored text: '
    + 'recolours, moves, resizes, renames, icons, rewired or bent connectors, and shapes added or removed. Each has `carry`: '
    + 'attributes to merge into that node\'s existing `[ … ]` list (one list per node) to keep the edit, or null when the '
    + 'language cannot say it. `canvasEdits` is null, with `canvasEditsNote` saying why, when it could not be compared. '
    + '`losses` names what the language cannot say at all. update_diagram drops anything the text you send does not carry.',
  schema: z.object({
    frameId: z.string().min(1).optional().describe(`${FRAME_ID} Defaults to the first diagram on the page.`),
    pageId: z.string().min(1).optional().describe('Page to read (see list_pages); defaults to the page the editor shows, or the first page in file mode.'),
  }),
  async run({ frameId, pageId }, context) {
    const page = requirePage(context.document, pageId ?? context.pageId);
    const first = frameId ? null : dslFrames(page)[0];
    if (!frameId && !first) throw new RangeError('This page has no diagram frames. Use list_diagrams.');
    const frame = frameId ? requireFrame(page, frameId) : first!;
    const scene = frameScene(page, frame.id);
    if (!scene) throw new RangeError(`Diagram frame "${frame.id}" was not found.`);
    const meta = dslFrameMeta(frame);
    const edited = frameEdited(scene);
    const losses = serializeLosses(scene);
    const compared = await frameCanvasEdits(scene, context.capabilities);
    return {
      command: null,
      output: {
        frameId: frame.id,
        pageId: page.id,
        family: meta.family,
        title: typeof frame.content.label === 'string' && frame.content.label ? frame.content.label : null,
        edited,
        losses,
        canvasEdits: compared.edits,
        ...(compared.note ? { canvasEditsNote: compared.note } : {}),
        dsl: frameText(scene),
      },
    };
  },
});

export const listDiagrams = defineOp({
  name: 'list_diagrams',
  title: 'List diagrams',
  description: 'Every diagram frame in the document: frameId, page, family, title, and `edited` (the canvas no longer matches its text).',
  schema: z.object({}),
  async run(_input, context) {
    const diagrams = context.document.pages.flatMap((page) =>
      dslFrames(page).map((frame) => {
        const scene = frameScene(page, frame.id);
        const meta = dslFrameMeta(frame);
        return {
          frameId: frame.id,
          pageId: page.id,
          pageName: page.name,
          family: meta.family,
          title: typeof frame.content.label === 'string' && frame.content.label ? frame.content.label : null,
          edited: scene ? frameEdited(scene) : false,
        };
      }));
    return { command: null, output: { diagrams } };
  },
});
