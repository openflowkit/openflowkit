// Public surface of the agent layer, bundled for the MCP server by
// vite.agent.config.ts. Pure: no store, no browser, no React.
import { createDefaultSceneLayer } from '@/opencanvas/domain/document/defaults';
import { SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION, type SceneDocumentV1 } from '@/opencanvas/domain/document/types';
import { migrateSceneDocument } from '@/opencanvas/domain/document/migration';

export { AGENT_OPS, LOOKUP_OPS, MAX_IMAGE_KB, PAGELESS_OPS, base64Kb, findAgentOp, opInputShape } from './ops';
export { createFileCapabilities, grammarSection } from './host';
export { headlessElkLayout } from './headlessLayout';
export type { FileHostOptions } from './host';
export {
  BRIDGE_DEFAULT_PORT, BRIDGE_IDLE_MS, BRIDGE_POLL_SECONDS, BRIDGE_PROTOCOL_VERSION,
  bridgeTokenHeader, bridgeUrls, isAllowedBridgeOrigin, isBridgeClientInfo, isBridgeRequest,
} from './bridge/protocol';
export type { BridgeClientInfo, BridgeHealth, BridgePageSummary, BridgeRequest, BridgeResult } from './bridge/protocol';
export type { AnyAgentOp } from './ops';
export type { AgentOp, ExportedFile, ExportRequest, IconMatch, OpCapabilities, OpContext, OpOutcome } from './ops';
export { CAPABILITY_MANIFEST, MANIFEST_VERSION, manifestCoverage, unlistedOps } from './manifest';
export { lintDsl } from './lint';
export { STARTER_TEMPLATES, findStarterTemplate } from './starterTemplates';
export type { StarterTemplate } from './starterTemplates';
export type { DslLintReport } from './lint';
export { resolveAgentOpCommand, runAgentOp } from './runAction';
export type { RunOpResult } from './runAction';
export type { SceneDocumentV1 };

// Headless consumers (the `openflowkit` CLI) compile whole workspaces and
// render canonical SVG without a browser. Re-exported, not re-implemented.
export { compileWorkspace } from '../dsl/compile';
// Checks that throw positions away (`openflowkit validate`) skip ELK and its size cap.
export { deterministicLayout } from '../dsl/layout';
export { architectureWorkspaceText } from '../dsl/families/architecture/text';
export { archModelFromJson } from '../dsl/model/model';
export { collectIconArt, exportCanonicalSvg } from '../opencanvas/infrastructure/export/canonicalSvg';
export { tablerSvg } from '../services/shapeLibrary/tablerSvg';
export { ICON_PACK_IDS } from '../dsl/iconMatch';
// Architecture discovery: one core for the MCP server, the CLI and the repo page.
export {
  acceptsArchitectureFile, capUnits, discoverArchitecture, discoverySummary, discoveryToDsl, driftReport,
  modelFromDocument, modelFromNode, readArchModel, slugDiscoveryId,
} from '../dsl/discovery/discovery';
export { INCLUDE_EXT, LANGUAGE_BY_EXT, SERVICE_RULES, isScannedFileName, isSkippedDir } from '../dsl/discovery/rules';
// The Living Map: facts from a checkout's files, the model, its depth presets and the two-way pairs `map` prints.
export { acceptsMapFile, factsFromFiles } from '../dsl/map/facts';
export { buildMap } from '../dsl/map/build';
export { presets } from '../dsl/map/view';
export { insights } from '../dsl/map/insights';
// The same owner/repo rules the repo page applies to a pasted address.
export { parseRepoPath } from '../services/discovery/githubRepo';
// The wireframe vocabulary, so discovery lists what the renderer draws.
export { WIDGET_KINDS } from '../opencanvas/domain/nodes/widgetNodePresentation';
export { FRAME_PRESETS } from '../opencanvas/domain/nodes/framePreset';
// The family headers the parser accepts: get_syntax answers one of these or says which exist.
export { DSL_FAMILIES } from '../dsl/ast';

export function createAgentDocument(name: string, id: string = crypto.randomUUID()): SceneDocumentV1 {
  const now = new Date().toISOString();
  // Same shape as the editor's createEmptyV2Document; the agent layer must not import presentation code.
  return {
    format: SCENE_DOCUMENT_FORMAT,
    schemaVersion: SCENE_DOCUMENT_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    pages: [{
      id: `${id}:page-1`, name: 'Page 1', diagramKind: 'flowchart', layers: [createDefaultSceneLayer()],
      nodes: [], connectors: [], metadata: {}, extensions: {},
    }],
    metadata: {},
    extensions: {},
  };
}

/** A document file opened by an agent (openflow_open, the CLI's --doc): loaded as the app loads one, so a bad thread is dropped with a warning on stderr. */
export function parseAgentDocument(value: unknown): SceneDocumentV1 {
  const result = migrateSceneDocument(value);
  if (result.success === false) {
    const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    throw new TypeError(`Invalid OpenCanvas document: ${summary}`);
  }
  return result.document;
}
