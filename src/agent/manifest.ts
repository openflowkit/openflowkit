// Capability manifest: the agent surface as external clients see it. One row
// per op, each naming the human operation it mirrors and the test that proves
// the two produce the same record. Owns no behaviour — ops live in ./ops.
import { AGENT_OPS, type AnyAgentOp } from './ops';

export { AGENT_OPS } from './ops';
export type { AnyAgentOp } from './ops';

export const MANIFEST_VERSION = 2;

export interface CapabilityRow {
  /** Editor operation as the user sees it. */
  readonly operation: string;
  /** Surface that ships the manual path. `agent` = no manual twin (lookups). */
  readonly surface: 'toolbar' | 'context-bar' | 'keyboard' | 'document-bar' | 'canvas' | 'code-panel' | 'agent';
  /** Agent op name. */
  readonly action: string;
  /** Test file (repo-relative) proving the op and the manual path agree. */
  readonly equivalenceTest: string | null;
  /** True when the op can change the document (and therefore has an inverse). */
  readonly mutates: boolean;
}

const rows: Readonly<Record<string, Omit<CapabilityRow, 'action'>>> = {
  create_diagram: { operation: 'Generate diagram from code', surface: 'code-panel', equivalenceTest: 'src/agent/ops/ops.test.ts', mutates: true },
  update_diagram: { operation: 'Regenerate a diagram frame', surface: 'code-panel', equivalenceTest: 'src/agent/ops/ops.test.ts', mutates: true },
  get_diagram: { operation: 'Edit as code', surface: 'context-bar', equivalenceTest: null, mutates: false },
  list_diagrams: { operation: 'List diagram frames', surface: 'agent', equivalenceTest: null, mutates: false },
  get_syntax: { operation: 'Grammar reference', surface: 'agent', equivalenceTest: null, mutates: false },
  search_icons: { operation: 'Icon search', surface: 'agent', equivalenceTest: null, mutates: false },
  find_icons_for: { operation: 'Icon search by concept', surface: 'agent', equivalenceTest: null, mutates: false },
  move: { operation: 'Move / nudge shapes', surface: 'canvas', equivalenceTest: 'src/agent/ops/ops.test.ts', mutates: true },
  style: { operation: 'Fill / stroke / width / dash / opacity', surface: 'context-bar', equivalenceTest: 'src/agent/ops/ops.test.ts', mutates: true },
  delete: { operation: 'Delete selection', surface: 'keyboard', equivalenceTest: 'src/agent/ops/ops.test.ts', mutates: true },
  add_shape: { operation: 'Create rectangle / ellipse / text', surface: 'toolbar', equivalenceTest: 'src/agent/ops/ops.test.ts', mutates: true },
  export: { operation: 'Export PNG / SVG / PDF / JSON', surface: 'document-bar', equivalenceTest: 'src/agent/ops/ops.test.ts', mutates: false },
  screenshot: { operation: 'Screenshot a diagram', surface: 'agent', equivalenceTest: null, mutates: false },
  fit_view: { operation: 'Zoom to fit / zoom to selection', surface: 'keyboard', equivalenceTest: null, mutates: false },
  get_document: { operation: 'Read document, page and selection', surface: 'canvas', equivalenceTest: null, mutates: false },
  list_threads: { operation: 'Read threads', surface: 'canvas', equivalenceTest: null, mutates: false },
  reply_to_thread: { operation: 'Add a comment to a thread', surface: 'canvas', equivalenceTest: 'src/agent/ops/threadOps.test.ts', mutates: true },
  resolve_thread: { operation: 'Resolve / reopen a thread', surface: 'canvas', equivalenceTest: 'src/agent/ops/threadOps.test.ts', mutates: true },
  start_thread: { operation: 'Comment tool: start a thread with its first comment', surface: 'canvas', equivalenceTest: 'src/agent/ops/threadOps.test.ts', mutates: true },
  list_pages: { operation: 'Page list', surface: 'document-bar', equivalenceTest: null, mutates: false },
};

export const CAPABILITY_MANIFEST: readonly CapabilityRow[] = AGENT_OPS.map((op) => {
  const row = rows[op.name];
  if (!row) throw new Error(`Op "${op.name}" has no manifest row. Add one in src/agent/manifest.ts.`);
  return { ...row, action: op.name };
});

export function manifestCoverage(): { readonly ops: number; readonly withEquivalentUiPath: number; readonly mutating: number } {
  return {
    ops: CAPABILITY_MANIFEST.length,
    withEquivalentUiPath: CAPABILITY_MANIFEST.filter(({ equivalenceTest }) => equivalenceTest !== null).length,
    mutating: CAPABILITY_MANIFEST.filter(({ mutates }) => mutates).length,
  };
}

/** Ops registered but absent from the manifest (a manifest row is part of "done"). */
export function unlistedOps(): readonly string[] {
  const listed = new Set(CAPABILITY_MANIFEST.map(({ action }) => action));
  return AGENT_OPS.map((op: AnyAgentOp) => op.name).filter((name) => !listed.has(name));
}
