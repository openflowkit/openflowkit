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

/** Frame ids are unique across pages: an op that names a frame runs on the page holding it (a C4 view's own page). */
export function pageHolding({ document, pageId }: OpContext, input: unknown): string {
  const frameId = (input as { frameId?: unknown } | null)?.frameId;
  if (typeof frameId !== 'string') return pageId;
  const holds = (page: SceneDocumentV1['pages'][number]) => page.nodes.some((node) => node.id === frameId);
  return document.pages.some((page) => page.id === pageId && holds(page)) ? pageId : document.pages.find(holds)?.id ?? pageId;
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
