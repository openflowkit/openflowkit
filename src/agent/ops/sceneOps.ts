// Scene ops: what the language cannot say. Each one wraps the same command
// builders the UI uses, so an agent edit and a human edit produce identical
// records — the parity test in ./ops.test.ts keeps that honest.
import { z } from 'zod';
import { buildDeleteSelectionCommand, buildMoveNodesCommand } from '../../opencanvas/domain/commands/sceneEdits';
import { buildNodeStateMap } from '../../opencanvas/domain/scene/nodeState';
import { resolveArchitectureNodePresentation } from '../../opencanvas/domain/nodes/architectureNodePresentation';
import { buildSetIconPlacementCommand } from '../../opencanvas/domain/commands/iconCommands';
import { buildStyleNodesCommand } from '../../opencanvas/domain/commands/styleNodes';
import { PRODUCTION_NODE_CATALOG, createProductionSceneNode } from '../../opencanvas/application/active-document/productionNodeCatalog';
import { buildProductionNodeMutationCommand } from '../../opencanvas/application/active-document/productionNodeBridge';
import { SHAPE_KINDS, createShapeNode, type ShapeKind } from '../../opencanvas/domain/nodes/shapeNode';
import { createChartNode } from '../../opencanvas/domain/nodes/chartNode';
import { DEFAULT_QUADRANT } from '../../opencanvas/domain/nodes/chartNodePresentation';
import { createWidgetNode } from '../../opencanvas/domain/nodes/widgetNode';
import { WIDGET_KINDS, WIDGET_SEVERITIES } from '../../opencanvas/domain/nodes/widgetNodePresentation';
import { FRAME_PRESETS, createPresetFrame } from '../../opencanvas/domain/nodes/framePreset';
import { defineOp, pointOf, pointSchema, requirePage } from './types';

// Toolbar shapes first: they are what a human creates, so agents get the same nodes.
// A catalog entry can share a toolbar shape's id (ellipse); the enum lists it once.
const CATALOG_IDS = [...new Set([...SHAPE_KINDS, ...PRODUCTION_NODE_CATALOG.map((entry) => entry.id)])];

// A factory, not one shared instance: a reused schema becomes a JSON-schema `$ref` strict clients reject.
const hex = () => z.string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Use a hex colour, #rrggbb or #rrggbbaa (e.g. #e95420); colour names are for DSL text, not this op.')
  .describe('Hex colour, #rrggbb or #rrggbbaa, e.g. #e95420.');
const nodeIds = (what: string) => z.array(z.string().min(1)).min(1, 'Pass at least one id (get_document lists them).').describe(what);

export const moveNodes = defineOp({
  name: 'move',
  title: 'Move shapes',
  description: 'Move nodes on the canvas, by `delta`, or so the first id lands at `to` (the rest keep their offsets). '
    + 'Pass exactly one of the two. One undo step. A diagram regenerated from text lays its nodes out again.',
  schema: z.object({
    ids: nodeIds('Node ids to move together (get_document lists them).'),
    to: pointSchema().optional().describe('Where the first id goes, in the x/y get_document reports for it (a node inside a frame counts from the frame).'),
    delta: pointSchema().optional().describe('Offset added to every node, in pixels.'),
  }),
  async run({ ids, to, delta }, context) {
    if ((to === undefined) === (delta === undefined)) throw new TypeError('Pass exactly one of to or delta.');
    const page = requirePage(context.document, context.pageId);
    const nodes = ids.map((id) => {
      const node = page.nodes.find((candidate) => candidate.id === id);
      if (!node) throw new RangeError(`Node "${id}" was not found on this page.`);
      return node;
    });
    const anchor = nodes[0]!;
    const target = to ? pointOf(to) : undefined;
    const offset = target
      ? { x: target.x - anchor.transform.translation.x, y: target.y - anchor.transform.translation.y }
      : pointOf(delta!);

    if (offset.x === 0 && offset.y === 0) return { command: null, output: { moved: [] } };
    // Same builder the nudge/pointer path commits, so records stay identical.
    // Locked nodes are dropped there, so only report what actually moved.
    const command = buildMoveNodesCommand(page, ids, offset);
    return { command, output: { moved: command ? ids : [] } };
  },
});

