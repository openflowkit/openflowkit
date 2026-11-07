// Page lifecycle for the v2 document bar: every action becomes exactly one
// reversible command through the shared production builders. Pages never share
// connectors — a page owns its own node/connector lists, so add/remove/move
// cannot cross-link them.
import { useCallback } from 'react';
import {
  buildProductionDuplicatePageCommand,
  buildProductionInsertPageCommand,
  buildProductionRemovePageCommand,
  buildProductionRenamePageCommand,
  buildProductionReorderPageCommand,
} from '../../application/active-document/productionPages';
import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneDocumentV1, ScenePage } from '../../domain/document/types';
import type { ToastItem } from '../design-system';

interface V2PagesOptions {
  readonly document: SceneDocumentV1 | null;
  readonly pageId: string | null;
  readonly readOnly: boolean;
  /** One page that stays as it is whatever the document allows (a repo document's map page): no rename, move, duplicate or delete. */
  readonly lockedPageId?: string | null;
  readonly commit: (command: DocumentCommand) => void;
  readonly onSelect: (pageId: string) => void;
  readonly mintId: (prefix: string) => string;
  readonly announce: (message: string) => void;
  /** Deleting a page that has content offers Undo: the toast, and the editor's undo. */
  readonly toast: (toast: ToastItem) => void;
  readonly undo: () => void;
  /** The session's contentRevision now: the toast's Undo only runs while the delete is still the latest diagram change. */
  readonly contentRevision: () => number;
}

export function useV2Pages(options: V2PagesOptions) {
  const { document, pageId, readOnly, lockedPageId = null, commit, onSelect, mintId, announce, toast, undo, contentRevision } = options;
  const isLocked = useCallback((id: string) => lockedPageId !== null && id === lockedPageId, [lockedPageId]);
  const pages: readonly ScenePage[] = document?.pages ?? [];
  const activePage = pages.find((page) => page.id === pageId) ?? pages[0] ?? null;

  const run = useCallback((build: () => DocumentCommand | null, done: (command: DocumentCommand) => string) => {
    if (!document || readOnly) return;
    try {
      const command = build();
      if (!command) return;
      commit(command);
      announce(done(command));
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Page action failed.');
    }
  }, [document, readOnly, commit, announce]);

  const add = useCallback((): { id: string; name: string } | undefined => {
    if (!document) return undefined;
    const id = mintId('page');
    const name = `Page ${document.pages.length + 1}`;
    run(() => buildProductionInsertPageCommand(document, id, name), () => `Added ${name}.`);
    onSelect(id);
    return { id, name };
  }, [document, mintId, run, onSelect]);

  const duplicate = useCallback((sourceId: string) => {
    if (!document || isLocked(sourceId)) return;
    const id = mintId('page');
    run(() => buildProductionDuplicatePageCommand(document, sourceId, id), () => 'Page duplicated.');
    onSelect(id);
  }, [document, mintId, run, onSelect, isLocked]);

  const rename = useCallback((targetId: string, name: string) => {
    if (!document || isLocked(targetId)) return;
    run(() => buildProductionRenamePageCommand(document, targetId, name), () => `Renamed page to ${name.trim()}.`);
  }, [document, run, isLocked]);

  const remove = useCallback((targetId: string) => {
    if (!document || isLocked(targetId)) return;
    const index = document.pages.findIndex((page) => page.id === targetId);
    const next = document.pages[index + 1] ?? document.pages[index - 1] ?? null;
    const removed = document.pages[index];
    const name = removed?.name ?? 'page';
    const afterDelete = contentRevision() + 1;
    run(() => buildProductionRemovePageCommand(document, targetId), () => `Deleted ${name}.`);
    if (pageId === targetId && next) onSelect(next.id);
    if (removed && document.pages.length > 1 && (removed.nodes.length > 0 || removed.connectors.length > 0)) {
      toast({ id: `page-removed-${targetId}`, title: `Deleted ${name}`, action: { label: 'Undo', onClick: () => { if (contentRevision() !== afterDelete) return; undo(); onSelect(targetId); } } });
    }
  }, [document, run, pageId, onSelect, isLocked, toast, undo, contentRevision]);

  const move = useCallback((targetId: string, direction: 'left' | 'right') => {
    if (!document) return;
    // Swapping with the locked page would move it too.
    const at = document.pages.findIndex((page) => page.id === targetId);
    const neighbour = document.pages[at + (direction === 'left' ? -1 : 1)];
    if (isLocked(targetId) || (neighbour && isLocked(neighbour.id))) return;
    run(() => buildProductionReorderPageCommand(document, targetId, direction), () => 'Reordered pages.');
  }, [document, run, isLocked]);

  return { pages, activePage, select: onSelect, add, duplicate, rename, remove, move, readOnly, isLocked };
}
