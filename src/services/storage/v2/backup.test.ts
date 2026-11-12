import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDocument, createTestNode } from '@/opencanvas/testing/builders/documentBuilder';
import { UNTITLED_DOCUMENT_NAME } from '@/opencanvas/domain/document/defaults';
import { FLOW_PERSISTENCE_DB_NAME } from '../indexedDbSchema';
import { V2_BACKUP_FORMAT, buildV2Backup, importFiles, openedNotice, readAllDocuments, importSummary, importDetail } from './backup';
import { createV2Repository } from './v2Repository';
import drawio from '../../dsl/fixtures/drawio/flow.drawio?raw';

const repository = () => createV2Repository(indexedDB);
let counter = 0;
const mint = () => `new-${(counter += 1)}`;
// jsdom's File has no text().
const fileOf = (text: string, name: string) => Object.assign(new File([text], name), { text: async () => text });
// jsdom's File has no arrayBuffer(); a browser's does.
const bytesOf = (bytes: Uint8Array, name: string) => Object.assign(new File([bytes], name), { arrayBuffer: async () => bytes.slice().buffer });
const named = (id: string, name: string) => ({ ...createTestDocument(), id, name });

beforeEach(async () => {
  counter = 0;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(FLOW_PERSISTENCE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe('buildV2Backup', () => {
  it('wraps the documents in the named, versioned envelope', () => {
    const documents = [named('a', 'A')];
    expect(buildV2Backup(documents, new Date('2026-10-12T08:00:00Z')))
      .toEqual({ format: V2_BACKUP_FORMAT, version: 1, exportedAt: '2026-10-12T08:00:00.000Z', documents });
  });
});

describe('download all, then import', () => {
  it('brings every diagram back, keeping the ones already here', async () => {
    const repo = repository();
    await repo.saveDocument('a', named('a', 'Alpha'), 1);
    await repo.saveDocument('b', named('b', 'Beta'), 1);
    await repo.archiveDocuments(['b']);
    const documents = await readAllDocuments(repo);
    expect(documents.map(({ name }) => name).sort()).toEqual(['Alpha', 'Beta']);

    const file = fileOf(JSON.stringify(buildV2Backup(documents)), 'openflowkit-backup-2026-10-12.json');
    const report = await importFiles([file], repo, mint);
    expect(report).toMatchObject({ count: 2, problems: [], draw: null });
    expect((await repo.listDocuments()).map(({ name }) => name).sort()).toEqual(['Alpha', 'Alpha', 'Beta']);
    expect(report.documents.map(({ id }) => id)).toEqual(['new-1', 'new-2']);
  });

  // Found by the gate 2026-10-12: a backup without its .json extension (renamed, or a browser's temp download) was skipped.
  it('opens a backup whose file name lost its extension', async () => {
    const repo = repository();
    const file = fileOf(JSON.stringify(buildV2Backup([named('a', 'Alpha')])), 'openflowkit-backup');
    expect(await importFiles([file], repo, mint)).toMatchObject({ count: 1, fromBackup: true, problems: [] });
  });

  it('says which entry would not open and keeps the rest', async () => {
    const good = named('a', 'Alpha');
    const file = fileOf(JSON.stringify({ format: V2_BACKUP_FORMAT, version: 1, exportedAt: '', documents: [good, { nope: true }] }), 'b.json');
    const report = await importFiles([file], repository(), mint);
    expect(report.count).toBe(1);
    expect(report.problems).toHaveLength(1);
  });
});

describe('importFiles', () => {
  it('names an untitled .json after its file', async () => {
    const file = fileOf(JSON.stringify({ ...createTestDocument(), name: UNTITLED_DOCUMENT_NAME }), 'payments.json');
    const report = await importFiles([file], repository(), mint);
    expect(report.documents[0]?.name).toBe('payments');
  });

  it('hands one text file back to draw, named after the file', async () => {
    const report = await importFiles([fileOf('a -> b', 'flow.mmd')], repository(), mint);
    expect(report.draw).toEqual({ source: 'a -> b', name: 'flow' });
  });

  it('saves a draw.io file as a diagram named after it, and says what did not come across', async () => {
    const report = await importFiles([fileOf(drawio, 'checkout.drawio')], repository(), mint);
    expect(report).toMatchObject({ count: 1, problems: [], draw: null });
    expect(report.documents[0]).toMatchObject({ id: 'new-1', name: 'checkout' });
    expect(report.documents[0]!.pages).toHaveLength(2);
    expect(report).toMatchObject({ notes: [] });
    expect(report.losses).toEqual(['checkout.drawio: 1 thing didn’t come across: Services: draw.io’s “mxgraph.aws4.lambda_function” shape is drawn as a box.']);
  });

  it('opens the diagram a draw.io SVG or PNG export carries, named without .drawio', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${drawio.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"></svg>`;
    const text = `mxfile\0${encodeURIComponent(drawio)}`;
    const chunk = (type: string, data: number[]) => [0, 0, (data.length >> 8) & 255, data.length & 255, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('tEXt', [...text].map((c) => c.charCodeAt(0))), ...chunk('IEND', [])]);
    const report = await importFiles([fileOf(svg, 'checkout.drawio.svg'), bytesOf(png, 'flow.drawio.png')], repository(), mint);
    expect(report).toMatchObject({ count: 2, problems: [] });
    expect(report.documents.map((document) => [document.name, document.pages.length])).toEqual([['checkout', 2], ['flow', 2]]);
  });

  it('says an image without a draw.io diagram has none', async () => {
    const report = await importFiles([fileOf('<svg xmlns="http://www.w3.org/2000/svg"/>', 'logo.svg'), bytesOf(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'shot.png')], repository(), mint);
    expect(report).toMatchObject({ count: 0, problems: ['logo.svg: It’s an image with no draw.io diagram in it.', 'shot.png: It’s an image with no draw.io diagram in it.'] });
  });

  it('says a .drawio file with no draw.io in it is not one, instead of asking for JSON', async () => {
    const report = await importFiles([fileOf('', 'empty.drawio'), fileOf('<catalogue/>', 'index.xml')], repository(), mint);
    expect(report).toMatchObject({ count: 0, problems: ['empty.drawio: It’s empty.', 'index.xml: It has no draw.io pages in it.'] });
  });

  it('keeps an import note short however many files it covers', () => {
    const many = Array.from({ length: 40 }, (_, index) => `f${index}.drawio: 2 things didn’t come across: a; b.`);
    const detail = importDetail({ problems: ['x.drawio: broken', 'y.drawio: broken', 'z.drawio: broken', 'w.drawio: broken'], notes: [], losses: many });
    expect(detail).toBe('Couldn’t open x.drawio: broken; y.drawio: broken; z.drawio: broken; and 1 more. '
      + 'f0.drawio: 2 things didn’t come across: a; b. f1.drawio: 2 things didn’t come across: a; b. and 38 more files lost something.');
  });

  it('says why a broken draw.io file did not open', async () => {
    const report = await importFiles([fileOf('<mxfile><diagram>', 'broken.drawio')], repository(), mint);
    expect(report).toMatchObject({ count: 0, problems: ['broken.drawio: It isn’t a readable draw.io file (<diagram> is never closed).'] });
  });

  it('keeps what an Excalidraw drawing lost apart from repairs, so Open file… titles it as an import', async () => {
    const drawing = JSON.stringify({ type: 'excalidraw', elements: [
      { id: 'a', type: 'rectangle', x: 0, y: 0, width: 40, height: 40, groupIds: ['g'] },
    ] });
    const report = await importFiles([fileOf(drawing, 'sketch.excalidraw')], repository(), mint);
    expect(report).toMatchObject({ count: 1, notes: [], losses: ['sketch.excalidraw: 1 thing didn’t come across: groups come in as separate shapes.'] });
    expect(openedNotice(report)).toEqual({ title: 'Imported 1 diagram', description: report.losses[0] });
    expect(openedNotice({ ...report, losses: [], notes: ['old.json: a repair.'] })).toEqual({ title: 'Opened, with a repair', description: 'old.json: a repair.' });
    expect(openedNotice({ ...report, losses: [] })).toBeNull();
  });

  it('opens none of several text files, and says to open them one at a time', async () => {
    const report = await importFiles([fileOf('x', 'a.d2'), fileOf('y', 'b.d2')], repository(), mint);
    expect(report).toMatchObject({ count: 0, draw: null, problems: ['2 text files (open those one at a time)'] });
  });
});

describe('the list a search reads', () => {
  it('carries page names and box labels in lowercase', async () => {
    const repo = repository();
    await repo.saveDocument('s', { ...named('s', 'Checkout'), pages: [{ ...createTestDocument({ nodes: [createTestNode('n', { content: { label: 'Stripe' } })] }).pages[0]!, name: 'Payments' }] }, 1);
    const [summary] = await repo.listDocuments();
    expect(summary?.searchText).toContain('stripe');
    expect(summary?.searchText).toContain('payments');
  });
});

// Found by the gate 2026-10-12: Open file… on a v1 backup said only "Opened 34 diagrams." — the backup and the
// already-here count (restoring twice) went missing when the opener became one function.
describe('importSummary', () => {
  it('names a backup and counts the diagrams already here', () => {
    const base = { count: 34, firstId: 'a', documents: [], problems: [], notes: [], losses: [], draw: null };
    expect(importSummary({ ...base, fromBackup: true, existing: 2 })).toBe('Opened 34 diagrams from the backup. 2 were already here and kept as is.');
    expect(importSummary({ ...base, count: 1, fromBackup: false, existing: 0 })).toBe('Opened 1 diagram.');
  });
});
