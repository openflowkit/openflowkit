import type { SceneDocumentV1 } from '../../domain/document/types';
import { exportCanonicalSvg, SVG_BACKGROUND } from '../../infrastructure/export/canonicalSvg';
import { serializeCanonicalJson } from '../../infrastructure/export/canonicalJson';
import { printSvgDocument } from '../../infrastructure/export/print';
import { rasterizeSvgToPng, withEmbeddedInter } from '../../infrastructure/export/raster';
import { readRawV2Records } from '../../../services/storage/v2/v2Repository';
import { loadIconArt } from './v2IconArt';

export type V2ExportFormat = 'png' | 'svg' | 'pdf' | 'json';
export type V2ExportScope = 'selection' | 'page' | 'document';
export type V2ExportTheme = 'light' | 'dark' | 'print';

interface V2ExportRequest {
  readonly document: SceneDocumentV1;
  readonly format: V2ExportFormat;
  readonly scope: V2ExportScope;
  readonly pageId: string;
  readonly selectedNodeIds?: readonly string[];
  /** An element export of connections: drawn without their endpoints. */
  readonly selectedConnectorIds?: readonly string[];
  readonly theme?: V2ExportTheme;
  /** Pixel multiplier baked into the emitted file (PNG and SVG alike). */
  readonly scale?: 1 | 2 | 3;
  readonly transparent?: boolean;
  /** JSON only: comment threads go in the file (off by default; they carry names and private conversation). */
  readonly includeThreads?: boolean;
}

export interface V2ExportFile {
  readonly filename: string;
  readonly mime: string;
  readonly text?: string;
  readonly bytes?: Uint8Array;
}

/** Filename-safe: letters and digits of any script stay (accents folded away), the rest becomes one dash. */
export function slug(value: string, fallback: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || fallback;
}

/** A lone element names the file: its label, else its kind (`rect-1` stays unique enough). */
function selectionStem(request: V2ExportRequest, page: SceneDocumentV1['pages'][number] | undefined): string {
  const nodeIds = request.selectedNodeIds ?? [];
  const connectorIds = request.selectedConnectorIds ?? [];
  if (nodeIds.length === 1 && connectorIds.length === 0) {
    const node = page?.nodes.find(({ id }) => id === nodeIds[0]);
    const label = typeof node?.content.label === 'string' ? node.content.label : '';
    return slug(label, node?.kind ?? 'element');
  }
  if (connectorIds.length === 1 && nodeIds.length === 0) {
    const connector = page?.connectors.find(({ id }) => id === connectorIds[0]);
    return slug(connector?.labels[0]?.text ?? '', 'connection');
  }
  return 'selection';
}

/**
 * The page a page/selection export draws. No page id means the first page (an agent that did not say); a page id that is
 * not in the document is an error, never a quiet export of page 1 under another page's name.
 */
function requestedPage(request: V2ExportRequest): SceneDocumentV1['pages'][number] {
  const page = request.pageId ? request.document.pages.find(({ id }) => id === request.pageId) : request.document.pages[0];
  if (!page) throw new RangeError(request.pageId ? 'The page to export is no longer in this document.' : 'Export requires at least one page.');
  return page;
}

function fileStem(request: V2ExportRequest): string {
  const base = slug(request.document.name, 'diagram');
  // JSON holds every page whatever the scope says; the file should say so.
  if (request.scope === 'document' || request.format === 'json') return `${base}-document`;
  const page = requestedPage(request);
  if (request.scope === 'selection') return `${base}-${selectionStem(request, page)}`;
  return pageStem(base, slug(page.name, page.id));
}

/** The document and page names, said once each: a repo map's page repeats the repo (`acme-shop` + `shop`, or `acme-shop-drawing`). */
function pageStem(base: string, page: string): string {
  if (base === page || base.endsWith(`-${page}`)) return base;
  return page.startsWith(`${base}-`) ? page : `${base}-${page}`;
}

/** Pages an export touches: one for page/selection scope, every page with something on it for document scope. */
function exportPages(request: V2ExportRequest) {
  const drawn = request.document.pages.filter((page) => page.nodes.length + page.connectors.length > 0);
  if (request.scope === 'document' && drawn.length > 0) return drawn;
  return [requestedPage(request)];
}

