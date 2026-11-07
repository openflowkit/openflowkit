// What the assistant sees of a page: every diagram frame's text, narrowed to
// the frames holding the selection when the scope is the selection. A frame's
// text is its authored source while untouched, regenerated once hand-edited —
// the same rule get_diagram follows.
import { dslFrames, frameScene, frameText } from '../../../dsl/frameScene';
import { dslFrameMeta } from '../../../dsl/sceneMeta';
import type { SceneNode, ScenePage } from '../../domain/document/types';
import type { AssistantContext, AssistantFrame } from './assistantPrompt';

const label = (node: SceneNode): string | null =>
  typeof node.content.label === 'string' && node.content.label.trim() ? node.content.label.trim() : null;

/** What a person calls the shape: library shapes are `process` nodes carrying their outline. */
export const shapeKindOf = (node: SceneNode): string => (typeof node.content.shape === 'string' ? node.content.shape : node.kind);

/** The diagram frames that hold (or are) the selected nodes, in page order. */
export function selectedFrameIds(page: ScenePage, nodeIds: readonly string[]): string[] {
  const frames = new Set(dslFrames(page).map(({ id }) => id));
  const byId = new Map(page.nodes.map((node) => [node.id, node]));
  const hit = new Set<string>();
  for (const id of nodeIds) {
    for (let node = byId.get(id); node; node = node.parentId ? byId.get(node.parentId) : undefined) {
      if (frames.has(node.id)) { hit.add(node.id); break; }
    }
  }
  return [...frames].filter((id) => hit.has(id));
}

export function assistantContext(
  page: ScenePage, nodeIds: readonly string[], scope: 'selection' | 'page',
): AssistantContext {
  const all = dslFrames(page);
  const picked = scope === 'selection' ? new Set(selectedFrameIds(page, nodeIds)) : null;
  const frames: AssistantFrame[] = [];
  for (const frame of all) {
    if (picked && !picked.has(frame.id)) continue;
    const scene = frameScene(page, frame.id);
    if (!scene) continue;
    const meta = dslFrameMeta(frame);
    frames.push({
      id: frame.id, title: label(frame), family: meta.family,
      dsl: frameText(scene),
    });
  }
  const frameIds = new Set(all.map(({ id }) => id));
  const byId = new Map(page.nodes.map((node) => [node.id, node]));
  const inDiagram = (node: SceneNode): boolean => {
    for (let parent = node.parentId; parent; parent = byId.get(parent)?.parentId ?? null) if (frameIds.has(parent)) return true;
    return false;
  };
  // A hand-drawn shape is named with its id: the scene tools act on ids, and a blank one has no label.
  const focus = page.nodes
    .filter((node) => nodeIds.includes(node.id) && !frameIds.has(node.id))
    .map((node) => (inDiagram(node) ? label(node) : `${label(node) ?? shapeKindOf(node)} (shape id ${node.id})`))
    .filter((text): text is string => text !== null);
  return { pageName: page.name, frames, scope, focus, outOfScope: all.length - frames.length };
}
