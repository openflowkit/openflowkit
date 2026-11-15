import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyV2Document } from './v2Document';
import { buildCanonicalFixtureDocument } from './v2Export.testFixtures';
import { buildV2Thumbnail, fitThumbnail, scheduleV2Thumbnail } from './v2Thumbnail';
import type { V2DocumentRepository } from '../../../services/storage/v2/v2Repository';

afterEach(() => vi.useRealTimers());

describe('buildV2Thumbnail', () => {
  it('draws the first page in both themes, without a background, from the export renderer', async () => {
    const thumbnail = await buildV2Thumbnail(await buildCanonicalFixtureDocument());
    expect(thumbnail).not.toBeNull();
    expect(thumbnail!.light).toMatch(/^<svg/);
    expect(thumbnail!.dark).toMatch(/^<svg/);
    expect(thumbnail!.light).not.toBe(thumbnail!.dark);
    expect(thumbnail!.light).toContain('Client');
  });

  it('has nothing to draw when no page has anything on it', async () => {
    expect(await buildV2Thumbnail(createEmptyV2Document('empty'))).toBeNull();
  });

  it('a repo document (empty map page first) shows its newest drawing, not a blank card (R17)', async () => {
    const drawn = await buildCanonicalFixtureDocument();
    const [page] = drawn.pages;
    const map = { ...page!, id: 'map', name: 'sindresorhus/ky', nodes: [], connectors: [] };
    const older = { ...page!, id: 'older', name: 'Older', nodes: page!.nodes.filter((node) => !node.content.label?.toString().includes('Client')) };
    const newest = { ...page!, id: 'newest', name: 'Newest' };
    const thumbnail = await buildV2Thumbnail({ ...drawn, pages: [map, older, newest] });
    expect(thumbnail?.light).toContain('Client');
    expect((await buildV2Thumbnail({ ...drawn, pages: [map, older] }))?.light).not.toContain('Client');
  });
});

describe('a diagram too detailed for a drawn preview', () => {
  it('gets a small picture of itself instead of a blank card', async () => {
    const document = await buildCanonicalFixtureDocument();
    const raster = vi.fn(async (svg: string) => `<svg data-picture="${svg.length > 0}"/>`);
    const thumbnail = await buildV2Thumbnail(document, 100, raster);
    expect(thumbnail).toEqual({ light: '<svg data-picture="true"/>', dark: '<svg data-picture="true"/>' });
    expect(raster).toHaveBeenCalledTimes(2);
  });

  it('a busy page is pictured smaller until it fits', async () => {
    const document = await buildCanonicalFixtureDocument();
    const raster = vi.fn(async (_svg: string, width: number) => 'x'.repeat(width / 4));
    expect(await buildV2Thumbnail(document, 160, raster)).toEqual({ light: 'x'.repeat(75), dark: 'x'.repeat(75) });
    expect(raster.mock.calls.map(([, width]) => width)).toEqual([400, 400, 300, 300]);
  });
});

describe('fitThumbnail', () => {
  it('keeps the first picture that fits the cap, drawing the plainer one only when needed, else nothing', () => {
    const big = { light: 'x'.repeat(40), dark: 'y'.repeat(40) };
    const plain = { light: 'x'.repeat(20), dark: 'y'.repeat(20) };
    const second = vi.fn(() => plain);
    expect(fitThumbnail([() => big, second], 100)).toBe(big);
    expect(second).not.toHaveBeenCalled();
    expect(fitThumbnail([() => big, second], 50)).toBe(plain);
    expect(fitThumbnail([() => big, () => plain], 10)).toBeNull();
    expect(fitThumbnail([() => null, () => plain], 50)).toBe(plain);
  });
});

describe('scheduleV2Thumbnail', () => {
  it('waits for a quiet moment, keeps only the latest document, and never throws into the editor', async () => {
    vi.useFakeTimers();
    const saveThumbnail = vi.fn<V2DocumentRepository['saveThumbnail']>().mockRejectedValue(new Error('disk gone'));
    const repository = { saveThumbnail } as unknown as V2DocumentRepository;
    const first = await buildCanonicalFixtureDocument('First');
    const second = await buildCanonicalFixtureDocument('Second');
    scheduleV2Thumbnail(repository, 'doc-1', first);
    scheduleV2Thumbnail(repository, 'doc-1', second);
    expect(saveThumbnail).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(saveThumbnail).toHaveBeenCalledTimes(1);
    expect(saveThumbnail.mock.calls[0]![0]).toBe('doc-1');
  });
});
