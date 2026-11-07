import { z } from 'zod';
import type { CompileOptions, CompileResult, CompileWorkspaceResult } from '../../dsl/compile';
import type { DocumentCommand } from '../../opencanvas/domain/commands/types';
import type { SceneDocumentV1, ScenePage } from '../../opencanvas/domain/document/types';


/**
 * A point schema, fresh per field: one instance shared by two fields becomes a JSON-schema `$ref`, which
 * strict tool-calling clients drop or reject. zod's declaration types in this repo widen object fields to
 * optional (`{x?: number}` even though parsing guarantees both), so `pointOf` narrows a parsed value back
 * for the compiler; the schema is the runtime truth.
 */
export const pointSchema = () => z.object({ x: z.number(), y: z.number() });

export function pointOf(value: { readonly x?: number; readonly y?: number }): { x: number; y: number } {
  return { x: value.x ?? 0, y: value.y ?? 0 };
}

/**
 * ELK time grows with connections far faster than with shapes (measured 2026-10-07:
 * a 500-shape chain 2 s; 2 links a shape, 200 links 1 s, 400 links 5 s, 500 links 13 s,
 * 2000 links over 7 min). Past these, the stdio server or the CLI would just hang, so a Node
 * host refuses to lay them out, and the ops skip the comparisons that would need it.
 */
export const HEADLESS_LAYOUT_LIMITS = { nodes: 1000, edges: 400 } as const;

/** One host action the ops cannot compute themselves (camera, raster, disk). */
export interface OpCapabilities {
  /** text → compiled frame scene. The host injects its layout port. */
  readonly compile: (text: string, options?: CompileOptions) => Promise<CompileResult>;
  /** text → one scene per view (a C4 workspace); single-frame families yield one view. */
  readonly compileWorkspace: (text: string, options?: CompileOptions) => Promise<CompileWorkspaceResult>;
  /** Grammar reference, narrowed to one family when asked (async: may load a chunk). */
  readonly syntax: (family?: string) => string | Promise<string>;
  /** Icon catalog search over the packs this host ships. */
  readonly searchIcons: (query: string, limit: number) => Promise<readonly IconMatch[]>;
  /** PNG raster of a canonical SVG; absent in hosts without a canvas. */
  readonly rasterize?: (svg: string, scale: number) => Promise<Uint8Array>;
  /** Files for an export intent; absent in hosts without an export pipeline. */
  readonly exportFiles?: (request: ExportRequest) => Promise<readonly ExportedFile[]>;
  /** Frame the view on ids, or on everything when omitted. View-only. */
  readonly fitView?: (objectIds?: readonly string[]) => void;
}

export interface IconMatch {
  readonly provider: string;
  readonly slug: string;
  readonly label: string;
  readonly category?: string;
}

export type ExportFormat = 'png' | 'svg' | 'pdf' | 'json' | 'svg-animated' | 'gif' | 'mp4' | 'webm';
export type ExportScope = 'selection' | 'page' | 'document';
export type ExportTheme = 'light' | 'dark' | 'print';

/** Motion presets the animated formats accept. */
export type ExportPreset = 'build' | 'walkthrough' | 'pulse';

export interface ExportRequest {
  readonly document: SceneDocumentV1;
  readonly format: ExportFormat;
  readonly scope: ExportScope;
  readonly pageId: string;
  readonly selectedNodeIds?: readonly string[];
  /** Selection scope connections, exported without their endpoints. */
  readonly selectedConnectorIds?: readonly string[];
  readonly scale?: 1 | 2 | 3;
  readonly theme?: ExportTheme;
  /** Motion only: how the steps are ordered. */
  readonly preset?: ExportPreset;
  /** Motion only: a flow id from the architecture model, `auto`, or `code` for the animate block. */
  readonly order?: string;
  /** Motion only: clip length in milliseconds; null keeps the natural one. */
  readonly durationMs?: number | null;
  readonly loop?: boolean;
  /** Motion only: raster width in pixels (720, 1080, 1440). */
  readonly size?: 720 | 1080 | 1440;
  readonly fps?: 12 | 24 | 30;
}

export interface ExportedFile {
  readonly filename: string;
  readonly mime: string;
  /** Text formats. */
  readonly text?: string;
  /** Binary formats, base64 (the wire is JSON). */
  readonly base64?: string;
}

export interface OpContext {
  readonly document: SceneDocumentV1;
  /** Page the op acts on; defaults to the first page in `runAgentOp`. */
  readonly pageId: string;
  readonly capabilities: OpCapabilities;
  /** Node and connector ids the user has selected in a live editor, on the page it shows; absent in file mode. */
  readonly selection?: { readonly pageId: string | null; readonly ids: readonly string[] };
  /** The agent's MCP clientInfo.name, so a comment is signed by who wrote it (see agentName). */
  readonly client?: string;
}

/**
 * What an op hands back: at most one reversible command plus a JSON-safe output. A thread op returns
 * `threads` instead: a document transform that never enters undo history (domain/threads).
 */
export interface OpOutcome<Output> {
  readonly command: DocumentCommand | null;
  readonly threads?: (document: SceneDocumentV1) => SceneDocumentV1;
  readonly output: Output;
  /**
   * With `threads`: the output read off the document the change was applied to, which in live mode can
   * differ from the one the op resolved against (a thread number given out in between).
   */
  readonly report?: (applied: SceneDocumentV1) => Output;
}

export interface AgentOp<Input = unknown, Output = unknown> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /**
   * `Input` is the parsed *output* of the schema; the third parameter keeps
   * zod's looser input type (optional nested objects) out of inference.
   */
  readonly schema: z.ZodType<Input, z.ZodTypeDef, unknown>;
  readonly run: (input: Input, context: OpContext) => Promise<OpOutcome<Output>>;
}

export function defineOp<Input, Output>(op: AgentOp<Input, Output>): AgentOp<Input, Output> {
  return op;
}

export function requirePage(document: SceneDocumentV1, pageId: string): ScenePage {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new RangeError(`Page "${pageId}" was not found.`);
  return page;
}

export function requireFrame(page: ScenePage, frameId: string) {
  const frame = page.nodes.find((node) => node.id === frameId && node.kind === 'frame');
  if (!frame) throw new RangeError(`Diagram frame "${frameId}" was not found on this page.`);
  return frame;
}
