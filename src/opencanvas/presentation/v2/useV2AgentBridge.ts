// The editor's half of the local pairing: long-poll the MCP server for op
// requests, run them against the live session, post the results back. Every op
// runs through runLiveAgentOp, as WebMCP's do, so an agent edit is one undo step
// like any other edit.
//
// One tab owns the bridge. The enable flag is per browser, so every tab would poll, and each poll ends the
// other tab's parked one: a hot loop that scattered ops across tabs (audit F2). A Web Lock lets one tab
// poll; the others wait for it and say "Connect is on in another tab". The lock is taken only once
// something answers on the port, so a tab that is merely waiting never shuts the others out. A server that
// knows tabs answers a replaced tab's poll with 409 (another browser, or an editor without Web Locks): that
// tab goes idle, keeping its lock, until the person presses "Use this tab".
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BRIDGE_POLL_SECONDS, bridgeUrls, isBridgeRequest,
  type BridgeClientInfo, type BridgePageSummary, type BridgeRequest,
} from '../../../agent/bridge/protocol';
import { agentName } from '../../../agent/agentName';
import { THREAD_WRITE_OPS } from '../../../agent/ops/surface';
import { runLiveAgentOp, type LiveAgentSession } from '../../../agent/liveOp';

/** `waiting`: nothing answers yet, the normal state until the agent starts its server. `elsewhere`: another tab has it. */
export type V2BridgeStatus = 'off' | 'connecting' | 'waiting' | 'connected' | 'elsewhere' | 'error';

export interface V2AgentBridgeOptions extends LiveAgentSession {
  readonly enabled: boolean;
  readonly port: number;
  readonly token: string;
  readonly revision: number;
  /** Id of the command on top of the undo stack: the panel offers Undo for the agent's change only while it is there. */
  readonly undoTopId?: string | null;
  readonly onActivity: (message: string) => void;
}

export interface V2AgentActivity {
  /** Who is acting: "Claude Code", the raw client name, or "Your agent". */
  readonly agent: string;
  /** What it is doing right now ("drawing"), or null once the request is answered. */
  readonly doing: string | null;
  /** Its last change, said as what it did ("added Cache"), while that change is the top of the undo stack; null otherwise. */
  readonly change: string | null;
}

interface V2AgentBridge {
  readonly status: V2BridgeStatus;
  readonly detail: string;
  readonly activity: V2AgentActivity | null;
  /** Agents that sent requests over this connection, latest first: several sessions can share one canvas. */
  readonly agents: readonly string[];
  /** "Use this tab": take the bridge back from another tab. */
  readonly claim: () => void;
}

export const TOKEN_REJECTED = 'The agent server did not accept this token. Copy the setup again and restart your agent.';
export const WAITING = 'Waiting for your agent…';
/** Another tab in this browser holds the lock, which a tab takes only once the agent's server answers (and lets go when it stops). */
export const ELSEWHERE = 'Connect is on in another tab.';
/** The server's 409: another tab, perhaps in another browser, said hello after this one. */
export const TAKEN = 'Another OpenFlowKit tab has the agent connection.';
export const stillWaiting = (port: number): string =>
  `Still waiting on 127.0.0.1:${port}. Is OpenFlowKit added to your agent, and did you restart it after? If your browser asked about local network access, allow it.`;
export const portTaken = (port: number): string =>
  `Something other than OpenFlowKit answers on 127.0.0.1:${port}. Pick another port under Connection settings and copy the setup again.`;

const RETRY_MS = 1500;
const SLOW_RETRY_MS = 5000;
const SLOW_AFTER_MS = 30_000;
const LOCK = 'ofk-agent-bridge';
const TAB_KEY = 'ofk-agent-tab';

/** Ops that only look: "is reading the canvas…" rather than "is drawing…". */
const READS = new Set(['get_document', 'list_threads', 'get_diagram', 'list_diagrams', 'list_pages', 'screenshot', 'export', 'get_syntax',
  'search_icons', 'find_icons_for', 'fit_view']);

const some = (count: number, noun: string): string => (count === 1 ? `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}` : `${count} ${noun}s`);

