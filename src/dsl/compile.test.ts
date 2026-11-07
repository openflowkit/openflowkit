import { describe, expect, it } from 'vitest';
import { format, serialize } from './serialize';
import { CONTAINER_TITLE_HEIGHT } from '../opencanvas/domain/nodes/nodeLabelBounds';
import { measureGroupSize } from './sizing';
import { compile, hashDslScene, hashText64, slugifyDslId } from './compile';

describe('compile presentation mapping', () => {
  it('maps shapes onto renderer kinds and shapes', async () => {
    const result = await compile('flowchart\nStart [ellipse]\nCheck [diamond]\nStore [cylinder]\nDoc [doc]\nActor [person]\nComponent [component]');
    const byId = Object.fromEntries(result.nodes.map((node) => [node.id, node]));
    expect(byId.start).toMatchObject({ kind: 'process', content: { shape: 'ellipse' } });
    expect(byId.check).toMatchObject({ kind: 'process', content: { shape: 'diamond' } });
    expect(byId.store).toMatchObject({ kind: 'process', content: { shape: 'cylinder' } });
    expect(byId.doc).toMatchObject({ kind: 'process', content: { shape: 'document' } });
    // A person is a user-icon card, never the blank silhouette (owner, 2026-10-11); the text keeps `[person]`.
    expect(byId.actor).toMatchObject({ kind: 'architecture', content: { icon: 'tabler/user' } });
    expect(byId.actor?.metadata.dsl).toMatchObject({ shape: 'person', autoIcon: 'tabler/user' });
    // Sized like the other icon cards, so it sits on its row instead of rising above it.
    expect(byId.actor?.size).toEqual(byId.component ? (await compile('flowchart\nX [icon: tabler/user]')).nodes[0]!.size : undefined);
    expect(byId.component).toMatchObject({ kind: 'process', content: { shape: 'rounded' } });
    expect(byId.component?.metadata.dsl).toMatchObject({ shape: 'component' });
  });

  it('sizes nodes from the measured label, not a fixed box', async () => {
    const result = await compile('flowchart\nA [cylinder]\nA background worker with a long label [cylinder]');
    const short = result.nodes.find((node) => node.id === 'a')!;
    const long = result.nodes.find((node) => node.id === 'a-background-worker-with-a-long-label')!;
    expect(long.size.width).toBeGreaterThan(short.size.width);
    expect(long.size.height).toBeGreaterThanOrEqual(short.size.height);
  });

  it('writes palette fills the style bar and renderer share', async () => {
    const result = await compile('flowchart\nA [blue]\nB [bold, red]\nC [outline, green]\nD [shadow]');
    const byId = Object.fromEntries(result.nodes.map((node) => [node.id, node]));
    expect(byId.a?.appearance).toMatchObject({ fill: '#eff6ff', stroke: '#60a5fa' });
    expect(byId.b?.appearance).toMatchObject({ fill: '#dc2626' });
    expect(byId.c?.appearance).toMatchObject({ fill: 'transparent' });
    expect(byId.d?.appearance).toMatchObject({ shadow: true });
  });

  it('resolves icons into provider-icon cards and warns on unknown ones', async () => {
    const result = await compile('architecture\nLambda [aws/lambda, green]\nMystery [icon: aws/nope]', {
      resolveIcon: (id) => id === 'aws/lambda' ? { packId: 'aws-pack', shapeId: 'compute-lambda' } : null,
    });
    const lambda = result.nodes.find((node) => node.id === 'lambda')!;
    expect(lambda).toMatchObject({
      kind: 'architecture',
      content: {
        icon: 'aws/lambda', archIconPackId: 'aws-pack', archIconShapeId: 'compute-lambda',
        archProvider: 'aws', archResourceType: 'lambda', assetPresentation: 'icon', color: 'emerald',
      },
    });
    expect(result.diagnostics.some((item) => item.code === 'W132' && item.line === 3)).toBe(true);
  });
});

