import { describe, expect, it } from 'vitest';
import { createTestConnector, createTestDocument, createTestNode } from '../../testing/builders/documentBuilder';
import { exportCanonicalSvg, iconArtKey } from './canonicalSvg';
import { connectorLabelLineHeight, connectorLabelLines, connectorLabelPlate } from '../../domain/connectors/labelStyle';
import { projectPageConnectors } from '../../domain/connectors/routeProjection';
import { compile } from '../../../dsl/compile';
import { iconContent } from '../../domain/nodes/iconNode';
import { architectureIconBounds } from '../../domain/nodes/iconCardLayout';
import { createPresetFrame } from '../../domain/nodes/framePreset';
import { createWidgetNode } from '../../domain/nodes/widgetNode';

const DSL_FIXTURES = import.meta.glob('../../../dsl/fixtures/**/*.dsl', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

describe('canonical SVG export', () => {
  it('fills a node with its gradient and casts its own shadow', () => {
    const node = createTestNode('a', { kind: 'process', appearance: {
      fill: '#dae8fc', gradientColor: '#7ea6e0', gradientDirection: 'east',
      shadow: true, shadowColor: '#ff0000', shadowOpacity: 0.25, shadowBlur: 1, shadowOffsetX: 2, shadowOffsetY: 3,
    } });
    const svg = exportCanonicalSvg(createTestDocument({ nodes: [node] }));
    expect(svg).toContain('<linearGradient id="gradient-a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#dae8fc"/><stop offset="1" stop-color="#7ea6e0"/></linearGradient>');
    expect(svg).toContain('fill="url(#gradient-a)"');
    expect(svg).toContain('<feDropShadow dx="2" dy="3" stdDeviation="1" flood-color="#ff0000" flood-opacity="0.25"/>');
  });

  it('sets a rich label line by line: styled runs, its own alignment, a divider across the box', () => {
    const node = createTestNode('t', { kind: 'process', size: { width: 160, height: 80 }, appearance: { textVerticalAlign: 'top', textAlign: 'start', textPadding: 0 }, content: {
      label: 'Holiday\nIdHoliday',
      richLabel: [
        { kind: 'text', align: 'center', runs: [{ text: 'Holiday', bold: true, underline: true }] },
        { kind: 'rule', spaceBefore: 6, spaceAfter: 6 },
        { kind: 'text', indent: 8, runs: [{ text: 'Id', color: '#ff0000' }, { text: 'Holiday' }] },
      ],
    } });
    const svg = exportCanonicalSvg(createTestDocument({ nodes: [node] }));
    expect(svg).toMatch(/<text x="80" y="[\d.]+" text-anchor="middle"[^>]*><tspan [^>]*font-weight="700" text-decoration="underline">Holiday<\/tspan><\/text>/);
    expect(svg).toMatch(/<text x="8" [^>]*text-anchor="start"[^>]*><tspan fill="#ff0000"[^>]*>Id<\/tspan><tspan [^>]*>Holiday<\/tspan><\/text>/);
    expect(svg).toMatch(/<line x1="0" x2="160" y1="[\d.]+" y2="[\d.]+"/);
  });

  it('a C4 element with a long description wraps it inside its box', async () => {
    const compiled = await compile('architecture\nmodel {\n system Shop {\n  container API [tech: Go, desc: "Handles every order, payment, refund and shipping request from the web and mobile clients"]\n }\n}\nviews { view container of Shop }\n');
    const api = compiled.nodes.find((node) => node.id === 'shop.api')!;
    const sub = exportCanonicalSvg(createTestDocument({ nodes: [{ ...api, parentId: null }] })).match(/<text[^>]*opacity="0.72">(.*?)<\/text>/)!;
    const lines = [...sub[1]!.matchAll(/<tspan x="[^"]*" y="([^"]*)">([^<]*)</g)];
    expect(lines.length).toBeGreaterThan(2);
    expect(Number(lines.at(-1)![1])).toBeLessThan(api.size.height);
    expect(lines.map((line) => line[2]).join(' ')).toContain('mobile clients');
  });

  it('wraps a long sub-label at the canvas sub-label size and keeps it inside the node', () => {
    const node = createTestNode('api', {
      kind: 'process', size: { width: 320, height: 75 },
      content: { label: 'API', subLabel: '[Container · Go]\nHandles every order, payment, refund and shipping request from the web and mobile clients' },
    });
    const svg = exportCanonicalSvg(createTestDocument({ nodes: [node] }), { padding: 0 });
    const sub = svg.match(/<text[^>]*opacity="0.72">(.*?)<\/text>/)!;
    expect(sub[0]).toContain('font-size="11"');
    const ys = [...sub[1]!.matchAll(/<tspan x="[^"]*" y="([^"]*)"/g)].map((match) => Number(match[1]));
    expect(ys.length).toBeGreaterThan(1);
    expect(ys.at(-1)!).toBeLessThan(75);
  });

  it('wraps the sub-label where the sizing policy wraps it on the canvas', () => {
    const node = createTestNode('api', {
      kind: 'process', size: { width: 320, height: 110 },
      content: {
        label: 'API', subLabel: '[Container · Go]\nHandles every order, payment, refund and shipping request from the web and mobile clients',
        sizingPolicy: { version: 1, mode: 'fixed', minSize: { width: 24, height: 24 }, maxSize: { width: 1600, height: 1200 }, overflow: 'wrap', clipContent: false, maxLines: 4 },
      },
    });
    const sub = exportCanonicalSvg(createTestDocument({ nodes: [node] })).match(/<text[^>]*opacity="0.72">(.*?)<\/text>/)!;
    const ys = [...sub[1]!.matchAll(/<tspan x="[^"]*" y="([^"]*)"/g)].map((match) => Number(match[1]));
    expect(ys.length).toBeGreaterThan(2);
    expect(ys.at(-1)!).toBeLessThan(110);
  });

  it('omits hidden objects, their children and attached connectors', () => {
    const visible = createTestNode('visible');
    const hidden = createTestNode('hidden', { content: { sectionHidden: true } });
    const child = createTestNode('child', { parentId: 'hidden' });
    const svg = exportCanonicalSvg(createTestDocument({ nodes: [visible, hidden, child],
      connectors: [createTestConnector('hidden-edge', 'child', 'visible')] }));
    expect(svg).toContain('data-node-id="visible"');
    expect(svg).not.toContain('data-node-id="hidden"');
    expect(svg).not.toContain('data-node-id="child"');
    expect(svg).not.toContain('data-connector-id="hidden-edge"');
  });
  it('draws wireframe widgets and device chrome from the canvas primitives, frames under their children', () => {
    const page = createTestDocument({ nodes: [] }).pages[0]!;
    const toggle = createWidgetNode(page, { id: 'toggle', widget: 'toggle', at: { x: 16, y: 60 }, label: 'Dark <mode>' });
    // The frame is newer (higher zIndex) than the toggle dropped into it.
    const phone = { ...createPresetFrame(page, { id: 'phone', preset: 'phone', at: { x: 0, y: 0 }, label: 'Login' }), zIndex: 9 };
    const light = exportCanonicalSvg(createTestDocument({ nodes: [{ ...toggle, parentId: 'phone' }, phone] }));
    expect(light.indexOf('data-node-id="phone"')).toBeLessThan(light.indexOf('data-node-id="toggle"'));
    expect(light).toContain('data-node-kind="widget"');
    expect(light).toContain('Dark &lt;mode&gt;');
    expect(light).toMatch(/<circle [^>]*fill="#ffffff"/); // the knob
    expect(light).toContain('>Login</text>');
    const dark = exportCanonicalSvg(createTestDocument({ nodes: [toggle] }), { theme: 'dark' });
    expect(dark).toMatch(/fill="#ffffff"[^>]*>Dark &lt;mode&gt;/); // canvas text turns light on dark
  });

  it('is deterministic, renderer-independent, escaped, themed, and high-DPI', () => {
    const a = createTestNode('a', { content: { label: '<Alpha & beta>', shape: 'diamond' } });
    const b = createTestNode('b', { transform: { ...createTestNode('x').transform,
      translation: { x: 200, y: 50 } } });
    const document = createTestDocument({ nodes: [a, b], connectors: [createTestConnector('a-b', 'a', 'b')] });
    const first = exportCanonicalSvg(document, { theme: 'dark', pixelRatio: 2 });
    expect(first).toBe(exportCanonicalSvg(document, { theme: 'dark', pixelRatio: 2 }));
    expect(first).toContain('data-theme="dark"');
    expect(first).toContain('data-pixel-ratio="2"');
    expect(first).toContain('&lt;Alpha &amp; beta&gt;');
    expect(first).toContain('data-connector-id="a-b"');
    expect(first).not.toContain('<Alpha & beta>');
  });

  it('stays well-formed XML when a label carries control characters (a PowerPoint soft break)', () => {
    const node = createTestNode('a', { size: { width: 400, height: 50 }, content: { label: 'line\u000Bbreak nul\u0000 bad\uD800 ok 😀' } });
    const svg = exportCanonicalSvg(createTestDocument({ nodes: [node] }));
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(svg).toContain('linebreak nul bad ok 😀');
  });

  // An agent's screenshot rasterizes this SVG through <img>: one duplicate attribute (an ERD's `o` marker
  // wrote fill="none" twice) and the whole image fails to decode. Every fixture family, parsed as XML.
  it.each(Object.keys(DSL_FIXTURES).sort())('stays well-formed XML for %s', async (name) => {
    const compiled = await compile(DSL_FIXTURES[name]!);
    const svg = exportCanonicalSvg(createTestDocument({ nodes: [compiled.frame, ...compiled.nodes], connectors: compiled.connectors }));
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.getElementsByTagName('parsererror')[0]?.textContent ?? null).toBeNull();
  });

  it('draws icon art where the canvas draws it, and only art it was given', () => {
    const card = createTestNode('db', {
      kind: 'architecture', size: { width: 148, height: 116 },
      content: { label: 'Postgres', ...iconContent({ provider: 'developer', packId: 'developer-icons-v1', shapeId: 'database-postgresql', label: 'Postgres' }) },
    });
    const document = createTestDocument({ nodes: [card] });
    const art = 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E';
    const svg = exportCanonicalSvg(document, { iconArt: { [iconArtKey('developer-icons-v1', 'database-postgresql')]: art } });
    const box = architectureIconBounds(card, 'provider-icon');
    const id = /<symbol id="([^"]+)" viewBox="0 0 1 1"><image href="([^"]+)" width="1" height="1" preserveAspectRatio="xMidYMid meet"\/><\/symbol>/.exec(svg);
    expect(id?.[2]).toBe(art);
    expect(svg).toContain(`<use href="#${id![1]}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/>`);
    // No art loaded (headless, or a failed fetch): the plate alone, never a broken link.
    expect(exportCanonicalSvg(document)).not.toContain('<image');
    expect(exportCanonicalSvg(document, { iconArt: {} })).not.toContain('<image');
  });

  // F01 (2026-10-14): a 20-card repo drawing inlined the TypeScript icon 20 times, so its Recents thumbnail
  // went over the 60 K cap and the card never got a picture. Each distinct art is written once.
  it('writes each distinct icon art once and places it per node', () => {
    const card = (id: string, shapeId: string, x: number) => createTestNode(id, {
      kind: 'architecture', size: { width: 148, height: 116 }, transform: { translation: { x, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
      content: { label: id, ...iconContent({ provider: 'developer', packId: 'developer-icons-v1', shapeId, label: id }) },
    });
    const nodes = [...Array.from({ length: 20 }, (_, index) => card(`ts-${index}`, 'typescript', index * 200)), card('pg', 'database-postgresql', 4200)];
    const ts = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg viewBox="0 0 24 24"><path fill="#3178c6" d="M0 0h24v24H0z"/></svg>')}`;
    const pg = 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E';
    const iconArt = { [iconArtKey('developer-icons-v1', 'typescript')]: ts, [iconArtKey('developer-icons-v1', 'database-postgresql')]: pg };
    const svg = exportCanonicalSvg(createTestDocument({ nodes }), { iconArt });
    expect(svg.split(ts).length - 1).toBe(1);
    expect(svg.split(pg).length - 1).toBe(1);
    expect(svg.match(/<use href="#ofk-icon-/g)).toHaveLength(21);
    // Every <use> names a symbol that exists, and the picture stays well-formed XML.
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    const symbols = new Set([...parsed.getElementsByTagName('symbol')].map((symbol) => symbol.id));
    expect(symbols.size).toBe(2);
    for (const use of parsed.getElementsByTagName('use')) expect(symbols.has(use.getAttribute('href')!.slice(1))).toBe(true);
    // The same art gets the same id in another export: two pictures in one page never point at each other's icons.
    const pgId = [...parsed.getElementsByTagName('symbol')].find((symbol) => symbol.firstElementChild?.getAttribute('href') === pg)!.id;
    expect(exportCanonicalSvg(createTestDocument({ nodes: [nodes[20]!] }), { iconArt })).toContain(`<symbol id="${pgId}"`);
  });

  it('draws an icon tile caption as the layout breaks it: a tspan per line, then the description', () => {
    const node = createTestNode('db', {
      kind: 'architecture', size: { width: 148, height: 130 },
      content: { label: 'Primary\ndatabase', subLabel: 'postgres 16', ...iconContent({ provider: 'developer', packId: 'developer-icons-v1', shapeId: 'database-postgresql', label: 'Postgres' }) },
    });
    const svg = exportCanonicalSvg(createTestDocument({ nodes: [node] }));
    // Line height 14.4 from the top at 88: the middles sit at 95.2 and 109.6; the description's line starts under them.
    expect(svg).toContain('<tspan x="74" y="95.2">Primary</tspan><tspan x="74" y="109.6">database</tspan>');
    expect(svg).toMatch(/<tspan x="74" y="[\d.]+">postgres 16<\/tspan>/);
  });

  // Found 2026-10-11: a Tabler or Kafka icon (one dark ink) vanished on a dark export's dark plate.
  it('draws a one-colour dark icon in the label ink on a dark plate, and as authored on a light one', () => {
    const node = createTestNode('queue', {
      kind: 'architecture', size: { width: 148, height: 116 },
      content: { label: 'Kafka', ...iconContent({ provider: 'developer', packId: 'developer-icons-v1', shapeId: 'kafka', label: 'Kafka' }) },
    });
    const document = createTestDocument({ nodes: [node] });
    const art = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg viewBox="0 0 24 24" fill="none" stroke="#334155"><path d="M1 1"/></svg>')}`;
    const href = (theme: 'light' | 'dark') => decodeURIComponent(
      /<image href="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(exportCanonicalSvg(document, { theme, iconArt: { [iconArtKey('developer-icons-v1', 'kafka')]: art } }))![1]!);
    expect(href('light')).toContain('stroke="#334155"');
    expect(href('dark')).toContain('stroke="#ffffff"');
  });

  it('draws a connector label where the projection puts it, wrapped like the canvas', () => {
    const text = 'Gets account information from, and makes payments using';
    const connector = createTestConnector('edge', 'a', 'b', {
      route: { kind: 'orthogonal', ownership: 'automatic' },
      labels: [{ id: 'l', text, pathRatio: 0.5, offset: { x: 0, y: 0 }, metadata: {} }],
    });
    const document = createTestDocument({
      nodes: [createTestNode('a', { transform: { translation: { x: 0, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } } }),
        createTestNode('b', { transform: { translation: { x: 400, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } } })],
      connectors: [connector],
    });
    const svg = exportCanonicalSvg(document);
    const projected = projectPageConnectors(document.pages[0]!)[0]!;
    const { point } = projected.labels[0]!;
    const n = (value: number) => Math.round(value * 100) / 100;
    const lines = connectorLabelLines(text, projected.presentation.label);
    expect(lines.length).toBeGreaterThan(2);
    for (const [index, line] of lines.entries()) {
      const y = point.y + (index - (lines.length - 1) / 2) * connectorLabelLineHeight(projected.presentation.label);
      expect(svg).toMatch(new RegExp(`<text x="${n(point.x)}" y="${n(y)}"[^>]*>${line}</text>`));
    }
    const plate = connectorLabelPlate(text, projected.presentation.label, point);
    expect(svg).toContain(`<rect x="${n(plate.x)}" y="${n(plate.y)}" width="${n(plate.width)}" height="${n(plate.height)}"`);
  });

  it('exports a visible selection and rejects empty output', () => {
    const a = createTestNode('a'); const b = createTestNode('b');
    const document = createTestDocument({ nodes: [a, b], connectors: [createTestConnector('edge', 'a', 'b')] });
    const selected = exportCanonicalSvg(document, { selectedNodeIds: ['a'], theme: 'print' });
    expect(selected).toContain('data-node-id="a"');
    expect(selected).not.toContain('data-node-id="b"');
    expect(selected).not.toContain('data-connector-id="edge"');
    expect(() => exportCanonicalSvg(document, { selectedNodeIds: ['missing'] })).toThrow(/visible node/);
  });

  it('expands a selected container to its whole subtree, dropping connectors that leave it', () => {
    const section = createTestNode('section', { kind: 'section' });
    const child = createTestNode('child', { parentId: 'section' });
    const grandchild = createTestNode('grandchild', { parentId: 'child' });
    const outside = createTestNode('outside');
    const document = createTestDocument({
      nodes: [section, child, grandchild, outside],
      connectors: [createTestConnector('inside-edge', 'child', 'grandchild'), createTestConnector('leaving-edge', 'grandchild', 'outside')],
    });
    const svg = exportCanonicalSvg(document, { selectedNodeIds: ['section'] });
    expect(svg).toContain('data-node-id="section"');
    expect(svg).toContain('data-node-id="child"');
    expect(svg).toContain('data-node-id="grandchild"');
    expect(svg).not.toContain('data-node-id="outside"');
    expect(svg).toContain('data-connector-id="inside-edge"');
    expect(svg).not.toContain('data-connector-id="leaving-edge"');
  });

  it('exports a lone connection without its endpoints', () => {
    const a = createTestNode('a'); const b = createTestNode('b');
    const document = createTestDocument({ nodes: [a, b], connectors: [createTestConnector('edge', 'a', 'b')] });
    const svg = exportCanonicalSvg(document, { selectedNodeIds: [], selectedConnectorIds: ['edge'] });
    expect(svg).toContain('data-connector-id="edge"');
    expect(svg).not.toContain('data-node-id="a"');
    expect(svg).not.toContain('data-node-id="b"');
  });

  it('exports freeform paths, pressure-width segments, and arrowheads', () => {
    const pen = createTestNode('pressure-pen', {
      kind: 'pen',
      size: { width: 20, height: 10 },
      content: {
        points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }],
        strokeColor: '#123456',
        strokeWidth: 4,
        inputSamples: [
          { pressure: 0.1, tiltX: 0, tiltY: 0, twist: 0 },
          { pressure: 0.5, tiltX: 20, tiltY: 0, twist: 0 },
          { pressure: 0.9, tiltX: 60, tiltY: 0, twist: 0 },
        ],
      },
    });
    const arrow = createTestNode('arrow', {
      kind: 'arrow',
      transform: { ...createTestNode('x').transform, translation: { x: 40, y: 0 } },
      size: { width: 20, height: 20 },
      content: { points: [{ x: 0, y: 0 }, { x: 20, y: 20 }], strokeWidth: 3 },
    });

    const svg = exportCanonicalSvg(createTestDocument({ nodes: [pen, arrow] }));
    expect(svg).toContain('data-node-kind="pen"');
    expect(svg).toContain('stroke="#123456"');
    const penGroup = svg.split('data-node-kind="pen"')[1].split('</g>')[0];
    expect(penGroup.match(/<path /g)).toHaveLength(2);
    const penWidths = [...penGroup.matchAll(/stroke-width="([\d.]+)"/g)]
      .map((match) => Number(match[1]));
    expect(penWidths[1]).toBeGreaterThan(penWidths[0]);
    expect(svg).toContain('data-node-kind="arrow"');
    const arrowGroup = svg.split('data-node-kind="arrow"')[1].split('</g>')[0];
    expect(arrowGroup.match(/<path /g)).toHaveLength(2);
    expect(svg).not.toContain('Pressure-pen');
  });

  it('draws a pen line with no colour of its own light on the dark preview, as the canvas does', () => {
    const pen = createTestNode('ink', { kind: 'pen', size: { width: 20, height: 10 }, content: { points: [{ x: 0, y: 0 }, { x: 20, y: 10 }], strokeWidth: 2 } });
    const document = createTestDocument({ nodes: [pen] });
    expect(exportCanonicalSvg(document, { theme: 'dark' })).toContain('stroke="#e2e8f0"');
    expect(exportCanonicalSvg(document, { theme: 'light' })).toContain('stroke="#334155"');
  });

  it('exports rich text, annotation, and safe image interiors', () => {
    const text = createTestNode('text', {
      kind: 'text',
      content: {
        label: '<Release notes>',
        fontSize: 24,
        fontFamily: 'serif',
        fontWeight: '700',
        fontStyle: 'italic',
        backgroundColor: '#f8fafc',
      },
    });
    const annotation = createTestNode('annotation', {
      kind: 'annotation',
      transform: { ...createTestNode('x').transform, translation: { x: 120, y: 0 } },
      content: { label: 'Risk', subLabel: 'Rotate & verify', color: 'yellow' },
    });
    const image = createTestNode('image', {
      kind: 'image',
      transform: { ...createTestNode('x').transform, translation: { x: 240, y: 0 } },
      content: {
        label: 'Diagram',
        imageUrl: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
        transparency: 0.7,
      },
    });

    const svg = exportCanonicalSvg(createTestDocument({ nodes: [text, annotation, image] }));
    expect(svg).toContain('data-node-kind="text"');
    expect(svg).toContain('&lt;Release notes&gt;');
    expect(svg).toContain('font-family="serif"');
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain('data-node-kind="annotation"');
    expect(svg).toContain('Rotate &amp; verify');
    expect(svg).toContain('data-node-kind="image"');
    expect(svg).toContain('<image href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E"');
    expect(svg).toContain('opacity="0.7"');
  });
});

describe('chart export', () => {
  const chartDocument = (chart: 'bar' | 'pie') => {
    const node = createTestNode('chart-1', {
      kind: 'chart',
      size: { width: 720, height: 440 },
      content: {
        chart,
        title: 'Monthly',
        categories: ['Jan', 'Feb', 'Mar'],
        series: [{ name: 'Revenue', values: [12, 19, 9] }],
      },
    });
    return createTestDocument({ nodes: [node] });
  };

  it('draws bars as rects with a tick axis and the title', () => {
    const svg = exportCanonicalSvg(chartDocument('bar'));
    expect(svg).toContain('data-node-kind="chart"');
    const bars = [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)];
    expect(bars.length).toBeGreaterThanOrEqual(3);
    expect(bars.every((bar) => Number(bar[3]) > 10)).toBe(true);
    expect(svg).toContain('>Monthly<');
    expect(svg).toContain('>Jan<');
    expect(svg).toContain('fill="#2563eb"');
  });

  it('draws pie slices as polygonal paths with percent labels', () => {
    const svg = exportCanonicalSvg(chartDocument('pie'));
    expect(svg.match(/<path /g)!.length).toBeGreaterThanOrEqual(3);
    expect(svg).toMatch(/>\d+%</);
  });
});

 it('exports semantic architecture card headers and descriptions', () => {
    const node = createTestNode('api', {kind: 'architecture', size: {width: 240, height: 152}, content: {
      label: 'Order API', assetPresentation: 'card', archProviderLabel: 'Container', archResourceType: 'Go', archEnvironment: 'Handles orders',
    }});
    const svg = exportCanonicalSvg(createTestDocument({nodes: [node]}));
    for (const text of ['Order API', 'Container', 'Go', 'Handles orders']) expect(svg).toContain(text);
  });

describe('dark architecture card export', () => {
  const person = (extra: Record<string, unknown> = {}) => createTestNode('who', { kind: 'architecture', size: { width: 240, height: 152 }, content: {
    label: 'Customer', assetPresentation: 'card', archProviderLabel: 'Person', archResourceType: '', color: 'violet', archKindColor: 'violet', ...extra,
  } });
  const cardRect = (svg: string) => svg.match(/<g[^>]*data-node-id="who"[^>]*>\s*<rect[^>]*>/)![0];

  it('washes a kind-default card as a faint tint, never an opaque light fill under white text', () => {
    const dark = exportCanonicalSvg(createTestDocument({ nodes: [person()] }), { theme: 'dark' });
    const rect = cardRect(dark);
    expect(rect).toMatch(/fill-opacity="0\.08"/);
    expect(rect).not.toContain('#f8fafc');
    expect(dark).toMatch(/fill="#ffffff"[^>]*><tspan[^>]*>Customer/);
  });
  it('keeps the light export of the same card unchanged', () => {
    const light = exportCanonicalSvg(createTestDocument({ nodes: [person()] }));
    expect(cardRect(light)).not.toContain('fill-opacity');
  });
  it('keeps a bold (filled) card solid in dark', () => {
    const dark = exportCanonicalSvg(createTestDocument({ nodes: [person({ colorMode: 'filled', archKindColor: undefined })] }), { theme: 'dark' });
    expect(cardRect(dark)).not.toContain('fill-opacity');
  });
});
