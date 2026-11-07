import { useCallback, useEffect, useMemo, type MutableRefObject, type RefObject } from 'react';
import { selectedFrameIds } from '../../application/ai/assistantContext';
import { agentDrawingRoute, drawingOf, drawingSourceOf } from '../../application/map/pinPage';
import type { useDocumentSession } from '../../application/session/useDocumentSession';
import { replaceSelection, type CanvasSelection } from '../../application/selection/selection';
import type { compileSource } from '../../../agent/compileSource';
import { dslFrames } from '../../../dsl/frameScene';
import type { DocumentCommand } from '../../domain/commands/types';
import type { LandingDirection } from '../../domain/camera/readableLanding';
import type { ScenePage } from '../../domain/document/types';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import { track, trackOnce } from '../../../services/usage/usage';
import type { ToastItem } from '../design-system';
import type { useV2MapMode } from './map/useV2MapMode';
import type { useV2Camera } from './useV2Camera';
import type { useV2DocumentLoad } from './useV2DocumentLoad';
import type { useV2Panels } from './useV2Panels';
import type { useV2Preferences } from './useV2Preferences';
import type { useV2Proposal } from './useV2Proposal';
import type { useV2RepoDocument } from './useV2RepoDocument';
import type { useV2CodeWorkspace } from './useV2CodeWorkspace';
import { useV2AgentBridge, useV2ConnectLink } from './useV2AgentBridge';
import { useV2AgentHost } from './useV2AgentHost';
import { useV2AgentPresence } from './useV2AgentPresence';
import { useV2AiSettings } from './useV2AiSettings';
import { useV2Assistant } from './useV2Assistant';
import { useV2WebMcp } from './useV2WebMcp';

interface EditorAgentsInput {
  readonly id: string | undefined;
  readonly session: ReturnType<typeof useDocumentSession>;
  readonly load: ReturnType<typeof useV2DocumentLoad>;
  readonly repo: ReturnType<typeof useV2RepoDocument>;
  readonly map: ReturnType<typeof useV2MapMode>;
  readonly panels: ReturnType<typeof useV2Panels>;
  readonly camera: ReturnType<typeof useV2Camera>;
  readonly code: ReturnType<typeof useV2CodeWorkspace>;
  readonly preferences: ReturnType<typeof useV2Preferences>['preferences'];
  readonly updatePreferences: ReturnType<typeof useV2Preferences>['updatePreferences'];
  readonly proposal: ReturnType<typeof useV2Proposal>;
  readonly compileDraft: (text: string) => ReturnType<typeof compileSource>;
  readonly page: ScenePage | null;
  readonly viewPage: ScenePage | null;
  readonly pageRef: RefObject<ScenePage | null>;
  readonly hostRef: RefObject<PixiRendererHost | null>;
  readonly selectionRef: RefObject<CanvasSelection>;
  readonly selectedConnectorIdsRef: RefObject<readonly string[]>;
  readonly selectionNodeIds: readonly string[];
  readonly applySelection: (selection: CanvasSelection) => void;
  readonly applyConnectorSelection: (connectorIds: readonly string[]) => void;
  readonly pinnable: boolean;
  readonly openDrawingRef: MutableRefObject<() => boolean>;
  readonly showDrawing: (pageId: string) => void;
  readonly setActivePageId: (pageId: string | null) => void;
  readonly writable: (command: DocumentCommand) => boolean;
  readonly landingDirection: () => LandingDirection;
  readonly toastZoomedToRead: () => void;
  readonly setAnnouncement: (message: string) => void;
  readonly pushToast: (toast: ToastItem) => void;
}

