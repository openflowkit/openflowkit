// Lists everything draw.io can draw, read from its own source, so the importer is checked against
// draw.io's full vocabulary rather than the files that happened to break. Regenerate, never edit:
//   node scripts/extract-drawio-vocabulary.mjs <draw.io checkout> [drawio-libs checkout]
// Writes src/services/dsl/drawioVocabulary.json:
//   shapes      every registered shape name → where draw.io defines it (core, a shape family file, or a stencil)
//   markers     every arrowhead name
//   edgeStyles  every line routing; perimeters every perimeter
//   styleKeys   every style key draw.io's constants name
//   defaults    draw.io's default stylesheet (styles/default.xml): what a vertex, edge, text… is when nothing is set
//   usage       how often each shape, arrowhead and routing appears in draw.io's own templates and libraries
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';

const root = process.argv[2];
const libs = process.argv[3];
if (!root) throw new Error('usage: node scripts/extract-drawio-vocabulary.mjs <drawio checkout> [drawio-libs checkout]');
const web = path.join(root, 'src/main/webapp');
const read = (file) => fs.readFileSync(file, 'utf8');
// draw.io's sources show usage in comments (`registerShape('box', BoxShape)`) and keep retired shapes commented out.
const code = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const files = (dir, ext) => fs.existsSync(dir)
  ? fs.readdirSync(dir, { recursive: true }).filter((name) => name.endsWith(ext)).map((name) => path.join(dir, name))
  : [];
const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));

