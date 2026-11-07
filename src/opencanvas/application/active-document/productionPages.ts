import type { DocumentCommand } from '../../domain/commands/types';
import { createDefaultSceneLayer } from '../../domain/document/defaults';
import type { SceneDocumentV1, ScenePage } from '../../domain/document/types';

function requirePage(document: SceneDocumentV1, pageId: string): ScenePage {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error(`Page "${pageId}" was not found.`);
  return page;
}

export function buildProductionRenamePageCommand(
  document: SceneDocumentV1,
  pageId: string,
  name: string
): DocumentCommand | null {
  const before = requirePage(document, pageId);
  const nextName = name.trim();
  if (!nextName) throw new Error('Page name must not be empty.');
  if (nextName === before.name) return null;
  return {
    kind: 'set-page', id: `rename-page:${pageId}`, label: 'Rename page', pageId,
    before, after: { ...before, name: nextName },
  };
}

export function buildProductionInsertPageCommand(
  document: SceneDocumentV1,
  pageId: string,
  name: string,
  diagramKind = 'flowchart'
): DocumentCommand {
  const nextName = name.trim();
  if (!pageId.trim() || document.pages.some((page) => page.id === pageId)) {
    throw new Error('Page ID must be non-empty and unique.');
  }
  if (!nextName) throw new Error('Page name must not be empty.');
  const page: ScenePage = {
    id: pageId, name: nextName, diagramKind,
    layers: [createDefaultSceneLayer()], nodes: [], connectors: [], metadata: {}, extensions: {},
  };
  return {
    kind: 'insert-page', id: `insert-page:${pageId}`, label: 'Add page',
    index: document.pages.length, page,
  };
}

export function buildProductionDuplicatePageCommand(
  document: SceneDocumentV1,
  sourcePageId: string,
  pageId: string
): DocumentCommand {
  const source = requirePage(document, sourcePageId);
  if (!pageId.trim() || document.pages.some((page) => page.id === pageId)) {
    throw new Error('Page ID must be non-empty and unique.');
  }
  // The copy takes the diagram, not its discussion: thread ids and numbers are unique across the document.
  const { threads: _threads, ...diagram } = source;
  return {
    kind: 'insert-page', id: `duplicate-page:${sourcePageId}`, label: 'Duplicate page',
    index: document.pages.findIndex((page) => page.id === sourcePageId) + 1,
    page: structuredClone({ ...diagram, id: pageId, name: `${source.name} Copy` }),
  };
}

export function buildProductionRemovePageCommand(
  document: SceneDocumentV1,
  pageId: string
): DocumentCommand {
  if (document.pages.length <= 1) throw new Error('A document must retain at least one page.');
  const page = requirePage(document, pageId);
  return {
    kind: 'remove-page', id: `remove-page:${pageId}`, label: 'Delete page',
    index: document.pages.findIndex((candidate) => candidate.id === pageId), page,
  };
}

export function buildProductionReorderPageCommand(
  document: SceneDocumentV1,
  pageId: string,
  direction: 'left' | 'right'
): DocumentCommand | null {
  const page = requirePage(document, pageId);
  const index = document.pages.findIndex((candidate) => candidate.id === pageId);
  const targetIndex = direction === 'left' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= document.pages.length) return null;
  return {
    kind: 'batch', id: `reorder-page:${pageId}:${direction}`, label: 'Reorder page',
    commands: [
      { kind: 'remove-page', id: `remove-page:${pageId}`, label: 'Reorder page', index, page },
      { kind: 'insert-page', id: `insert-page:${pageId}`, label: 'Reorder page',
        index: targetIndex, page },
    ],
  };
}
