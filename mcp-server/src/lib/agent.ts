import type { ZodType, ZodTypeDef } from 'zod';
// The bundle is emitted by `npm run build:agent` at the repo root (see
// vite.agent.config.ts) and carries no declarations; this file is its typed
// surface. Keep in sync with src/agent/index.ts in the app.
// @ts-expect-error generated bundle has no declaration file
import * as bundle from '../generated/openflowkit-agent.js';

export interface SceneDocumentV1 {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly pages: readonly {
    readonly id: string;
    readonly name: string;
    readonly nodes: readonly unknown[];
    readonly connectors: readonly unknown[];
  }[];
}

export interface AgentOp {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** Zod object schema; `shape` is read by the MCP tool registration. */
  readonly schema: ZodType<unknown, ZodTypeDef, unknown>;
  readonly run: (input: unknown, context: unknown) => Promise<{ command: unknown; output: unknown }>;
}

export interface AgentOpSchemaObject {
  readonly shape: Record<string, ZodType<unknown, ZodTypeDef, unknown>>;
}

export interface ExportedFile {
  readonly filename: string;
  readonly mime: string;
  readonly text?: string;
  readonly base64?: string;
}

export interface IconMatch {
  readonly provider: string;
  readonly slug: string;
  readonly label: string;
  readonly category?: string;
}

export interface BridgePageSummary {
  readonly pageId: string;
  readonly name: string;
  readonly nodes: number;
  readonly connectors: number;
}

export interface BridgeClientInfo {
  readonly documentId: string;
  readonly name: string;
  readonly revision: number;
  readonly pageId: string;
  readonly pages: readonly BridgePageSummary[];
  readonly app: string;
}

export interface BridgeRequest {
  readonly id: string;
  readonly op: string;
  readonly input: unknown;
  readonly pageId?: string;
  /** The MCP clientInfo.name of the agent session that made the call (servers after 0.2.4). */
  readonly client?: string;
}

export interface BridgeHealth {
  readonly ok: true;
  readonly protocol: number;
  readonly name: string;
  readonly version: string;
  readonly connected: boolean;
  readonly documentId: string | null;
  readonly documentName: string | null;
  readonly pageId: string | null;
  readonly pages: readonly BridgePageSummary[];
  readonly lastSeenMs: number | null;
  /** Servers after 0.2.4: the `POST /call` protocol other local servers share this one's canvas through. */
  readonly share?: number;
}

export interface DslLintReport {
  readonly ok: boolean;
  readonly family: string;
  readonly reserved: boolean;
  readonly statements: number;
  readonly lines: number;
  readonly diagnostics: readonly { readonly code: string; readonly severity: string; readonly line: number; readonly col: number; readonly message: string; readonly hint?: string }[];
  readonly converted?: { readonly from: 'mermaid' | 'structurizr' | 'd2'; readonly dsl: string; readonly losses: readonly { readonly line: number; readonly message: string }[] };
}

/** A compiled scene node, as much of it as headless consumers read. */
export interface BundleSceneNode {
  readonly id: string;
  readonly kind: string;
  readonly parentId: string | null;
  readonly layerId: string;
  readonly zIndex: number;
  readonly content: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly size: { readonly width: number; readonly height: number };
}

export interface BundleSceneConnector {
  readonly id: string;
  readonly source: { readonly nodeId: string | null };
  readonly target: { readonly nodeId: string | null };
  readonly metadata: Record<string, unknown>;
}

export interface BundleCompileResult {
  readonly frame: BundleSceneNode;
  readonly nodes: readonly BundleSceneNode[];
  readonly groups: readonly BundleSceneNode[];
  readonly connectors: readonly BundleSceneConnector[];
  readonly diagnostics: DslLintReport['diagnostics'];
  readonly meta: { readonly family: string; readonly title?: string };
}

export interface BundleWorkspaceView {
  readonly viewId: string;
  readonly name: string;
  readonly result: BundleCompileResult;
}