describe('compile layout', () => {
  it('nests group children inside the group box, parent-relative', async () => {
    const result = await compile('architecture right\ngroup Edge [blue] {\nA\nB\nA -> B\n}\nOutside\nOutside -> A');
    const group = result.groups[0]!;
    const inside = result.nodes.filter((node) => node.parentId === group.id);
    expect(inside).toHaveLength(2);
    for (const node of inside) {
      expect(node.transform.translation.x).toBeGreaterThanOrEqual(0);
      expect(node.transform.translation.y).toBeGreaterThanOrEqual(0);
      expect(node.transform.translation.x + node.size.width).toBeLessThanOrEqual(group.size.width + 1);
      expect(node.transform.translation.y + node.size.height).toBeLessThanOrEqual(group.size.height + 1);
    }
    const outside = result.nodes.find((node) => node.id === 'outside')!;
    expect(outside.parentId).toBe(result.frame.id);
    expect(group.size.width).toBeGreaterThan(0);
  });

  it('keeps frame children parent-relative so a moved frame does not double its origin', async () => {
    const origin = { x: 500, y: 300 };
    const result = await compile('flowchart\nA -> B', { origin });
    expect(result.frame.transform.translation).toEqual(origin);
    for (const node of result.nodes) {
      expect(node.transform.translation.x).toBeLessThan(result.frame.size.width);
      expect(node.transform.translation.y).toBeLessThan(result.frame.size.height);
    }
  });

  // Orchestrator 2026-10-11: `align row B, D` put D on C's row at C's x, exactly on top of C.
  // The positions ELK gives that graph (down; for `right`, the same picture turned).
  it.each(['row', 'column'])('an `align %s` never stacks a node on another: it moves past it, inside the frame', async (axis) => {
    const at = (x: number, y: number) => (axis === 'row' ? { x, y } : { x: y, y: x });
    const layout = { run: async (graph: { rootId: string }) => ({
      positions: { a: at(48, 28), b: at(28, 144), c: at(196, 144), d: at(196, 260) },
      sizes: { [graph.rootId]: axis === 'row' ? { width: 344, height: 340 } : { width: 340, height: 344 } },
    }) };
    const result = await compile(`flowchart${axis === 'column' ? ' right' : ''}\nA -> B, C\nC -> D\nalign ${axis} B, D`, { layout, measureLabel: () => ({ width: 120, height: 52 }) });
    const box = (id: string) => {
      const node = result.nodes.find((candidate) => candidate.id === id)!;
      return { ...node.transform.translation, ...node.size };
    };
    const [b, c, d] = ['b', 'c', 'd'].map(box);
    expect(axis === 'row' ? d!.y : d!.x).toBe(axis === 'row' ? b!.y : b!.x);
    const overlaps = d!.x < c!.x + c!.width && c!.x < d!.x + d!.width && d!.y < c!.y + c!.height && c!.y < d!.y + d!.height;
    expect(overlaps).toBe(false);
    expect(d!.x + d!.width).toBeLessThanOrEqual(result.frame.size.width);
    expect(d!.y + d!.height).toBeLessThanOrEqual(result.frame.size.height);
  });

  it('an aligned node moved past a sibling stays inside its group, and the group inside the frame', async () => {
    const layout = { run: async (graph: { rootId: string }) => ({
      positions: { g: { x: 28, y: 28 }, a: { x: 42, y: 54 }, b: { x: 22, y: 170 }, c: { x: 190, y: 170 }, d: { x: 190, y: 286 } },
      sizes: { [graph.rootId]: { width: 400, height: 420 }, g: { width: 332, height: 360 } },
    }) };
    const result = await compile('flowchart\ngroup G {\n  A -> B\n  A -> C\n  C -> D\n}\nalign row B, D', { layout, measureLabel: () => ({ width: 120, height: 52 }) });
    const g = result.groups.find((group) => group.id === 'g')!;
    const d = result.nodes.find((node) => node.id === 'd')!;
    expect(d.transform.translation.y).toBe(170);
    expect(d.transform.translation.x + d.size.width).toBeLessThanOrEqual(g.size.width);
    expect(g.transform.translation.x + g.size.width).toBeLessThanOrEqual(result.frame.size.width);
  });

  it('a note follows its node when `align` moves it', async () => {
    const layout = { run: async (graph: { rootId: string }) => ({
      positions: { a: { x: 48, y: 28 }, b: { x: 28, y: 144 }, c: { x: 196, y: 144 }, d: { x: 196, y: 260 } },
      sizes: { [graph.rootId]: { width: 600, height: 400 } },
    }) };
    const result = await compile('flowchart\nA -> B, C\nC -> D\nnote D : hi\nalign row B, D', { layout, measureLabel: () => ({ width: 120, height: 52 }) });
    const d = result.nodes.find((node) => node.id === 'd')!;
    const note = result.nodes.find((node) => (node.metadata.dsl as { noteFor?: string }).noteFor === 'd')!;
    expect(note.transform.translation.x).toBe(d.transform.translation.x + d.size.width + 36);
    expect(Math.abs(note.transform.translation.y - d.transform.translation.y)).toBeLessThan(d.size.height);
  });

  it('honours width, height and pin attributes', async () => {
    const result = await compile('flowchart\nA [width: 300, height: 90]\nB [pin: 40,20]\nC [pin: "10,12"]');
    const a = result.nodes.find((node) => node.id === 'a')!;
    const b = result.nodes.find((node) => node.id === 'b')!;
    const c = result.nodes.find((node) => node.id === 'c')!;
    expect(a.size).toEqual({ width: 300, height: 90 });
    expect(b.transform.translation).toEqual({ x: 40, y: 20 });
    expect(c.transform.translation).toEqual({ x: 10, y: 12 });
  });

  it('creates sticky notes anchored to their target', async () => {
    const result = await compile('flowchart\nAPI\nnote API : retries twice');
    const note = result.nodes.find((node) => node.kind === 'sticky')!;
    const api = result.nodes.find((node) => node.id === 'api')!;
    expect(note.content).toMatchObject({ label: 'retries twice' });
    expect(note.metadata.dsl).toMatchObject({ noteFor: 'api' });
    expect(api.metadata.dsl).toMatchObject({ notes: ['retries twice'] });
    expect(note.transform.translation.x).toBeGreaterThan(api.transform.translation.x + api.size.width);
  });

  it('reserves room for a note: it overlaps no node and stays inside its group and the frame', async () => {
    const result = await compile('flowchart down\ngroup G {\n  A\n  B\n}\nA -> B -> C\nnote B : a longer note about B that wraps over lines\nnote B : and a second one');
    const box = (node: { transform: { translation: { x: number; y: number } }; size: { width: number; height: number } }) =>
      ({ ...node.transform.translation, ...node.size });
    const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const notes = result.nodes.filter((node) => node.kind === 'sticky');
    expect(notes).toHaveLength(2);
    const group = result.groups.find((node) => node.id === 'g')!;
    for (const note of notes) {
      // Children are placed relative to their group, so only siblings are compared.
      for (const other of result.nodes.filter((node) => node.id !== note.id && node.parentId === note.parentId)) {
        expect(overlap(box(note), box(other)), `${note.id} over ${other.id}`).toBe(false);
      }
      expect(note.parentId).toBe('g');
      expect(note.transform.translation.x + note.size.width).toBeLessThanOrEqual(group.size.width);
      expect(note.transform.translation.y + note.size.height).toBeLessThanOrEqual(group.size.height);
    }
    const b = result.nodes.find((node) => node.id === 'b')!;
    expect(notes.every((note) => note.transform.translation.x > b.transform.translation.x + b.size.width)).toBe(true);
  });

  it('draws opposite edges as two lanes on the facing sides', async () => {
    const result = await compile('flowchart right\nA -> B\nB --> A\nC --> C\nD -> E\nE -> F\nD -> F');
    const anchor = (connectorId: string, end: 'source' | 'target') => result.connectors.find((c) => c.id === connectorId)![end].anchor;
    const forward = result.connectors[0]!;
    const back = result.connectors[1]!;
    expect(forward.source.anchor).toMatchObject({ side: 'right' });
    expect(forward.target.anchor).toMatchObject({ side: 'left' });
    expect(back.source.anchor).toMatchObject({ side: 'left' });
    expect(back.target.anchor).toMatchObject({ side: 'right' });
    // Lane 1 is the same height at both ends, lane 2 another one: two straight, separate lines.
    expect(forward.source.anchor).toMatchObject({ ratio: (forward.target.anchor as { ratio: number }).ratio });
    expect((forward.source.anchor as { ratio: number }).ratio).not.toBe((back.source.anchor as { ratio: number }).ratio);
    // An edge with no twin keeps the router's choice.
    expect(anchor(result.connectors[3]!.id, 'source')).toBeNull();
  });

  it('leaves room for a self-loop and its label inside the frame', async () => {
    const result = await compile('flowchart right\nA --> A : again');
    const a = result.nodes.find((node) => node.id === 'a')!;
    // The loop bumps 48px out of the right side; its label sits on that bump.
    expect(a.transform.translation.x + a.size.width + 48 + 'again'.length * 7).toBeLessThanOrEqual(result.frame.size.width);
  });

  it('uses injected measurement and layout ports', async () => {
    const result = await compile('flowchart\nA -> B', {
      measureLabel: () => ({ width: 99, height: 44 }),
      layout: { run: async (graph) => ({ positions: { a: { x: 10, y: 20 }, b: { x: 210, y: 20 } }, sizes: { [graph.rootId]: { width: 500, height: 300 } } }) },
      origin: { x: 100, y: 200 },
    });
    expect(result.nodes[0]).toMatchObject({ size: { width: 99, height: 44 }, transform: { translation: { x: 10, y: 20 } } });
    expect(result.nodes[1]?.transform.translation.x).toBe(210);
    expect(result.frame.size).toEqual({ width: 500, height: 300 });
  });
});

