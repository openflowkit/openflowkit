// The diagram-as-code panel: its draft, the frame it is bound to, and Generate,
// which compiles the draft and commits it as one undo step.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { detectForeign } from '../../../agent/lint';
import type { DslDiagnostic } from '../../../dsl/ast';
import { DSL_FAMILIES } from '../../../dsl/ast';
import { compileWorkspace } from '../../../dsl/compile';
import { MAX_DSL_LINES } from '../../../dsl/tokenize';
import { architectureWorkspaceText } from '../../../dsl/families/architecture/text';
import { dslFrames, frameEdited, frameScene, frameSource } from '../../../dsl/frameScene';
import { archModelOfPage } from '../../../dsl/model/model';
import { parse } from '../../../dsl/parse';
import { dslFrameRaw } from '../../../dsl/sceneMeta';
import { elkDslLayoutPort } from '../../../services/elk-layout/runtime';
import { resolveDslIcon } from '../../../services/dsl/iconResolver';
import { applySnapsToWorkspace, type WorkspaceSnap } from '../../../services/workspace/workspaceFolder';
import { buildWorkspacePagesCommand, firstViewLanding } from '../../application/dsl/architectureCommands';
import { buildDslPageCommand, nameUntitledDocument, nextDslFrameOrigin } from '../../application/dsl/dslPageCommand';
import { buildAutoIconsOffCommand, hasAutoIcon } from '../../application/dsl/iconCommands';
import { replaceSelection, type CanvasSelection } from '../../application/selection/selection';
import type { DocumentCommand } from '../../domain/commands/types';
import type { SceneDocumentV1, ScenePage } from '../../domain/document/types';
import { isDiagramPalette, type DiagramPaletteName } from '../../domain/nodes/nodePalette';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import type { ToastItem } from '../design-system';
import { mintV2Id } from './v2Document';
import { INITIAL_CODE } from './V2Workspace';

interface V2CodeWorkspaceOptions {
  readonly document: SceneDocumentV1 | null;
  readonly page: ScenePage | null;
  readonly pageRef: RefObject<ScenePage | null>;
  readonly hostRef: RefObject<PixiRendererHost | null>;
  readonly readOnly: boolean;
  readonly palette: DiagramPaletteName;
  readonly autoIcons: boolean;
  /** A frame authored in another palette switches the picker to it. */
  readonly onPaletteChange: (palette: DiagramPaletteName) => void;
  readonly commit: (command: DocumentCommand) => void;
  readonly applySelection: (selection: CanvasSelection) => void;
  readonly fitView: (ids?: readonly string[]) => void;
  readonly openPanel: () => void;
  /** A C4 workspace generated several views; land on the first one's page once it exists. */
  readonly onViews: (pageId: string) => void;
  readonly pushToast: (toast: ToastItem) => void;
  readonly dismissToast: (id: string) => void;
  readonly announce: (message: string) => void;
  /** A template lands with the canvas focused, so keys act on the diagram, not the source. */
  readonly focusCanvas?: () => void;
  /** A template that starts a document is its first state: nothing to undo back to "Untitled". */
  readonly forgetHistory?: () => void;
}

// Below this a phone: the source would cover the diagram it just drew.
const PHONE_PX = 768;

type Foreign = NonNullable<ReturnType<typeof detectForeign>>;

/** A converter that throws (a pathological input) reports like one that returns an error. */
function convertSafely(foreign: Foreign, text: string): ReturnType<Foreign['convert']> {
  try { return foreign.convert(text); } catch (error) {
    return { error: error instanceof Error ? error.message : 'Couldn’t convert this text' };
  }
}

