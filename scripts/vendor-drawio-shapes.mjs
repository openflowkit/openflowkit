// Copies draw.io's shape code into src/vendor/drawio/, unchanged, so draw.io's own code draws its shapes.
//   node scripts/vendor-drawio-shapes.mjs <draw.io checkout>
// draw.io's files are classic scripts that share globals, so they are joined inside one function: one scope,
// run once, by src/services/dsl/drawioShapes.ts, which supplies the few editor names the shapes look up.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.argv[2];
if (!root) throw new Error('usage: node scripts/vendor-drawio-shapes.mjs <drawio checkout>');
const web = path.join(root, 'src/main/webapp');
const list = (dir) => fs.readdirSync(path.join(web, dir), { recursive: true })
  .filter((name) => name.endsWith('.js')).sort().map((name) => path.join(dir, name));

// The part of draw.io's core the shapes use, in load order; then every shape: core, the editor's, the families.
const files = [
  'mxgraph/src/util/mxConstants.js', 'mxgraph/src/util/mxObjectIdentity.js', 'mxgraph/src/util/mxDictionary.js',
  'mxgraph/src/util/mxPoint.js', 'mxgraph/src/util/mxRectangle.js', 'mxgraph/src/util/mxUtils.js',
  'mxgraph/src/util/mxEventObject.js', 'mxgraph/src/util/mxEventSource.js', 'mxgraph/src/util/mxUrlConverter.js',
  'mxgraph/src/util/mxAbstractCanvas2D.js', 'mxgraph/src/shape/mxShape.js', 'mxgraph/src/shape/mxActor.js',
  'mxgraph/src/shape/mxRectangleShape.js', 'mxgraph/src/shape/mxPolyline.js', 'mxgraph/src/shape/mxCylinder.js',
  'mxgraph/src/shape/mxStencil.js', 'mxgraph/src/shape/mxStencilRegistry.js', 'mxgraph/src/shape/mxMarker.js',
];
for (const file of list('mxgraph/src/shape')) if (!files.includes(file) && !file.endsWith('mxText.js')) files.push(file);
// Where lines meet shapes and how they route: plain functions over boxes, which Shapes.js extends.
files.push('mxgraph/src/view/mxPerimeter.js', 'mxgraph/src/view/mxEdgeStyle.js', 'mxgraph/src/view/mxStyleRegistry.js');
files.push('js/grapheditor/Shapes.js', ...list('shapes'));

const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const out = path.resolve('src/vendor/drawio');
fs.mkdirSync(out, { recursive: true });
const body = files.map((file) => `// ---- ${file}\n${fs.readFileSync(path.join(web, file), 'utf8')}`).join('\n;\n');
fs.writeFileSync(path.join(out, 'shapes.js'), `/* eslint-disable */
// draw.io ${version} (https://github.com/jgraph/drawio), Copyright JGraph Ltd, Apache License 2.0 (LICENSE beside this file).
// Its shape code, unchanged, joined into one function by scripts/vendor-drawio-shapes.mjs. Regenerate, never edit.
export function runDrawioShapes(host) {
  var { window, document, navigator, mxClient, mxLog, mxEvent, mxCellRenderer, Graph, mxConnectionConstraint, mxGraphView,
    mxCellState, mxEdgeHandler, mxVertexHandler, Element, Node, GRAPH_IMAGE_PATH, Editor, Math } = host;
${body}
;
  return { mxConstants, mxUtils, mxRectangle, mxPoint, mxAbstractCanvas2D, mxShape, mxStencil, mxStencilRegistry,
    mxRectangleShape, mxEllipse, mxRhombus, mxCylinder, mxConnector, mxActor, mxTriangle, mxHexagon, mxCloud, mxLine,
    mxArrow, mxArrowConnector, mxDoubleEllipse, mxSwimlane, mxImageShape, mxLabel, mxStyleRegistry, mxPerimeter, mxEdgeStyle };
}
`);
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));
// Rough.js, which draw.io's sketch look draws with (`sketch=1`), as draw.io ships it; ROUGH-LICENSE is kept by hand.
const rough = fs.readFileSync(path.join(web, 'js/rough/rough.min.js'), 'utf8').trim();
fs.writeFileSync(path.join(out, 'rough.js'), `/* eslint-disable */
// Rough.js 4.6.6 (https://github.com/rough-stuff/rough), Copyright (c) 2019 Preet Shihn, MIT License (ROUGH-LICENSE beside this file).
// The copy draw.io ships (js/rough/rough.min.js), unchanged, by scripts/vendor-drawio-shapes.mjs. Regenerate, never edit.
${rough}
export { rough };
`);
console.log(`draw.io ${version}: ${files.length} files → ${path.join(out, 'shapes.js')}`);
