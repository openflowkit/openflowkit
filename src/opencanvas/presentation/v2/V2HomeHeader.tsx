import { useRef, type RefObject } from 'react';
import { IconChevronDown, IconFileImport, IconLayoutGrid, IconLayoutList, IconPlus } from '@tabler/icons-react';
import { Button, Icon, Menu, MenuItem, Segmented, Tooltip } from '../design-system';
import { IMPORT_ACCEPT, useHomeState } from './homeLibrary';
import { SORTS } from './homeConfig';

type HomeState = ReturnType<typeof useHomeState>[0];

interface HomeHeaderProps {
  readonly title: string;
  readonly listing: boolean;
  readonly sortTitle: string;
  readonly sortOpen: boolean;
  readonly home: HomeState;
  readonly fileRef: RefObject<HTMLInputElement>;
  readonly blocked: boolean | undefined;
  readonly onSortOpen: (open: boolean) => void;
  readonly onUpdateHome: (patch: Partial<HomeState>) => void;
  readonly onImport: (files: readonly File[]) => void;
  readonly onCreate: () => void;
}

export function V2HomeHeader({
  title, listing, sortTitle, sortOpen, home, fileRef, blocked, onSortOpen, onUpdateHome, onImport, onCreate,
}: HomeHeaderProps): React.JSX.Element {
  const sortRef = useRef<HTMLButtonElement>(null);
  return (
    <header className="ofk-home-head">
      <h1>{title}</h1>
      {listing ? (
        <div className="ofk-home-head-tools">
          <Button ref={sortRef} variant="quiet" className="ofk-home-sort" aria-haspopup="menu" aria-expanded={sortOpen}
            aria-label={`Sort by ${sortTitle}`} onClick={() => onSortOpen(!sortOpen)}>
            {sortTitle} <Icon icon={IconChevronDown} />
          </Button>
          <Menu open={sortOpen} anchorRef={sortRef} onClose={() => onSortOpen(false)} label="Sort by" placement="bottom-end">
            {SORTS.map(({ sort, title }) => (
              <MenuItem key={sort} role="menuitemradio" checked={home.sort === sort}
                onSelect={() => onUpdateHome({ sort })}>{title}</MenuItem>
            ))}
          </Menu>
          <Segmented label="Layout" value={home.layout} onChange={(layout) => onUpdateHome({ layout })} options={[
            { value: 'grid', title: 'Grid', label: <><Icon icon={IconLayoutGrid} /><span className="ofk-visually-hidden">Grid</span></> },
            { value: 'list', title: 'List', label: <><Icon icon={IconLayoutList} /><span className="ofk-visually-hidden">List</span></> },
          ]} />
        </div>
      ) : null}
      <Tooltip content="Import .json, Excalidraw, Mermaid, D2 or Structurizr — or drop files anywhere">
        <Button variant="quiet" className="ofk-home-import" onClick={() => fileRef.current?.click()}>
          <Icon icon={IconFileImport} /> <span>Import</span>
        </Button>
      </Tooltip>
      <input ref={fileRef} type="file" accept={IMPORT_ACCEPT} multiple hidden aria-hidden="true" tabIndex={-1}
        onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ''; onImport(files); }} />
      <Tooltip content="New diagram" shortcut="N">
        <Button variant="primary" data-home-new disabled={blocked} onClick={onCreate}>
          <Icon icon={IconPlus} /> New diagram
        </Button>
      </Tooltip>
    </header>
  );
}
