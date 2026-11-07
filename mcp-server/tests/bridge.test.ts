import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { CONNECT_URL, LiveBridge, NOT_PAIRED } from '../src/lib/bridge.js';
import { MCP_SERVER_VERSION } from '../src/lib/version.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServerWithDeps } from '../src/server.js';
import {
  bridgeTokenHeader, bridgeUrls, type BridgeRequest,
} from '../src/lib/agent.js';

// A real HTTP server on an ephemeral port with a scripted editor client, so the
// protocol (parking, routing, results, origin and token gates) is exercised
// end to end rather than mocked.

interface FakeEditor {
  readonly port: number;
  readonly stop: () => Promise<void>;
  /** Runs until one request arrives; resolves with it. */
  next(): Promise<BridgeRequest>;
  result(id: string, output: unknown): Promise<void>;
  hello(name?: string): Promise<void>;
  health(): Promise<{ connected: boolean; documentName: string | null }>;
}

async function startEditor(bridgePort: number, options: { token?: string; origin?: string } = {}): Promise<FakeEditor> {
  const urls = bridgeUrls(bridgePort);
  const headers: Record<string, string> = { 'content-type': 'text/plain;charset=UTF-8' };
  if (options.token) headers[bridgeTokenHeader] = options.token;
  if (options.origin) headers.origin = options.origin;
  let polls = 0;
  return {
    port: bridgePort,
    async hello(name = 'Editor doc') {
      await fetch(urls.hello, {
        method: 'POST', headers,
        body: JSON.stringify({ document: { documentId: 'doc-live', name, revision: 1, pageId: 'p1', pages: [{ pageId: 'p1', name: 'Page 1', nodes: 3, connectors: 2 }], app: 'test-editor' } }),
      });
    },
    async next() {
      polls += 1;
      const response = await fetch(`${urls.next}?wait=2`, { headers });
      if (response.status !== 200) throw new Error(`poll ${polls} answered ${response.status}`);
      return await response.json() as BridgeRequest;
    },
    async result(id, output) {
      await fetch(urls.result, { method: 'POST', headers, body: JSON.stringify({ id, ok: true, output }) });
    },
    async health() {
      const response = await fetch(urls.health, { headers });
      return await response.json() as { connected: boolean; documentName: string | null };
    },
    async stop() { /* the bridge owns the socket; nothing to close here */ },
  };
}

const DOCUMENT = { documentId: 'doc-live', name: 'Editor doc', revision: 1, pageId: 'p1', pages: [{ pageId: 'p1', name: 'Page 1', nodes: 3, connectors: 2 }], app: 'test-editor' };

let bridge: LiveBridge | null = null;
afterEach(async () => { await bridge?.stop(); bridge = null; });

