import type { ComponentProps, MutableRefObject, ReactNode, RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { C4_STARTER } from '../../../agent/starterTemplates';
import type { CanvasSelection } from '../../application/selection/selection';
import type { DocumentCommand } from '../../domain/commands/types';
import type { ScenePage } from '../../domain/document/types';
import type { PixiRendererHost, PixiRendererStatus } from '../../infrastructure/pixi/PixiRendererHost';
import { EmptyState, Button, ErrorState } from '../design-system';
import { V2CanvasHost } from './V2CanvasHost';
import type { V2Tool } from './V2CreationToolbar';
import { V2StateHero } from './V2StateHero';
import { mapRepoPath, V2MapStart } from './map/V2MapStart';
import { V2RepoMapOverlay } from './map/V2RepoMapState';
import type { useV2MapMode } from './map/useV2MapMode';
import type { useV2Camera } from './useV2Camera';
import type { useV2CodeWorkspace } from './useV2CodeWorkspace';
import type { useV2ConnectorLabelEditing } from './useV2ConnectorLabelEditing';
import type { useV2IconActions } from './useV2IconActions';
import type { useV2LabelEditing } from './useV2LabelEditing';
import type { useV2Panels } from './useV2Panels';
import type { useV2RepoDocument } from './useV2RepoDocument';
import type { V2ToolConfig } from './v2ToolCatalog';
import type { V2GestureApi } from './v2PointerGestures';
import { mintV2Id } from './v2Document';
import { counted } from './v2EditorUtil';

type HostProps = ComponentProps<typeof V2CanvasHost>;

interface EditorCanvasProps {
  readonly page: ScenePage;
  readonly viewPage: ScenePage;
  readonly hostRef: RefObject<PixiRendererHost | null>;
  readonly sectionRef: RefObject<HTMLElement | null>;
  readonly pageRef: RefObject<ScenePage | null>;
  readonly selectionRef: RefObject<CanvasSelection>;
  readonly selectedConnectorIdsRef: RefObject<readonly string[]>;
  readonly toolRef: RefObject<V2Tool>;
  readonly spacePanRef: RefObject<boolean>;
  readonly toolConfigRef: RefObject<V2ToolConfig>;
  readonly readOnlyRef: RefObject<boolean>;
  readonly gestureApiRef: MutableRefObject<V2GestureApi | null>;
  readonly explainMapRef: MutableRefObject<() => void>;
  readonly openDrawingRef: MutableRefObject<() => boolean>;
  readonly tool: V2Tool;
  readonly camera: ReturnType<typeof useV2Camera>;
  readonly map: ReturnType<typeof useV2MapMode>;
  readonly panels: ReturnType<typeof useV2Panels>;
  readonly repo: ReturnType<typeof useV2RepoDocument>;
  readonly repoSource: ReturnType<typeof useV2RepoDocument>['source'];
  readonly repoDrawing: boolean;
  readonly code: ReturnType<typeof useV2CodeWorkspace>;
  readonly agentCursor: ReactNode;
  /** Comment pins, composer and thread (V2Comments). */
  readonly comments: ReactNode;
  readonly labelEditing: ReturnType<typeof useV2LabelEditing>;
  readonly connectorLabel: ReturnType<typeof useV2ConnectorLabelEditing>;
  readonly iconActions: ReturnType<typeof useV2IconActions>;
  readonly selection: CanvasSelection;
  readonly selectedConnectorId: string | null;
  readonly selectedConnectorIds: readonly string[];
  readonly zoomInto: HostProps['zoomInto'];
  readonly editLocked: boolean;
  readonly canvasColor: string;
  readonly showGrid: boolean;
  readonly snapToGrid: boolean;
  readonly drawCommit: HostProps['commit'];
  readonly applySelection: HostProps['applySelection'];
  readonly applyConnectorSelection: HostProps['applyConnectorSelection'];
  readonly openEditor: HostProps['openEditor'];
  readonly setTool: (tool: V2Tool) => void;
  readonly setContextMenu: HostProps['onContextMenu'];
  readonly setRendererStatus: (status: PixiRendererStatus) => void;
  readonly extendConnectorCommand: (command: DocumentCommand, fromNodeId: string, toNodeId: string) => DocumentCommand;
  readonly openChartData: (nodeId: string) => boolean;
  readonly editBox: (nodeId: string) => void;
  readonly setModelPanelOnStart: (on: boolean) => void;
}

/** The canvas and what Map draws over it: the repo overlay, the agent's cursor, the start, empty and error screens. */
export function V2EditorCanvas(p: EditorCanvasProps): React.JSX.Element {
  const { map, panels, code, repoSource, labelEditing, connectorLabel, iconActions, selectionRef } = p;
  const navigate = useNavigate();
  const openWorkspace = panels.openWorkspace;
  return (
    <V2CanvasHost
      page={p.viewPage} hostRef={p.hostRef} camera={p.camera.camera} cameraRef={p.camera.cameraRef} pageRef={p.pageRef}
      selectionRef={selectionRef} selectedConnectorIdsRef={p.selectedConnectorIdsRef} toolRef={p.toolRef} tool={p.tool} spacePanRef={p.spacePanRef}
      toolConfigRef={p.toolConfigRef} onOpenChartData={p.openChartData} zoomInto={map.active ? null : p.zoomInto}
      {...(map.active ? { onNodeClick: map.clickNode, onNodeDoubleClick: p.editBox, onNodeDrag: () => p.explainMapRef.current() } : {})}
      onRemoveIcons={() => iconActions.removeIcons(selectionRef.current.nodeIds)}
      onSetIcon={(icon) => iconActions.setIcons(selectionRef.current.nodeIds, icon)}
      onOpenCode={code.openNew}
      onInspect={() => openWorkspace('inspect')}
      readOnlyRef={p.readOnlyRef} gestureApiRef={p.gestureApiRef}
      selection={p.selection} selectedConnectorId={p.selectedConnectorId} selectedConnectorIds={p.selectedConnectorIds}
      editing={labelEditing.editing}
      commit={p.drawCommit}
      applySelection={p.applySelection} applyConnectorSelection={p.applyConnectorSelection}
      updateCamera={p.camera.updateCamera} openEditor={p.openEditor} openConnectorEditor={connectorLabel.open} onToolChange={p.setTool} mintId={mintV2Id}
      extendConnectorCommand={p.extendConnectorCommand}
      onCommitLabel={labelEditing.commitLabel} onCancelEdit={labelEditing.cancelEdit}
      connectorEditing={connectorLabel.editing}
      onCommitConnectorLabel={connectorLabel.commit} onCancelConnectorEdit={connectorLabel.cancel}
      onStatusChange={p.setRendererStatus}
      sectionRef={p.sectionRef}
      showGrid={p.showGrid} snapToGrid={p.snapToGrid}
      backgroundColor={Number.parseInt(p.canvasColor.slice(1), 16)}
      readOnly={p.editLocked}
      onContextMenu={p.setContextMenu}
    >
      {repoSource && map.active ? <V2RepoMapOverlay source={repoSource} map={p.repo.state} links={map.links}
        onOpenDrawing={p.repoDrawing ? () => { p.openDrawingRef.current(); } : undefined} /> : null}
      {p.comments}
      {p.agentCursor}
      {map.start ? (
        <V2MapStart busy={code.generating} onStartModel={() => { void code.startFrom(C4_STARTER, { openPanel: false }).then(counted('created_template')); p.setModelPanelOnStart(true); }}
          onMapRepo={(repoRef) => navigate(mapRepoPath(repoRef))}
          onAgent={() => openWorkspace('agent')} />
      ) : null}
      {map.empty ? (
        <div className="ofk-v2-map-state" data-testid="v2-map-empty">
          <EmptyState hero={<V2StateHero kind="no-canvas" />} title="No elements yet"
            description="Add people, systems and containers in the model; the map draws them as you go."
            action={<Button variant="primary" onClick={() => openWorkspace('model')}>Open model</Button>} />
        </div>
      ) : null}
      {map.error ? (
        <div className="ofk-v2-map-state" data-testid="v2-map-error">
          <ErrorState hero={<V2StateHero kind="torn-page" />} title="The map could not be drawn." description={map.error}
            action={<Button variant="primary" onClick={() => map.choose('canvas')}>Back to canvas</Button>} />
        </div>
      ) : null}
    </V2CanvasHost>
  );
}