export interface BundleWorkspace {
  readonly family: string;
  readonly views: readonly BundleWorkspaceView[];
}

/** Structural shape `exportCanonicalSvg` reads; the real document is richer. */
export interface SvgExportPage {
  readonly id: string;
  readonly layers: readonly { readonly id: string; readonly visible: boolean }[];
  readonly nodes: readonly unknown[];
  readonly connectors: readonly unknown[];
}

export interface SvgExportDocument {
  readonly id: string;
  readonly pages: readonly SvgExportPage[];
}

export interface SvgExportOptions {
  readonly pageId?: string;
  readonly theme?: 'light' | 'dark' | 'print';
  readonly padding?: number;
  readonly pixelRatio?: number;
  readonly transparent?: boolean;
  readonly iconArt?: Readonly<Record<string, string>>;
}

export interface OpCapabilities {
  readonly compile: (text: string, options?: unknown) => Promise<unknown>;
  readonly compileWorkspace: (text: string, options?: unknown) => Promise<unknown>;
  readonly syntax: (family?: string) => string | Promise<string>;
  readonly searchIcons: (query: string, limit: number) => Promise<readonly IconMatch[]>;
  readonly exportFiles?: (request: unknown) => Promise<readonly ExportedFile[]>;
  readonly fitView?: (objectIds?: readonly string[]) => void;
}

/* The Living Map: structural subset of src/dsl/map/types.ts that the CLI reads. */
export interface MapFactsData {
  readonly files: readonly { path: string; loc: number }[];
  readonly source?: { repo?: string; ref?: string; sha?: string };
  readonly [key: string]: unknown;
}
export interface MapNodeData {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly parent: string | null;
  readonly children: readonly string[];
  readonly files: number;
  readonly loc: number;
}
export interface MapModelData {
  readonly root: string;
  readonly nodes: Readonly<Record<string, MapNodeData>>;
  readonly links: readonly unknown[];
  readonly source: { readonly repo?: string; readonly ref?: string; readonly sha?: string };
  readonly stats: { readonly files: number; readonly loc: number; readonly imports: number; readonly unresolved: number };
}
export type MapDepth = 'overview' | 'detailed' | 'everything';

/* Architecture discovery: shapes copied from src/dsl/discovery/discovery.ts. */
export interface DiscoveryEvidence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export type DiscoveredUnitKind = 'system' | 'container' | 'store' | 'queue' | 'external';

export interface DiscoveredUnit {
  readonly id: string;
  readonly name: string;
  readonly kind: DiscoveredUnitKind;
  readonly tech?: string;
  readonly evidence: readonly DiscoveryEvidence[];
  readonly dir: string;
}

export interface DiscoveredRelation {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly evidence: readonly DiscoveryEvidence[];
}

export interface ArchitectureDiscovery {
  readonly units: readonly DiscoveredUnit[];
  readonly relations: readonly DiscoveredRelation[];
  readonly languages: Readonly<Record<string, number>>;
  readonly evidenceCount: number;
}

export interface ArchElementData {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly parent: string | null;
  readonly tech?: string;
  readonly desc?: string;
  readonly tags: readonly string[];
  readonly links: readonly string[];
  readonly attrs?: readonly { readonly key?: string; readonly value: string }[];
}

export interface ArchRelationData {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly tech?: string;
}

export interface ArchViewData {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly of?: string;
}

export interface ArchFlowStepData {
  readonly id: string;
  readonly kind: string;
  readonly from?: string;
  readonly to?: string;
  readonly label?: string;
  readonly branches?: readonly { readonly label?: string; readonly steps: readonly ArchFlowStepData[] }[];
}

export interface ArchFlowData {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly ArchFlowStepData[];
}

export interface ArchModelData {
  readonly name?: string;
  readonly elements: readonly ArchElementData[];
  readonly relations: readonly ArchRelationData[];
  readonly views: readonly ArchViewData[];
  readonly flows: readonly ArchFlowData[];
}