describe('compile graph structure', () => {
  it('declares nodes once, first group wins, later attributes fill gaps', async () => {
    const result = await compile('flowchart\ngroup One { A }\ngroup Two { A [blue] }\nB -> A');
    expect(result.nodes.map((node) => node.id).sort()).toEqual(['a', 'b']);
    expect(result.nodes.find((node) => node.id === 'a')?.parentId).toBe('one');
    expect(result.nodes.find((node) => node.id === 'a')?.appearance).toMatchObject({ fill: '#eff6ff' });
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'W121' })]));
  });

  // `a = Foo {bar}` used to open a group `a` around a node `bar`, silently. The text is still read that way; it now says so.
  it('warns when a `{…}` closed on the same line turns a label into a group, and suggests quotes', async () => {
    const result = await compile('flowchart\na = Foo {bar}\nb = Baz\na -> b');
    const warning = result.diagnostics.find((item) => item.code === 'W106');
    expect(warning).toMatchObject({ severity: 'warning', line: 2 });
    expect(warning!.message).toMatch(/opens a group/);
    expect(warning!.hint).toContain('"Foo {bar}"');
    expect(result.groups.map((group) => group.id)).toEqual(['a']);
    // What it was meant to be, written the way the grammar asks for it.
    const quoted = await compile('flowchart\na = "Foo {bar}"\nb = Baz\na -> b');
    expect(quoted.diagnostics.filter((item) => item.code === 'W106')).toEqual([]);
    expect(quoted.nodes.find((node) => node.id === 'a')!.content.label).toBe('Foo {bar}');
  });

  it('reports a stray closing brace on its own line, not on line 1', async () => {
    const result = await compile('flowchart\nA -> B\nB -> C\n}\n');
    expect(result.diagnostics.find((item) => item.message.includes('Unexpected block close'))).toMatchObject({ line: 4 });
  });

  it('does not warn about a group written as one', async () => {
    for (const text of ['flowchart\ngroup Zoo { A }\nA -> B', 'flowchart\ngroup Zoo {\n  A\n}\nA -> B', 'flowchart\nZoo {\n  A\n}\nA -> B', 'state\nstate Running { A }\nA -> B']) {
      expect((await compile(text)).diagnostics.filter((item) => item.code === 'W106')).toEqual([]);
    }
  });

  it('resolves bare references to an explicit id', async () => {
    const result = await compile('flowchart\napi = API Gateway [rounded]\ndb = Customer records [cylinder]\napi -> db : reads');
    expect(result.nodes.map((node) => node.id)).toEqual(['api', 'db']);
    expect(result.nodes[0]?.content.label).toBe('API Gateway');
    expect(result.connectors[0]).toMatchObject({ source: { nodeId: 'api' }, target: { nodeId: 'db' } });
  });

  // Persona U2 (2026-10-11): `Ledger DB = Aurora Postgres` warned "slugified as ledger-db", then
  // `Payments API -> Ledger DB` made a second node `ledger-db-2` and left the declared one unconnected.
  it.each(['flowchart', 'architecture', 'state'])('a reference written as a slugified explicit id is that node: %s', async (family) => {
    const text = `${family}\ngroup Private {\n  Ledger DB = Aurora Postgres\n  a.b = Thing\n}\nPayments API -> Ledger DB : write\nPayments API -> a.b\nX -> ledger-db`;
    const result = await compile(text);
    const ids = (scene: typeof result) => scene.nodes.map((node) => node.id).sort();
    const ends = (scene: typeof result) => scene.connectors.map((connector) => `${connector.source.nodeId}->${connector.target.nodeId}`);
    expect(ids(result)).toEqual(['a-b', 'ledger-db', 'payments-api', 'x']);
    expect(ends(result)).toEqual(['payments-api->ledger-db', 'payments-api->a-b', 'x->ledger-db']);
    expect(result.diagnostics.filter((item) => item.code === 'W120').map((item) => item.message)).toEqual([
      'Invalid explicit id Ledger DB; slugified as ledger-db', 'Invalid explicit id a.b; slugified as a-b',
    ]);
    const again = await compile(serialize(result));
    expect(ids(again)).toEqual(ids(result));
    expect(ends(again)).toEqual(ends(result));
  });

  it('keeps every written id its own node when their slugs collide (CJK, a.b beside a-b)', async () => {
    const cjk = await compile('flowchart\n数据库 = Postgres\n缓存 = Redis\nApp -> 数据库\nApp -> 缓存');
    const label = (scene: typeof cjk, id: string | null) => scene.nodes.find((node) => node.id === id)?.content.label;
    expect(cjk.nodes.map((node) => node.content.label)).toEqual(['Postgres', 'Redis', 'App']);
    expect(cjk.connectors.map((connector) => label(cjk, connector.target.nodeId))).toEqual(['Postgres', 'Redis']);
    const dotted = await compile('flowchart\na.b = First\na-b = Second\nX -> a.b');
    expect(dotted.nodes.map((node) => node.content.label)).toEqual(['First', 'Second', 'X']);
    expect(label(dotted, dotted.connectors[0]!.target.nodeId)).toBe('First');
    for (const scene of [cjk, dotted]) {
      const again = await compile(serialize(scene));
      expect(again.connectors.map((connector) => label(again, connector.target.nodeId))).toEqual(scene.connectors.map((connector) => label(scene, connector.target.nodeId)));
    }
  });

  // Owner decision 2026-10-11: a node labelled exactly the reference text wins; a written id is a fallback.
  it.each([
    'ldb = Ledger DB\nLedger DB = Postgres',
    'Ledger DB = Postgres\nldb = Ledger DB',
  ])('a reference that is both a label and a slugified written id names the labelled node: %s', async (declarations) => {
    const result = await compile(`flowchart\n${declarations}\nA -> Ledger DB`);
    expect(result.connectors[0]!.target.nodeId).toBe('ldb');
  });

  // Orchestrator 2026-10-11: `Client [blue] [pin: "228,28"] -> API` silently made a node named `Client [pin : 228,28]`.
  it('warns on a second [ ] list after a name, with the merged list as the fix, and keeps the name clean', async () => {
    const result = await compile('flowchart\nClient [blue] [pin: "228,28"] -> API');
    expect(result.nodes.map((node) => node.content.label)).toEqual(['Client', 'API']);
    // The first list still applies, exactly as on its own.
    const single = await compile('flowchart\nClient [blue] -> API');
    expect(result.nodes[0]!.appearance).toEqual(single.nodes[0]!.appearance);
    expect(result.nodes[0]!.appearance).not.toEqual((await compile('flowchart\nClient -> API')).nodes[0]!.appearance);
    const warning = result.diagnostics.find((item) => item.code === 'W101')!;
    expect(warning).toMatchObject({ severity: 'warning', line: 2, message: 'A second [ ] list after a name is not read; list dropped', hint: 'merge into one [ ] list: [blue, pin: "228,28"]' });
  });

  it('an explicit id is a new node even when its label is taken (two nodes called API)', async () => {
    const result = await compile('flowchart\ngroup A {\n  API\n}\ngroup B {\n  api-2 = API\n}\nAPI -> api-2\nAPI -> Client');
    expect(result.nodes.slice(0, 2).map((node) => [node.id, node.content.label, node.parentId])).toEqual([['api', 'API', 'a'], ['api-2', 'API', 'b']]);
    expect(result.diagnostics.filter((item) => item.code === 'W121')).toEqual([]);
    expect(result.connectors.map((connector) => connector.source.nodeId)).toEqual(['api', 'api']);
    const again = await compile(serialize({ frame: result.frame, nodes: result.nodes, groups: result.groups, connectors: result.connectors }));
    expect(again.nodes.map((node) => [node.id, node.content.label])).toEqual(result.nodes.map((node) => [node.id, node.content.label]));
  });

  it.each([
    'flowchart\nAPI -> DB\ngateway = API [blue]',
    'flowchart\ngw = API\napi = API\ngw -> api',
    'flowchart\nAPI -> DB\nAPI = API [blue]',
  ])('shared labels survive serialize → compile: %s', async (source) => {
    const first = await compile(source);
    const shape = (result: typeof first) => [
      result.nodes.map((node) => `${node.id}:${String(node.content.label)}`).sort(),
      result.connectors.map((connector) => `${connector.source.nodeId}->${connector.target.nodeId}`).sort(),
    ];
    const again = await compile(serialize({ frame: first.frame, nodes: first.nodes, groups: first.groups, connectors: first.connectors }));
    expect(shape(again)).toEqual(shape(first));
  });

  it('labels that read as keywords or punctuation (queue, ...etc) survive serialize → compile', async () => {
    const result = await compile('flowchart\n"queue" [queue]\n"person" [person]\n"system"\n"...etc" -> "(beta) API"\n"title" [blue]\n"direction" -> "group"');
    expect(result.diagnostics.filter((item) => item.severity !== 'info')).toEqual([]);
    const text = serialize({ frame: result.frame, nodes: result.nodes, groups: result.groups, connectors: result.connectors });
    const again = await compile(text);
    expect(again.diagnostics.filter((item) => item.severity !== 'info')).toEqual([]);
    expect(again.nodes.map((node) => node.content.label).sort()).toEqual(['queue', 'person', 'system', '...etc', '(beta) API', 'title', 'direction', 'group'].sort());
  });

  it('an edge that names a group ends on the group frame, wherever the group opens; a node statement of that name wins', async () => {
    const result = await compile('flowchart\nClient -> Payments : pays\ngroup Payments {\n  Pay -> Stripe\n  Pay -> Payments\n}\ngroup pay-box = Box {\n  x\n}\nClient -> pay-box');
    expect(result.diagnostics.filter((item) => item.severity !== 'info')).toEqual([]);
    expect(result.nodes.map((node) => node.id).sort()).toEqual(['client', 'pay', 'stripe', 'x']);
    expect(result.connectors.map((connector) => `${connector.source.nodeId}->${connector.target.nodeId}`))
      .toEqual(['client->payments', 'pay->stripe', 'pay->payments', 'client->pay-box']);
    const text = serialize({ frame: result.frame, nodes: result.nodes, groups: result.groups, connectors: result.connectors });
    const again = await compile(text);
    expect(again.nodes.map((node) => node.id).sort()).toEqual(['client', 'pay', 'stripe', 'x']);
    expect(again.connectors.map((connector) => connector.target.nodeId).sort()).toEqual(['pay-box', 'payments', 'payments', 'stripe']);

    const shadowed = await compile('flowchart\ngroup Payments {\n  Pay\n}\nPayments [red]\nClient -> Payments');
    expect(shadowed.connectors[0]?.target.nodeId).toBe('payments-2');
    const shadowedText = serialize({ frame: shadowed.frame, nodes: shadowed.nodes, groups: shadowed.groups, connectors: shadowed.connectors });
    expect((await compile(shadowedText)).connectors[0]?.target.nodeId).toBe('payments-2');

    // A group and a node that share a label, with edges to both: the edge to the group names its id.
    for (const source of ['flowchart\ngroup API {\n  API\n}\nClient -> API\nAPI -> Client', 'flowchart\nAPI [red]\ngroup API {\n  x\n}\nClient -> API']) {
      const both = await compile(source);
      both.connectors.forEach((connector) => connector.target.nodeId === 'client' || expect(connector.target.nodeId).toBe(both.nodes.find((node) => node.content.label === 'API')!.id));
      const bothText = serialize({ frame: both.frame, nodes: both.nodes, groups: both.groups, connectors: both.connectors });
      const ends = (scene: typeof both) => scene.connectors.map((connector) => `${connector.source.nodeId}->${connector.target.nodeId}`);
      expect(ends(await compile(bothText)), bothText).toEqual(ends(both));
    }
    const toGroup = await compile('flowchart\ngroup API {\n  API\n}\nClient -> api');
    const groupText = serialize({ frame: toGroup.frame, nodes: toGroup.nodes, groups: toGroup.groups, connectors: toGroup.connectors });
    expect(toGroup.connectors[0]?.target.nodeId).toBe('api');
    expect((await compile(groupText)).connectors[0]?.target.nodeId, groupText).toBe('api');
  });

  it('a quoted \\n is a line break in node, edge and mindmap labels, and survives serialize → compile', async () => {
    const result = await compile('flowchart\n"Line one\\nLine two" -> B : "edge\\nlabel"');
    expect(result.nodes.map((node) => node.content.label)).toEqual(['Line one\nLine two', 'B']);
    expect(result.connectors[0]?.labels[0]?.text).toBe('edge\nlabel');
    const text = serialize({ frame: result.frame, nodes: result.nodes, groups: result.groups, connectors: result.connectors });
    expect(text).toContain('"Line one\\nLine two" -> B : "edge\\nlabel"');
    expect((await compile(text)).nodes[0]?.content.label).toBe('Line one\nLine two');
    expect((await compile('mindmap\nRoot\n  "kid\\nline"')).nodes.map((node) => node.content.label)).toContain('kid\nline');
  });

  it('a quoted \\n anywhere a writer does not quote (attrs, notes, conditions, steps, members) stays one line', async () => {
    for (const source of [
      'flowchart\nx [desc: "a\\nb"] -> y',
      'flowchart\nx -> y\nnote x : "a\\nb"',
      'sequence\nalt "c1\\nc2" {\n  A -> B : x\n}',
      'flowchart\n"one two" -> y\nanimate {\n  step "one\\ntwo" : x -> y\n}',
      'class\nFoo {\n  "+a\\nb"\n}',
    ]) {
      const once = await format(source);
      expect(await format(once), once).toBe(once);
      expect((await compile(once)).diagnostics.filter((item) => item.severity !== 'info'), once).toEqual([]);
    }
  });

  it('warns when a repeated declaration tries to move a node between groups', async () => {
    const result = await compile('flowchart\ngroup One { A }\ngroup Two {\n  A\n}');
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'W121', severity: 'warning' })]));
  });

  it('keeps stable ids and utility functions deterministic', async () => {
    const first = await compile('flowchart\nAPI -> API Gateway\nAPI -> API Gateway');
    const second = await compile('flowchart\nAPI -> API Gateway\nAPI -> API Gateway');
    expect(first.nodes.map(({ id }) => id)).toEqual(['api', 'api-gateway']);
    expect(second.nodes.map(({ id }) => id)).toEqual(first.nodes.map(({ id }) => id));
    expect(first.connectors.map(({ id }) => id)).toEqual(['edge:api->api-gateway:1', 'edge:api->api-gateway:2']);
    expect(slugifyDslId('Żółć API')).toBe('zo-c-api');
    expect(hashDslScene('same')).toBe(hashDslScene('same'));
  });

  // The published FNV-1a 64 test vectors (code units below 0x80 are the bytes the reference hashes).
  it('hashes text to 64-bit FNV-1a, as 16 hex digits', () => {
    expect(hashText64('')).toBe('cbf29ce484222325');
    expect(hashText64('a')).toBe('af63dc4c8601ec8c');
    expect(hashText64('foobar')).toBe('85944171f73967e8');
    // Two texts the 32-bit hash cannot tell apart.
    const pair = ['flowchart\nA -> B229599', 'flowchart\nA -> B432382'].map((text) => JSON.stringify([text, null, null]));
    expect(hashDslScene(pair[0]!)).toBe(hashDslScene(pair[1]!));
    expect(hashText64(pair[0]!)).not.toBe(hashText64(pair[1]!));
  });

  it('records the frame meta the code panel binds to', async () => {
    const text = 'architecture down\ntitle: Shop\nAPI -> DB';
    const result = await compile(text);
    expect(result.frame).toMatchObject({
      kind: 'frame', content: { label: 'Shop' },
      metadata: { dsl: { family: 'architecture', direction: 'down', version: 1, source: text } },
    });
    expect(typeof result.meta.hash).toBe('string');
  });
});

