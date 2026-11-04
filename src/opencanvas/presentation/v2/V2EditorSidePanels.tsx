import type { ComponentProps } from 'react';
import { C4_STARTER } from '../../../agent/starterTemplates';
import { placedElementId } from '../../../dsl/model/model';
import type { CanvasSelection } from '../../application/selection/selection';
import type { useDocumentSession } from '../../application/session/useDocumentSession';
import { inspectSelection } from '../../domain/scene/inspect';
import type { ScenePage } from '../../domain/document/types';
import { V2AgentConnect } from './V2AgentConnect';
import { V2CodePanel } from './V2CodePanel';
import { V2FlowPanel } from './V2FlowPanel';
import { V2InspectPanel } from './V2InspectPanel';
import { V2ModelPanel } from './V2ModelPanel';
import type { useV2ArchitectureActions } from './useV2ArchitectureActions';
import type { useV2Architecture } from './useV2Architecture';
import type { useV2Camera } from './useV2Camera';
import type { useV2CodeWorkspace } from './useV2CodeWorkspace';
import type { useV2EditorAgents } from './useV2EditorAgents';
import type { useV2FlowPlayback } from './useV2FlowPlayback';
import type { useV2Panels } from './useV2Panels';
import type { useV2Preferences } from './useV2Preferences';
import type { useV2RepoDocument, useV2RepoPanel } from './useV2RepoDocument';
import type { useV2Selection } from './useV2Selection';
import type { useV2WorkspaceFolder } from './useV2WorkspaceFolder';
import type { useV2MapMode } from './map/useV2MapMode';
import type { useV2Threads } from './useV2Threads';
import { V2ThreadsPanel } from './V2ThreadsPanel';
import type { ToastItem } from '../design-system';
import { counted } from './v2EditorUtil';

interface SidePanelsProps {
  readonly panels: ReturnType<typeof useV2Panels>;
  readonly code: ReturnType<typeof useV2CodeWorkspace>;
  readonly preferences: ReturnType<typeof useV2Preferences>['preferences'];
  readonly updatePreferences: ReturnType<typeof useV2Preferences>['updatePreferences'];
  readonly agents: ReturnType<typeof useV2EditorAgents>;
  readonly session: ReturnType<typeof useDocumentSession>;
  readonly viewPage: ScenePage;
  readonly selection: CanvasSelection;
  readonly selectedConnectorIds: readonly string[];
  readonly selectionApi: ReturnType<typeof useV2Selection>;
  readonly selectNodes: (nodeIds: readonly string[]) => void;
  readonly camera: ReturnType<typeof useV2Camera>;
  readonly architecture: ReturnType<typeof useV2Architecture>;
  readonly architectureActions: ReturnType<typeof useV2ArchitectureActions>;
  readonly playback: ReturnType<typeof useV2FlowPlayback>;
  readonly endFlow: () => void;
  readonly map: ReturnType<typeof useV2MapMode>;
  readonly repoPanel: ReturnType<typeof useV2RepoPanel>;
  readonly repoSource: ReturnType<typeof useV2RepoDocument>['source'];
  readonly repoLoading: boolean;
  readonly mapArrow: ComponentProps<typeof V2ModelPanel>['mapArrow'];
  readonly renameRequest: ComponentProps<typeof V2ModelPanel>['renameRequest'];
  readonly selectedElementId: string | null;
  readonly placedElementIds: ReadonlySet<string>;
  readonly canvasElementIds: ReadonlySet<string>;
  readonly showOnCanvas: (elementId: string) => void;
  readonly workspaceFolder: ReturnType<typeof useV2WorkspaceFolder>;
  readonly docReadOnly: boolean;
  readonly pushToast: (toast: ToastItem) => void;
  readonly setAnnouncement: (message: string) => void;
  readonly focusCanvas: () => void;
  readonly threads: ReturnType<typeof useV2Threads>;
}

