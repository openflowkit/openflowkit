import { clearSelection, replaceSelection, toggleSelection, type CanvasSelection } from '../../application/selection/selection';
import type { useDocumentSession } from '../../application/session/useDocumentSession';
import { buildConnectorObjectAction } from '../../application/active-document/connectorActions';
import { buildDeleteSelectionCommand, buildDuplicateSelectionCommand, buildReorderCommand, buildToggleLockCommand } from '../../domain/commands/sceneEdits';
import { buildStepOrderCommand } from '../../domain/commands/arrangeNodes';
import { buildLayerMoveCommand } from '../../domain/commands/layerMove';
import type { DocumentCommand } from '../../domain/commands/types';
import type { ScenePage } from '../../domain/document/types';
import { writeAnimateBlock } from '../../../dsl/animate';
import { Panel, type ToastItem } from '../design-system';
import { V2AgentPanel } from './V2AgentPanel';
import { V2ChartDataPanel } from './V2ChartDataPanel';
import type { ContextMenuTarget } from './V2ContextMenu';
import { V2FeatureTip } from './V2FeatureTip';
import { V2FeedbackPrompt } from './V2Feedback';
import { V2FindBar } from './V2FindBar';
import { V2MotionExport } from './V2MotionExport';
import { V2TreePanel } from './V2TreePanel';
import { V2Shortcuts } from './V2Workspace';
import type { useV2ArchitectureActions } from './useV2ArchitectureActions';
import type { useV2Camera } from './useV2Camera';
import type { useV2CodeWorkspace } from './useV2CodeWorkspace';
import type { useV2EditorAgents } from './useV2EditorAgents';
import type { useV2FeatureTips } from './useV2FeatureTips';
import type { useV2FeedbackPrompts } from './useV2FeedbackPrompts';
import type { useV2Find } from './useV2Find';
import type { OpenEditorOptions } from './useV2LabelEditing';
import type { useV2Panels } from './useV2Panels';
import type { useV2Proposal } from './useV2Proposal';
import { mintV2Id } from './v2Document';
import type { V2TipId } from './v2FeatureTips';

interface OverlaysProps {
  readonly panels: ReturnType<typeof useV2Panels>;
  readonly find: ReturnType<typeof useV2Find>;
  readonly tips: ReturnType<typeof useV2FeatureTips>;
  readonly runTip: (tip: V2TipId) => void;
  readonly feedback: ReturnType<typeof useV2FeedbackPrompts>;
  readonly transient: boolean;
  readonly mapActive: boolean;
  readonly code: ReturnType<typeof useV2CodeWorkspace>;
  readonly session: ReturnType<typeof useDocumentSession>;
  readonly page: ScenePage;
  readonly viewPage: ScenePage;
  readonly chartPanelNode: ScenePage['nodes'][number] | null;
  readonly selection: CanvasSelection;
  readonly selectedConnectorIds: readonly string[];
  readonly editLocked: boolean;
  readonly docReadOnly: boolean;
  readonly commit: (command: DocumentCommand) => void;
  readonly applySelection: (selection: CanvasSelection) => void;
  readonly applyConnectorSelection: (connectorIds: readonly string[]) => void;
  readonly selectNodes: (nodeIds: readonly string[]) => void;
  readonly openEditor: (nodeId: string, options?: OpenEditorOptions) => void;
  readonly setContextMenu: (target: ContextMenuTarget | null) => void;
  readonly camera: ReturnType<typeof useV2Camera>;
  readonly architectureActions: ReturnType<typeof useV2ArchitectureActions>;
  readonly agents: ReturnType<typeof useV2EditorAgents>;
  readonly proposal: ReturnType<typeof useV2Proposal>;
  readonly pushToast: (toast: ToastItem) => void;
  readonly focusCanvas: () => void;
}

