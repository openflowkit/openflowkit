import { useState } from 'react';
import type { V2DocumentSummary } from '../../../services/storage/v2/v2Repository';

export type HomeView = 'recents' | 'starred' | 'templates' | 'archive' | 'news';
export type HomeSort = 'edited' | 'name';
type HomeLayout = 'grid' | 'list';

/** Home's own memory: starred ids, how the list is shown, the last news item seen. Per browser, like the diagrams. */
interface HomeState {
  readonly starred: readonly string[];
  readonly sort: HomeSort;
  readonly layout: HomeLayout;
  readonly newsSeen: string;
}

const KEY = 'openflowkit-v2-home';
const DEFAULTS: HomeState = { starred: [], sort: 'edited', layout: 'grid', newsSeen: '' };

export function readHomeState(raw: string | null): HomeState {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<Record<keyof HomeState, unknown>> | null;
    return {
      starred: Array.isArray(value?.starred) ? value.starred.filter((id): id is string => typeof id === 'string') : [],
      sort: value?.sort === 'name' ? 'name' : 'edited',
      layout: value?.layout === 'list' ? 'list' : 'grid',
      newsSeen: typeof value?.newsSeen === 'string' ? value.newsSeen : '',
    };
  } catch {
    return DEFAULTS;
  }
}

export function useHomeState() {
  const [state, setState] = useState(() => {
    try { return readHomeState(localStorage.getItem(KEY)); } catch { return DEFAULTS; }
  });
  function update(patch: Partial<HomeState>): void {
    setState((previous) => {
      const next = { ...previous, ...patch };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* this session still remembers */ }
      return next;
    });
  }
  return [state, update] as const;
}

export const parseView = (value: string | null): HomeView =>
  value === 'starred' || value === 'templates' || value === 'archive' || value === 'news' ? value : 'recents';

/** Adds or removes one id, keeping the order the rest were added in (stars, selection). */
export const toggleId = (ids: readonly string[], id: string): readonly string[] =>
  ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];

/** Shift-click: everything between the last clicked card and this one, in the order shown. */
export function selectRange(order: readonly string[], anchor: string | null, id: string): readonly string[] {
  const from = anchor ? order.indexOf(anchor) : -1;
  const to = order.indexOf(id);
  if (from < 0 || to < 0) return [id];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** Arrow keys over a grid of `count` cards in `columns` columns; null when the key does not move. */
export function gridStep(index: number, count: number, columns: number, key: string): number | null {
  const next = key === 'ArrowRight' ? index + 1 : key === 'ArrowLeft' ? index - 1
    : key === 'ArrowDown' ? index + columns : key === 'ArrowUp' ? index - columns
      : key === 'Home' ? 0 : key === 'End' ? count - 1 : null;
  return next === null || next < 0 || next >= count ? null : next;
}

/** What Import does with a file: open our .json, or draw diagram text (OpenFlow DSL, Mermaid, D2, Structurizr). */
export function importKind(fileName: string): 'json' | 'source' | null {
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  // An Excalidraw drawing is JSON too; the import tells it from ours by its contents.
  if (extension === 'json' || extension === 'excalidraw') return 'json';
  return ['mmd', 'mermaid', 'd2', 'dsl', 'ofk', 'txt'].includes(extension) ? 'source' : null;
}
export const IMPORT_ACCEPT = '.json,.excalidraw,.mmd,.mermaid,.d2,.dsl,.ofk,.txt,application/json,text/plain';

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The diagrams a view shows: the view's subset, matching the search (title, page names, box labels), in the chosen order. */
export function arrange(documents: readonly V2DocumentSummary[], { view, starred, query, sort }: {
  readonly view: HomeView;
  readonly starred: readonly string[];
  readonly query: string;
  readonly sort: HomeSort;
}): readonly V2DocumentSummary[] {
  const needle = query.trim().toLowerCase();
  const shown = documents.filter(({ id, name, searchText }) =>
    (view !== 'starred' || starred.includes(id)) && (!needle || name.toLowerCase().includes(needle) || searchText.includes(needle)));
  // The repository already lists most recently saved first.
  return sort === 'name' ? [...shown].sort((a, b) => byName.compare(a.name, b.name)) : shown;
}

/** "Payments" → "Payments copy", "Payments copy" → "Payments copy 2", … against the names already taken. */
export function copyName(name: string, taken: readonly string[]): string {
  const base = `${name.replace(/ copy(?: \d+)?$/, '')} copy`;
  if (!taken.includes(base)) return base;
  let index = 2;
  while (taken.includes(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}