// Constants: mxConstants.SHAPE_X = 'name', and each shape class's own `cst = { KEY: 'name' }`.
const constants = read(path.join(web, 'mxgraph/src/util/mxConstants.js'));
const mxConst = Object.fromEntries([...constants.matchAll(/([A-Z][A-Z0-9_]+):\s*'([^']*)'/g)].map(([, key, value]) => [key, value]));

function classConstants(source) {
  const byClass = {};
  for (const [, owner, body] of source.matchAll(/(\w+)\.prototype\.cst\s*=\s*\{([\s\S]*?)\};/g)) {
    byClass[owner] = Object.fromEntries([...body.matchAll(/(\w+)\s*:\s*'([^']*)'/g)].map(([, key, value]) => [key, value]));
  }
  return byClass;
}

const shapes = {};
function collectShapes(file, origin) {
  const source = code(file);
  const cst = classConstants(source);
  for (const [, arg] of source.matchAll(/registerShape\(\s*([^,]+?)\s*,/g)) {
    let name = null;
    const literal = /^['"]([^'"]+)['"]$/.exec(arg);
    const core = /^mxConstants\.(\w+)$/.exec(arg);
    const own = /^(\w+)\.prototype\.cst\.(\w+)$/.exec(arg);
    if (literal) name = literal[1];
    else if (core) name = mxConst[core[1]] ?? null;
    else if (own) name = cst[own[1]]?.[own[2]] ?? Object.values(cst).find((table) => own[2] in table)?.[own[2]] ?? null;
    if (name) shapes[name] ??= origin;
  }
}
for (const file of [...files(path.join(web, 'mxgraph/src'), '.js'), ...files(path.join(web, 'js/grapheditor'), '.js')]) collectShapes(file, 'core');
for (const file of files(path.join(web, 'shapes'), '.js')) collectShapes(file, `family:${path.basename(file, '.js')}`);

// Stencils (drawn from XML, not code) are listed by the stencil build's index; name them by package only.
const stencilIndex = path.resolve('public/drawio-stencils/index.json');
const stencilPackages = fs.existsSync(stencilIndex) ? Object.keys(JSON.parse(read(stencilIndex))) : [];

const allJs = [...files(path.join(web, 'mxgraph/src'), '.js'), ...files(path.join(web, 'js/grapheditor'), '.js'), ...files(path.join(web, 'shapes'), '.js')];
const markers = new Set();
const edgeStyles = new Set();
const perimeters = new Set();
for (const file of allJs) {
  const source = read(file);
  for (const [, name] of source.matchAll(/addMarker\(\s*'([^']+)'/g)) markers.add(name);
  for (const [, name] of source.matchAll(/mxStyleRegistry\.putValue\(\s*'([^']+)'/g)) (name.endsWith('Perimeter') ? perimeters : edgeStyles).add(name);
  // The ER markers are added in a loop over their names.
  for (const [, list] of source.matchAll(/\[((?:\s*'ER\w+'\s*,?)+)\]/g)) for (const [, name] of list.matchAll(/'(ER\w+)'/g)) markers.add(name);
}
for (const [key, value] of Object.entries(mxConst)) {
  if (key.startsWith('ARROW_') && !key.startsWith('ARROW_SPACING') && !key.startsWith('ARROW_WIDTH') && !key.startsWith('ARROW_SIZE')) markers.add(value);
  if (key.startsWith('EDGESTYLE_')) edgeStyles.add(value);
  if (key.startsWith('PERIMETER_')) perimeters.add(value);
}
// mxStyleRegistry's built-ins are named by their constants' values.
const registry = read(path.join(web, 'mxgraph/src/view/mxStyleRegistry.js'));
for (const [, key] of registry.matchAll(/putValue\(mxConstants\.(\w+)/g)) {
  const name = mxConst[key];
  if (name) (key.startsWith('PERIMETER_') ? perimeters : edgeStyles).add(name);
}

const styleKeys = Object.entries(mxConst).filter(([key]) => key.startsWith('STYLE_')).map(([, value]) => value);

// The default stylesheet: <add as="name" extend="…"><add as="key" value="…"/></add>.
function stylesheet(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const [, name, extend, body] of read(file).matchAll(/<add as="([^"]+)"(?:\s+extend="([^"]+)")?\s*>([\s\S]*?)<\/add>/g)) {
    out[name] = { ...(extend ? { extend } : {}), ...Object.fromEntries([...body.matchAll(/<add as="([^"]+)" value="([^"]*)"/g)].map(([, key, value]) => [key, value])) };
  }
  return out;
}

// Usage: count shape=, arrowheads and edge styles in templates (compressed or not) and sidebar entries.
function cellStyles(xml) {
  const styles = [];
  for (const [, style] of xml.matchAll(/style="([^"]*)"/g)) styles.push(style.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  return styles;
}
function decompressDiagrams(xml) {
  const parts = [xml];
  for (const [, body] of xml.matchAll(/<diagram[^>]*>([^<]+)<\/diagram>/g)) {
    try { parts.push(decodeURIComponent(zlib.inflateRawSync(Buffer.from(body.trim(), 'base64')).toString('utf8'))); } catch { /* not compressed */ }
  }
  return parts.join('\n');
}
const usage = { shape: {}, marker: {}, edgeStyle: {} };
const bump = (table, key) => { if (key) table[key] = (table[key] ?? 0) + 1; };
function countStyle(style) {
  const pairs = Object.fromEntries(style.split(';').filter(Boolean).map((part) => {
    const at = part.indexOf('=');
    return at < 0 ? [part, ''] : [part.slice(0, at), part.slice(at + 1)];
  }));
  const shape = pairs.shape ?? Object.keys(pairs).find((key) => pairs[key] === '' && /^[a-z][\w.]*$/i.test(key));
  bump(usage.shape, shape);
  bump(usage.marker, pairs.startArrow);
  bump(usage.marker, pairs.endArrow);
  bump(usage.edgeStyle, pairs.edgeStyle);
}
let templateCount = 0;
for (const file of files(path.join(web, 'templates'), '.xml')) {
  templateCount += 1;
  for (const style of cellStyles(decompressDiagrams(read(file)))) countStyle(style);
}
// Sidebars are left out: they build names by joining strings in code, so a literal is often only a name's tail.
let libraryCount = 0;
if (libs) for (const file of files(path.join(libs, 'libs'), '.xml')) {
  libraryCount += 1;
  for (const style of cellStyles(read(file).replace(/&quot;/g, '"'))) countStyle(style);
}

const vocabulary = {
  source: { drawio: 'https://github.com/jgraph/drawio (Apache-2.0)', libs: libs ? 'https://github.com/jgraph/drawio-libs' : null, templates: templateCount, libraries: libraryCount },
  shapes: sorted(shapes),
  stencilPackages: stencilPackages.sort(),
  markers: [...markers].sort(),
  edgeStyles: [...edgeStyles].sort(),
  perimeters: [...perimeters].sort(),
  styleKeys: [...new Set(styleKeys)].sort(),
  defaults: stylesheet(path.join(web, 'styles/default.xml')),
  darkDefaults: stylesheet(path.join(web, 'styles/dark-default.xml')),
  usage: { shape: sorted(usage.shape), marker: sorted(usage.marker), edgeStyle: sorted(usage.edgeStyle) },
};
const out = path.resolve('src/services/dsl/drawioVocabulary.json');
fs.writeFileSync(out, `${JSON.stringify(vocabulary, null, 1)}\n`);
console.log(`${Object.keys(shapes).length} shapes, ${markers.size} arrowheads, ${edgeStyles.size} routings, ${perimeters.size} perimeters, ${vocabulary.styleKeys.length} style keys, ${templateCount} templates, ${libraryCount} libraries → ${out}`);
