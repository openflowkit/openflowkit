import type { Dispatch, SetStateAction } from 'react';
import type { ToastItem } from '../design-system';
import type { V2DocumentRepository, V2Thumbnail } from '../../../services/storage/v2/v2Repository';
import { buildV2Backup, importFiles as importDocumentFiles, readAllDocuments } from '../../../services/storage/v2/backup';
import { downloadTextFile } from './v2Export';
import { track } from '../../../services/usage/usage';
import { buildV2Thumbnail } from './v2Thumbnail';
import { mintV2Id, type V2StartIntent } from './v2Document';
import { importKind } from './homeLibrary';
import { plural } from './homeConfig';

/** What Home's file import and "download all" need from the page. */
export interface HomeTransfer {
  readonly repository: V2DocumentRepository;
  readonly toast: (item: Omit<ToastItem, 'id'>) => void;
  readonly fail: (error: unknown) => void;
  readonly create: (intent?: V2StartIntent) => void;
  readonly refresh: () => void;
  readonly setThumbnails: Dispatch<SetStateAction<ReadonlyMap<string, V2Thumbnail | null>>>;
}

export async function importHomeFiles({ repository, toast, create, refresh, setThumbnails }: HomeTransfer, files: readonly File[]): Promise<void> {
  const usable = files.filter((file) => importKind(file.name));
  if (!usable.length) {
    toast({ tone: 'danger', title: 'Nothing here to import', description: 'OpenFlowKit imports its own .json files, Excalidraw drawings, and Mermaid, D2, Structurizr or OpenFlow DSL text files.' });
    return;
  }
  const report = await importDocumentFiles(usable, repository, () => mintV2Id('doc'));
  // A text diagram is drawn by the editor's compiler, so it opens there — one at a time.
  if (report.draw) { create({ source: report.draw.source, name: report.draw.name }); return; }
  refresh();
  if (report.count > 0) track('created_import');
  // The card's preview is otherwise drawn only by an editor save; they arrive after the list.
  void (async () => {
    for (const document of report.documents) {
      try { await repository.saveThumbnail(document.id, await buildV2Thumbnail(document)); } catch { /* the placeholder stays */ }
    }
    repository.listThumbnails().then(setThumbnails, () => undefined);
  })();
  const description = [...(report.problems.length ? [`Couldn’t open ${report.problems.join('; ')}`.replace(/([^.])$/, '$1.')] : []), ...report.notes, ...report.losses].join(' ');
  toast({
    tone: report.problems.length ? (report.count ? 'warning' : 'danger') : report.notes.length + report.losses.length ? 'warning' : 'success',
    title: report.count ? `Imported ${plural(report.count, 'diagram')}` : 'Nothing was imported',
    ...(description ? { description } : {}),
  });
}

export async function downloadAllDiagrams({ repository, toast, fail }: HomeTransfer): Promise<void> {
  try {
    const documents = await readAllDocuments(repository);
    if (!documents.length) { toast({ tone: 'info', title: 'No diagrams to download yet' }); return; }
    const backup = buildV2Backup(documents);
    downloadTextFile(`openflowkit-diagrams-${backup.exportedAt.slice(0, 10)}.json`, JSON.stringify(backup), 'application/json');
    toast({ tone: 'success', title: `Downloaded ${plural(documents.length, 'diagram')}`, description: 'One file. Import it here to bring them back.' });
  } catch (error) { fail(error); }
}
