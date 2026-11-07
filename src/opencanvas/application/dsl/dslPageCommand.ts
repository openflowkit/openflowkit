import type { CompileResult } from '../../../dsl/compile';
import type { DocumentCommand } from '../../domain/commands/types';
import { UNTITLED_DOCUMENT_NAME } from '../../domain/document/defaults';
import type { SceneConnector, SceneDocumentV1, SceneNode, ScenePage } from '../../domain/document/types';
import { areStructurallyEqual } from '../../domain/commands/equality';
import { hashDslScene } from '../../../dsl/compile';

function descendants(page: ScenePage, rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of page.nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
    }
  }
  return ids;
}

/**
 * DSL ids are names (`Start` → `start`), so two diagrams on a page share them.
 * A generated id already taken outside the frame being replaced becomes
 * `<frameId>-<id>`; the frame's hash is re-taken over the final records so the
 * frame does not read as hand-edited.
 */
function placeRecords(compiled: CompileResult, frameId: string, taken: ReadonlySet<string>) {
  const rename = new Map<string, string>([[compiled.frame.id, frameId]]);
  for (const { id } of [...compiled.groups, ...compiled.nodes, ...compiled.connectors]) {
    if (taken.has(id)) rename.set(id, `${frameId}-${id}`);
  }
  const to = (id: string | null) => (id === null ? null : rename.get(id) ?? id);
  const node = (record: SceneNode): SceneNode => ({ ...record, id: to(record.id)!, parentId: to(record.parentId) });
  const inside = [...compiled.groups, ...compiled.nodes].map(node);
  const connectors = compiled.connectors.map((record): SceneConnector => ({
    ...record, id: to(record.id)!,
    source: { ...record.source, nodeId: to(record.source.nodeId) },
    target: { ...record.target, nodeId: to(record.target.nodeId) },
  }));
  if (rename.size === 1 && compiled.frame.id === frameId) return { frame: compiled.frame, inside, connectors };
  const hash = hashDslScene(JSON.stringify({
    nodes: compiled.nodes.map(node), groups: compiled.groups.map(node), connectors,
  }));
  const dsl = compiled.frame.metadata.dsl as Record<string, unknown> | undefined;
  const frame = { ...compiled.frame, id: frameId, metadata: { ...compiled.frame.metadata, dsl: { ...dsl, hash } } };
  return { frame, inside, connectors };
}

function uniqueId(taken: ReadonlySet<string>, id: string): string {
  let unique = id;
  for (let copy = 2; taken.has(unique); copy += 1) unique = `${id}-${copy}`;
  return unique;
}

/** The id a new frame lands under: its compiled id, or a numbered copy when the page already holds that id. */
export function placedFrameId(page: ScenePage, compiled: CompileResult): string {
  return uniqueId(new Set([...page.nodes, ...page.connectors].map(({ id }) => id)), compiled.frame.id);
}

/**
 * Creates one reversible page replacement for one Generate intent, or null when
 * the regenerated frame is identical (set-page rejects no-op commands).
 */
export function buildDslPageCommand(page: ScenePage, compiled: CompileResult, boundFrameId?: string): DocumentCommand | null {
  let retainedNodes = [...page.nodes];
  let retainedConnectors = [...page.connectors];
  if (boundFrameId) {
    const removed = descendants(page, boundFrameId);
    retainedNodes = retainedNodes.filter((node) => !removed.has(node.id));
    retainedConnectors = retainedConnectors.filter((connector) => !removed.has(connector.source.nodeId ?? '') && !removed.has(connector.target.nodeId ?? ''));
  }
  const taken = new Set([...retainedNodes, ...retainedConnectors].map(({ id }) => id));
  const frameId = boundFrameId ?? uniqueId(taken, compiled.frame.id);
  const { frame, inside, connectors } = placeRecords(compiled, frameId, taken);
  const after: ScenePage = {
    ...page,
    diagramKind: compiled.meta.family,
    nodes: [...retainedNodes, frame, ...inside],
    connectors: [...retainedConnectors, ...connectors],
  };
  if (areStructurallyEqual(page, after)) return null;
  return { kind: 'set-page', id: `dsl-generate:${frameId}`, label: boundFrameId ? 'Regenerate diagram' : 'Generate diagram', pageId: page.id, before: page, after };
}

export function nextDslFrameOrigin(page: ScenePage): { x: number; y: number } {
  const right = page.nodes.reduce((maximum, node) => Math.max(maximum, node.transform.translation.x + node.size.width), 0);
  return { x: right + 160, y: 80 };
}

/** An untitled document takes its first diagram's title, in the same undo step as the diagram. */
export function nameUntitledDocument(document: SceneDocumentV1, command: DocumentCommand, title: string | undefined): DocumentCommand {
  const name = title?.trim();
  if (!name || (document.name && document.name !== UNTITLED_DOCUMENT_NAME)) return command;
  return {
    kind: 'batch', id: `${command.id}:name`, label: command.label,
    commands: [...(command.kind === 'batch' ? command.commands : [command]), { kind: 'set-document-name', id: `rename-document:${document.id}`, label: 'Rename document', before: document.name, after: name }],
  };
}
