import { V2Settings, type V2SettingsProps } from './V2Settings';
import { V2FeedbackDialog } from './V2Feedback';
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  IconCloudCheck,
  IconFolderOff,
  IconFolderOpen,
  IconBook2,
  IconHome,
  IconPlus,
  IconMenu2,
  IconPencil,
  IconSettings,
  IconCloudOff,
  IconDownload,
  IconFileImport,
  IconArchive,
  IconLoader2,
  IconLock,
  IconMessageCircle,
  IconShare2,
} from '@tabler/icons-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SceneDocumentV1 } from '../../domain/document/types';
import { createV2Repository } from '../../../services/storage/v2/v2Repository';
import { importFiles, importSummary, openedNotice } from '../../../services/storage/v2/backup';
import { track } from '../../../services/usage/usage';
import { buildV1Backup, readV1ImportMarker } from '../../../services/storage/v2/v1Import';
import { downloadTextFile } from './v2Export';
import type { HomeNotice } from './V2LegacyRoutes';
import { mintV2Id, type V2StartIntent } from './v2Document';
import { IMPORT_ACCEPT, copyName } from './homeLibrary';
import { DOCS_URL } from './homeStars';
import {
  Button,
  FloatingRegion,
  Icon,
  IconButton,
  Menu,
  MenuSeparator,
  MenuItem,
  Toolbar,
  Tooltip,
  type ToastItem,
} from '../design-system';
import type { V2SaveStatus } from './useV2Autosave';
import { V2PagesMenu } from './V2PagesMenu';
import type { useV2Pages } from './useV2Pages';
import { isWorkspacePickerSupported } from '../../../services/workspace/workspaceFolder';

interface V2DocumentBarProps extends V2SettingsProps {
  readonly document: SceneDocumentV1;
  /** Active page id; export and page controls act on it. */
  readonly pageId: string;
  readonly pages: ReturnType<typeof useV2Pages>;
  readonly saveStatus: V2SaveStatus;
  readonly readOnly: boolean;
  readonly onRetrySave: () => void;
  readonly onReload: () => void;
  readonly onToast: (toast: ToastItem) => void;
  readonly onRename: (name: string) => void;
  /** Opens the shared export panel, anchored on the canvas-menu button. */
  readonly onOpenExport: (anchor: HTMLElement | null) => void;
  /** Where sharing is offered; the bar at the right edge hides on a phone, so the menu keeps the way in. */
  readonly onOpenShare?: (anchor: HTMLElement | null) => void;
  /** A document panel taking the foreground closes an open export panel. */
  readonly onDismissExport: () => void;
  /** A shared link's viewer: saves a local, editable copy and opens it. Throws a readable error on failure. */
  readonly onEditShared?: () => Promise<void>;
  readonly workspace?: {
    readonly name: string | null;
    readonly onOpenFolder: () => void;
    readonly onCloseFolder: () => void;
  };
  /** Architecture level chain when the document carries a model. */
  readonly breadcrumb?: readonly { readonly pageId: string; readonly label: string; readonly elementId?: string }[];
  readonly onCrumb?: (crumb: { readonly pageId: string; readonly elementId?: string }) => void;
  /** Map mode: the selected box's path (ancestors, then the box), and the way to select an ancestor. */
  readonly mapPath?: readonly { readonly id: string; readonly label: string }[];
  readonly onMapPath?: (id: string) => void;
  readonly mapMode?: { readonly mode: 'canvas' | 'map'; readonly onChange: (mode: 'canvas' | 'map') => void };
}

// ponytail: icon-only save indicator; text lives in the tooltip + live region.
function saveLabel(status: V2SaveStatus): { tone: 'neutral' | 'success' | 'warning' | 'danger'; text: string; icon: typeof IconCloudCheck } {
  switch (status.state) {
    case 'clean':
      return { tone: 'neutral', text: 'Saved', icon: IconCloudCheck };
    case 'pending':
      return { tone: 'neutral', text: 'Saving…', icon: IconLoader2 };
    case 'saved':
      return { tone: 'success', text: 'Saved', icon: IconCloudCheck };
    case 'conflict':
      return { tone: 'warning', text: 'Changed in another tab. Reload loses this tab’s last edits.', icon: IconCloudOff };
    case 'failed':
      if (status.reason === 'invalid') return { tone: 'danger', text: status.message, icon: IconCloudOff };
      return status.reason === 'quota'
        ? { tone: 'danger', text: 'Save failed — storage is full', icon: IconCloudOff }
        : status.reason === 'unavailable'
          ? { tone: 'danger', text: 'Save failed — storage unavailable', icon: IconCloudOff }
          : { tone: 'danger', text: 'Save failed', icon: IconCloudOff };
  }
}

