import { isJsonObject } from '../../../opencanvas/domain/document/json';
import { UNTITLED_DOCUMENT_NAME } from '../../../opencanvas/domain/document/defaults';
import type { SceneDocumentV1 } from '../../../opencanvas/domain/document/types';
import { documentFromFileText } from './openDocumentFile';
import { isV1Backup, openV1Backup } from './v1Import';
import type { V2DocumentRepository } from './v2Repository';

/** "Download all diagrams": every v2 document in one file, for the browser that may forget them (Safari after 7 idle days). */
export const V2_BACKUP_FORMAT = 'openflowkit.backup';

interface V2Backup {
  readonly format: typeof V2_BACKUP_FORMAT;
  readonly version: 1;
  readonly exportedAt: string;
  readonly documents: readonly SceneDocumentV1[];
}

export const buildV2Backup = (documents: readonly SceneDocumentV1[], now = new Date()): V2Backup =>
  ({ format: V2_BACKUP_FORMAT, version: 1, exportedAt: now.toISOString(), documents });

const isV2Backup = (value: unknown): value is V2Backup =>
  isJsonObject(value) && value.format === V2_BACKUP_FORMAT && Array.isArray(value.documents);

/** Every stored diagram, archived ones too (a backup that skips them loses them); one that will not open is skipped. */
export async function readAllDocuments(repository: V2DocumentRepository): Promise<SceneDocumentV1[]> {
  const summaries = [...await repository.listDocuments(), ...await repository.listArchive()];
  const documents: SceneDocumentV1[] = [];
  for (const { id } of summaries) {
    const loaded = await repository.loadDocument(id);
    if (loaded.status === 'ok' || loaded.status === 'recovered') documents.push(loaded.record.document);
  }
  return documents;
}

interface ImportReport {
  /** How many diagrams were saved. */
  readonly count: number;
  /** The first one saved, where a single file opens. */
  readonly firstId: string | null;
  /** The saved ones that have no preview yet (v1 diagrams get theirs from Home's list). */
  readonly documents: readonly SceneDocumentV1[];
  readonly problems: readonly string[];
  /** A backup file was among them: the summary says so. */
  readonly fromBackup: boolean;
  /** Diagrams of a v1 backup already in this browser, kept as they are. */
  readonly existing: number;
  /** What opening had to change, per file. */
  readonly notes: readonly string[];
  /** What a drawing from another app (Excalidraw) couldn't bring across, per file. */
  readonly losses: readonly string[];
  /** Exactly one text file, nothing else: it is drawn by the editor, so it is handed back, not saved. */
  readonly draw: { readonly source: string; readonly name: string } | null;
}

const EMPTY: ImportReport = { count: 0, firstId: null, documents: [], problems: [], fromBackup: false, existing: 0, notes: [], losses: [], draw: null };

/** "Opened 34 diagrams from the backup. 2 were already here and kept as is." */
export function importSummary(report: ImportReport): string {
  const parts = [`Opened ${report.count} ${report.count === 1 ? 'diagram' : 'diagrams'}${report.fromBackup ? ' from the backup' : ''}.`];
  if (report.existing) parts.push(`${report.existing} ${report.existing === 1 ? 'was' : 'were'} already here and kept as is.`);
  return parts.join(' ');
}
export const MAX_IMPORT_CHARS = 2_000_000;
const withoutExtension = (name: string) => name.replace(/\.[^.]+$/, '');
const SOURCE = /\.(mmd|mermaid|d2|dsl|ofk|txt)$/i;

/**
 * The one way files open, from Home's Import and the editor's Open file…: our .json (one diagram, a v2 backup, a v1
 * backup) is saved as new diagrams (every file gets fresh ids, so a diagram already here is kept beside its copy);
 * a lone text diagram is handed back to draw; more than one text file is said no to.
 */
