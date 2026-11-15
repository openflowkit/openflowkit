// Splits draw.io's stencil bundle (js/stencils.min.js, Apache-2.0) into one file per library under
// public/drawio-stencils/, so an import fetches only the libraries its file uses. Regenerate, never edit:
//   node scripts/build-drawio-stencils.mjs <path to draw.io's webapp/js/stencils.min.js>
// Each <library>.deflate is draw.io's own raw-deflated XML; index.json maps a package name
// (`mxgraph.aws4`, lower case) to its file.
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';

const source = process.argv[2];
if (!source) throw new Error('usage: node scripts/build-drawio-stencils.mjs <stencils.min.js>');
const bundle = fs.readFileSync(source, 'utf8');
const out = path.resolve('public/drawio-stencils');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const index = {};
for (const [, file, packed] of bundle.matchAll(/f\['([^']+)'\] = '([^']+)'/g)) {
  const bytes = Buffer.from(packed, 'base64');
  const xml = zlib.inflateRawSync(bytes).toString('utf8');
  const name = file.replace(/\.xml$/, '').replace(/\//g, '~');
  for (const [, pkg] of xml.matchAll(/<shapes name="([^"]+)"/g)) index[pkg.toLowerCase()] = name;
  fs.writeFileSync(path.join(out, `${name}.deflate`), bytes);
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index));
fs.writeFileSync(path.join(out, 'NOTICE'), 'Stencil libraries from draw.io (https://github.com/jgraph/drawio), Copyright JGraph Ltd, Apache License 2.0.\n');
console.log(`${Object.keys(index).length} packages written to ${out}`);