export const styleNodes = defineOp({
  name: 'style',
  title: 'Style shapes',
  description: 'Set fill, stroke, stroke width, dash, opacity or text colour on nodes, or move the icon on icon cards (iconPlacement). Pass at least one property. One undo step. '
    + 'A diagram regenerated from text drops these unless its DSL carries them (get_diagram lists them as canvasEdits).',
  schema: z.object({
    ids: nodeIds('Node ids to restyle (get_document lists them).'),
    fill: hex().optional(),
    stroke: hex().optional(),
    strokeWidth: z.number().min(0).max(32).optional(),
    strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    opacity: z.number().min(0).max(1).optional(),
    textColor: hex().optional(),
    iconPlacement: z.enum(['top', 'left']).optional().describe('Icon cards only: the icon above its caption (top) or left of its text (left). It resizes the card, so pass it on its own.'),
  }),
  async run({ ids, iconPlacement, ...patch }, context) {
    const page = requirePage(context.document, context.pageId);
    for (const id of ids) if (!page.nodes.some((node) => node.id === id)) throw new RangeError(`Node "${id}" was not found on this page.`);
    const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    if (iconPlacement) {
      if (Object.keys(defined).length > 0) throw new TypeError('Pass iconPlacement on its own: it resizes the card.');
      // Only unlocked icon cards have a placement: say so when none of the ids is one, rather than report a change that never happened.
      const states = buildNodeStateMap(page);
      const cards = ids.filter((id) => {
        const node = page.nodes.find((candidate) => candidate.id === id)!;
        return resolveArchitectureNodePresentation(node)?.display === 'provider-icon' && !states.get(id)?.locked;
      });
      if (cards.length === 0) throw new RangeError('None of these ids is an unlocked icon card (an icon with its name, like `API [tabler/server]`): iconPlacement applies to those only.');
      const command = buildSetIconPlacementCommand(page, ids, iconPlacement);
      return { command, output: { ids: command ? cards : [] } };
    }
    if (Object.keys(defined).length === 0) throw new TypeError('Pass at least one style property.');
    return { command: buildStyleNodesCommand(page, ids, defined), output: { ids } };
  },
});

export const deleteShapes = defineOp({
  name: 'delete',
  title: 'Delete shapes',
  description: 'Delete nodes (with their children and the connectors attached to them) or connectors, by id. One undo step.',
  schema: z.object({
    ids: nodeIds('Node or connector ids to delete (get_document lists both).'),
    kind: z.enum(['node', 'connector', 'any']).default('any').describe('Only match ids of this kind; any (default) matches both.'),
  }),
  async run({ ids, kind }, context) {
    const page = requirePage(context.document, context.pageId);
    const nodes = kind === 'connector' ? [] : ids.filter((id) => page.nodes.some((node) => node.id === id));
    const connectors = kind === 'node' ? [] : ids.filter((id) => page.connectors.some((connector) => connector.id === id));
    if (nodes.length + connectors.length !== ids.length) {
      const missing = ids.filter((id) => !nodes.includes(id) && !connectors.includes(id));
      throw new RangeError(`These ids were not found on this page: ${missing.join(', ')}.`);
    }
    // One builder for both kinds: deletes a subtree and its dangling connectors.
    return { command: buildDeleteSelectionCommand(page, nodes, connectors), output: { deleted: ids } };
  },
});

