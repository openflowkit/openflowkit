import { describe, expect, it } from 'vitest';
import type { V2DocumentSummary } from '../../../services/storage/v2/v2Repository';
import { arrange, copyName, gridStep, importKind, parseView, readHomeState, selectRange, toggleId } from './homeLibrary';

const doc = (id: string, name: string): V2DocumentSummary => ({ id, name, savedAt: '', pageCount: 1, pageIds: [], searchText: '' });
const docs = [doc('a', 'Payments'), doc('b', 'auth flow'), doc('c', 'Diagram 10'), doc('d', 'Diagram 9')];

describe('homeLibrary', () => {
  it('reads stored state defensively', () => {
    expect(readHomeState(null)).toEqual({ starred: [], sort: 'edited', layout: 'grid', newsSeen: '' });
    expect(readHomeState('{not json')).toEqual(readHomeState(null));
    expect(readHomeState(JSON.stringify({ starred: ['a', 3], sort: 'name', layout: 'list', newsSeen: 'x' })))
      .toEqual({ starred: ['a'], sort: 'name', layout: 'list', newsSeen: 'x' });
    expect(readHomeState(JSON.stringify({ sort: 'size', layout: 'table' }))).toMatchObject({ sort: 'edited', layout: 'grid' });
  });

  it('parses views, unknown means recents', () => {
    expect([parseView(null), parseView('starred'), parseView('templates'), parseView('archive'), parseView('news'), parseView('trash')])
      .toEqual(['recents', 'starred', 'templates', 'archive', 'news', 'recents']);
  });

  it('finds a diagram by a page name or a box label, not only its title', () => {
    const inside = [{ ...doc('a', 'Checkout'), searchText: 'page 1\nstripe\ncart' }, doc('b', 'Auth')];
    const base = { view: 'recents' as const, starred: [], sort: 'edited' as const };
    expect(arrange(inside, { ...base, query: ' Stripe ' }).map(({ id }) => id)).toEqual(['a']);
    expect(arrange(inside, { ...base, query: 'auth' }).map(({ id }) => id)).toEqual(['b']);
  });

  it('toggles an id on and off', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('selects a range either way, or just the card when there is no anchor', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(selectRange(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(selectRange(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(selectRange(order, null, 'c')).toEqual(['c']);
    expect(selectRange(order, 'gone', 'c')).toEqual(['c']);
  });

  it('steps through a grid and stops at its edges', () => {
    // 7 cards in 3 columns: 0 1 2 / 3 4 5 / 6
    expect(gridStep(1, 7, 3, 'ArrowDown')).toBe(4);
    expect(gridStep(4, 7, 3, 'ArrowDown')).toBeNull();
    expect(gridStep(0, 7, 3, 'ArrowLeft')).toBeNull();
    expect(gridStep(2, 7, 3, 'ArrowRight')).toBe(3);
    expect(gridStep(5, 7, 3, 'Home')).toBe(0);
    expect(gridStep(0, 7, 3, 'End')).toBe(6);
    expect(gridStep(0, 7, 3, 'Enter')).toBeNull();
  });

  it('knows which files Import can open', () => {
    expect([importKind('a.JSON'), importKind('flow.mmd'), importKind('x.d2'), importKind('w.dsl'), importKind('pic.png'), importKind('noext')])
      .toEqual(['json', 'source', 'source', 'source', null, null]);
    expect(importKind('sketch.excalidraw')).toBe('json');
  });

  it('filters by view and search, keeps saved order or sorts by name naturally', () => {
    const base = { view: 'recents', starred: ['b'], query: '', sort: 'edited' } as const;
    expect(arrange(docs, base).map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
    expect(arrange(docs, { ...base, view: 'starred' }).map(({ id }) => id)).toEqual(['b']);
    expect(arrange(docs, { ...base, query: '  DIAGRAM ' }).map(({ id }) => id)).toEqual(['c', 'd']);
    expect(arrange(docs, { ...base, sort: 'name' }).map(({ name }) => name)).toEqual(['auth flow', 'Diagram 9', 'Diagram 10', 'Payments']);
  });

  it('names a copy without stacking "copy copy"', () => {
    expect(copyName('Payments', ['Payments'])).toBe('Payments copy');
    expect(copyName('Payments', ['Payments copy'])).toBe('Payments copy 2');
    expect(copyName('Payments copy 2', ['Payments copy', 'Payments copy 2'])).toBe('Payments copy 3');
  });
});
