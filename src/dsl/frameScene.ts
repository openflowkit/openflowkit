import { isContainerNodeKind } from '../opencanvas/domain/nodes/containerNodePresentation';
import type { SceneNode, ScenePage } from '../opencanvas/domain/document/types';
import { hashDslScene } from './compile';
import { parseDocument } from './document';
import { dslFrameMeta, dslFrameRaw, type DslFrameScene } from './sceneMeta';
import { serialize } from './serialize';

/** Everything under a frame, split the way compile() and the writers expect it. */
export function frameScene(page: ScenePage, frameId: string): DslFrameScene | null {
  const frame = page.nodes.find((node) => node.id === frameId);
  if (!frame) return null;
  const subtree = new Set([frameId]);
  let grown = true;
  while (grown) {
    grown = false;
    for (const node of page.nodes) {
      if (node.parentId && subtree.has(node.parentId) && !subtree.has(node.id)) {
        subtree.add(node.id);
        grown = true;
      }
    }
  }
  const inside = page.nodes.filter((node) => node.id !== frameId && subtree.has(node.id));
  return {
    frame,
    nodes: inside.filter((node) => !isContainerNodeKind(node.kind)),
    groups: inside.filter((node) => isContainerNodeKind(node.kind)),
    connectors: page.connectors.filter((connector) =>
      subtree.has(connector.source.nodeId ?? '') && subtree.has(connector.target.nodeId ?? '')),
  };
}

/** Frame ids of every DSL diagram on a page, in document order. */
export function dslFrames(page: ScenePage): readonly SceneNode[] {
  // The raw record: `dslFrameMeta` defaults the family, which would make every
  // frame (boundaries, hand-drawn frames) look generated.
  return page.nodes.filter((node) => node.kind === 'frame' && typeof dslFrameRaw(node).family === 'string');
}

/**
 * True when the canvas no longer matches the text that produced it: the hash
 * compiled into `metadata.dsl` is the structural fingerprint of the content.
 */
export function frameEdited(scene: DslFrameScene): boolean {
  const hash = dslFrameMeta(scene.frame).hash;
  if (typeof hash !== 'string') return false;
  return hashDslScene(JSON.stringify({ nodes: scene.nodes, groups: scene.groups ?? [], connectors: scene.connectors })) !== hash;
}

/** A frame's code: the text that drew it while the canvas still matches, else the canvas written back as code. */
export function frameSource(scene: DslFrameScene): string {
  const source = dslFrameRaw(scene.frame).source;
  return !frameEdited(scene) && typeof source === 'string'
    ? source
    : serialize({ frame: scene.frame, nodes: scene.nodes, groups: scene.groups ?? [], connectors: scene.connectors });
}

/**
 * A frame's code for a reader who redraws from the text alone (an agent, the assistant). The palette can be set by a
 * caller option rather than the text, so it is named here: without it the redraw comes back on the default palette.
 */
export function frameText(scene: DslFrameScene): string {
  const text = frameSource(scene);
  const palette = dslFrameMeta(scene.frame).appearance?.palette;
  if (!palette || palette === 'pastel' || parseDocument(text).appearance) return text;
  return `${text.trimEnd()}\nappearance: ${palette}`;
}
