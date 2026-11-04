// Export panel: one intent (format + scope + scale) over the shared exporter.
// Owns no document state; the host passes the live document in. One instance
// serves both entry points — the canvas menu's Export… and an element's
// context menu — so scope always matches what the user pointed at.
import { useState } from 'react';
import { dslFrames, frameScene, frameSource } from '../../../dsl/frameScene';
import { diagramToMermaid, mermaidLossSummary } from '../../../dsl/mermaid/toMermaid';
import { dslFrameMeta } from '../../../dsl/sceneMeta';
import { IconChevronRight, IconCode, IconCopy, IconDownload, IconLink, IconLinkOff, IconLock, IconMovie, IconPhoto } from '@tabler/icons-react';
import type { SceneDocumentV1 } from '../../domain/document/types';
import { isContainerNodeKind } from '../../domain/nodes/containerNodePresentation';
import { Button, Icon, Popover, PopoverHeader, Segmented, Tooltip, type ToastItem } from '../design-system';
import { track } from '../../../services/usage/usage';
import { appBaseUrl, createShareLink, browserStorage, deleteShare, forgetShare, latestShareFor, rememberShare, ShareError } from '../../../services/share/shareClient';
import { getTurnstileToken } from '../../../services/share/turnstile';
import { dslLink } from '../../../services/discovery/dslLink';
import {
  buildV2Export, copyImageToClipboard, downloadV2Export, printV2Export,
  type V2ExportFormat, type V2ExportScope, type V2ExportTheme,
} from './v2Export';

interface V2ExportMenuProps {
  readonly open: boolean;
  readonly anchorRef: React.RefObject<HTMLElement | null>;
  readonly document: SceneDocumentV1;
  /** The stored document, when `document` is a view of it (a Map scene stands in for the page): JSON and share links carry this, never the view. */
  readonly sourceDocument?: SceneDocumentV1;
  readonly pageId: string;
  /** The view-only link needs the share service (a Turnstile site key); the editable link needs nothing. */
  readonly canShare?: boolean;
  readonly selectedNodeIds: readonly string[];
  /** Connector ids when the selection is connections, not nodes. */
  readonly selectedConnectorIds?: readonly string[];
  /** The scope this entry point implies: Page from the document bar, Selection from an element. */
  readonly initialScope?: V2ExportScope;
  /** Share shows the two kinds of link; Export the files. */
  readonly section?: 'export' | 'share';
  /** The bar at the right edge opens its panel toward the inside. */
  readonly placement?: 'bottom-start' | 'bottom-end';
  readonly onClose: () => void;
  readonly onToast: (title: string, tone: 'info' | 'success' | 'danger', extra?: Pick<ToastItem, 'description' | 'action' | 'persistent'>) => void;
  /** Animation is a docked panel, not a popover: too much to read in a flyout. */
  readonly onOpenAnimation: () => void;
}

const FORMATS: readonly { value: V2ExportFormat; label: string; title: string }[] = [
  { value: 'png', label: 'PNG', title: 'Raster image, transparent option free' },
  { value: 'svg', label: 'SVG', title: 'Vector, opens in Figma and Illustrator' },
  { value: 'pdf', label: 'PDF', title: 'Opens the print dialog; choose "Save as PDF"' },
  { value: 'json', label: 'JSON', title: 'Whole document, every page' },
];

/** What Selection means right now, in the element's own words. */
function selectionCaption(nodeIds: readonly string[], connectorIds: readonly string[], page: SceneDocumentV1['pages'][number] | undefined): string {
  if (connectorIds.length > 0) {
    return connectorIds.length === 1 ? 'The selected connection.' : `${connectorIds.length} selected connections.`;
  }
  if (nodeIds.length > 1) return `${nodeIds.length} selected elements and everything inside them.`;
  const kind = page?.nodes.find(({ id }) => id === nodeIds[0])?.kind;
  return kind && isContainerNodeKind(kind)
    ? `The selected ${kind} and everything inside it.`
    : 'The selected element.';
}