describe('live bridge', () => {
  it('pairs an editor, reports health and routes one op round trip', async () => {
    bridge = new LiveBridge({ port: 0, log: () => undefined });
    const port = await bridge.start();
    expect(bridge.connected).toBe(false);
    expect(bridge.health()).toMatchObject({ ok: true, protocol: 1, connected: false });

    const editor = await startEditor(port);
    await editor.hello('Checkout flow');
    expect(bridge.health()).toMatchObject({ connected: true, documentId: 'doc-live', documentName: 'Checkout flow' });
    expect(bridge.health().pages).toHaveLength(1);

    // The editor parks; the call wakes it and the result comes back.
    const parked = editor.next();
    const call = bridge.call('create_diagram', { dsl: 'flowchart\n A -> B' });
    const request = await parked;
    expect(request).toMatchObject({ op: 'create_diagram' });
    expect(request.input).toEqual({ dsl: 'flowchart\n A -> B' });
    await editor.result(request.id, { frameId: 'dsl-abc', nodes: 2 });
    await expect(call).resolves.toEqual({ frameId: 'dsl-abc', nodes: 2 });
  });

  it('surfaces editor errors as rejections and refuses calls with no editor', async () => {
    bridge = new LiveBridge({ port: 0, callTimeoutMs: 1500 });
    const port = await bridge.start();
    await expect(bridge.call('get_diagram', {})).rejects.toThrow(NOT_PAIRED);

    const editor = await startEditor(port);
    await editor.hello();
    const parked = editor.next();
    // Attach the rejection expectation before awaiting the round trip so the
    // promise is never momentarily unhandled.
    const rejected = expect(bridge.call('get_diagram', {})).rejects.toThrow(/no diagram frames/);
    const request = await parked;
    await fetch(bridgeUrls(port).result, {
      method: 'POST', headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ id: request.id, ok: false, error: 'no diagram frames' }),
    });
    await rejected;
  });

  it('answers 204 when the editor has nothing to do, and times out a lost result', async () => {
    bridge = new LiveBridge({ port: 0, callTimeoutMs: 900 });
    const port = await bridge.start();
    const editor = await startEditor(port);
    await editor.hello();
    const origin = 'http://127.0.0.1:5173';
    const empty = await fetch(`${bridgeUrls(port).next}?wait=1`, { headers: { origin } });
    expect(empty.status).toBe(204);
    // A browser drops a cross-origin reply without this header — the editor would flap.
    expect(empty.headers.get('access-control-allow-origin')).toBe(origin);
    const superseded = fetch(`${bridgeUrls(port).next}?wait=5`, { headers: { origin } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const replacement = fetch(`${bridgeUrls(port).next}?wait=1`, { headers: { origin } });
    const closed = await superseded;
    expect(closed.status).toBe(204);
    expect(closed.headers.get('access-control-allow-origin')).toBe(origin);
    await replacement;

    const parked = editor.next();
    const timedOut = expect(bridge.call('get_document', {})).rejects.toThrow(/did not answer/);
    await parked;
    await timedOut;
  });

  it('rejects foreign origins and demands the token when configured', async () => {
    bridge = new LiveBridge({ port: 0, token: 'secret-token' });
    const port = await bridge.start();
    const foreign = await fetch(bridgeUrls(port).health, { headers: { origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);

    const missingToken = await fetch(bridgeUrls(port).health, { headers: { origin: 'http://localhost:5173' } });
    expect(missingToken.status).toBe(401);

    const allowed = await fetch(bridgeUrls(port).health, {
      headers: { origin: 'http://localhost:5173', [bridgeTokenHeader]: 'secret-token' },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ ok: true, connected: false });

    const inQuery = await fetch(`${bridgeUrls(port).health}?token=secret-token`, { headers: { origin: 'http://localhost:5173' } });
    expect(inQuery.status).toBe(200);
    const wrongQuery = await fetch(`${bridgeUrls(port).health}?token=nope`, { headers: { origin: 'http://localhost:5173' } });
    expect(wrongQuery.status).toBe(401);
  });

  it('refuses a browser no-cors request (no Origin, cross-site) but serves curl and Node', async () => {
    bridge = new LiveBridge({ port: 0 });
    const port = await bridge.start();
    for (const site of ['cross-site', 'same-site']) {
      const hijack = await fetch(`${bridgeUrls(port).next}?wait=1`, { headers: { 'sec-fetch-site': site } });
      expect(hijack.status).toBe(403);
      // No wildcard or echoed origin on the refusal.
      expect(hijack.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect((await fetch(bridgeUrls(port).health)).status).toBe(200);
    expect((await fetch(bridgeUrls(port).health, { headers: { 'sec-fetch-site': 'none' } })).status).toBe(200);
    const refused = await fetch(bridgeUrls(port).health, { headers: { origin: 'https://evil.example' } });
    expect(refused.status).toBe(403);
    expect(refused.headers.get('access-control-allow-origin')).toBeNull();
    const allowed = await fetch(bridgeUrls(port).health, { headers: { origin: 'http://localhost:5173' } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('answers a browser preflight for the token header without needing the token', async () => {
    bridge = new LiveBridge({ port: 0, token: 'secret-token' });
    const port = await bridge.start();
    const origin = 'http://localhost:5173';
    const preflight = await fetch(bridgeUrls(port).hello, {
      method: 'OPTIONS',
      headers: {
        origin, 'access-control-request-method': 'POST',
        'access-control-request-headers': `content-type, ${bridgeTokenHeader}`,
        'access-control-request-private-network': 'true',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
    expect(preflight.headers.get('access-control-allow-headers')).toContain(bridgeTokenHeader);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');

    const foreign = await fetch(bridgeUrls(port).hello, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
  });
  it('refuses a request whose Host is not this machine (DNS rebinding)', async () => {
    bridge = new LiveBridge({ port: 0 });
    const port = await bridge.start();
    // fetch may not set Host, so a raw request says exactly what a rebound page would send.
    const statusFor = (host: string) => new Promise<number>((done, fail) => {
      request({ host: '127.0.0.1', port, path: '/health', headers: { host } }, (res) => { res.resume(); done(res.statusCode ?? 0); })
        .on('error', fail).end();
    });
    for (const host of [`evil.example:${port}`, 'localhost.evil.example', `127.0.0.1.nip.io:${port}`]) expect(await statusFor(host), host).toBe(403);
    // Only the name matters: an SSH or devcontainer forward arrives as localhost on its own port.
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, 'LOCALHOST:9000', 'localhost']) expect(await statusFor(host), host).toBe(200);
  });

  it('refuses a malformed hello instead of pairing a phantom editor', async () => {
    bridge = new LiveBridge({ port: 0, log: () => undefined });
    const port = await bridge.start();
    for (const document of [{ documentId: 'x' }, { documentId: 'x', name: 'n', revision: 1, pageId: 'p', pages: 'none', app: 'a' }]) {
      const response = await fetch(bridgeUrls(port).hello, { method: 'POST', body: JSON.stringify({ document }) });
      expect(response.status).toBe(400);
    }
    expect(bridge.connected).toBe(false);
    expect(bridge.health()).toMatchObject({ connected: false, documentId: null });
  });
  it('says at once that the editor tab went away, instead of waiting out the call', async () => {
    bridge = new LiveBridge({ port: 0, log: () => undefined });
    const port = await bridge.start();
    const editor = await startEditor(port);
    await editor.hello();
    const tab = new AbortController();
    const parked = fetch(`${bridgeUrls(port).next}?wait=20`, { signal: tab.signal }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    tab.abort();
    await parked;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bridge.connected).toBe(false);
    const started = Date.now();
    await expect(bridge.call('get_document', {})).rejects.toThrow('The editor tab was closed or reloaded. Reopen it and press Connect.');
    expect(Date.now() - started).toBeLessThan(500);
    // Pairing again clears it.
    await editor.hello();
    expect(bridge.connected).toBe(true);
  });
  // U3 2026-10-11: the editor showed "did not accept this token" while whoami told the agent to click Connect agent.
  it('whoami says an editor was refused for its token, not that none is there', async () => {
    bridge = new LiveBridge({ port: 0, token: 'right', log: () => undefined });
    const port = await bridge.start();
    const { server } = createServerWithDeps({ bridge, log: () => undefined });
    const client = new Client({ name: 'test', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    const whoami = async () => JSON.parse((await client.callTool({ name: 'whoami', arguments: {} }) as { content: { text: string }[] }).content[0]!.text) as { hint: string };
    expect((await whoami()).hint).toBe(NOT_PAIRED);
    await (await startEditor(port, { token: 'wrong' })).hello();
    expect((await whoami()).hint).toMatch(/refused.*token/);
    expect((await client.callTool({ name: 'list_pages', arguments: {} }) as { content: { text: string }[] }).content[0]!.text).toMatch(/refused.*token/);
  });

  // Audit F2 2026-10-13: two tabs each polled ~600 times a second and four add_shape calls landed 2 + 2.
  it('two tabs never split ops: the tab that said hello last polls, the other gets 409', async () => {
    bridge = new LiveBridge({ port: 0, log: () => undefined });
    const urls = bridgeUrls(await bridge.start());
    const hello = (tab: string) => fetch(`${urls.hello}?tab=${tab}`, { method: 'POST', body: JSON.stringify({ document: DOCUMENT }) });
    const poll = (tab: string, wait = 1) => fetch(`${urls.next}?wait=${wait}&tab=${tab}`);
    await hello('A');
    await hello('B');
    // Both tabs poll (an app that ignores the 409): every op lands in B, the tab that said hello last.
    const landed: Record<'A' | 'B', string[]> = { A: [], B: [] };
    let done = false;
    const loop = async (tab: 'A' | 'B') => {
      while (!done) {
        const response = await poll(tab);
        if (response.status === 200) {
          const request = await response.json() as BridgeRequest;
          landed[tab].push(request.op);
          await fetch(urls.result, { method: 'POST', body: JSON.stringify({ id: request.id, ok: true, output: {} }) });
        } else if (response.status === 409) await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    const loops = [loop('A'), loop('B')];
    for (let i = 0; i < 4; i += 1) await bridge.call('add_shape', { i });
    done = true;
    await Promise.all(loops);
    expect(landed).toEqual({ A: [], B: ['add_shape', 'add_shape', 'add_shape', 'add_shape'] });

    // A tab displaced while parked hears it at once, with a reason it can show.
    const parkedB = poll('B', 5);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await hello('A');
    const kicked = await parkedB;
    expect(kicked.status).toBe(409);
    expect((await kicked.json() as { error: string }).error).toMatch(/another tab/i);
  });

  it('an app without tab ids (0.2.4 and older) pairs and polls as before', async () => {
    bridge = new LiveBridge({ port: 0, log: () => undefined });
    const urls = bridgeUrls(await bridge.start());
    await fetch(urls.hello, { method: 'POST', body: JSON.stringify({ document: DOCUMENT }) });
    const parked = fetch(`${urls.next}?wait=2`);
    const call = bridge.call('get_document', {});
    const response = await parked;
    expect(response.status).toBe(200);
    const request = await response.json() as BridgeRequest;
    await fetch(urls.result, { method: 'POST', body: JSON.stringify({ id: request.id, ok: true, output: 'old app' }) });
    await expect(call).resolves.toBe('old app');
    // A newer tab takes over; an old tab's poll (no id) is still served, as it was before tab ids.
    await fetch(`${urls.hello}?tab=new`, { method: 'POST', body: JSON.stringify({ document: DOCUMENT }) });
    expect((await fetch(`${urls.next}?wait=1`)).status).toBe(204);
  });

  it('each op names the agent that asked for it (MCP clientInfo.name)', async () => {
    bridge = new LiveBridge({ port: 0, log: () => undefined });
    const port = await bridge.start();
    const { server } = createServerWithDeps({ bridge, log: () => undefined });
    const client = new Client({ name: 'claude-code', version: '2.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    const editor = await startEditor(port);
    await editor.hello();
    const parked = editor.next();
    const called = client.callTool({ name: 'list_pages', arguments: {} });
    const request = await parked;
    expect(request).toMatchObject({ op: 'list_pages', client: 'claude-code' });
    await editor.result(request.id, { pages: [] });
    expect((await called).isError).toBeFalsy();
  });

  // Server instructions and errors name the one place a user pairs a tab.
  it('instructions tell the model how a drawing reaches the user', async () => {
    bridge = new LiveBridge({ port: 0, log: () => undefined });
    const { server } = createServerWithDeps({ bridge, log: () => undefined });
    const client = new Client({ name: 'test', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain(CONNECT_URL);
    expect(instructions).toMatch(/live on that canvas/);
    expect(instructions).toMatch(/file mode: openflow_create/);
    expect(NOT_PAIRED).toBe('No editor is paired. Ask the user to open https://app.openflowkit.com/#/connect and press Connect, then call again; or use file mode (openflow_create, or openflow_open with a .openflow.json path).');
  });
});

/** An MCP client session on a bridge, as an agent would hold one. */
async function agentOn(target: LiveBridge, name = 'test') {
  const { server } = createServerWithDeps({ bridge: target, log: () => undefined });
  const client = new Client({ name, version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return async (tool: string, args = {}) => {
    const result = await client.callTool({ name: tool, arguments: args });
    return { isError: result.isError === true, text: (result.content as { text: string }[])[0]!.text };
  };
}

/** A real HTTP server on a real port that answers every request with one reply: an old or foreign holder. */
async function holderAnswering(status: number, body: unknown): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((_request, response) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
}

/** One raw request, headers exactly as given (fetch adds Sec-Fetch-* of its own). */
function raw(port: number, method: string, path: string, headers: Record<string, string>, body?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path, method, headers }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, text }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

const OLD_HEALTH = { ok: true, protocol: 1, name: 'openflowkit', version: '0.2.4', connected: false, documentId: null, documentName: null, pageId: null, pages: [], lastSeenMs: null };

// Audit F1 2026-10-13: every agent session starts a server; only the first got the port, the rest were file-only.
describe('many agents, one canvas', () => {
  let guest: LiveBridge | null = null;
  afterEach(async () => { await guest?.stop(); guest = null; });

  it('a second server shares the first one\'s canvas: its ops land on the editor paired there', async () => {
    bridge = new LiveBridge({ port: 0, log: () => undefined });
    const port = await bridge.start();
    guest = new LiveBridge({ port, log: () => undefined });
    await expect(guest.start()).resolves.toBe(port);
    expect(guest.status()).toEqual({ port, state: 'shared', shared: { side: 'guest', holder: `openflowkit ${MCP_SERVER_VERSION}`, editorPaired: false } });
    const tool = await agentOn(guest, 'cursor');
    // Nobody paired yet: the guest says what to do, like any server.
    expect(await tool('list_pages')).toEqual({ isError: true, text: NOT_PAIRED });

    const editor = await startEditor(port);
    await editor.hello('Shared doc');
    const parked = editor.next();
    const listed = tool('list_pages');
    const request = await parked;
    expect(request).toMatchObject({ op: 'list_pages', client: 'cursor' });
    await editor.result(request.id, { pages: [{ pageId: 'p1' }] });
    expect(await listed).toMatchObject({ isError: false });
    expect(JSON.parse((await listed).text)).toEqual({ pages: [{ pageId: 'p1' }] });

    const whoami = JSON.parse((await tool('whoami')).text) as { mode: string; editor: { name: string }; bridge: unknown; hint: string };
    expect(whoami).toMatchObject({ mode: 'live-editor', editor: { name: 'Shared doc' }, bridge: { state: 'shared', shared: { side: 'guest', editorPaired: true } } });
    expect(whoami.hint).toMatch(/other agent sessions share/);
    expect(JSON.parse((await tool('server_info')).text)).toMatchObject({ bridge: { state: 'shared' } });
    // The holder says who draws through it.
    expect(bridge.status()).toEqual({ port, state: 'paired', shared: { side: 'holder', guests: ['cursor'] } });
  });

  it('when the holder exits, the guest takes the port and the editor pairs with it', async () => {
    const holder = new LiveBridge({ port: 0, log: () => undefined });
    const port = await holder.start();
    bridge = new LiveBridge({ port, log: () => undefined });
    await bridge.start();
    const tool = await agentOn(bridge);
    expect(JSON.parse((await tool('whoami')).text)).toMatchObject({ bridge: { state: 'shared' } });
    await holder.stop();
    expect(JSON.parse((await tool('whoami')).text)).toMatchObject({ bridge: { port, state: 'listening' } });
    const editor = await startEditor(port);
    await editor.hello();
    expect(bridge.status()).toEqual({ port, state: 'paired' });
  });

  it('a holder that exits mid-call: the guest says so and holds the port', async () => {
    const holder = new LiveBridge({ port: 0, log: () => undefined });
    const port = await holder.start();
    bridge = new LiveBridge({ port, log: () => undefined });
    await bridge.start();
    const editor = await startEditor(port);
    await editor.hello();
    await bridge.retryPort();
    expect(bridge.connected).toBe(true);
    const parked = editor.next();
    const call = expect(bridge.call('add_shape', {})).rejects.toThrow(/exited during "add_shape"; this one holds port \d+ now/);
    await parked;
    await holder.stop();
    await call;
    expect(bridge.status()).toEqual({ port, state: 'listening' });
  });

  it('a holder too busy to answer the probe in time is still the holder, not "another program" (review-1 #9)', async () => {
    // The real health of a sharing holder, then a holder that answers it once and goes quiet (a big layout in its process).
    bridge = new LiveBridge({ port: 0, log: () => undefined });
    const real = await bridge.start();
    const health = JSON.parse((await raw(real, 'GET', '/health', { host: `127.0.0.1:${real}` })).text);
    await bridge.stop();
    bridge = null;
    let answered = 0;
    const server = createServer((_request, response) => {
      if (answered++ > 0) return; // hangs: never answers again
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(health));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    try {
      guest = new LiveBridge({ port, log: () => undefined });
      await expect(guest.start()).resolves.toBe(port);
      expect(guest.status().state).toBe('shared');
      const tool = await agentOn(guest);
      expect(JSON.parse((await tool('whoami')).text)).toMatchObject({ bridge: { state: 'shared' } });
    } finally {
      await guest?.stop();
      guest = null;
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    }
  }, 20_000);

  it('a port held by something that never answers says "busy, try again", not "another program" (review-2 #6)', async () => {
    const server = createServer(() => { /* never answers */ });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    try {
      guest = new LiveBridge({ port, log: () => undefined });
      await expect(guest.start()).rejects.toThrow(/EADDRINUSE/);
      expect(guest.unpairedReason).toMatch(/did not answer in time/);
    } finally {
      await guest?.stop();
      guest = null;
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    }
  }, 20_000);

  it('refuses to share with an older server, another protocol or another program, and says which', async () => {
    const cases: [number, unknown, RegExp][] = [
      [200, OLD_HEALTH, new RegExp(`\\(0\\.2\\.4\\) owns port \\d+ and cannot share its canvas with this one \\(${MCP_SERVER_VERSION.replace(/\./g, '\\.')}\\): their bridge protocols differ`)],
      [200, { ...OLD_HEALTH, version: '9.0.0', protocol: 2, share: 1 }, /\(9\.0\.0\) owns port \d+ and cannot share/],
      [404, { error: 'nope' }, /^Another program already owns port \d+; this one can only edit files/],
    ];
    for (const [status, body, message] of cases) {
      const holder = await holderAnswering(status, body);
      guest = new LiveBridge({ port: holder.port, log: () => undefined });
      await expect(guest.start()).rejects.toThrow(/EADDRINUSE/);
      expect(guest.status()).toEqual({ port: holder.port, state: 'port-in-use' });
      const tool = await agentOn(guest);
      expect(await tool('list_pages')).toMatchObject({ isError: true, text: expect.stringMatching(message) });
      expect(JSON.parse((await tool('whoami')).text)).toMatchObject({ bridge: { state: 'port-in-use' }, hint: expect.stringMatching(message) });
      expect(JSON.parse((await tool('server_info')).text)).toMatchObject({ bridge: { state: 'port-in-use' } });
      // Gone: the next whoami takes the port (2026-10-12: it used to stay file-only forever).
      await holder.close();
      expect(JSON.parse((await tool('whoami')).text)).toMatchObject({ bridge: { state: 'listening' } });
      await guest.stop();
    }
  });

  it('a guest whose token the holder refuses says so instead of sharing', async () => {
    bridge = new LiveBridge({ port: 0, token: 'right', log: () => undefined });
    const port = await bridge.start();
    guest = new LiveBridge({ port, token: 'wrong', log: () => undefined });
    await expect(guest.start()).rejects.toThrow(/EADDRINUSE/);
    expect(guest.unpairedReason).toMatch(/refused this server's token/);
    await guest.stop();
    guest = new LiveBridge({ port, token: 'right', log: () => undefined });
    await guest.start();
    expect(guest.status().state).toBe('shared');
  });

  it('/call is for local servers only: no browser, no wrong token, no rebound Host', async () => {
    bridge = new LiveBridge({ port: 0, token: 'secret', log: () => undefined });
    const port = await bridge.start();
    const body = JSON.stringify({ op: 'list_pages', input: {} });
    const json = { host: `127.0.0.1:${port}`, 'content-type': 'application/json', [bridgeTokenHeader]: 'secret' };
    const refused: [string, string, Record<string, string>, number][] = [
      ['an allowed app origin', 'POST', { ...json, origin: 'http://localhost:5173' }, 403],
      ['a foreign origin', 'POST', { ...json, origin: 'https://evil.example' }, 403],
      ['a no-Origin browser request', 'POST', { ...json, 'sec-fetch-site': 'same-origin' }, 403],
      ['fetch metadata only', 'POST', { ...json, 'sec-fetch-mode': 'cors' }, 403],
      ['a form-encodable body', 'POST', { ...json, 'content-type': 'text/plain' }, 403],
      ['a preflight', 'OPTIONS', { ...json, origin: 'http://localhost:5173' }, 403],
      ['a GET', 'GET', json, 403],
      ['a rebound Host', 'POST', { ...json, host: `evil.example:${port}` }, 403],
      ['no token', 'POST', { host: json.host, 'content-type': 'application/json' }, 401],
      ['a wrong token', 'POST', { ...json, [bridgeTokenHeader]: 'nope' }, 401],
    ];
    for (const [name, method, headers, status] of refused) {
      const reply = await raw(port, method, '/call', headers, method === 'POST' ? body : undefined);
      expect(reply.status, name).toBe(status);
    }
    // A local server with the token runs the op exactly like a local call: here, no editor yet.
    const ok = await raw(port, 'POST', '/call', json, body);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text)).toMatchObject({ ok: false, error: NOT_PAIRED, health: { connected: false, share: 1 } });
  });
});
