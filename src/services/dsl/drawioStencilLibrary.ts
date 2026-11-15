import { parseXml, type XmlElement } from './xmlReader';

// draw.io's stencil libraries (public/drawio-stencils, built by scripts/build-drawio-stencils.mjs): a shape named
// `mxgraph.aws4.lambda` lives in the package `mxgraph.aws4`, as draw.io's mxStencilRegistry names them —
// package and shape name lower-cased, spaces as underscores.

/** Where the library files come from: `index.json`, or one library's raw-deflated XML. */
export interface StencilSource {
  index(): Promise<Readonly<Record<string, string>> | null>;
  library(file: string): Promise<Uint8Array | null>;
}

/** The app's copy, fetched from the site; null where it can't be reached (offline, or a test without a server). */
export const siteStencils = (base = '/drawio-stencils/'): StencilSource => ({
  async index() {
    try {
      const response = await fetch(`${base}index.json`);
      return response.ok ? await response.json() as Record<string, string> : null;
    } catch {
      return null;
    }
  },
  async library(file) {
    try {
      const response = await fetch(`${base}${file}.deflate`);
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    } catch {
      return null;
    }
  },
});

async function inflateRaw(bytes: Uint8Array): Promise<string> {
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/** A stencil's registry name: its package, then its own name, lower-cased with spaces as underscores. */
export const stencilKey = (pkg: string, name: string): string => `${pkg}.${name.replace(/ /g, '_')}`.toLowerCase();

/** The stencils a page names, read from the libraries they live in: full name (lower case) → its `<shape>`. */
export async function loadStencils(names: Iterable<string>, source: StencilSource): Promise<ReadonlyMap<string, XmlElement>> {
  const wanted = [...new Set([...names].map((name) => name.toLowerCase()).filter((name) => name.startsWith('mxgraph.')))];
  const found = new Map<string, XmlElement>();
  if (!wanted.length) return found;
  const index = await source.index();
  if (!index) return found;
  const files = new Set<string>();
  for (const name of wanted) {
    // The longest package that prefixes the name; the rest is the shape's own name.
    const parts = name.split('.');
    for (let cut = parts.length - 1; cut >= 2; cut -= 1) {
      const file = index[parts.slice(0, cut).join('.')];
      if (file) { files.add(file); break; }
    }
  }
  for (const file of files) {
    const bytes = await source.library(file);
    if (!bytes) continue;
    let xml: string;
    try {
      xml = await inflateRaw(bytes);
    } catch {
      continue;
    }
    const parsed = parseXml(xml);
    if ('error' in parsed) continue;
    const sets = parsed.root.name === 'shapes' ? [parsed.root] : parsed.root.children.filter((child) => child.name === 'shapes');
    for (const set of sets) {
      const pkg = set.attributes.name ?? '';
      for (const shape of set.children) if (shape.name === 'shape' && shape.attributes.name) found.set(stencilKey(pkg, shape.attributes.name), shape);
    }
  }
  return found;
}