/** The code diagram a Mermaid copy or an editable link is about: the one holding the selection, else the first on the page. */
function codeFrame(page: SceneDocumentV1['pages'][number] | undefined, selectedNodeIds: readonly string[]) {
  if (!page) return null;
  const frames = dslFrames(page);
  const byId = new Map(page.nodes.map((node) => [node.id, node]));
  for (let id: string | undefined = selectedNodeIds[0]; id; id = byId.get(id)?.parentId) {
    const hit = frames.find((frame) => frame.id === id);
    if (hit) return hit;
  }
  return frames[0] ?? null;
}

export function V2ExportMenu({
  open, anchorRef, document, sourceDocument, pageId, canShare = false, selectedNodeIds, selectedConnectorIds = [], initialScope = 'page',
  section = 'export', placement = 'bottom-start', onClose, onToast, onOpenAnimation,
}: V2ExportMenuProps) {
  const [format, setFormat] = useState<V2ExportFormat>('png');
  const [scope, setScope] = useState<V2ExportScope>(initialScope);
  // The panel opens at the scope of its entry point, without a stale frame.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setScope(initialScope);
  }
  const [scale, setScale] = useState<1 | 2>(2);
  const [theme, setTheme] = useState<V2ExportTheme>('light');
  const [transparent, setTransparent] = useState(false);
  const [includeComments, setIncludeComments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState<'snapshot' | 'code' | null>(null);
  const [linkKind, setLinkKind] = useState<'snapshot' | 'code'>('snapshot');
  // Re-reads this browser's delete tokens after a share or a delete.
  const [, setShareTick] = useState(0);
  const latestLink = latestShareFor(browserStorage(), document.id);
  const hasSelection = selectedNodeIds.length > 0 || selectedConnectorIds.length > 0;
  const effectiveScope: V2ExportScope = scope === 'selection' && !hasSelection ? 'page' : scope;
  // JSON is the whole document; on an element it would quietly export everything.
  const effectiveFormat: V2ExportFormat = format === 'json' && effectiveScope === 'selection' ? 'png' : format;
  const activePage = document.pages.find((page) => page.id === pageId) ?? document.pages[0];
  // Exporting an empty page is an error, not an empty file: say so up front.
  const pageEmpty = (activePage?.nodes.length ?? 0) + (activePage?.connectors.length ?? 0) === 0;
  const empty = effectiveScope === 'selection' ? !hasSelection : effectiveScope === 'page' && pageEmpty;
  const whole = sourceDocument ?? document;
  const request = {
    document: effectiveFormat === 'json' ? whole : document, format: effectiveFormat, scope: effectiveScope, pageId, theme,
    ...(effectiveScope === 'selection'
      ? { selectedNodeIds, ...(selectedConnectorIds.length ? { selectedConnectorIds } : {}) }
      : {}),
    ...(effectiveFormat === 'json' ? jsonOptions(includeComments) : {}),
    ...(effectiveFormat === 'png' ? { scale } : {}),
    ...(effectiveFormat === 'png' || effectiveFormat === 'svg' ? { transparent } : {}),
  } as const;
  const caption = empty
    ? effectiveScope === 'selection' ? 'Select an element or connection first.' : 'Nothing to export here — this page has no shapes.'
    : effectiveScope === 'selection' ? selectionCaption(selectedNodeIds, selectedConnectorIds, activePage)
      : effectiveScope === 'document' ? (effectiveFormat === 'pdf' ? 'Every page, one sheet each.' : 'Every page as its own file.') : 'The current page.';

  // Only while the panel is open: closed, it costs nothing per render.
  const mermaidTarget = open ? codeFrame(activePage, selectedNodeIds) : null;
  const mermaidFamily = mermaidTarget ? dslFrameMeta(mermaidTarget).family : undefined;
  const mermaidReason = !mermaidTarget ? 'Copy as Mermaid needs a diagram made from code; this page has none.'
    : mermaidFamily !== 'flowchart' && mermaidFamily !== 'sequence' ? `Copy as Mermaid supports flowchart and sequence, not ${mermaidFamily}.` : '';

  async function copyMermaid(): Promise<void> {
    const scene = mermaidTarget && activePage ? frameScene(activePage, mermaidTarget.id) : null;
    if (!mermaidTarget || !scene || mermaidReason) return;
    let mermaid: ReturnType<typeof diagramToMermaid>;
    try {
      mermaid = diagramToMermaid(scene);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Couldn’t write this diagram as Mermaid', 'danger');
      return;
    }
    try {
      await navigator.clipboard.writeText(mermaid.text);
    } catch {
      onToast('Couldn’t copy', 'danger', { description: 'This browser blocked the clipboard.' });
      return;
    }
    track('export_data');
    onToast(`Copied “${frameName(mermaidTarget)}” as Mermaid`, 'success', mermaid.losses.length > 0 ? { description: mermaidLossSummary(mermaid.losses) } : undefined);
    onClose();
  }

  async function run(action: 'download' | 'copy-png'): Promise<void> {
    setBusy(true);
    try {
      if (effectiveFormat === 'pdf') {
        await printV2Export(request);
        track('export_image');
        onToast('Print dialog opened', 'info', { description: 'Choose “Save as PDF” to keep a file.' });
      } else if (action === 'copy-png') {
        // Started inside the click, resolved later: the clipboard write must begin while the gesture is live.
        let buildError: unknown;
        const png = buildV2Export({ ...request, format: 'png', scale }).then(([file]) => {
          if (!file?.bytes) throw new Error('Nothing to copy');
          return file.bytes;
        });
        png.catch((error: unknown) => { buildError = error; });
        const copied = await copyImageToClipboard(png, 'image/png');
        if (buildError !== undefined) throw buildError;
        if (!copied) {
          onToast('Couldn’t copy the image', 'danger', { description: 'This browser can’t copy images to the clipboard.' });
        } else {
          track('export_image');
          onToast('PNG copied', 'success');
        }
      } else {
        const files = await buildV2Export(request);
        downloadV2Export(files);
        track(effectiveFormat === 'json' ? 'export_data' : 'export_image');
        onToast(files.length > 1 ? `${files.length} files downloaded` : `${files[0]?.filename ?? 'Export'} downloaded`, 'success');
      }
      // The panel stays open: the next variant (theme, scale, format) is one click, not a reopen.
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Export failed', 'danger');
    } finally {
      setBusy(false);
    }
  }

  /** Encrypts the whole document in the browser, uploads the ciphertext, copies a link whose key stays in the #fragment. */
  async function copyShareLink(): Promise<void> {
    setSharing('snapshot');
    try {
      const link = await createShareLink(whole, { appUrl: appBaseUrl(window.location.href), getTurnstileToken });
      rememberShare(browserStorage(), document.id, link.id, link.deleteToken);
      track('share_view');
      setShareTick((tick) => tick + 1);
      const copied = await navigator.clipboard.writeText(link.url).then(() => true, () => false);
      // No clipboard permission: the link is shown instead of lost.
      onToast(copied ? 'View-only link copied' : 'View-only link ready', 'success',
        copied ? { description: 'Anyone with it can view every page. The key never leaves the link.' } : { description: link.url, persistent: true });
      onClose();
    } catch (error) {
      if (error instanceof ShareError && (error.code === 'too-large' || error.code === 'unreachable')) {
        const tooLarge = error.code === 'too-large';
        onToast(tooLarge ? 'Too big to share as a link' : error.message, 'danger', {
          description: tooLarge ? 'Links hold up to 1 MB. Send the file instead.' : 'Try again in a minute, or send the file instead.', persistent: true,
          action: { label: 'Download file', onClick: () => { void buildV2Export({ document: whole, format: 'json', scope: 'document', pageId }).then(downloadV2Export); } },
        });
      } else {
        onToast(error instanceof Error ? error.message : 'Couldn’t create the link', 'danger');
      }
    } finally {
      setSharing(null);
    }
  }

  /** Puts this diagram's code inside a link: nothing is uploaded, and whoever opens it gets their own copy. */
  async function copyCodeLink(): Promise<void> {
    const scene = mermaidTarget && activePage ? frameScene(activePage, mermaidTarget.id) : null;
    if (!mermaidTarget || !scene) return;
    setSharing('code');
    try {
      const url = await dslLink(frameSource(scene), appBaseUrl(window.location.href), whole.name);
      if (!url) {
        onToast('Too long for an editable link', 'danger', { description: canShare ? 'Share a view-only link instead, or send the file.' : 'Send the file instead.' });
        return;
      }
      track('share_edit');
      const copied = await navigator.clipboard.writeText(url).then(() => true, () => false);
      onToast(copied ? 'Editable link copied' : 'Editable link ready', 'success',
        copied ? { description: `Opens “${frameName(mermaidTarget)}” as a new copy to edit. Nothing was uploaded.` } : { description: url, persistent: true });
      onClose();
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Couldn’t create the link', 'danger');
    } finally {
      setSharing(null);
    }
  }

  /** Deletes the newest link made here for this document, the one the button is about. */
  async function deleteLink(): Promise<void> {
    if (!latestLink) return;
    setSharing('snapshot');
    try {
      await deleteShare(latestLink.id, latestLink.deleteToken);
      forgetShare(browserStorage(), latestLink.id);
      onToast('Link deleted', 'success', { description: 'It no longer opens.' });
    } catch (error) {
      // The server doesn't know this token: it will never work, so stop offering it.
      if (error instanceof ShareError && error.code === 'forbidden') forgetShare(browserStorage(), latestLink.id);
      onToast(error instanceof Error ? error.message : 'Couldn’t delete the link', 'danger');
    } finally {
      setShareTick((tick) => tick + 1);
      setSharing(null);
    }
  }

  const sharingOnly = section === 'share';
  // Two jobs, like Excalidraw's live session vs link: show the finished document, or hand over a diagram to change.
  const linkKinds = [
    { value: 'snapshot', icon: IconLock, title: 'View-only link', available: canShare,
      detail: canShare ? 'Every page, encrypted in your browser.' : 'Not set up on this site.' },
    { value: 'code', icon: IconCode, title: 'Editable copy', available: Boolean(mermaidTarget),
      detail: mermaidTarget ? 'This page only. Its code, in the link, nothing uploaded.' : 'Needs a diagram made from code.' },
  ] as const;
  // The chosen kind, or the one that works here; neither → the file.
  const kind = linkKinds.find(({ value, available }) => available && value === linkKind)?.value
    ?? linkKinds.find(({ available }) => available)?.value ?? null;
  const title = sharingOnly ? 'Share' : 'Export';

  return (
    <Popover role="dialog" aria-label={title} open={open} anchorRef={anchorRef} onClose={onClose} placement={placement}>
      <PopoverHeader title={title} onClose={onClose} />
      <div className="ofk-v2-properties ofk-v2-export">
        {sharingOnly ? null : <>
        {/* The one export no other diagram tool has: a row of its own, not a footnote. */}
        <button type="button" className="ofk-v2-export-animate" aria-label="Animate this page…" disabled={pageEmpty}
          onClick={() => { onClose(); onOpenAnimation(); }}>
          <span className="ofk-v2-share-glyph" aria-hidden="true"><Icon icon={IconMovie} /></span>
          <span className="ofk-v2-share-text">
            <span className="ofk-v2-share-title">Animate this page</span>
            <span className="ofk-v2-share-detail">GIF, MP4, WebM or animated SVG</span>
          </span>
          <Icon icon={IconChevronRight} />
        </button>
        <Segmented<V2ExportFormat> label="Format" showLabel value={effectiveFormat} onChange={setFormat}
          options={effectiveScope === 'selection'
            ? FORMATS.map((option) => option.value === 'json'
              ? { ...option, disabled: true, title: 'JSON is the whole document' } : option)
            : FORMATS} />
        <Segmented<V2ExportScope> label="Pages" showLabel value={effectiveScope} onChange={setScope}
          options={[
            { value: 'selection', label: 'Selection', disabled: !hasSelection, title: 'Select shapes first' },
            { value: 'page', label: 'Page' },
            { value: 'document', label: 'All pages', title: effectiveFormat === 'pdf' ? 'One sheet per page' : 'One file per page' },
          ]} />
        <p className="ofk-caption ofk-v2-export-caption">{caption}</p>
        {effectiveFormat === 'png' ? (
          <Segmented<'1' | '2'> label="Size" showLabel value={scale === 2 ? '2' : '1'}
            onChange={(value) => setScale(value === '2' ? 2 : 1)}
            options={[{ value: '1', label: '1×' }, { value: '2', label: '2×' }]} />
        ) : null}
        {effectiveFormat !== 'json' ? (
          <Segmented<V2ExportTheme> label="Theme" showLabel value={theme} onChange={setTheme}
            options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'print', label: 'Print' }]} />
        ) : null}
        {effectiveFormat === 'png' || effectiveFormat === 'svg' ? (
          <Segmented<'opaque' | 'transparent'> label="Background" showLabel value={transparent ? 'transparent' : 'opaque'}
            onChange={(value) => setTransparent(value === 'transparent')}
            options={[
              { value: 'opaque', label: 'Canvas', title: 'Theme background' },
              { value: 'transparent', label: 'Transparent', title: 'No background rectangle' },
            ]} />
        ) : null}
        {effectiveFormat === 'json' ? (
          <label className="ofk-v2-export-option">
            <input type="checkbox" checked={includeComments} onChange={(event) => setIncludeComments(event.target.checked)} />
            <span>Include comments</span>
          </label>
        ) : null}
        <div className="ofk-v2-export-actions">
          <Button variant="primary" disabled={busy || empty} onClick={() => { void run('download'); }}>
            <Icon icon={IconDownload} /> {effectiveFormat === 'pdf' ? 'Print / PDF' : 'Download'}
          </Button>
        </div>
        <div className="ofk-v2-export-copies">
          {effectiveFormat === 'png' ? (
            <Button variant="secondary" disabled={busy || empty} onClick={() => { void run('copy-png'); }}>
              <Icon icon={IconPhoto} /> Copy PNG
            </Button>
          ) : null}
          <Tooltip content={mermaidReason || 'Copy the code diagram as Mermaid text (flowchart or sequence)'}>
            <Button variant="secondary" disabled={Boolean(mermaidReason)} onClick={() => { void copyMermaid(); }}>
              <Icon icon={IconCopy} /> Copy as Mermaid
            </Button>
          </Tooltip>
        </div>
        </>}
        {sharingOnly ? (
          <div className="ofk-v2-share">
            <div className="ofk-v2-share-kinds" role="radiogroup" aria-label="Kind of link">
              {linkKinds.map(({ value, icon, title, detail, available }) => (
                <label key={value} className="ofk-v2-share-kind" data-disabled={available ? undefined : 'true'}>
                  <input type="radio" name="ofk-share-kind" value={value} checked={kind === value} disabled={!available}
                    onChange={() => setLinkKind(value)} />
                  <span className="ofk-v2-share-glyph" aria-hidden="true"><Icon icon={icon} /></span>
                  <span className="ofk-v2-share-text">
                    <span className="ofk-v2-share-title">{title}</span>
                    <span className="ofk-v2-share-detail">{detail}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="ofk-v2-share-effect" aria-live="polite">
              {kind === 'snapshot' ? 'Viewers can look at every page and make their own copy, but never change yours.'
                : kind === 'code' ? `Opens “${frameName(mermaidTarget!)}” as their own copy to change. Copy again after you edit.`
                  : 'No link can be made here. Send the file instead; it opens in any browser.'}
            </p>
            {kind ? (
              <Button variant="primary" className="ofk-v2-share-copy" disabled={sharing !== null}
                aria-label={kind === 'code' ? 'Copy editable link' : 'Copy view-only link'}
                onClick={() => { void (kind === 'code' ? copyCodeLink() : copyShareLink()); }}>
                <Icon icon={IconLink} /> {sharing ? 'Working…' : 'Copy link'}
              </Button>
            ) : (
              <Button variant="primary" className="ofk-v2-share-copy"
                onClick={() => { void buildV2Export({ document: whole, format: 'json', scope: 'document', pageId }).then(downloadV2Export); }}>
                <Icon icon={IconDownload} /> Download file
              </Button>
            )}
            <div className="ofk-v2-share-foot">
              <a href="https://docs.openflowkit.com/share-links/" target="_blank" rel="noreferrer">How sharing works</a>
              {kind === 'snapshot' && latestLink ? (
                <Button variant="quiet" disabled={sharing !== null} onClick={() => { void deleteLink(); }}>
                  <Icon icon={IconLinkOff} /> Delete link
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </Popover>
  );
}

/** The JSON export request's thread option: comments reach the file only when the box is ticked. */
function jsonOptions(includeComments: boolean): { readonly includeThreads?: true } {
  return includeComments ? { includeThreads: true } : {};
}

function frameName(frame: SceneDocumentV1['pages'][number]['nodes'][number]): string {
  return (typeof frame.content.label === 'string' && frame.content.label) || dslFrameMeta(frame).title || `${dslFrameMeta(frame).family} diagram`;
}