function svgFor(request: V2ExportRequest, pageId: string, scale: number, iconArt: Readonly<Record<string, string>>): string {
  const selection = request.scope === 'selection';
  return exportCanonicalSvg(request.document, {
    pageId,
    iconArt,
    // Selection is strict: an empty list draws nothing and says so, rather
    // than silently widening to the page.
    ...(selection ? { selectedNodeIds: request.selectedNodeIds ?? [] } : {}),
    ...(selection && request.selectedConnectorIds?.length
      ? { selectedConnectorIds: request.selectedConnectorIds }
      : {}),
    theme: request.theme ?? 'light',
    pixelRatio: scale,
    ...(request.transparent ? { transparent: true } : {}),
  });
}

/**
 * One export intent → files ready to hand to the platform. SVG, PDF (print
 * HTML) and JSON are text; PNG is rasterized from the same SVG, so every format
 * shares one source of truth. Document scope yields one file per page.
 */
export async function buildV2Export(request: V2ExportRequest): Promise<readonly V2ExportFile[]> {
  if (request.format === 'pdf') return [];
  const stem = fileStem(request);
  if (request.format === 'json') {
    return [{ filename: `${stem}.json`, mime: 'application/json', text: serializeCanonicalJson(request.document, { includeThreads: request.includeThreads === true }) }];
  }
  const pages = exportPages(request);
  const scale = request.scale ?? 1;
  const iconArt = await loadIconArt(request.document);
  const files: V2ExportFile[] = [];
  const taken = new Set<string>();
  for (const [index, page] of pages.entries()) {
    let name = stem;
    if (pages.length > 1) {
      // Each page is named as its own page export would be; a second page of the same name keeps its place number.
      name = pageStem(slug(request.document.name, 'diagram'), slug(page.name, page.id));
      if (taken.has(name)) name = `${name}-${index + 1}`;
      taken.add(name);
    }
    const svg = svgFor(request, page.id, scale, iconArt);
    if (request.format === 'svg') {
      // A saved SVG is often shown through <img> (READMEs, docs), which cannot see web fonts.
      files.push({ filename: `${name}.svg`, mime: 'image/svg+xml', text: await withEmbeddedInter(svg) });
      continue;
    }
    const bytes = await rasterizeSvgToPng(svg, {
      scale: 1,
      ...(request.transparent ? {} : { background: request.theme === 'dark' ? SVG_BACKGROUND.dark : SVG_BACKGROUND.light }),
    });
    files.push({ filename: `${name}.png`, mime: 'image/png', bytes });
  }
  return files;
}

/** PDF is the browser's print dialog over the same SVGs the other formats use, one page per sheet. */
export async function printV2Export(request: V2ExportRequest): Promise<void> {
  const iconArt = await loadIconArt(request.document);
  const svgs = await Promise.all(exportPages(request).map((page) => withEmbeddedInter(svgFor(request, page.id, 1, iconArt))));
  printSvgDocument(svgs, request.document.name, { theme: request.theme ?? 'light' });
}

/** Base64 for the wire (agent bridge / MCP JSON results); chunked for big PNGs. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return window.btoa(binary);
}

export function downloadV2Export(files: readonly V2ExportFile[]): void {
  files.forEach((file, index) => {
    // Stagger downloads so browsers that ignore multiple saves still queue them.
    window.setTimeout(() => {
      const blob = file.bytes
        ? new Blob([file.bytes as BlobPart], { type: file.mime })
        : new Blob([file.text ?? ''], { type: `${file.mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, index * 150);
  });
}

export function downloadTextFile(filename: string, text: string, mime: string): void {
  downloadV2Export([{ filename, mime, text }]);
}

/**
 * Copy an image artefact to the system clipboard; false when the API is missing or refuses.
 * The ClipboardItem is made before `bytes` resolves (call this inside the click, not after an await):
 * Safari only honours the clipboard write while the user gesture is still live.
 */
export async function copyImageToClipboard(bytes: Promise<Uint8Array>, mime: string): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ [mime]: bytes.then((data) => new Blob([data as BlobPart], { type: mime })) })]);
    return true;
  } catch {
    return false;
  }
}

export function buildV2SvgExport(document: SceneDocumentV1): { filename: string; svg: string } {
  return { filename: `${document.id}.svg`, svg: exportCanonicalSvg(document) };
}

export function buildV2JsonExport(document: SceneDocumentV1, options: { readonly includeThreads?: boolean } = {}): { filename: string; json: string } {
  return { filename: `${document.id}.json`, json: serializeCanonicalJson(document, options) };
}

/** A damaged diagram is still the person's data: both stored copies, exactly as they are. A failed read downloads nothing. */
export function downloadRawRecords(id: string, suffix: string): void {
  void readRawV2Records(window.indexedDB, id)
    .then((raw) => downloadTextFile(`${id}-${suffix}.json`, JSON.stringify(raw, null, 2), 'application/json'), () => undefined);
}
