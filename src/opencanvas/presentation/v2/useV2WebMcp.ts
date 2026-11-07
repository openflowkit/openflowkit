// WebMCP: an agent that lives in the browser gets the editor's tools, no install, port or token. Only when the
// browser has a model context; otherwise nothing loads. Every op runs through runLiveAgentOp, as the MCP bridge's do.
import { useEffect, useRef, useState } from 'react';
import { runLiveAgentOp, type LiveAgentSession } from '../../../agent/liveOp';
import { agentCommented } from './useV2AgentBridge';
import { trackOnce } from '../../../services/usage/usage';
import { modelContextOf, registerWebMcpTools } from '../../../agent/webMcp';
import type { WebMcpEditor } from '../../../agent/webMcpTools';
import type { CanvasCamera } from '../../domain/camera/types';
import type { ScenePage } from '../../domain/document/types';

export interface V2WebMcpOptions extends LiveAgentSession {
  /** What the canvas draws (the map in Map mode). */
  readonly scene: ScenePage | null;
  readonly mode: 'canvas' | 'map';
  readonly camera: () => CanvasCamera;
  /** Screen rect of a drawn node, null when it is not drawn; and the canvas size. */
  readonly screenRect: (nodeId: string) => { left: number; top: number; right: number; bottom: number } | null;
  readonly viewport: () => { width: number; height: number };
  readonly select: (nodeIds: readonly string[], connectorIds: readonly string[], reveal: boolean) => void;
  readonly onActivity: (message: string) => void;
  /** Id of the command on top of the undo stack: the change line shows only while the agent's change is there (as the bridge's). */
  readonly undoTopId?: string | null;
}

interface V2WebMcp {
  /** Tools registered with the browser's agent; 0 when the browser has no WebMCP. */
  readonly tools: number;
  /** The last change an agent in this browser applied (its undo label) while it is the undo top; null otherwise. */
  readonly activity: string | null;
}

const CLOSED = 'The editor closed this document.';
const CANCELLED = 'The agent cancelled this call.';

/** One signal that aborts, with its own reason, when either source does. */
function eitherSignal(closed: AbortSignal, call: AbortSignal | undefined): AbortSignal {
  const both = new AbortController();
  const follow = (source: AbortSignal, reason: string) => {
    if (source.aborted) both.abort(new Error(reason));
    else source.addEventListener('abort', () => both.abort(new Error(reason)), { once: true });
  };
  follow(closed, CLOSED);
  if (call) follow(call, CANCELLED);
  return both.signal;
}

const UNSHOWN_EDIT = 'The editor did not show this change. Call get_document to see what the page holds before trying again.';
// The session took the thread change already: a blind retry would post it twice, and get_document shows no threads.
const UNSHOWN_THREAD = 'The editor took this thread change but did not show it. Call list_threads to see whether it is there before trying again.';

/**
 * A commit or a thread change reaches the editor's state on the next render; the next call must read the document it made. An edit
 * the session took that never shows up (a reload over it) is reported, not taken for applied.
 */
async function settled(read: () => unknown, before: unknown, unshown: string): Promise<void> {
  for (let tries = 0; tries < 60; tries += 1) {
    if (read() !== before) return;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error(unshown);
}

export function useV2WebMcp(options: V2WebMcpOptions): V2WebMcp {
  const [tools, setTools] = useState(0);
  const [activity, setActivity] = useState<{ label: string; id: string } | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const readOnly = Boolean(options.readOnly);

  useEffect(() => {
    const context = modelContextOf();
    if (!context) return undefined;
    const controller = new AbortController();
    // One op at a time, each against the document the last one left.
    let queue: Promise<unknown> = Promise.resolve();
    const run = (name: string, input: Record<string, unknown>, pageId?: string, callSignal?: AbortSignal): Promise<unknown> => {
      const signal = eitherSignal(controller.signal, callSignal);
      const next = queue.then(async () => {
        const before = optionsRef.current.document;
        const ran = await runLiveAgentOp(() => optionsRef.current, name, input, pageId, signal);
        const { command, output, threadsChanged } = ran;
        trackOnce('agent_webmcp');
        if (command) setActivity({ label: command.label, id: command.id });
        if (command || threadsChanged) await settled(() => optionsRef.current.document, before, command ? UNSHOWN_EDIT : UNSHOWN_THREAD);
        const commented = agentCommented(name, ran);
        optionsRef.current.onActivity(commented ? `An agent in this browser ${commented}.` : `${name} ran from an agent in this browser.`);
        return output;
      });
      queue = next.catch(() => undefined);
      return next;
    };
    const editor: WebMcpEditor = {
      run,
      view: () => {
        const { document, pageId, scene, mode, selectedIds, camera, screenRect, viewport } = optionsRef.current;
        if (!document || !pageId || !scene) return null;
        const { width, height } = viewport();
        const onScreen = scene.nodes.filter((node) => !node.parentId).map((node) => node.id).filter((id) => {
          const rect = screenRect(id);
          return rect !== null && rect.right > 0 && rect.bottom > 0 && rect.left < width && rect.top < height;
        });
        const { x, y, zoom } = camera();
        // A repo map page is not read-only to an agent: its changes land on the map's drawing (runLiveAgentOp).
        return { document, pageId, scene, mode, readOnly: Boolean(optionsRef.current.readOnly), selection: selectedIds?.() ?? [], camera: { x, y, zoom }, onScreen };
      },
      select: (nodeIds, connectorIds, reveal) => optionsRef.current.select(nodeIds, connectorIds, reveal),
    };
    void import('../../../agent/webMcpTools').then(async ({ webMcpTools }) => {
      if (controller.signal.aborted) return;
      const names = await registerWebMcpTools(context, webMcpTools(editor, { readOnly }), controller.signal);
      if (!controller.signal.aborted) setTools(names.length);
    }).catch((error: unknown) => console.warn('WebMCP tools did not load:', error));
    return () => { controller.abort(new Error(CLOSED)); setTools(0); };
  }, [readOnly]);

  // After an Undo (or any later edit) the label would name a change that is no longer there.
  return { tools, activity: activity && activity.id === (options.undoTopId ?? null) ? activity.label : null };
}