describe('compile connectors', () => {
  it('writes the appearance keys the renderer honours', async () => {
    const result = await compile('flowchart\nA -> B : solid\nB --> C : dashed\nC <-> D\nD <--> E\nE -- F\nF -> G [thick, head: circle]\nA -> H [from: right, to: left]');
    const byPair = Object.fromEntries(result.connectors.map((connector) => [`${connector.source.nodeId}->${connector.target.nodeId}`, connector]));
    expect(byPair['a->b']?.appearance).toEqual({ markerEnd: 'arrow' });
    expect(byPair['b->c']?.appearance).toEqual({ dashPattern: 'dashed', markerEnd: 'arrow' });
    expect(byPair['c->d']?.appearance).toEqual({ markerStart: 'arrow', markerEnd: 'arrow' });
    expect(byPair['d->e']?.appearance).toEqual({ dashPattern: 'dashed', markerStart: 'arrow', markerEnd: 'arrow' });
    expect(byPair['e->f']?.appearance).toEqual({});
    expect(byPair['f->g']?.appearance).toEqual({ markerEnd: 'circle', strokeWidth: 2.5 });
    expect(byPair['a->h']?.source.anchor).toEqual({ kind: 'side', side: 'right', ratio: 0.5 });
    expect(byPair['a->h']?.target.anchor).toEqual({ kind: 'side', side: 'left', ratio: 0.5 });
    expect(result.connectors[0]?.labels[0]?.text).toBe('solid');
  });

  it('keeps unknown attributes on the record for round-trip', async () => {
    const result = await compile('flowchart\nA -> B : goes [custom: 1]');
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'W131', line: 2 })]));
    expect(result.connectors[0]?.metadata.dsl).toMatchObject({ attrs: [{ key: 'custom', value: '1' }] });
  });

  it('keeps a column named title, direction or appearance inside its entity', async () => {
    const result = await compile('erd\ncourses {\n  id uuid pk\n  title text\n  direction text\n  appearance text\n}\nlessons {\n  title text\n}\ncourses ||--o{ lessons : contains\n');
    const fields = (id: string) => (result.nodes.find((node) => node.id === id)!.content.erFields as { name: string }[]).map((field) => field.name);
    expect(fields('courses')).toEqual(['id', 'title', 'direction', 'appearance']);
    expect(fields('lessons')).toEqual(['title']);
    expect(result.meta.title).toBeUndefined();
    expect(result.diagnostics.filter((item) => item.code === 'W104' || item.code === 'W101' || item.code === 'W102')).toEqual([]);
    const titled = await compile('erd\ntitle: School\ncourses {\n  title text\n}\n');
    expect(titled.meta.title).toBe('School');
    expect((titled.nodes[0]!.content.erFields as { name: string }[]).map((field) => field.name)).toEqual(['title']);
  });
});