/** What the agent did, as a person would say it ("added Cache"), after its name; the command's label when the op says no more. */
export function agentDid(op: string, input: unknown, label: string): string {
  const fields = (input && typeof input === 'object' ? input : {}) as { label?: unknown; kind?: unknown; ids?: unknown };
  const count = Array.isArray(fields.ids) ? fields.ids.length : 0;
  const name = typeof fields.label === 'string' ? fields.label.trim().slice(0, 40) : '';
  switch (op) {
    case 'add_shape': return `added ${name || some(1, typeof fields.kind === 'string' && fields.kind !== 'process' ? fields.kind : 'shape')}`;
    case 'create_diagram': return 'drew a diagram';
    case 'update_diagram': return 'updated the diagram';
    case 'move': return `moved ${some(count, 'shape')}`;
    case 'style': return `restyled ${some(count, 'shape')}`;
    case 'delete': return `deleted ${some(count, fields.kind === 'connector' ? 'connector' : 'shape')}`;
    default: return `made a change: ${label}`;
  }
}

let tab = '';
/** One id per tab, kept across reloads, so the server can tell this tab's polls from another's. */
export function bridgeTabId(): string {
  if (tab) return tab;
  try { tab = sessionStorage.getItem(TAB_KEY) ?? ''; } catch { /* storage blocked: a per-load id still works */ }
  if (!tab) {
    tab = Math.random().toString(36).slice(2, 12);
    try { sessionStorage.setItem(TAB_KEY, tab); } catch { /* as above */ }
  }
  return tab;
}

/** This tab holds the lock (an earlier run of the effect may not have released it yet). */
let holding = false;

class Elsewhere extends Error {}

/** Resolves after `ms`, or at once on abort; leaves no listener behind either way (waiting retries for hours). */
export const pause = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal.aborted) { resolve(); return; }
  const done = (): void => { window.clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
  const timer = window.setTimeout(done, ms);
  signal.addEventListener('abort', done, { once: true });
});

const until = (signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal.aborted) resolve();
  else signal.addEventListener('abort', () => resolve(), { once: true });
});