/** Everything that floats over the canvas beside the workspace panels: shortcuts, find, tips, prompts, animation, chart data, layers, assistant. */
export function V2EditorOverlays(p: OverlaysProps): React.JSX.Element {
  const {
    panels, find, tips, feedback, transient, code, session, page, viewPage, chartPanelNode, selection, selectedConnectorIds, editLocked, commit,
    applySelection, applyConnectorSelection, selectNodes, camera, architectureActions, agents, pushToast,
  } = p;
  /** The layers tree's row actions; each is one undo step. */
  const runObjectAction = (nodeId: string, action: 'lock' | 'hide' | 'duplicate' | 'delete' | 'rename' | 'front' | 'forward' | 'backward' | 'back') => {
    const node = page?.nodes.find((item) => item.id === nodeId);
    if (editLocked || !page || !node) return;
    if (action === 'lock') commit(buildToggleLockCommand(page, [nodeId]));
    if (action === 'rename') {
      camera.revealNodes([nodeId]);
      p.openEditor(nodeId);
    }
    if (action === 'front' || action === 'back') {
      const command = buildReorderCommand(page, [nodeId], action);
      if (command) commit(command);
    }
    if (action === 'forward' || action === 'backward') {
      const command = buildStepOrderCommand(page, [nodeId], action);
      if (command) commit(command);
    }
    if (action === 'hide') commit({
      kind: 'set-node', id: `visibility:${nodeId}`, label: node.content.sectionHidden ? 'Show object' : 'Hide object',
      pageId: page.id, before: node,
      after: { ...node, content: { ...node.content, sectionHidden: !node.content.sectionHidden } },
    });
    if (action === 'duplicate') {
      const command = buildDuplicateSelectionCommand(page, [nodeId], page.connectors.map((item) => item.id), mintV2Id);
      commit(command);
      // The copy, not its copied members: the row that lights up is the one that was duplicated.
      selectNodes(command.commands.flatMap((item) => item.kind === 'insert-node' && item.node.parentId === node.parentId ? [item.node.id] : []));
    }
    if (action === 'delete') {
      if (!architectureActions.unplaceSelection([nodeId])) commit(buildDeleteSelectionCommand(page, [nodeId], []));
      applySelection(clearSelection());
    }
  };
  return (
    <>
      {panels.shortcutsOpen ? <V2Shortcuts onClose={panels.closeShortcuts} /> : null}
      {find.open ? <V2FindBar find={find} label={p.mapActive ? 'Find in map' : 'Find on canvas'} /> : null}
      {tips.tip ? <V2FeatureTip id={tips.tip} onAction={() => p.runTip(tips.tip!)} onClose={tips.dismiss} /> : null}
      {feedback.prompt ? <V2FeedbackPrompt prompt={feedback.prompt} hidden={transient} onToast={pushToast}
        onFinish={(outcome) => { feedback.finish(outcome); if (document.activeElement === document.body) p.focusCanvas(); }} /> : null}
      {panels.motionOpen ? (
        <Panel title="Animation export" className="ofk-motion-panel ofk-v2-workspace-panel"
          onClose={panels.closeMotion}>
          <V2MotionExport key={page.id} document={session.document!} pageId={page.id}
            onToast={(title, tone) => pushToast({ id: `motion-${Date.now()}`, tone, title })}
            codeText={code.draft}
            // The chips write the text hub; the code panel shares this side, so it opens only when asked.
            onAnimateBlock={(block) => code.writeNew((draft) => writeAnimateBlock(draft, block))}
            onShowCode={() => panels.openWorkspace('code')} />
        </Panel>
      ) : null}
      {chartPanelNode ? (
        <V2ChartDataPanel key={chartPanelNode.id} node={chartPanelNode} pageId={page.id}
          commit={commit} onClose={panels.closeChart} />
      ) : null}
      {panels.treeOpen ? (
        <V2TreePanel
          key={page.id}
          page={viewPage} selection={selection} selectedConnectorIds={selectedConnectorIds}
          readOnly={editLocked}
          onObjectAction={runObjectAction}
          onConnectorMenu={(connectorId, x, y) => {
            applySelection(clearSelection());
            applyConnectorSelection([connectorId]);
            p.setContextMenu({ kind: 'connector', id: connectorId, x, y });
          }}
          onConnectorAction={(connectorId, action) => {
            if (editLocked) return;
            const command = buildConnectorObjectAction(page, connectorId, action, mintV2Id);
            if (!command) return;
            commit(command);
            applySelection(clearSelection());
            applyConnectorSelection(command.kind === 'insert-connector' ? [command.connector.id] : []);
          }}
          onSelectNode={(nodeId, additive) => {
            applyConnectorSelection([]);
            applySelection(additive ? toggleSelection(selection, nodeId) : replaceSelection([nodeId]));
            camera.revealNodes([nodeId]);
          }}
          onSelectConnector={(connectorId) => {
            applySelection(clearSelection());
            applyConnectorSelection([connectorId]);
            const connector = viewPage.connectors.find((item) => item.id === connectorId);
            const ends = [connector?.source.nodeId, connector?.target.nodeId].filter((id): id is string => !!id);
            if (ends.length) camera.revealNodes(ends);
          }}
          onClose={panels.closeTree}
          onMoveLayer={(nodeId, drop) => {
            const command = editLocked ? null : buildLayerMoveCommand(page, nodeId, drop);
            if (command) { commit(command); selectNodes([nodeId]); }
          }}
          mapMode={p.mapActive}
        />
      ) : null}
      {panels.workspace === 'assistant' ? (
        <V2AgentPanel assistant={agents.assistant} proposal={p.proposal} aiSettings={agents.aiSettings}
          currentRevision={session.contentRevision} readOnly={p.docReadOnly}
          diagramCount={agents.diagramCount} selectedDiagramCount={agents.selectedDiagramCount}
          onClose={panels.closeWorkspace} />
      ) : null}
    </>
  );
}