export interface DriftFinding {
  readonly id: string;
  readonly name: string;
  readonly evidence: readonly DiscoveryEvidence[];
}

export interface DriftChange {
  readonly id: string;
  readonly field: 'tech' | 'dir';
  readonly model: string;
  readonly repo: string;
}

export interface DriftReportResult {
  readonly missing: readonly DriftFinding[];
  readonly undrawn: readonly DriftFinding[];
  readonly changed: readonly DriftChange[];
}

export interface DetectionRule {
  readonly name: string;
  readonly type: string;
  readonly provider: 'aws' | 'gcp' | 'azure' | 'cncf' | 'docker' | 'third-party' | 'unknown';
  readonly patterns: readonly RegExp[];
}

export interface ScannedFile {
  readonly path: string;
  readonly content: string;
}

interface AgentBundle {
  readonly AGENT_OPS: readonly AgentOp[];
  findAgentOp(name: string): AgentOp | null;
  /** The op's fields, through a `.refine` wrapper: what a client advertises. */
  opInputShape(op: AgentOp): AgentOpSchemaObject['shape'];
  /** Ops that read no document (no documentId field). */
  readonly LOOKUP_OPS: ReadonlySet<string>;
  /** Ops that take no pageId field. */
  readonly PAGELESS_OPS: ReadonlySet<string>;
  /** The largest image a tool result carries inline. */
  readonly MAX_IMAGE_KB: number;
  base64Kb(base64: string): number;
  runAgentOp(op: AgentOp, rawInput: unknown, context: {
    document: SceneDocumentV1; pageId: string; capabilities: OpCapabilities; client?: string;
  }): Promise<{ document: SceneDocumentV1; changed: boolean; output: unknown }>;
  createFileCapabilities(options: {
    grammar: string;
    layout: unknown;
    icons?: readonly IconMatch[];
    resolveIcon?: (id: string) => { packId: string; shapeId: string } | null;
    loadIcon?: (packId: string, shapeId: string) => Promise<string | null>;
  }): OpCapabilities;
  grammarSection(grammar: string, family?: string): string;
  lintDsl(source: string): DslLintReport;
  createAgentDocument(name: string, id?: string): SceneDocumentV1;
  parseAgentDocument(value: unknown): SceneDocumentV1;
  compileWorkspace(text: string, options?: { readonly layout?: unknown; readonly origin?: { readonly x: number; readonly y: number } }): Promise<BundleWorkspace>;
  architectureWorkspaceText(model: unknown): string;
  archModelFromJson(value: unknown): unknown;
  exportCanonicalSvg(document: SvgExportDocument, options?: SvgExportOptions): string;
  collectIconArt(document: SvgExportDocument, load: (packId: string, shapeId: string) => Promise<string | null>): Promise<Record<string, string>>;
  tablerSvg(nodes: readonly (readonly [string, Readonly<Record<string, string>>])[]): string;
  readonly ICON_PACK_IDS: Readonly<Record<string, string>>;
  /** One row per op: the human operation it mirrors. */
  readonly CAPABILITY_MANIFEST: readonly { readonly action: string; readonly operation: string; readonly mutates: boolean }[];
  /** A cheap grid layout, for checks that discard positions. */
  readonly deterministicLayout: unknown;
  /** ELK in process: the editor's layout, for file mode and the CLI. */
  readonly headlessElkLayout: unknown;
  readonly BRIDGE_PROTOCOL_VERSION: number;
  readonly BRIDGE_DEFAULT_PORT: number;
  readonly BRIDGE_POLL_SECONDS: number;
  readonly BRIDGE_IDLE_MS: number;
  readonly bridgeTokenHeader: string;
  bridgeUrls(port: number, host?: string): { base: string; health: string; hello: string; next: string; result: string };
  isAllowedBridgeOrigin(origin: string | undefined | null): boolean;
  isBridgeClientInfo(value: unknown): value is BridgeClientInfo;
  isBridgeRequest(value: unknown): value is BridgeRequest;
  readonly WIDGET_KINDS: readonly string[];
  readonly FRAME_PRESETS: readonly string[];
  readonly DSL_FAMILIES: readonly [string, ...string[]];
  readonly STARTER_TEMPLATES: readonly StarterTemplate[];
  readonly findStarterTemplate: (name: string) => StarterTemplate | undefined;
  acceptsMapFile(path: string): boolean;
  factsFromFiles(files: readonly { path: string; content: string }[], repoName: string, options?: { paths?: readonly string[]; listed?: readonly string[] }): MapFactsData;
  parseRepoPath(input: string): { owner: string; repo: string; ref: string } | null;
  buildMap(facts: MapFactsData, overlay?: unknown): MapModelData;
  presets(model: MapModelData): Record<MapDepth, Set<string>>;
  insights(model: MapModelData, options?: { minPair?: number; top?: number }): { twoWay: { a: string; b: string; ab: number; ba: number }[] };
  discoverArchitecture(files: readonly ScannedFile[], rootName: string): ArchitectureDiscovery;
  capUnits(result: ArchitectureDiscovery, max: number): { readonly result: ArchitectureDiscovery; readonly dropped: number };
  discoveryToDsl(result: ArchitectureDiscovery, name: string, evidenceLink?: (evidence: DiscoveryEvidence) => string): string;
  driftReport(modelOrJson: ArchModelData | string, result: ArchitectureDiscovery): DriftReportResult;
  modelFromNode(node: unknown): ArchModelData | null;
  modelFromDocument(document: unknown): ArchModelData | null;
  readArchModel(value: unknown): ArchModelData | null;
  discoverySummary(result: ArchitectureDiscovery): string;
  acceptsArchitectureFile(file: string): boolean;
  slugDiscoveryId(value: string): string;
  readonly SERVICE_RULES: readonly DetectionRule[];
  readonly LANGUAGE_BY_EXT: Readonly<Record<string, string>>;
  readonly INCLUDE_EXT: ReadonlySet<string>;
  isScannedFileName(name: string): boolean;
  isSkippedDir(name: string): boolean;
}