/** Text the code panel can draw: Mermaid, Structurizr, D2, or OpenFlowKit source (a family line, then more). */
export function looksLikeDiagramCode(text: string): boolean {
  if (detectForeign(text)) return true;
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line && !/^(?:%%|\/\/|#)/.test(line));
  return lines.length > 1 && (DSL_FAMILIES as readonly string[]).includes(lines[0]!.split(/\s+/)[0]!);
}

/** "Flowchart: Start here" — the diagram kind and its first node's label, short. */
function pastedName(result: { readonly meta: { readonly family: string }; readonly nodes: readonly { readonly content: Record<string, unknown> }[] }): string {
  const kind = result.meta.family.charAt(0).toUpperCase() + result.meta.family.slice(1);
  const first = result.nodes.map((node) => node.content.label).find((label): label is string => typeof label === 'string' && label.trim() !== '');
  if (!first) return kind;
  const label = first.replace(/\s+/g, ' ').trim();
  return `${kind}: ${label.length > 28 ? `${label.slice(0, 27)}…` : label}`;
}

export function useV2CodeWorkspace(options: V2CodeWorkspaceOptions) {
  const {
    document, page, pageRef, hostRef, readOnly, palette, autoIcons, onPaletteChange,
    commit, applySelection, fitView, openPanel, onViews, pushToast, dismissToast, announce, focusCanvas, forgetHistory,
  } = options;
  const [draft, setDraft] = useState(INITIAL_CODE);
  // The frame Generate replaces; null draws a new diagram.
  const [frameId, setFrameId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  // False while the panel was opened by a template beside its diagram (not asked for): it leaves focus on the canvas.
  const [panelFocus, setPanelFocus] = useState(true);
  // Only a new diagram's source opens selected (paste replaces the sample); a diagram's own source never does.
  const [panelSelect, setPanelSelect] = useState(true);
  const [compileDiagnostics, setCompileDiagnostics] = useState<readonly DslDiagnostic[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // The icons toast speaks for one Generate: the next one dismisses it, so it never sits over a diagram it says nothing about.
  const iconToastRef = useRef<string | null>(null);
  // The text last generated as a workspace. While the draft still equals it, the draft
  // follows the model (views, flows, relationships made outside the panel), so Generate
  // from an untouched draft never undoes them. Text the user typed is never replaced.
  const workspaceTextRef = useRef<string | null>(null);
  useEffect(() => {
    if (draft !== workspaceTextRef.current) return;
    const model = page ? archModelOfPage(page) : null;
    const text = model ? architectureWorkspaceText(model) : null;
    if (!text || text === draft) return;
    workspaceTextRef.current = text;
    setDraft(text);
  }, [page, draft]);

  // Mermaid, Structurizr or D2 in the panel converts in place.
  const foreign = useMemo(() => detectForeign(draft), [draft]);
  const diagnostics = useMemo(() => {
    // compile() re-parses, so dedupe the live parse pass against the last generate. Foreign text skips
    // the OpenFlowKit parse (it describes a language nobody wrote) but keeps what a conversion reported.
    const seen = new Set<string>();
    return [...(foreign ? [] : parse(draft).diagnostics), ...compileDiagnostics].filter((item) => {
      const key = `${item.code}:${item.line}:${item.col}:${item.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [draft, foreign, compileDiagnostics]);
  const convertForeign = useCallback(() => {
    if (!foreign) return;
    const conversion = convertSafely(foreign, draft);
    if ('error' in conversion) {
      setCompileDiagnostics([{ code: 'E003', severity: 'error', line: 1, col: 1, endCol: 1, message: conversion.error, source: 'parse' }]);
      return;
    }
    // A line the converter could not read (E004) keeps the source text, so its line numbers still point at it.
    setCompileDiagnostics(conversion.diagnostics);
    if (conversion.diagnostics.some((item) => item.severity === 'error')) {
      announce(`${foreign.label} not converted: fix the marked lines first.`);
      return;
    }
    setDraft(conversion.dsl);
    announce(`${foreign.label} converted${conversion.losses.length ? `. Not kept: ${conversion.losses.join('; ')}` : ''}.`);
  }, [draft, foreign, announce]);
  const canvasEdited = useMemo(() => {
    const scene = page && frameId ? frameScene(page, frameId) : null;
    return scene ? frameEdited(scene) : false;
  }, [page, frameId]);

  const edit = useCallback((text: string) => {
    setDraft(text);
    setCompileDiagnostics([]);
  }, []);
  /** Opens the panel on a new diagram rather than the last bound frame. */
  const openNew = useCallback(() => {
    setFrameId(null);
    setPanelFocus(true);
    setPanelSelect(true);
    openPanel();
  }, [openPanel]);
  const openFrame = useCallback((id: string, reveal = true) => {
    const scene = pageRef.current ? frameScene(pageRef.current, id) : null;
    if (!scene) return;
    const metadata = dslFrameRaw(scene.frame);
    // frameSource, not frameText: the picker below shows the palette, and an `appearance:` line in the editor would override it.
    const source = frameSource(scene);
    // The picker follows the frame's authored palette so re-theming is explicit.
    const authored = (metadata.appearance as { palette?: unknown } | undefined)?.palette;
    if (isDiagramPalette(authored) && authored !== palette) onPaletteChange(authored);
    setDraft(source);
    setFrameId(id);
    if (!reveal) return;
    setPanelFocus(true);
    setPanelSelect(false);
    openPanel();
  }, [pageRef, palette, onPaletteChange, openPanel]);

  // The panel follows the page on screen: a frame bound on the page just left is not this page's, so it shows this page's own
  // diagram, or (none) starts over as a new diagram. Generate must never rewrite a page the user is not on.
  const lastPageId = useRef(page?.id);
  useEffect(() => {
    if (!page || lastPageId.current === page.id) return;
    lastPageId.current = page.id;
    if (frameId && page.nodes.some((node) => node.id === frameId)) return;
    // A draft typed for a new diagram stays; a bound frame's source, or the untouched sample, belongs to a page.
    if (!frameId && draft !== INITIAL_CODE) return;
    const frames = dslFrames(page);
    if (frames.length === 1) openFrame(frames[0]!.id, false);
    else { setFrameId(null); setDraft(INITIAL_CODE); }
  }, [page, frameId, draft, openFrame]);

  // A new diagram is fitted once the renderer has its frame; regenerating keeps the camera.
  const [fitFrameId, setFitFrameId] = useState<string | null>(null);
  useEffect(() => {
    if (!fitFrameId || !hostRef.current?.getContentBounds([fitFrameId])) return;
    setFitFrameId(null);
    fitView([fitFrameId]);
  }, [fitFrameId, page, hostRef, fitView]);

  const offerIconRemoval = useCallback((targetId: string, inferred: number) => {
    // Said once per diagram, when it is drawn: what the compiler added, with the way out beside it.
    if (!inferred) return;
    const toastId = `auto-icons-${targetId}`;
    iconToastRef.current = toastId;
    pushToast({
      id: toastId, tone: 'info',
      title: `${inferred} ${inferred === 1 ? 'icon' : 'icons'} added from labels`,
      description: 'Right-click a node to remove one, or turn this off in Settings.',
      action: { label: inferred === 1 ? 'Remove' : 'Remove all', onClick: () => {
        dismissToast(toastId);
        const off = pageRef.current ? buildAutoIconsOffCommand(pageRef.current, targetId) : null;
        if (off) commit(off);
      } },
    });
  }, [pushToast, dismissToast, pageRef, commit]);

  /** Compiles `text` (the draft by default) into `target`, the bound frame unless a new diagram is asked for. True when it committed. */
  const generate = useCallback(async (text?: string, snaps?: Readonly<Record<string, WorkspaceSnap>>, target = frameId, quiet = false): Promise<boolean> => {
    const currentPage = pageRef.current;
    if (!currentPage || !document || readOnly || generating) return false;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (iconToastRef.current) { dismissToast(iconToastRef.current); iconToastRef.current = null; }
    setGenerating(true);
    try {
      // Mermaid, Structurizr or D2 converts first: compiled as DSL it parses into one node per line.
      const written = text ?? draft;
      const foreignSource = detectForeign(written);
      const attempt = foreignSource ? convertSafely(foreignSource, written) : undefined;
      if (attempt && 'error' in attempt) {
        setCompileDiagnostics([{ code: 'E003', severity: 'error', line: 1, col: 1, endCol: 1, message: attempt.error, source: 'parse' }]);
        return false;
      }
      const conversion = attempt && 'dsl' in attempt ? attempt : undefined;
      if (conversion?.diagnostics.some((item) => item.severity === 'error')) {
        setCompileDiagnostics(conversion.diagnostics);
        return false;
      }
      const source = conversion ? conversion.dsl : written;
      // The tokenizer drops every line past the cap: committing would draw the nodes that fit and none of the connectors after them.
      const lineCount = source.split('\n').length;
      if (lineCount > MAX_DSL_LINES) {
        setCompileDiagnostics([{ code: 'E002', severity: 'error', line: 1, col: 1, endCol: 1, message: `Too big: ${lineCount.toLocaleString('en-US')} lines, the limit is ${MAX_DSL_LINES.toLocaleString('en-US')}`, source: 'parse' }]);
        return false;
      }
      if (conversion) setDraft(source);
      // Generate only writes the page on screen: a frame bound on another page is not this page's to replace.
      const bound = target ? currentPage.nodes.find((node) => node.id === target) : undefined;
      if (!bound) target = null;
      const compiled = await compileWorkspace(source, {
        origin: bound?.transform.translation ?? nextDslFrameOrigin(currentPage),
        layout: elkDslLayoutPort, signal: controller.signal, resolveIcon: resolveDslIcon,
        // Panel defaults: an authored `appearance:` or `icons:` line wins.
        appearance: { palette }, autoIcons,
      });
      // Saved layout overrides win over ELK for the elements they name.
      const workspace = snaps ? applySnapsToWorkspace(compiled, snaps) : compiled;
      const compiledPrimary = workspace.views[0]!.result;
      // A pasted diagram without a title names its frame after what it is, not "Frame".
      const primary = foreignSource?.from === 'mermaid' && !compiledPrimary.meta.title && !compiledPrimary.frame.content.label
        ? { ...compiledPrimary, frame: { ...compiledPrimary.frame, content: { ...compiledPrimary.frame.content, label: pastedName(compiledPrimary) } } }
        : compiledPrimary;
      setCompileDiagnostics([...(conversion?.diagnostics ?? []), ...primary.diagnostics]);
      if (workspace.views.length > 1 || workspace.views[0]!.viewId.startsWith('view:')) {
        // A C4 workspace: one page per view, all pages in one undo step.
        const command = buildWorkspacePagesCommand(document, workspace, {
          mintId: mintV2Id, intoPageId: currentPage.id, ...(target ? { replaceFrameId: target } : {}),
        });
        if (command) commit(nameUntitledDocument(document, command, primary.meta.title));
        // Bad lines stay in the panel as written, so the typo can be fixed; only a clean text follows the model.
        workspaceTextRef.current = primary.diagnostics.some((item) => item.severity !== 'info') ? null : source;
        setFrameId(null);
        // Regenerating from one of its view pages stays on that page; else land on the first view.
        const first = firstViewLanding(document, workspace, command, target ?? undefined, currentPage.id);
        if (first) {
          onViews(first.pageId);
          // The first view may have taken the page the user is on: no page switch to fit it.
          if (!target) setFitFrameId(first.frameId);
        }
        announce(workspace.views.length === 1 ? 'Generated 1 view.' : `Generated ${workspace.views.length} views. Every element is shared across them.`);
        return Boolean(command);
      }
      const command = buildDslPageCommand(currentPage, primary, target ?? undefined);
      if (command) commit(nameUntitledDocument(document, command, primary.meta.title));
      const targetId = target ?? primary.frame.id;
      // A template or import was asked for as it is: no note about icons it carries. A regenerate is not news either.
      if (!target && !quiet) offerIconRemoval(targetId, primary.nodes.filter(hasAutoIcon).length);
      // A new diagram lands where the user can see it; regenerating keeps their camera.
      if (!target) setFitFrameId(targetId);
      setFrameId(targetId);
      applySelection(replaceSelection([targetId]));
      announce(`${primary.nodes.length} nodes generated${primary.diagnostics.some((item) => item.severity !== 'info') ? ' with diagnostics' : ''}.`);
      return Boolean(command);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        pushToast({ id: `dsl-${Date.now()}`, tone: 'danger', title: error instanceof Error ? error.message : 'Couldn’t generate the diagram' });
      }
      return false;
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setGenerating(false); }
    }
  }, [pageRef, document, readOnly, generating, frameId, draft, palette, autoIcons, commit, onViews, announce, offerIconRemoval, applySelection, pushToast, dismissToast]);

  /** One template path for the canvas welcome, home's cards and the starter gallery. The Model panel's own button keeps itself open (`openPanel: false`). True once drawn. */
  const startFrom = useCallback((dsl: string, { openPanel: showPanel = true, baseline = false }: { openPanel?: boolean; baseline?: boolean } = {}): Promise<boolean> => {
    setFrameId(null);
    setDraft(dsl);
    if (showPanel) {
      focusCanvas?.();
      if (window.innerWidth >= PHONE_PX) { setPanelFocus(false); openPanel(); }
    }
    // A skipped generate committed nothing: the undo it would have replaced stays.
    // A template opens on the diagram, not on a selected frame with its style bar over it (J11).
    return generate(dsl, undefined, null, baseline).then((committed) => {
      if (baseline && committed) {
        forgetHistory?.();
        applySelection(replaceSelection([]));
      }
      return committed;
    });
  }, [openPanel, generate, focusCanvas, forgetHistory, applySelection]);
  /** Writes the draft for a new diagram without opening the panel (the motion chips). */
  const writeNew = useCallback((update: (current: string) => string) => {
    setDraft(update);
    setFrameId(null);
  }, []);
  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return {
    /** The diagram Generate replaces; null draws a new one. */
    frameId,
    draft, setDraft, edit, writeNew, generating, diagnostics, canvasEdited, panelFocus, panelSelect,
    foreign: foreign ? { label: foreign.label, convert: convertForeign } : null,
    openNew, openFrame, generate, startFrom, cancel,
  };
}
