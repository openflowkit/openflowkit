import { describe, expect, it } from 'vitest';
import { applyDocumentCommand } from '../../domain/commands/execute';
import { validateSceneDocumentV1 } from '../../domain/document/validation';
import { createTestDocument } from '../../testing/builders/documentBuilder';
import {
  buildProductionDuplicatePageCommand,
  buildProductionInsertPageCommand,
  buildProductionRemovePageCommand,
  buildProductionRenamePageCommand,
  buildProductionReorderPageCommand,
} from './productionPages';

describe('production page organization', () => {
  it('adds, renames, duplicates, reorders, deletes, and reverses pages', () => {
    const document = createTestDocument();
    const inserted = applyDocumentCommand(document,
      buildProductionInsertPageCommand(document, 'page-2', ' Page 2 '));
    const renamed = applyDocumentCommand(inserted.document,
      buildProductionRenamePageCommand(inserted.document, 'page-2', 'Details')!);
    const duplicated = applyDocumentCommand(renamed.document,
      buildProductionDuplicatePageCommand(renamed.document, 'page-2', 'page-3'));
    expect(duplicated.document.pages.map((page) => page.name))
      .toEqual(['Page 1', 'Details', 'Details Copy']);
    const reordered = applyDocumentCommand(duplicated.document,
      buildProductionReorderPageCommand(duplicated.document, 'page-3', 'left')!);
    expect(reordered.document.pages.map((page) => page.id)).toEqual(['page-1', 'page-3', 'page-2']);
    expect(applyDocumentCommand(reordered.document, reordered.inverse).document)
      .toEqual(duplicated.document);
    const removed = applyDocumentCommand(duplicated.document,
      buildProductionRemovePageCommand(duplicated.document, 'page-2'));
    expect(removed.document.pages.map((page) => page.id)).toEqual(['page-1', 'page-3']);
    expect(applyDocumentCommand(removed.document, removed.inverse).document)
      .toEqual(duplicated.document);
  });

  it('duplicating a page copies the diagram, not its comment threads', () => {
    const base = createTestDocument();
    const thread = { id: 't1', number: 1, anchor: { nodeId: null, offset: null, point: { x: 0, y: 0 } }, resolved: false, comments: [{ id: 'm1', author: { kind: 'human' as const, name: 'Ada' }, body: 'hi', createdAt: '2026-10-26T12:00:00.000Z' }] };
    const document = { ...base, pages: [{ ...base.pages[0]!, threads: [thread] }] };
    const duplicated = applyDocumentCommand(document, buildProductionDuplicatePageCommand(document, 'page-1', 'page-2'));
    expect(duplicated.document.pages[0]!.threads).toEqual([thread]);
    expect(duplicated.document.pages[1]!.threads).toBeUndefined();
    expect(validateSceneDocumentV1(duplicated.document).success).toBe(true);
  });

  it('rejects deleting the only page and detects rename no-ops', () => {
    const document = createTestDocument();
    expect(() => buildProductionRemovePageCommand(document, 'page-1')).toThrow(/at least one/);
    expect(buildProductionRenamePageCommand(document, 'page-1', 'Page 1')).toBeNull();
  });
});