/** Local agent pairing and the in-page assistant: the MCP bridge, WebMCP, the cursor, and how an agent's change reaches the map's drawing. */
export function useV2EditorAgents(input: EditorAgentsInput) {
  const {
    id, session, load, repo, map, panels, camera, code, preferences, updatePreferences, proposal, compileDraft, page, viewPage, pageRef, hostRef,
    selectionRef, selectedConnectorIdsRef, selectionNodeIds, applySelection, applyConnectorSelection, pinnable, openDrawingRef, showDrawing,
    setActivePageId, writable, landingDirection, toastZoomedToRead, setAnnouncement, pushToast,
  } = input;
  const { openWorkspace } = panels;
  // Local agent pairing: the ops run here, against this session, through the
  // same registry the MCP server uses. Off until the user connects.
  const agentCapabilities = useV2AgentHost({ fitView: camera.fitView, autoIcons: preferences.autoIcons });
  const aiSettings = useV2AiSettings();
  const loadGrammar = useCallback(async () => String(await agentCapabilities.syntax()), [agentCapabilities]);
  const assistant = useV2Assistant({
    documentId: id ?? null, page, selectedIds: selectionNodeIds,
    settings: aiSettings.settings, proposal, loadGrammar,
    tools: { document: session.document, capabilities: agentCapabilities, compile: compileDraft },
    undo: session.undo, announce: setAnnouncement,
    // The committed page arrives next frame; land on what was drawn (a removal leaves the camera alone).
    onApplied: (nodeIds) => {
      track('ai_applied');
      // pageRef still holds the page from before this apply: a root it lacks is a diagram the assistant made.
      if (nodeIds.some((nodeId) => !pageRef.current?.nodes.some((node) => node.id === nodeId))) track('created_ai');
      requestAnimationFrame(() => {
        if (nodeIds.length && camera.landReadable(landingDirection(), nodeIds)) toastZoomedToRead();
      });
    },
  });
  const diagramCount = useMemo(() => (page ? dslFrames(page).length : 0), [page]);
  const selectedDiagramCount = useMemo(() => (page ? selectedFrameIds(page, selectionNodeIds).length : 0), [page, selectionNodeIds]);
  // --- F02 (2026-10-14): an agent's change for the repo map (read from the code, never written) ---
  // It lands on the map's drawing, opened the way Canvas opens it (made from the map on screen when there is none). With
  // none to open or make, the person is told what the agent tried and what to do; the agent gets the next step (liveOp).
  const agentOpenDrawing = (): boolean => {
    const document = session.document;
    const mapId = repo.lockedPageId;
    if (!document || !page || mapId === null) return false;
    const route = load.readOnly || repo.broken ? 'none' : agentDrawingRoute(document, mapId, page.id, pinnable);
    if (route === 'canvas') return openDrawingRef.current();
    if (route === 'switch') { setActivePageId(drawingOf(document, mapId)!.id); return true; }
    if (route === 'here') return true;
    const next = load.readOnly ? 'This shared map is read-only: Edit makes your own copy to draw on.'
      : repo.state.status === 'loading' ? 'The map is still being read. Once it is drawn, press Canvas and ask again.'
      : page.id === mapId ? 'There is no map to copy yet. Once it shows, press Canvas and ask again.'
      : 'Open the map and press Canvas, then ask again.';
    setAnnouncement(`${agentShown} tried to draw on the repo map. ${next}`);
    pushToast({ id: 'agent-repo-map', tone: 'info', title: `${agentShown} tried to draw on the repo map`, description: next });
    return false;
  };
  // A change for a page that is not on screen: that page first (a drawing from the map on screen, the way Canvas shows it).
  const agentShowPage = (pageId: string) => {
    const target = session.document?.pages.find((candidate) => candidate.id === pageId);
    if (!target || !page) return;
    if (map.active && drawingSourceOf(target) === page.id) showDrawing(pageId);
    else setActivePageId(pageId);
  };
  // --- end F02 ---
  // The live session both agent transports (the MCP bridge, WebMCP) run ops against, through runLiveAgentOp.
  const agentSession = {
    openDrawing: agentOpenDrawing, showPage: agentShowPage,
    readOnly: load.readOnly || repo.broken, lockedPageId: repo.lockedPageId,
    document: session.document,
    pageId: page?.id ?? null,
    capabilities: agentCapabilities,
    // false tells the agent its edit did not land (a locked page), instead of reporting it applied.
    commit: (command: DocumentCommand) => { if (!writable(command)) return false; session.commit(command); return true; },
    // Agent thread changes happen outside undo history.
    threadChange: session.updateThreads,
    onActivity: setAnnouncement,
    // An agent edit off-screen (or under the agent panel) lands readable, as the assistant's does; one in view stays put.
    // It waits for the renderer to draw the edit: a frame later the host often had no bounds for it yet.
    onApplied: (nodeIds: readonly string[]) => {
      // Agent presence: the change builds in under a named cursor (not on a map: it draws something else).
      if (!map.active) presence.arm();
      camera.revealWhenDrawn(landingDirection(), nodeIds, toastZoomedToRead);
    },
    // get_document reports what the person has selected, shapes and connectors.
    selectedIds: () => [...selectionRef.current.nodeIds, ...selectedConnectorIdsRef.current],
  };
  const agentBridge = useV2AgentBridge({
    ...agentSession,
    enabled: preferences.agentBridgeEnabled,
    port: preferences.bridgePort,
    token: preferences.bridgeToken,
    revision: session.revision,
    undoTopId: session.session?.history.past.at(-1)?.command.id ?? null,
  });
  // The tab the person just opened from the link takes the bridge, even from an older tab that was waiting too.
  useV2ConnectLink(() => { openWorkspace('agent'); updatePreferences({ agentBridgeEnabled: true }); agentBridge.claim(); });
  useEffect(() => { if (agentBridge.status === 'connected') trackOnce('agent_mcp'); }, [agentBridge.status]);
  // Opened by the person, not by a template drawing beside its source (that opens it without focus).
  useEffect(() => { if (panels.workspace === 'code' && code.panelFocus) track('code_opened'); }, [panels.workspace]); // eslint-disable-line react-hooks/exhaustive-deps
  // Agent presence: who is drawing, and the cursor that shows it on the canvas.
  const presence = useV2AgentPresence({ hostRef, cameraRef: camera.cameraRef, working: agentBridge.activity?.doing === 'drawing' });
  const agentShown = agentBridge.activity?.agent ?? agentBridge.agents[0] ?? 'Your agent';
  const webMcp = useV2WebMcp({
    ...agentSession,
    undoTopId: session.session?.history.past.at(-1)?.command.id ?? null,
    scene: viewPage, mode: map.mode,
    camera: () => camera.cameraRef.current,
    screenRect: (nodeId) => hostRef.current?.getNodeScreenBounds(nodeId) ?? null,
    viewport: () => hostRef.current?.getViewportSize() ?? { width: 0, height: 0 },
    // select: the agent points at shapes; a connector shows with its two ends.
    select: (nodeIds, connectorIds, reveal) => {
      applySelection(replaceSelection(nodeIds));
      applyConnectorSelection(connectorIds);
      const ends = (viewPage?.connectors ?? []).filter(({ id: connectorId }) => connectorIds.includes(connectorId))
        .flatMap(({ source, target }) => [source.nodeId, target.nodeId]).filter((nodeId): nodeId is string => typeof nodeId === 'string');
      if (reveal && nodeIds.length + ends.length) camera.revealNodes([...nodeIds, ...ends]);
    },
  });
  return { aiSettings, assistant, diagramCount, selectedDiagramCount, agentBridge, webMcp, presence, agentShown };
}
