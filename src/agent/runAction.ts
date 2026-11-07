import { applyDocumentCommand } from '@/opencanvas/domain/commands/execute';
import type { SceneDocumentV1 } from '@/opencanvas/domain/document/types';
import type { AgentOp, OpContext, OpOutcome } from './ops/types';

/**
 * Validated input in, one reversible command (or none) plus a JSON-safe output
 * out. Hosts that own a history commit the command themselves; file hosts
 * apply it with runAgentOp.
 */
export async function resolveAgentOpCommand<Input, Output>(
  op: AgentOp<Input, Output>,
  rawInput: unknown,
  context: OpContext
): Promise<OpOutcome<Output>> {
  const input = op.schema.parse(rawInput ?? {});
  return op.run(input, { ...context, pageId: pageHolding(context, input) });
}

/**
 * Frame ids are unique across pages: an op that names a frame runs on the page holding it (a C4 view's own page).
 * An op that names a node (start_thread) does the same when the page it was given lacks the node and one other page
 * holds it; C4 views share element ids, so with several it stays on its page and the op says which hold it.
 */
export function pageHolding({ document, pageId }: OpContext, input: unknown): string {
  const { frameId, nodeId } = (input ?? {}) as { frameId?: unknown; nodeId?: unknown };
  const id = typeof frameId === 'string' ? frameId : typeof nodeId === 'string' ? nodeId : null;
  if (id === null) return pageId;
  const holders = document.pages.filter((page) => page.nodes.some((node) => node.id === id));
  if (holders.some((page) => page.id === pageId)) return pageId;
  return (typeof frameId === 'string' || holders.length === 1 ? holders[0]?.id : undefined) ?? pageId;
}

export interface RunOpResult {
  readonly document: SceneDocumentV1;
  readonly changed: boolean;
  readonly output: unknown;
}

/** Apply an op straight to a document — the file/offline path. */
export async function runAgentOp(
  op: AgentOp<unknown, unknown>,
  rawInput: unknown,
  context: OpContext
): Promise<RunOpResult> {
  const { command, threads, output, report } = await resolveAgentOpCommand(op, rawInput, context);
  if (threads) {
    const next = threads(context.document);
    return { document: next, changed: next !== context.document, output: report ? report(next) : output };
  }
  if (!command) return { document: context.document, changed: false, output };
  return { document: applyDocumentCommand(context.document, command).document, changed: true, output };
}