export interface StarterTemplate {
  readonly name: string;
  readonly title: string;
  readonly family: 'flowchart' | 'architecture' | 'sequence' | 'state' | 'erd';
  readonly summary: string;
  readonly dsl: string;
}

export const {
  AGENT_OPS, LOOKUP_OPS, PAGELESS_OPS, MAX_IMAGE_KB, base64Kb, findAgentOp, opInputShape, runAgentOp, createFileCapabilities, grammarSection, lintDsl,
  createAgentDocument, parseAgentDocument,
  compileWorkspace, architectureWorkspaceText, archModelFromJson, exportCanonicalSvg,
  collectIconArt, tablerSvg, ICON_PACK_IDS, headlessElkLayout, deterministicLayout, CAPABILITY_MANIFEST,
  BRIDGE_PROTOCOL_VERSION, BRIDGE_DEFAULT_PORT, BRIDGE_POLL_SECONDS, BRIDGE_IDLE_MS,
  bridgeTokenHeader, bridgeUrls, isAllowedBridgeOrigin, isBridgeClientInfo, isBridgeRequest, WIDGET_KINDS, FRAME_PRESETS, DSL_FAMILIES,
  STARTER_TEMPLATES, findStarterTemplate,
  discoverArchitecture, capUnits, discoveryToDsl, driftReport, modelFromNode, modelFromDocument, readArchModel,
  discoverySummary, acceptsArchitectureFile, slugDiscoveryId,
  SERVICE_RULES, LANGUAGE_BY_EXT, INCLUDE_EXT, isScannedFileName, isSkippedDir,
  acceptsMapFile, factsFromFiles, buildMap, presets, insights, parseRepoPath,
} = bundle as unknown as AgentBundle;

export type { ZodType, ZodRawShape, ZodObject } from 'zod';