export function useV2AgentBridge(options: V2AgentBridgeOptions): V2AgentBridge {
  const [status, setStatus] = useState<V2BridgeStatus>('off');
  const [detail, setDetail] = useState('');
  const [agents, setAgents] = useState<readonly string[]>([]);
  const [activity, setActivity] = useState<{ agent: string; doing: string | null; change: { label: string; id: string } | null } | null>(null);
  // The poll loop outlives renders; it reads the status it last set from here, not from its closure.
  const statusRef = useRef<V2BridgeStatus>('off');
  const show = useCallback((next: V2BridgeStatus, message?: string) => {
    statusRef.current = next;
    setStatus(next);
    if (message !== undefined) setDetail(message);
  }, []);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { enabled, port, token } = options;
  const [claims, setClaims] = useState(0);
  const stealRef = useRef(false);
  const claim = useCallback(() => { stealRef.current = true; setClaims((count) => count + 1); }, []);

  const identity = JSON.stringify({ documentId: options.document?.id ?? null, revision: options.revision });
  const lastHelloRef = useRef(identity);
  const announceRef = useRef<(() => Promise<void>) | null>(null);

  const stop = useCallback(() => show('off', ''), [show]);

  useEffect(() => {
    if (!enabled) { stop(); return; }
    const controller = new AbortController();
    const { signal } = controller;
    const urls = bridgeUrls(port);
    // The token rides in the query, not a header: a custom header makes every request a CORS preflight,
    // which a bridge server older than the editor cannot answer.
    const withAuth = (url: string, params: Record<string, string> = {}): string => {
      const target = new URL(url);
      for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
      target.searchParams.set('tab', bridgeTabId());
      if (optionsRef.current.token) target.searchParams.set('token', optionsRef.current.token);
      return target.toString();
    };
    const check = (response: Response): void => {
      if (response.status === 401) throw new Error(TOKEN_REJECTED);
      if (response.status === 409) throw new Elsewhere(TAKEN);
      // A route the bridge would know: some other server holds the port.
      if (response.status === 404 || response.status === 405) throw new Error(portTaken(port));
      if (!response.ok) throw new Error(`The agent bridge answered ${response.status}.`);
    };
    // Any reply at all (a 401 too) means something listens. No token: while nothing does, the console prints every
    // failed request's URL, every few seconds.
    const answers = (): Promise<boolean> => fetch(urls.health, { signal }).then(() => true, () => false);

    /** Say hello, then poll until something fails or `hold` aborts (another tab took the bridge, or cleanup). */
    const session = async (hold: AbortSignal): Promise<void> => {
      const post = (url: string, body: unknown, abort?: AbortSignal): Promise<Response> =>
        fetch(withAuth(url), { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body), signal: abort });

      const hello = async (): Promise<void> => {
        const { document, pageId, revision } = optionsRef.current;
        if (!document) return;
        lastHelloRef.current = JSON.stringify({ documentId: document.id, revision });
        const info: BridgeClientInfo = {
          documentId: document.id, name: document.name, revision, pageId: pageId ?? document.pages[0]?.id ?? '',
          pages: document.pages.map<BridgePageSummary>((page) => ({
            pageId: page.id, name: page.name, nodes: page.nodes.length, connectors: page.connectors.length,
          })),
          app: 'openflowkit-editor',
        };
        check(await post(urls.hello, { document: info }, hold));
      };

      const runRequest = async (request: BridgeRequest): Promise<void> => {
        const agent = agentName(request.client);
        setAgents((seen) => (seen[0] === agent ? seen : [agent, ...seen.filter((name) => name !== agent)].slice(0, 4)));
        setActivity((last) => ({ agent, doing: READS.has(request.op) ? 'reading the canvas' : THREAD_WRITE_OPS.has(request.op) ? 'commenting' : 'drawing', change: last?.change ?? null }));
        let result: { id: string; ok: boolean; output?: unknown; error?: string };
        try {
          const { command, output } = await runLiveAgentOp(() => optionsRef.current, request.op, request.input, request.pageId, undefined, request.client);
          const did = command ? agentDid(request.op, request.input, command.label) : null;
          setActivity((last) => ({ agent, doing: null, change: command && did ? { label: did, id: command.id } : last?.change ?? null }));
          optionsRef.current.onActivity(did ? `${agent} ${did}.` : `${agent} ran ${request.op}.`);
          result = { id: request.id, ok: true, output };
        } catch (error) {
          setActivity((last) => last && { ...last, doing: null });
          result = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        // Never under `hold`: the change is committed, so a tab that loses the bridge mid-op still answers for it.
        // Aborted, the agent would wait out its timeout and retry, drawing it twice.
        await post(urls.result, result);
      };

      const poll = async (): Promise<void> => {
        // Re-announce the document whenever it changed since the last hello so a
        // server that restarted (or missed a revision) still sees the truth.
        const current = JSON.stringify({ documentId: optionsRef.current.document?.id ?? null, revision: optionsRef.current.revision });
        if (lastHelloRef.current !== current) await hello();
        const response = await fetch(withAuth(urls.next, { wait: String(BRIDGE_POLL_SECONDS) }), { signal: hold });
        if (response.status === 204) return;
        check(response);
        const payload: unknown = await response.json();
        if (isBridgeRequest(payload)) await runRequest(payload);
      };

      // A lock granted after a wait can outlive the server: look before sending the token.
      if (!(await answers())) throw new TypeError('Nothing answers.');
      // The bridge can start before the document loads (a reload with Connect on). A poll before this tab's hello
      // reads as a stray tab to a server another tab said hello to (409), so nothing is sent until there is a document.
      while (!optionsRef.current.document) {
        await pause(100, hold);
        if (hold.aborted) return;
      }
      announceRef.current = () => hello().catch(() => undefined);
      try {
        await hello();
        show('connected', '');
        while (!hold.aborted) await poll();
      } finally {
        announceRef.current = null;
      }
    };

    let current: AbortController | null = null;
    /** One session under its own signal, so a tab whose lock is stolen stops polling at once. */
    const held = async (): Promise<'done' | 'gone' | 'error'> => {
      const hold = new AbortController();
      current = hold;
      holding = true;
      try {
        await session(hold.signal);
        return 'done';
      } catch (error) {
        if (hold.signal.aborted || signal.aborted) return 'done';
        if (error instanceof Elsewhere) {
          // Another tab, perhaps in another browser, said hello last. Stay idle, and keep the lock so a tab queued
          // behind this one cannot take the bridge back; "Use this tab" (or closing it) ends this.
          show('elsewhere', TAKEN);
          await until(hold.signal);
          return 'done';
        }
        // fetch rejects with a TypeError when no server answers at all: the agent stopped it.
        if (error instanceof TypeError) return 'gone';
        show('error', error instanceof Error ? error.message : String(error));
        return 'error';
      } finally {
        holding = false;
      }
    };

    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    let steal = stealRef.current;
    stealRef.current = false;
    /** A session holding the lock: tried first, queued behind another tab's, or stolen for "Use this tab" and #/connect. */
    const withLock = async (): Promise<'done' | 'gone' | 'error'> => {
      if (!locks) return held();
      // A lock this tab still holds from an earlier run is released in a moment: wait for it rather than say "another tab".
      const mode: LockOptions = steal ? { steal: true } : holding ? { signal } : { ifAvailable: true };
      steal = false;
      try {
        const outcome = await locks.request(LOCK, mode, (lock) => (lock && !signal.aborted ? held() : null));
        if (outcome) return outcome;
        if (signal.aborted) return 'done';
        show('elsewhere', ELSEWHERE);
        // Queued: when that tab closes or lets go, this one takes over by itself.
        return await locks.request(LOCK, { signal }, () => held());
      } catch {
        // Our own cleanup cancelled the wait, or another tab took the bridge: stop polling now. A running op still
        // posts its result (see runRequest).
        if (!signal.aborted) { current?.abort(); show('elsewhere', ELSEWHERE); }
        return 'done';
      }
    };

    // The lock is held only while something answers, so a tab that is merely waiting never shuts the others out.
    const main = async (): Promise<void> => {
      show('connecting', `127.0.0.1:${port}`);
      let waitingSince: number | null = null;
      while (!signal.aborted) {
        if (!(await answers())) {
          if (signal.aborted) return;
          waitingSince ??= Date.now();
          const slow = Date.now() - waitingSince >= SLOW_AFTER_MS;
          show('waiting', slow ? stillWaiting(port) : WAITING);
          await pause(slow ? SLOW_RETRY_MS : RETRY_MS, signal);
          continue;
        }
        waitingSince = null;
        // A retry leaves its status up until it succeeds.
        if ((await withLock()) === 'error') await pause(RETRY_MS, signal);
      }
    };
    void main();

    return () => {
      controller.abort();
      current?.abort();
      announceRef.current = null;
      setAgents([]);
      stop();
    };
    // Identity changes must NOT restart the loop (it would drop the socket on
    // every edit); hello() re-announces instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, port, token, claims, stop]);

  // Another document opened in this tab: tell the server now, not when the parked poll ends (up to 25 s).
  const documentId = options.document?.id ?? null;
  useEffect(() => {
    if (documentId && lastHelloRef.current !== identity) void announceRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // The change line is the undo top's, or nothing: after an Undo (or any later edit) the panel's Undo would act under a stale label.
  const change = activity?.change && activity.change.id === (options.undoTopId ?? null) ? activity.change.label : null;
  const shown = activity && (activity.doing || change) ? { agent: activity.agent, doing: activity.doing, change } : null;
  return { status, detail, activity: shown, agents, claim };
}

/**
 * `#/connect` (it lands on the editor as `?connect`) opens Connect agent with Connect on, so an agent or a doc can hand
 * someone one link; the editor also claims the bridge for this tab. It never carries a token: the copied setup does.
 */
export function useV2ConnectLink(onConnect: () => void): void {
  const location = useLocation();
  const navigate = useNavigate();
  const asked = new URLSearchParams(location.search).has('connect');
  useEffect(() => {
    if (!asked) return;
    onConnect();
    navigate(location.pathname, { replace: true, state: location.state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
}