describe('compile section headers', () => {
  // Every family that shows the frame title keeps its content below the 40px header band, with air.
  const TITLED: Record<string, string> = {
    flowchart: 'flowchart down\ntitle: Order flow\nA -> B',
    architecture: 'architecture\ntitle: Order flow\nA -> B',
    state: 'state\ntitle: Order flow\nA -> B',
    class: 'class\ntitle: Order flow\nclass A {\n+x: int\n}\nclass B {\n+y: int\n}\nA --> B',
    erd: 'erd\ntitle: Order flow\nA {\nid int\n}\nB {\nid int\n}\nA ||--o{ B',
    c4: 'architecture\ntitle: Order flow\nmodel {\n  person Customer\n  system Shop\n  Customer -> Shop\n}\nviews {\n  view context of Shop\n}',
    sequence: 'sequence\ntitle: Order flow\nA -> B: hi',
    'sequence with an actor': 'sequence\ntitle: Order flow\nactor A\nA -> B: hi',
    gitgraph: 'gitgraph\ntitle: Order flow\ncommit\ncommit',
    mindmap: 'mindmap\ntitle: Order flow\nRoot\n  A\n  B',
  };

  it.each(Object.entries(TITLED))('%s: every direct frame child starts below the title band', async (_family, text) => {
    const result = await compile(text);
    const children = [...result.groups, ...result.nodes].filter((node) => node.parentId === result.frame.id);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child.transform.translation.y, child.id).toBeGreaterThanOrEqual(CONTAINER_TITLE_HEIGHT + 16);
    }
  });

  it('an untitled graph keeps its tight padding', async () => {
    const result = await compile('flowchart\nA -> B');
    expect(Math.min(...result.nodes.map((node) => node.transform.translation.y))).toBe(28);
  });

  it('a long title widens the frame to hold it', async () => {
    const title = 'A very long diagram title that keeps going well past the width of two small boxes';
    for (const text of [`flowchart\ntitle: ${title}\nA -> B`, `sequence\ntitle: ${title}\nA -> B: hi`, `gitgraph\ntitle: ${title}\ncommit`]) {
      const result = await compile(text);
      expect(result.frame.size.width, text.split('\n')[0]).toBeGreaterThanOrEqual(measureGroupSize(title, true).width);
    }
  });

  it('a chart, which prints its own title, is not widened by it', async () => {
    const title = 'A very long chart title that keeps going well past the width of the plot area itself here';
    const result = await compile(`chart bar\ntitle: ${title}\nA: 1\nB: 2`);
    expect(result.frame.size.width).toBeLessThan(measureGroupSize(title, true).width);
  });

  it('a C4 boundary leaves its kind tag a line below its last child', async () => {
    const result = await compile('architecture\nmodel {\n  system Shop {\n    container Web\n    container API\n  }\n}\nviews {\n  view container of Shop\n}');
    const boundary = result.groups.find((group) => group.content.label === 'Shop')!;
    const children = result.nodes.filter((node) => node.parentId === boundary.id);
    expect(children.length).toBeGreaterThan(0);
    const bottom = Math.max(...children.map((node) => node.transform.translation.y + node.size.height));
    // The kind tag is drawn from 22px above the boundary's bottom edge: the last child ends clear above it.
    expect(bottom + 8).toBeLessThanOrEqual(boundary.size.height - 22);
  });
});
