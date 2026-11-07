import { IconArrowBackUp, IconArchive, IconStar, IconStarFilled, IconTrashX, IconUpload, IconX } from '@tabler/icons-react';
import { Button, Dialog, Icon, IconButton, Kbd, Tooltip } from '../design-system';
import type { V2DocumentSummary } from '../../../services/storage/v2/v2Repository';
import { platformKeys } from './v2Shortcuts';
import { plural } from './homeConfig';

interface HomeSelectionBarProps {
  readonly count: number;
  readonly archive: boolean;
  readonly allStarred: boolean;
  readonly onRestore: () => void;
  readonly onDelete: () => void;
  readonly onStar: () => void;
  readonly onArchive: () => void;
  readonly onClear: () => void;
}

export function HomeSelectionBar({ count, archive, allStarred, onRestore, onDelete, onStar, onArchive, onClear }: HomeSelectionBarProps): React.JSX.Element {
  return (
    <div className="ofk-home-selectionbar" role="toolbar" aria-label="Selection">
      <span className="ofk-home-selectionbar-count" role="status">{count} selected</span>
      {archive ? <>
        <Button variant="quiet" onClick={onRestore}><Icon icon={IconArrowBackUp} /> Restore</Button>
        <Button variant="quiet" className="ofk-home-head-danger" onClick={onDelete}>
          <Icon icon={IconTrashX} /> Delete forever
        </Button>
      </> : <>
        <Button variant="quiet" onClick={onStar}>
          <Icon icon={allStarred ? IconStarFilled : IconStar} /> {allStarred ? 'Unstar' : 'Star'}
        </Button>
        <Button variant="quiet" onClick={onArchive}><Icon icon={IconArchive} /> Archive</Button>
      </>}
      <Tooltip content="Clear selection" shortcut="Esc">
        <IconButton variant="quiet" label="Clear selection" icon={<Icon icon={IconX} />} onClick={onClear} />
      </Tooltip>
    </div>
  );
}

export function HomeDropOverlay(): React.JSX.Element {
  return (
    <div className="ofk-home-drop" aria-hidden="true">
      <Icon icon={IconUpload} />
      <strong>Drop to import</strong>
      <span>OpenFlowKit .json, Excalidraw, Mermaid, D2, Structurizr or OpenFlow DSL</span>
    </div>
  );
}

export function HomeKeysDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts"
      actions={<Button variant="quiet" onClick={onClose}>Close</Button>}>
      <dl className="ofk-home-keys">
        {([
          [['N'], 'New diagram'], [[platformKeys('⌘K')], 'Find anything'], [['/'], 'Search this view'], [['↑', '↓', '←', '→'], 'Move between diagrams'],
          [[platformKeys('↵')], 'Open'], [['Space'], 'Select'], [[platformKeys('⇧↓')], 'Select a range'], [[platformKeys('⌘A')], 'Select all'],
          [['S'], 'Star'], [['F2'], 'Rename'], [['Del'], 'Archive'], [['Esc'], 'Clear selection'],
        ] as const).map(([keys, what]) => <div key={what}><dt>{what}</dt><dd><Kbd keys={keys} /></dd></div>)}
      </dl>
    </Dialog>
  );
}

interface HomeDeleteDialogProps {
  readonly deleting: readonly V2DocumentSummary[] | null;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function HomeDeleteDialog({ deleting, onClose, onConfirm }: HomeDeleteDialogProps): React.JSX.Element {
  return (
    <Dialog open={deleting !== null} onClose={onClose}
      title={deleting?.length === 1 ? `Delete “${deleting[0]!.name}” forever?` : `Delete ${plural(deleting?.length ?? 0, 'diagram')} forever?`}
      description={`${deleting?.length === 1 ? 'It’s' : 'They’re'} removed from this browser. This can’t be undone.`}
      actions={<>
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>Delete forever</Button>
      </>} />
  );
}
