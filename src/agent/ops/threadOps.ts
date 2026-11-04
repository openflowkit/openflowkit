// Threads as agent ops. They return a document transform (`threads`), never a command: threads are
// conversation, not drawing, so they take no undo step, no camera move and no page switch (see liveOp).
import { z } from 'zod';
import { addComment, addThread, nextThreadNumber, ThreadError, findThread, pageThreads, setThreadResolved } from '../../opencanvas/domain/threads/threads';
import { buildNodeWorldMatrices } from '../../opencanvas/domain/scene/worldGeometry';
import { COMMENT_BODY_MAX, type SceneCommentAuthor } from '../../opencanvas/domain/document/types';
import { agentName } from '../agentName';
import { defineOp, pointOf, pointSchema, requirePage, type OpContext } from './types';

const body = () => z.string().min(1).max(COMMENT_BODY_MAX).describe(`Plain text, at most ${COMMENT_BODY_MAX} characters.`);
const author = (context: OpContext): SceneCommentAuthor => ({ kind: 'agent', name: agentName(context.client) });
const stamp = () => ({ id: crypto.randomUUID(), createdAt: new Date().toISOString() });

export const listThreads = defineOp({
  name: 'list_threads',
  title: 'List threads',
  description: 'Threads people (and agents) pinned on the canvas: id, page, the node it is pinned to (with its label, '
    + 'when the node still exists), the pin point, resolved, and every comment in it. Resolved threads are left out unless asked for. '
    + 'Threads never appear in get_diagram or exports.',
  schema: z.object({
    pageId: z.string().min(1).optional().describe('Only this page (see list_pages); default every page.'),
    threadId: z.string().min(1).optional().describe('Only this thread, whatever its page or state; an unknown id is an error.'),
    unanswered: z.boolean().default(false).describe('Only threads whose last comment is from a person, so still waiting for an answer.'),
    includeResolved: z.boolean().default(false).describe('Also list resolved threads.'),
  }),
  async run({ pageId, threadId, unanswered, includeResolved }, context) {
    if (threadId && !findThread(context.document, threadId)) throw new ThreadError(`Unknown thread "${threadId}".`);
    const pages = pageId ? [requirePage(context.document, pageId)] : context.document.pages;
    const threads = pages.flatMap((page) => {
      const nodes = new Map(page.nodes.map((node) => [node.id, node]));
      return pageThreads(page)
        .filter((thread) => (threadId ? thread.id === threadId : includeResolved || !thread.resolved))
        .filter((thread) => !unanswered || thread.comments[thread.comments.length - 1]?.author.kind === 'human')
        .map((thread) => {
          const node = thread.anchor.nodeId === null ? undefined : nodes.get(thread.anchor.nodeId);
          return {
            id: thread.id, number: thread.number, pageId: page.id, nodeId: thread.anchor.nodeId,
            ...(node ? { nodeLabel: typeof node.content.label === 'string' ? node.content.label : '' } : {}),
            point: thread.anchor.point, resolved: thread.resolved,
            comments: thread.comments.map(({ id, author: by, body: text, createdAt, editedAt }) => ({
              id, author: by, body: text, createdAt, ...(editedAt ? { editedAt } : {}),
            })),
          };
        });
    });
    return { command: null, output: { threads } };
  },
});

export const replyToThread = defineOp({
  name: 'reply_to_thread',
  title: 'Reply to a thread',
  description: 'Add a comment to a thread (list_threads gives the threadId). Signed with your agent name. '
    + 'A new comment reopens a resolved thread. Takes no undo step.',
  schema: z.object({ threadId: z.string().min(1), body: body() }),
  async run({ threadId, body: text }, context) {
    if (!findThread(context.document, threadId)) throw new ThreadError(`Unknown thread "${threadId}".`);
    const comment = { ...stamp(), author: author(context), body: text };
    return {
      command: null,
      threads: (document) => addComment(document, threadId, comment),
      output: { threadId, commentId: comment.id },
    };
  },
});

export const resolveThread = defineOp({
  name: 'resolve_thread',
  title: 'Resolve a thread',
  description: 'Mark a thread resolved (it leaves the canvas but stays in the file), or reopen it with resolved: false.',
  schema: z.object({ threadId: z.string().min(1), resolved: z.boolean().default(true) }),
  async run({ threadId, resolved }, context) {
    if (!findThread(context.document, threadId)) throw new ThreadError(`Unknown thread "${threadId}".`);
    return {
      command: null,
      threads: (document) => setThreadResolved(document, threadId, resolved),
      output: { threadId, resolved },
    };
  },
});

export const startThread = defineOp({
  name: 'start_thread',
  title: 'Start a thread',
  description: 'Start a thread with its first comment. Pin it to a node (nodeId: the pin sits at its top-right corner and follows the node) '
    + 'or to a world point; one of the two is required. Signed with your agent name. Takes no undo step.',
  schema: z.object({
    nodeId: z.string().min(1).optional().describe('Node to pin to (see get_document).'),
    point: pointSchema().optional().describe('World position of the pin; wins over the node corner when both are given.'),
    body: body(),
  }),
  async run({ nodeId, point, body: text }, context) {
    if (!nodeId && !point) throw new ThreadError('Say where the thread goes: pass nodeId (a node on the page) or point ({x, y} in world coordinates).');
    const page = requirePage(context.document, context.pageId);
    let pin = point ? pointOf(point) : null;
    if (nodeId) {
      const node = page.nodes.find((candidate) => candidate.id === nodeId);
      const origin = node ? buildNodeWorldMatrices(page).get(nodeId) : undefined;
      if (!node || !origin) throw new ThreadError(`Node "${nodeId}" is not on page "${page.id}" (get_document lists them).`);
      pin ??= { x: origin.tx + node.size.width, y: origin.ty };
    }
    const threadId = crypto.randomUUID();
    const comment = { ...stamp(), author: author(context), body: text };
    const pageId = page.id;
    const at = pin!;
    const output = (number: number) => ({ threadId, number, commentId: comment.id, pageId, nodeId: nodeId ?? null, point: at });
    return {
      command: null,
      threads: (document) => addThread(document, { pageId, threadId, nodeId: nodeId ?? null, point: at, comment }),
      output: output(nextThreadNumber(context.document)),
      report: (applied) => output(findThread(applied, threadId)?.thread.number ?? nextThreadNumber(context.document)),
    };
  },
});