export async function importFiles(files: readonly File[], repository: V2DocumentRepository, mintId: () => string): Promise<ImportReport> {
  const sources = files.filter((file) => SOURCE.test(file.name));
  if (files.length === 1 && sources.length === 1) {
    const text = await sources[0]!.text();
    return text.length > MAX_IMPORT_CHARS
      ? { ...EMPTY, problems: [`“${sources[0]!.name}” is too big to draw`] }
      : { ...EMPTY, draw: { source: text, name: withoutExtension(sources[0]!.name) } };
  }
  const documents: SceneDocumentV1[] = [];
  const problems: string[] = [];
  const notes: string[] = [];
  const losses: string[] = [];
  let count = 0;
  let firstId: string | null = null;
  let fromBackup = false;
  let existing = 0;
  const save = async (document: SceneDocumentV1, name: string): Promise<boolean> => {
    const saved = await repository.saveDocument(document.id, document, 1);
    if (saved.status !== 'saved') { problems.push(name); return false; }
    count += 1;
    firstId ??= document.id;
    documents.push(document);
    return true;
  };
  // Anything that isn't a text diagram is read as JSON, as Open file… always did: a renamed backup still opens.
  for (const file of files.filter((candidate) => !SOURCE.test(candidate.name))) {
    try {
      const text = await file.text();
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* documentFromFileText reports it */ }
      if (isJsonObject(parsed) && (parsed.type === 'excalidraw' || parsed.type === 'excalidraw/clipboard')) {
        // Loaded on first use: Home's list doesn't wait on the importer.
        const { excalidrawToDocument, lossNote } = await import('../../dsl/excalidraw');
        const imported = excalidrawToDocument(text, mintId());
        if ('error' in imported) { problems.push(`${file.name}: ${imported.error}`); continue; }
        if (imported.losses.length) losses.push(`${file.name}: ${lossNote(imported.losses)}`);
        await save({ ...imported.document, name: withoutExtension(file.name) }, file.name);
        continue;
      }
      if (isV1Backup(parsed)) {
        const report = await openV1Backup(parsed, repository);
        fromBackup = true;
        existing += report.existing;
        count += report.opened.length;
        firstId ??= report.opened[0] ?? null;
        problems.push(...report.failures.map((failure) => failure.name));
        continue;
      }
      if (isV2Backup(parsed)) {
        fromBackup = true;
        if (parsed.version !== 1) { problems.push(`${file.name}: this backup was made by a newer OpenFlowKit`); continue; }
        for (const entry of parsed.documents) {
          const opened = documentFromFileText(JSON.stringify(entry), mintId());
          if ('error' in opened) { problems.push(`${file.name}: ${opened.error}`); continue; }
          if (opened.notice) notes.push(`${file.name}: ${opened.notice}`);
          await save(opened.document, file.name);
        }
        continue;
      }
      const opened = documentFromFileText(text, mintId());
      if ('error' in opened) { problems.push(`${file.name}: ${opened.error}`); continue; }
      if (opened.notice) notes.push(`${file.name}: ${opened.notice}`);
      const untitled = !opened.document.name || opened.document.name === UNTITLED_DOCUMENT_NAME;
      await save(untitled ? { ...opened.document, name: withoutExtension(file.name) } : opened.document, file.name);
    } catch {
      problems.push(file.name);
    }
  }
  if (sources.length) problems.push(`${sources.length} text ${sources.length === 1 ? 'file' : 'files'} (open those one at a time)`);
  return { count, firstId, documents, problems, fromBackup, existing, notes, losses, draw: null };
}

/** The toast for one file opened in the editor: what opening repaired, or, for a drawing from another app, what it lost. */
export function openedNotice(report: ImportReport): { readonly title: string; readonly description: string } | null {
  if (report.notes.length) return { title: 'Opened, with a repair', description: [...report.notes, ...report.losses].join(' ') };
  // Titled as Home's Import titles the same file.
  return report.losses.length ? { title: 'Imported 1 diagram', description: report.losses.join(' ') } : null;
}