export const addShape = defineOp({
  name: 'add_shape',
  title: 'Add shape',
  description: `Add one shape without writing DSL (hand-layout only). Prefer create_diagram. Kinds: ${CATALOG_IDS.join(', ')}, chart, widget (wireframe control), frame (phone, browser… preset; drop widgets in with parentId).`,
  schema: z.object({
    kind: z.union([z.enum(CATALOG_IDS as [string, ...string[]]), z.literal('chart'), z.literal('widget'), z.literal('frame')]).default('process'),
    label: z.string().optional().describe('Text on the shape; required for catalog kinds other than the toolbar shapes.'),
    x: z.number().default(0).describe('Top-left x in page pixels (inside parentId: from the frame).'),
    y: z.number().default(0).describe('Top-left y in page pixels (inside parentId: from the frame).'),
    id: z.string().min(1).optional().describe('Id for the new node; one is minted when omitted.'),
    /** Charts only: the data the node renders (categories and series, or points). */
    chart: z.object({
      kind: z.enum(['bar', 'line', 'area', 'scatter', 'pie', 'donut', 'radar', 'heatmap', 'table', 'quadrant']).default('bar'),
      categories: z.array(z.string()).optional(),
      series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })).optional(),
      points: z.array(z.object({ label: z.string(), x: z.number(), y: z.number() })).optional(),
    }).optional(),
    /** Widgets only: which control, and its state. `label` holds items as `A | B | C`. */
    widget: z.object({
      kind: z.enum(WIDGET_KINDS),
      checked: z.boolean().optional(),
      value: z.number().min(0).max(1).optional(),
      active: z.number().int().min(0).optional(),
      variant: z.enum(['primary', ...WIDGET_SEVERITIES]).optional(),
    }).optional(),
    /** Frames only: the device or layout preset. */
    preset: z.enum(FRAME_PRESETS).optional(),
    /** Widgets only: the frame to place it in; x/y are then frame-local. */
    parentId: z.string().min(1).optional(),
  }).refine((input) => (SHAPE_KINDS as readonly string[]).includes(input.kind)
    || input.kind === 'chart' || input.kind === 'widget' || input.kind === 'frame' || !!input.label,
    { message: 'Catalog nodes need a label; toolbar shapes may be blank.', path: ['label'] }),
  async run(input, context) {
    const page = requirePage(context.document, context.pageId);
    const id = input.id ?? `node-${crypto.randomUUID()}`;
    if (page.nodes.some((node) => node.id === id)) throw new RangeError(`Node "${id}" already exists.`);
    const at = { x: input.x, y: input.y };
    if ((SHAPE_KINDS as readonly string[]).includes(input.kind)) {
      // Same command the v2 toolbar commits (create-node id, append index).
      const node = createShapeNode(page, { kind: input.kind as ShapeKind, id, at, label: input.label });
      return {
        command: { kind: 'insert-node', id: `create-node:${id}`, label: `Create ${input.kind}`, pageId: page.id, index: page.nodes.length, node },
        output: { id },
      };
    }
    if (input.kind === 'chart') {
      const chart = input.chart ?? { kind: 'bar' as const };
      const data = chart.series?.length
        ? { categories: chart.categories ?? [], series: chart.series.map((series) => ({
            name: series.name, values: [...series.values],
          })) }
        : undefined;
      const node = createChartNode(page, {
        id, at, chart: chart.kind,
        ...(input.label ? { title: input.label } : {}),
        ...(data ? { data } : {}),
        ...(chart.kind === 'quadrant' && chart.points?.length
          ? { quadrant: { ...DEFAULT_QUADRANT, points: chart.points.map((point) => ({
              label: point.label ?? 'Point', x: point.x ?? 0.5, y: point.y ?? 0.5,
            })) } } : {}),
      });
      return {
        command: { kind: 'insert-node', id: `create-node:${id}`, label: 'Add chart', pageId: page.id, index: page.nodes.length, node },
        output: { id },
      };
    }
    if (input.kind === 'widget') {
      if (!input.widget) throw new TypeError('Widgets need widget: { kind }.');
      if (input.parentId && !page.nodes.some((node) => node.id === input.parentId)) {
        throw new RangeError(`Parent "${input.parentId}" was not found on this page.`);
      }
      const { kind: widget, ...state } = input.widget;
      const node = createWidgetNode(page, {
        id, widget, at, ...state,
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.parentId ? { parentId: input.parentId } : {}),
      });
      return {
        command: { kind: 'insert-node', id: `create-node:${id}`, label: 'Add widget', pageId: page.id, index: page.nodes.length, node },
        output: { id },
      };
    }
    if (input.kind === 'frame') {
      const node = createPresetFrame(page, { id, at, preset: input.preset ?? 'frame', ...(input.label ? { label: input.label } : {}) });
      return {
        command: { kind: 'insert-node', id: `create-node:${id}`, label: 'Add frame', pageId: page.id, index: page.nodes.length, node },
        output: { id },
      };
    }
    const layerId = page.layers[0]?.id ?? 'default';
    const node = createProductionSceneNode(input.kind, id, at, layerId, { label: input.label ?? '' });
    return { command: buildProductionNodeMutationCommand(page, { kind: 'insert', node }).command, output: { id } };
  },
});