export function V2DocumentBar(props: V2DocumentBarProps): React.JSX.Element {
  const [panel, setPanel] = useState<'menu' | 'settings' | 'pages' | 'feedback' | null>(null);
  function closePanel(name: typeof panel): void {
    setPanel((current) => current === name ? null : current);
  }
  /** Opening a document panel replaces an element export panel. */
  function openPanel(name: Exclude<typeof panel, null>): void {
    props.onDismissExport();
    setPanel(name);
  }
  function togglePanel(name: 'menu' | 'pages'): void {
    if (panel === name) { setPanel(null); return; }
    openPanel(name);
  }
  const settingsRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(props.document.name);
  const pagesRef = useRef<HTMLButtonElement>(null);
  const activePageName = props.pages.activePage?.name ?? 'Page 1';
  const save = saveLabel(props.saveStatus);
  // Beside the switch, never before it: the switch must not move when the path changes. Canvas walks pages; Map shows the selected box's path.
  const inMap = props.mapMode?.mode === 'map';
  const crumbs: { key: string; label: string; open?: () => void }[] = inMap
    ? (props.mapPath ?? []).map((box, index, all) => ({ key: box.id, label: box.label, ...(index < all.length - 1 ? { open: () => props.onMapPath?.(box.id) } : {}) }))
    : (props.breadcrumb ?? []).map((crumb, index, all) => ({ key: crumb.pageId, label: crumb.label, ...(index < all.length - 1 ? { open: () => props.onCrumb?.(crumb) } : {}) }));
  useEffect(() => { if (editingTitle) titleRef.current?.select(); }, [editingTitle]);

  function startRename(): void {
    if (props.readOnly) return;
    setTitleDraft(props.document.name);
    setEditingTitle(true);
  }

  function finishRename(commit: boolean): void {
    const name = titleDraft.trim();
    if (commit && name && name !== props.document.name) props.onRename(name);
    else setTitleDraft(props.document.name);
    setEditingTitle(false);
  }

  // Activating an ancestor turns that button into the current crumb: the keyboard follows it instead of falling to the page.
  const crumbRef = useRef<HTMLElement>(null);
  const refocus = useRef(false);
  const crumbKey = crumbs.map((crumb) => crumb.key).join('/');
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    crumbRef.current?.querySelector<HTMLElement>('.ofk-v2-breadcrumb-current')?.focus({ preventScroll: true });
  }, [crumbKey]);

  const toast = (title: string, tone: ToastItem['tone']): void =>
    props.onToast({ id: `toast-${Date.now()}`, tone, title });
  const [copying, setCopying] = useState(false);
  const editShared = (): void => {
    if (copying || !props.onEditShared) return;
    setCopying(true);
    props.onEditShared()
      .catch((error: unknown) => toast(error instanceof Error ? error.message : 'Couldn’t save a copy', 'danger'))
      .finally(() => setCopying(false));
  };

  // Open files (our .json or a backup, a V1 file, diagram text) as new diagrams, the way Home's Import does, and go there.
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  // A file the person picked is always tried (a renamed backup still opens); what isn't a diagram says so below.
  const openFiles = async (files: readonly File[]): Promise<void> => {
    if (!files.length) return;
    const report = await importFiles(files, createV2Repository(window.indexedDB), () => mintV2Id('doc'));
    if (report.draw) { navigate(`/d/${mintV2Id('doc')}`, { state: { source: report.draw.source, name: report.draw.name } satisfies V2StartIntent }); return; }
    if (report.count) track('created_import');
    const failed = report.problems.length > 0;
    if (report.count === 1 && !failed && report.firstId) {
      const notice = openedNotice(report);
      navigate(`/d/${report.firstId}`, notice ? { state: { openedNotice: notice } } : undefined);
      return;
    }
    if (!report.count) {
      props.onToast({ id: `toast-${Date.now()}`, tone: 'danger', title: 'Couldn’t open that file', description: report.problems.join('; ') });
      return;
    }
    const parts = [importSummary(report)];
    if (failed) parts.push(`Couldn’t open ${report.problems.join('; ')}.`);
    parts.push(...report.notes, ...report.losses);
    navigate('/home', { state: { notice: parts.join(' '), tone: failed || report.notes.length + report.losses.length ? 'warning' : 'success' } satisfies HomeNotice });
  };
  // What opening the file had to change, told once in the new document's editor.
  const location = useLocation();
  const opened = (location.state as { openedNotice?: ReturnType<typeof openedNotice> } | null)?.openedNotice;
  useEffect(() => {
    if (!opened) return;
    props.onToast({ id: `toast-${Date.now()}`, tone: 'warning', ...opened });
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened file
  }, [opened]);

  // A conflict's other way out: this tab's version, kept as a diagram of its own, instead of reloading it away.
  const saveCopy = async (): Promise<void> => {
    const id = mintV2Id('doc');
    const now = new Date().toISOString();
    const copy = { ...props.document, id, name: copyName(props.document.name, []), createdAt: now, updatedAt: now };
    const saved = await createV2Repository(window.indexedDB).saveDocument(id, copy, 1);
    if (saved.status === 'saved') navigate(`/d/${id}`);
  };

  const hasV1Diagrams = Object.keys(readV1ImportMarker()?.docs ?? {}).length > 0;
  const downloadV1Backup = async (): Promise<void> => {
    toast('Preparing the v1 backup…', 'info');
    const backup = await buildV1Backup(window.indexedDB, localStorage);
    // ponytail: built and serialised on the main thread like the boot import; a worker if backups grow large.
    downloadTextFile(`openflowkit-backup-${backup.exportedAt.slice(0, 10)}.json`, JSON.stringify(backup), 'application/json');
  };

  return (
    <>
      <FloatingRegion slot="top-start">
        <Toolbar label="Document" className="ofk-v2-document-bar">
          <Tooltip content="Canvas menu">
            <IconButton ref={settingsRef} variant="quiet" label="Canvas menu"
              icon={<Icon icon={IconMenu2} />}
              aria-expanded={panel === 'menu'} aria-haspopup="menu"
              onClick={() => togglePanel('menu')} />
          </Tooltip>
          {editingTitle ? (
            <input ref={titleRef} className="ofk-v2-document-title-input" value={titleDraft}
              aria-label="Diagram title" maxLength={120}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => finishRename(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') { event.preventDefault(); finishRename(false); }
              }} />
          ) : (
            <Button variant="quiet" className="ofk-v2-document-title" title={props.document.name}
              onClick={startRename}>
              <span className="ofk-v2-document-title-text">{props.document.name}</span>
            </Button>
          )}
          {props.mapMode ? (
            <div className="ofk-v2-mode" role="group" aria-label="View mode">
              <Tooltip content="Draw and arrange freely">
                <Button variant="quiet" selected={props.mapMode.mode === 'canvas'} aria-label="Canvas"
                  onClick={() => props.mapMode!.onChange('canvas')}>Canvas</Button>
              </Tooltip>
              <Tooltip content="Laid out from your model: click a box to open it" shortcut="M">
                <Button variant="quiet" selected={props.mapMode.mode === 'map'} aria-label="Map"
                  onClick={() => props.mapMode!.onChange('map')}>Map</Button>
              </Tooltip>
            </div>
          ) : null}
          {crumbs.length > 0 ? <span className="ofk-v2-divider" aria-hidden="true" /> : null}
          {crumbs.length > 0 ? (
            <nav ref={crumbRef} className="ofk-v2-breadcrumb" aria-label={inMap ? 'Map path' : 'Architecture level'}>
              {crumbs.map((crumb, index) => (
                <Fragment key={`${crumb.key}-${index}`}>
                  {index > 0 ? <span className="ofk-v2-breadcrumb-sep" aria-hidden="true">/</span> : null}
                  {crumb.open ? (
                    <button type="button" className="ofk-v2-breadcrumb-link" onClick={() => { refocus.current = true; window.setTimeout(() => { refocus.current = false; }, 600); crumb.open?.(); }}>{crumb.label}</button>
                  ) : (
                    <span className="ofk-v2-breadcrumb-current" tabIndex={-1} aria-current={inMap ? 'location' : 'page'}>{crumb.label}</span>
                  )}
                </Fragment>
              ))}
            </nav>
          ) : null}
          {props.onEditShared ? (
            <Button variant="primary" disabled={copying} onClick={editShared}>Edit in OpenFlowKit</Button>
          ) : null}
          <Tooltip content="Pages">
            <Button ref={pagesRef} variant="quiet" aria-expanded={panel === 'pages'} aria-haspopup="dialog"
              aria-label={`Pages (current: ${activePageName})`}
              onClick={() => togglePanel('pages')}>
              {`${props.pages.pages.length} ${props.pages.pages.length === 1 ? 'page' : 'pages'}`}
            </Button>
          </Tooltip>
          <Tooltip content={props.readOnly ? 'Read-only' : save.text}>
            <span className="ofk-v2-save-status" role="status" aria-atomic
              data-tone={props.readOnly ? 'neutral' : save.tone}
              data-busy={props.saveStatus.state === 'pending' || undefined}>
              <Icon icon={props.readOnly ? IconLock : save.icon} />
              <span className="ofk-visually-hidden">{props.readOnly ? 'Read-only' : save.text}</span>
            </span>
          </Tooltip>
          {props.saveStatus.state === 'failed' && props.saveStatus.reason === 'invalid' ? (
            // Retry cannot help here: the way out is taking the work away as a file.
            <Button variant="quiet" onClick={() => props.onOpenExport(settingsRef.current)}>
              Export…
            </Button>
          ) : props.saveStatus.state === 'failed' ? (
            <Button variant="quiet" onClick={props.onRetrySave}>
              Retry
            </Button>
          ) : null}
          {props.saveStatus.state === 'conflict' ? (
            <>
              <span className="ofk-v2-conflict-note" title="Changed in another tab. Reload loses this tab’s last edits.">Changed in another tab. Reload loses this tab’s last edits.</span>
              <Button variant="quiet" onClick={props.onReload}>
                Discard and reload
              </Button>
              <Button variant="quiet" onClick={() => void saveCopy().catch((error: unknown) =>
                toast(error instanceof Error ? error.message : 'Couldn’t save a copy', 'danger'))}>
                Save as copy
              </Button>
            </>
          ) : null}
        </Toolbar>
      </FloatingRegion>

      <Menu open={panel === 'menu'} anchorRef={settingsRef} onClose={() => closePanel('menu')} label="Canvas menu" placement="bottom-start">
        <MenuItem icon={<Icon icon={IconHome} />} onSelect={() => navigate('/home')}>Home</MenuItem>
        <MenuItem icon={<Icon icon={IconPlus} />} onSelect={() => navigate(`/d/${mintV2Id('doc')}`)}>New diagram</MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Icon icon={IconPencil} />} disabled={props.readOnly} onSelect={startRename}>Rename diagram</MenuItem>
        <MenuItem icon={<Icon icon={IconSettings} />} onSelect={() => openPanel('settings')}>Settings</MenuItem>
        <MenuItem icon={<Icon icon={IconFileImport} />} onSelect={() => fileRef.current?.click()}>Open file…</MenuItem>
        {props.onOpenShare ? (
          <MenuItem icon={<Icon icon={IconShare2} />} onSelect={() => { setPanel(null); props.onOpenShare?.(settingsRef.current); }}>Share…</MenuItem>
        ) : null}
        <MenuItem icon={<Icon icon={IconDownload} />} onSelect={() => { setPanel(null); props.onOpenExport(settingsRef.current); }}>Export…</MenuItem>
        {/* Only where v1 diagrams were found; the permanent stand-in for Classic (12.7). */}
        {hasV1Diagrams ? (
          <MenuItem icon={<Icon icon={IconArchive} />} onSelect={() => void downloadV1Backup().catch((error: unknown) =>
            toast(error instanceof Error ? error.message : 'Couldn’t read the previous editor’s diagrams', 'danger'))}>
            Download v1 backup
          </MenuItem>
        ) : null}
        {/* File System Access API only (Chrome/Edge); elsewhere the item would be a silent no-op. */}
        {props.workspace && isWorkspacePickerSupported() ? (
          <>
            <MenuSeparator />
            <MenuItem icon={<Icon icon={IconFolderOpen} />} onSelect={props.workspace.onOpenFolder}>
              {props.workspace.name ? `Open another folder (${props.workspace.name})` : 'Open workspace folder…'}
            </MenuItem>
            {props.workspace.name ? (
              <MenuItem icon={<Icon icon={IconFolderOff} />} onSelect={props.workspace.onCloseFolder}>
                Stop syncing {props.workspace.name}
              </MenuItem>
            ) : null}
          </>
        ) : null}
        <MenuSeparator />
        <MenuItem icon={<Icon icon={IconBook2} />} onSelect={() => { window.open(DOCS_URL, '_blank', 'noopener'); }}>Docs</MenuItem>
        <MenuItem icon={<Icon icon={IconMessageCircle} />} onSelect={() => openPanel('feedback')}>Send feedback…</MenuItem>
      </Menu>
      <input ref={fileRef} type="file" accept={IMPORT_ACCEPT} multiple hidden aria-hidden="true" tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = '';
          if (files.length) void openFiles(files).catch((error: unknown) => toast(error instanceof Error ? error.message : 'Couldn’t open the file', 'danger'));
        }} />
      <V2Settings open={panel === 'settings'} anchorRef={settingsRef} onClose={() => closePanel('settings')}
        preferences={props.preferences} canvasDefaultColor={props.canvasDefaultColor}
        onPreferencesChange={props.onPreferencesChange} />
      <V2FeedbackDialog open={panel === 'feedback'} onToast={props.onToast}
        onClose={() => { closePanel('feedback'); settingsRef.current?.focus(); }} />
      <V2PagesMenu open={panel === 'pages'} anchorRef={pagesRef} pages={props.pages} onClose={() => closePanel('pages')} />
    </>
  );
}