/** The workspace panels on the right: code, agent pairing, inspect, model and the flow player. */
export function V2EditorSidePanels(p: SidePanelsProps): React.JSX.Element {
  const {
    panels, code, preferences, updatePreferences, agents, session, viewPage, selection, selectedConnectorIds, selectionApi, selectNodes, camera,
    architecture, architectureActions, playback, map, repoPanel, repoSource, repoLoading, selectedElementId, workspaceFolder, docReadOnly, pushToast,
  } = p;
  const { agentBridge, webMcp } = agents;
  const openWorkspace = panels.openWorkspace;
  return (
    <>
      {panels.workspace === 'code' ? <V2CodePanel code={code.draft} palette={preferences.diagramPalette} autoFocus={code.panelFocus} selectAll={code.panelSelect}
        onPaletteChange={(diagramPalette) => updatePreferences({ diagramPalette })}
        onCodeChange={code.edit}
        diagnostics={code.diagnostics} generating={code.generating} canvasEdited={code.canvasEdited}
        {...(code.foreign ? { convertFrom: code.foreign } : {})}
        onGenerate={() => {
          // Regenerating a bound diagram is an edit, not a new one.
          const fresh = code.frameId === null;
          void code.generate().then((committed) => { if (fresh) counted('created_code')(committed); });
        }} onClose={() => { code.cancel(); panels.closeWorkspace(); }} /> : null}
      {panels.workspace === 'agent' ? <V2AgentConnect status={agentBridge.status} detail={agentBridge.detail}
        activity={agentBridge.activity} agents={agentBridge.agents} onUndo={session.undo} webMcpTools={webMcp.tools} webMcpActivity={webMcp.activity}
        port={preferences.bridgePort} token={preferences.bridgeToken}
        onPortChange={(bridgePort) => updatePreferences({ bridgePort })}
        onTokenChange={(bridgeToken) => updatePreferences({ bridgeToken })}
        onToggle={(connect) => updatePreferences({ agentBridgeEnabled: connect })} onClaim={agentBridge.claim}
        onClose={panels.closeWorkspace} /> : null}
      {panels.workspace === 'threads' ? (
        <V2ThreadsPanel entries={p.threads.entries} total={p.threads.total} unread={p.threads.unread} selectedId={p.threads.openThreadId}
          query={p.threads.query} onQuery={p.threads.setQuery} filters={p.threads.filters} onFilters={p.threads.setFilters}
          readOnly={docReadOnly} focusOnOpen={!p.threads.quiet}
          onSelect={(threadId) => { p.threads.select(threadId); }} onToggleResolved={p.threads.toggleResolved}
          onMarkRead={p.threads.markRead} onMarkUnread={p.threads.markUnread} onCopyLink={p.threads.copyLink} onDelete={p.threads.remove}
          onClose={() => { panels.closeWorkspace(); p.focusCanvas(); }} />
      ) : null}
      {panels.workspace === 'inspect' ? (
        <V2InspectPanel report={inspectSelection(viewPage, selection.nodeIds, selectedConnectorIds)}
          onClose={() => { panels.closeWorkspace(); p.focusCanvas(); }}
          onSelectNode={(nodeId) => {
            selectNodes([nodeId]);
            camera.glideToNodes([nodeId]);
          }}
          onShowCode={code.openFrame}
          onOpenModel={() => openWorkspace('model')} />
      ) : null}
      {panels.workspace === 'model' ? (
        <V2ModelPanel
          onOpenCode={() => openWorkspace('code')}
          onCreateWorkspace={() => { void code.startFrom(C4_STARTER, { openPanel: false }).then(counted('created_template')); }}
          architecture={architecture}
          elementPageIds={new Map(session.document!.pages.flatMap((candidate) => candidate.nodes.flatMap((node) => {
            const elementId = placedElementId(node);
            return elementId ? [[elementId, candidate.id] as const] : [];
          })))}
          selectedElementId={selectedElementId}
          renameRequest={p.renameRequest}
          mapArrow={p.mapArrow}
          {...(repoPanel.box ? { mapBox: repoPanel.box } : {})}
          {...(map.active && map.model ? { mapOverview: { model: map.model, arch: map.arch, onSelect: map.reveal, reading: repoSource !== null && repoLoading } } : {})}
          placedElementIds={p.placedElementIds}
          perspectiveTags={preferences.perspectiveTags}
          onPerspectiveChange={(tags) => updatePreferences({ perspectiveTags: [...tags] })}
          onNavigate={(crumb) => architectureActions.openCrumb(crumb)}
          onDrillInto={architectureActions.drillInto}
          onCreateChildView={(elementId) => {
            void architectureActions.createChildView(elementId).catch((error: unknown) => pushToast({
              id: 'create-c4-view', tone: 'danger', title: error instanceof Error ? error.message : 'Couldn’t create the view',
            }));
          }}
          onSelectElement={(elementId) => {
            const node = viewPage.nodes.find((candidate) => placedElementId(candidate) === elementId);
            if (node) {
              selectNodes([node.id]);
              camera.glideToNodes([node.id]);
              return;
            }
            selectNodes([]);
            p.setAnnouncement('Inspecting an element outside the current view.');
          }}
          onClearSelection={() => selectionApi.clearAll()}
          {...(map.available && !map.active && !repoSource ? { onOpenInMap: (id: string) => { map.enterMapAt(id); } } : {})}
          {...(map.active && !repoSource ? { onShowOnCanvas: p.showOnCanvas, canvasElementIds: p.canvasElementIds } : {})}
          onEditElement={architectureActions.editElement}
          onRemoveElement={architectureActions.removeElement}
          onAddElement={architectureActions.addElement}
          onAddToView={(id) => {
            void architectureActions.addToView(id).catch((error: unknown) => pushToast({
              id: 'add-to-view', tone: 'danger', title: error instanceof Error ? error.message : 'Couldn’t add it to this view',
            }));
          }}
          onCreateFlow={architectureActions.createFlow}
          onPlayFlow={playback.open}
          onClose={panels.closeWorkspace}
          readOnly={docReadOnly}
          adrs={workspaceFolder.adrs}
        />
      ) : null}
      {playback.flow ? (
        <V2FlowPanel
          model={architecture.model}
          playback={playback}
          onClose={p.endFlow}
          onCopy={(kind) => {
            if (kind === 'sequence') { void architectureActions.openFlowAsSequence(playback.flow!); return; }
            const text = playback.exportText(kind);
            if (!text) return;
            void navigator.clipboard?.writeText(text).then(
              () => pushToast({ id: `flow-${kind}`, tone: 'success', title: `${kind === 'mermaid' ? 'Mermaid' : 'PlantUML'} copied` }),
              () => pushToast({ id: `flow-${kind}`, tone: 'danger', title: 'Couldn’t copy', description: 'This browser blocked the clipboard.' }),
            );
          }}
        />
      ) : null}
    </>
  );
}
