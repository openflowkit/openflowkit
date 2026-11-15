// draw.io's shapes, drawn by draw.io's own code (src/vendor/drawio, Apache-2.0) onto a canvas that records what
// it draws: each filled or stroked path, in the shape's box, with its paint. The node's own fill and line are
// passed in as marker colours and come back as 'fill' / 'stroke', so recolouring the node recolours the shape.
// Loaded once, on first use; a page-less stand-in replaces the editor parts draw.io's shape code looks up.
/* eslint-disable @typescript-eslint/no-explicit-any -- draw.io's shape code is untyped JavaScript. */
import { STENCIL_FILL, STENCIL_STROKE } from '../../opencanvas/domain/nodes/imageNode';
import type { Point2d } from '../../opencanvas/domain/geometry/types';
import type { RouteTerminal, Router } from './drawioEdgeStyles';
import type { Perimeter } from './drawioPerimeter';
import type { XmlElement } from './xmlReader';
import { measurePortableText } from '../../opencanvas/domain/text/measurement';
import { provideDrawnShapes } from '../../opencanvas/domain/nodes/drawnShape';
import { provideDrawnLines } from '../../opencanvas/domain/connectors/drawnLine';
import { installDrawioSketch } from './drawioSketch';

export type DrawioPathCommand =
  | { readonly kind: 'move'; readonly x: number; readonly y: number }
  | { readonly kind: 'line'; readonly x: number; readonly y: number }
  | { readonly kind: 'quad'; readonly x1: number; readonly y1: number; readonly x: number; readonly y: number }
  | { readonly kind: 'cubic'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly x: number; readonly y: number }
  | { readonly kind: 'close' };

/** A colour draw.io painted: the node's own fill or line, or a colour of the shape's own. */
export type DrawioPaintColor = 'fill' | 'stroke' | string;

export interface DrawioShapePart {
  readonly path: readonly DrawioPathCommand[];
  readonly fill: DrawioPaintColor | null;
  readonly stroke: DrawioPaintColor | null;
  readonly strokeWidth: number;
  /** Dash and gap lengths, in line widths as draw.io writes them; empty is solid. */
  readonly dash: readonly number[];
  /** 0–1: the cell's opacity times the fill's or line's own. */
  readonly fillOpacity: number;
  readonly strokeOpacity: number;
}

/** A picture a shape draws inside its box (draw.io's `label` card draws the cell's `image` at its left). */
export interface DrawioShapeImage {
  readonly url: string;
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
}

export interface DrawioShapeDrawing {
  readonly parts: readonly DrawioShapePart[];
  readonly images: readonly DrawioShapeImage[];
}

export interface DrawioShapes {
  /** Whether draw.io draws `name`: in code, or by a stencil handed in (`addStencils`). */
  has(name: string): boolean;
  /** draw.io's stencils (library shapes), by full name in lower case, so shapes and code that draws them find them. */
  addStencils(stencils: ReadonlyMap<string, XmlElement>): void;
  /** Every shape name draw.io's code registers. */
  names(): readonly string[];
  /** The shape `style.shape` names, drawn in a `width` × `height` box; null when draw.io has no such shape. */
  draw(style: Readonly<Record<string, string>>, width: number, height: number): DrawioShapeDrawing | null;
  /** A line draw.io draws with a shape of its own (`flexArrow`, a lightning link), along `points` on the page, ends included. */
  drawLine(style: Readonly<Record<string, string>>, points: readonly Point2d[]): DrawioShapePart[] | null;
  /** draw.io's own routing named `edgeStyle=` (mxEdgeStyle and the ones Shapes.js adds), as the importer's routers run. */
  router(name: string): Router | null;
  /** draw.io's own outline rule named `perimeter=`, as the importer's perimeters run. */
  perimeter(name: string): Perimeter | null;
}

/** How wide a line of text is, for the few shapes that size their parts by their words (mockup tabs, buttons). */
export type MeasureText = (text: string, fontSize: number, fontFamily: string) => { width: number; height: number };

/** OpenFlowKit's own text measure, which runs the same in the app, a worker and Node. */
const portableMeasure: MeasureText = (text, fontSize) => {
  const { width, height } = measurePortableText(text, { fontSize });
  return { width, height };
};

type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
function rotation(degrees: number, cx: number, cy: number): Matrix {
  const rad = degrees * Math.PI / 180;
  const cos = Math.cos(rad); const sin = Math.sin(rad);
  return multiply(multiply(translation(cx, cy), [cos, sin, -sin, cos, 0, 0]), translation(-cx, -cy));
}

/** The editor names draw.io's shape code looks up; none of them draw. */
function host(registry: Record<string, unknown>): any {
  const inert = (): any => new Proxy(function inertPart() { /* nothing */ }, {
    get(target: any, key) {
      if (key === 'prototype' || key in target) return target[key];
      if (typeof key === 'symbol') return undefined;
      return (target[key] = inert());
    },
    construct: () => inert(),
  });
  function mxCellRenderer() { /* never constructed */ }
  Object.assign(mxCellRenderer, {
    defaultShapes: registry,
    registerShape: (name: string, shape: unknown) => { registry[name] = shape; },
  });
  mxCellRenderer.prototype = { getShape: (name: string | null) => (name == null ? null : registry[name]) };
  const element = { style: {}, getContext: () => null, setAttribute() { /* none */ }, appendChild() { /* none */ } };
  return {
    window: globalThis, navigator: { userAgent: '', appVersion: '', platform: '' },
    document: { documentMode: undefined, createElement: () => element, documentElement: { style: {} } },
    mxClient: { IS_SVG: true, NO_FO: true, imageBasePath: '', basePath: '', link() { /* none */ }, include() { /* none */ } },
    mxLog: { debug() { /* none */ }, warn() { /* none */ }, show() { /* none */ } },
    mxEvent: { addListener() { /* none */ }, removeListener() { /* none */ }, consume() { /* none */ } },
    mxCellRenderer, Graph: inert(), mxConnectionConstraint: inert(), mxGraphView: inert(),
    mxCellState: undefined, mxEdgeHandler: undefined, mxVertexHandler: undefined,
    Element: function Element() { /* none */ }, Node: function Node() { /* none */ }, GRAPH_IMAGE_PATH: '',
  };
}

function role(color: unknown): DrawioPaintColor | null {
  if (typeof color !== 'string' || color === '' || color === 'none') return null;
  const lower = color.toLowerCase();
  if (lower === STENCIL_FILL) return 'fill';
  if (lower === STENCIL_STROKE) return 'stroke';
  return lower;
}

/** draw.io's canvas, recording instead of painting. Built on its own abstract canvas, so state is kept as draw.io keeps it. */
function recorderClass(mx: Record<string, any>): new () => any {
  const { mxAbstractCanvas2D, mxUtils } = mx;
  const KAPPA = 0.5522847498;
  function Recorder(this: any) {
    mxAbstractCanvas2D.call(this);
    this.parts = [] as DrawioShapePart[];
    this.images = [] as DrawioShapeImage[];
    this.state.matrix = IDENTITY;
  }
  mxUtils.extend(Recorder, mxAbstractCanvas2D);
  const proto = Recorder.prototype;
  // Full precision: draw.io's base canvas rounds to whole pixels for its SVG output.
  proto.format = (value: number) => value;
  // draw.io's SVG canvas rotates and flips about the shape's centre; the same transform, kept as a matrix.
  proto.rotate = function rotate(this: any, theta: number, flipH: boolean, flipV: boolean, cx: number, cy: number) {
    if (theta === 0 && !flipH && !flipV) return;
    const s = this.state;
    const x = (cx + s.dx) * s.scale; const y = (cy + s.dy) * s.scale;
    let turn = theta;
    let m: Matrix = s.matrix;
    if (flipH && flipV) turn += 180;
    else if (flipH !== flipV) {
      const tx = flipH ? x : 0; const ty = flipV ? y : 0;
      m = multiply(m, multiply(multiply(translation(tx, ty), [flipH ? -1 : 1, 0, 0, flipV ? -1 : 1, 0, 0]), translation(-tx, -ty)));
    }
    if (flipH ? !flipV : flipV) turn *= -1;
    if (turn !== 0) m = multiply(m, rotation(turn, x, y));
    s.matrix = m;
    s.rotation += turn;
  };
  proto.rect = function rect(this: any, x: number, y: number, w: number, h: number) {
    this.begin(); this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.close();
  };
  proto.roundrect = function roundrect(this: any, x: number, y: number, w: number, h: number, dx: number, dy?: number) {
    // One radius rounds both ways, as draw.io's SVG canvas takes it.
    const rx = Math.min(dx, w / 2); const ry = Math.min(dy ?? dx, h / 2);
    const kx = rx * KAPPA; const ky = ry * KAPPA;
    this.begin();
    this.moveTo(x + rx, y);
    this.lineTo(x + w - rx, y); this.curveTo(x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry);
    this.lineTo(x + w, y + h - ry); this.curveTo(x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h);
    this.lineTo(x + rx, y + h); this.curveTo(x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry);
    this.lineTo(x, y + ry); this.curveTo(x, y + ry - ky, x + rx - kx, y, x + rx, y);
    this.close();
  };
  proto.ellipse = function ellipse(this: any, x: number, y: number, w: number, h: number) {
    const rx = w / 2; const ry = h / 2; const cx = x + rx; const cy = y + ry;
    const kx = rx * KAPPA; const ky = ry * KAPPA;
    this.begin();
    this.moveTo(cx + rx, cy);
    this.curveTo(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry);
    this.curveTo(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy);
    this.curveTo(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry);
    this.curveTo(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy);
    this.close();
  };
  proto.text = function text() { /* labels are OpenFlowKit's own */ };
  proto.image = function image(this: any, x: number, y: number, w: number, h: number, src: string) {
    const s = this.state; const m: Matrix = s.matrix;
    const at = (px: number, py: number) => {
      const tx = (px + s.dx) * s.scale; const ty = (py + s.dy) * s.scale;
      return { x: m[0] * tx + m[2] * ty + m[4], y: m[1] * tx + m[3] * ty + m[5] };
    };
    const a = at(x, y); const b = at(x + w, y + h);
    if (typeof src === 'string' && src) this.images.push({ url: src, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });
  };
  proto.end = function end() { /* draw.io's path is painted by fill / stroke */ };
  proto.paint = function paint(this: any, filled: boolean, stroked: boolean) {
    const ops: unknown[] = this.path ?? [];
    if (ops.length === 0) return;
    const s = this.state;
    const m: Matrix = s.matrix;
    const at = (index: number) => {
      const x = ops[index] as number; const y = ops[index + 1] as number;
      return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
    };
    const path: DrawioPathCommand[] = [];
    for (let i = 0; i < ops.length;) {
      const op = ops[i];
      if (op === 'M' || op === 'L') { path.push({ kind: op === 'M' ? 'move' : 'line', ...at(i + 1) }); i += 3; }
      else if (op === 'Q') { const c = at(i + 1); path.push({ kind: 'quad', x1: c.x, y1: c.y, ...at(i + 3) }); i += 5; }
      else if (op === 'C') { const c1 = at(i + 1); const c2 = at(i + 3); path.push({ kind: 'cubic', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, ...at(i + 5) }); i += 7; }
      else { path.push({ kind: 'close' }); i += 1; }
    }
    const fill = filled ? role(s.fillColor) : null;
    const stroke = stroked ? role(s.strokeColor) : null;
    // A part some shape drew from a setting it lacked (a coordinate that isn't a number) is left out, not the import.
    const finite = path.every((command) => Object.values(command).every((value) => typeof value === 'string' || Number.isFinite(value)));
    if ((fill || stroke) && finite) {
      this.parts.push({
        path, fill, stroke, strokeWidth: s.strokeWidth,
        dash: s.dashed ? String(s.dashPattern ?? '3 3').split(/[ ,]+/).map(Number).filter(Number.isFinite) : [],
        fillOpacity: s.alpha * s.fillAlpha, strokeOpacity: s.alpha * s.strokeAlpha,
      });
    }
  };
  proto.fill = function fill(this: any) { this.paint(true, false); };
  proto.stroke = function stroke(this: any) { this.paint(false, true); };
  proto.fillAndStroke = function fillAndStroke(this: any) { this.paint(true, true); };
  return Recorder as unknown as new () => any;
}

/** mxShape.redrawShape's painting: before and after it, draw.io swaps in its hand-drawn canvas (`sketch`, `comic`). */
function paintAsDrawio(shape: any, canvas: any): void {
  shape.beforePaint(canvas);
  try { shape.paint(canvas); } finally { shape.afterPaint(canvas); }
}

/** The few DOM calls draw.io's stencil reader makes (mxStencil), over our own parsed XML. */
function domOf(element: XmlElement, parent: any = null): any {
  const node: any = {
    nodeType: 1, nodeName: element.name, tagName: element.name, parentNode: parent, nextSibling: null,
    getAttribute: (name: string) => (Object.hasOwn(element.attributes, name) ? element.attributes[name] : null),
    hasAttribute: (name: string) => Object.hasOwn(element.attributes, name),
  };
  const children = element.children.map((child) => domOf(child, node));
  children.forEach((child: any, index: number) => { child.nextSibling = children[index + 1] ?? null; });
  node.childNodes = children;
  node.firstChild = children[0] ?? null;
  node.getElementsByTagName = (name: string) => {
    const found: any[] = [];
    const walk = (at: any) => { for (const child of at.childNodes) { if (child.nodeName === name) found.push(child); walk(child); } };
    walk(node);
    return found;
  };
  return node;
}

/** Runs draw.io's shape code; the result draws any shape it registered. */
export function createDrawioShapes(runDrawioShapes: (host: any) => Record<string, any>, measure: MeasureText = portableMeasure, rough?: Parameters<typeof installDrawioSketch>[1]): DrawioShapes {
  const registry: Record<string, any> = Object.create(null);
  const mx = runDrawioShapes(host(registry));
  if (rough) installDrawioSketch(mx, rough);
  const { mxConstants, mxUtils, mxRectangle } = mx;
  // draw.io's core shapes, registered as its renderer registers them.
  for (const [key, name] of [['RECTANGLE', 'mxRectangleShape'], ['ELLIPSE', 'mxEllipse'], ['RHOMBUS', 'mxRhombus'], ['CYLINDER', 'mxCylinder'],
    ['CONNECTOR', 'mxConnector'], ['ACTOR', 'mxActor'], ['TRIANGLE', 'mxTriangle'], ['HEXAGON', 'mxHexagon'], ['CLOUD', 'mxCloud'],
    ['LINE', 'mxLine'], ['ARROW', 'mxArrow'], ['ARROW_CONNECTOR', 'mxArrowConnector'], ['DOUBLE_ELLIPSE', 'mxDoubleEllipse'],
    ['SWIMLANE', 'mxSwimlane'], ['IMAGE', 'mxImageShape'], ['LABEL', 'mxLabel']] as const) registry[mxConstants[`SHAPE_${key}`]] = mx[name];
  mxUtils.getSizeForString = (text: string, fontSize?: number, fontFamily?: string) => {
    const size = measure(String(text), Number(fontSize) || mxConstants.DEFAULT_FONTSIZE, fontFamily ?? mxConstants.DEFAULT_FONTFAMILY);
    return new mxRectangle(0, 0, size.width, size.height);
  };
  const Recorder = recorderClass(mx);
  const graph = { isCellVisible: () => true, isCellCollapsed: () => false, getModel: () => ({ getParent: () => null }), getLabel: () => '', convertValueToString: () => '' };

  // draw.io's view at scale 1, as much of it as routings and outline rules read (mxGraphView).
  const { mxPoint, mxStyleRegistry, mxStencilRegistry } = mx;
  // draw.io's app finds stencils by name in lower case (Graph.loadStencil); its shape code passes names as written.
  mxStencilRegistry.getStencil = (name: string | null) => (name == null ? null : mxStencilRegistry.stencils[name.toLowerCase()] ?? null);
  const sequenceGraph = {
    ...graph,
    // Graph.getSequenceLifeline: a lifeline's activation bar counts as the lifeline.
    getSequenceLifeline: (cell: { lifeline: string | null }) => cell.lifeline ?? cell,
    sequenceSelfCallSize: 30,
    // Graph.getSequenceSelfCallPoints: the loop runs sequenceSelfCallSize right of where it leaves.
    getSequenceSelfCallPoints(state: any, y1: number, y2: number) {
      const pt = view.getPerimeterPoint(state, new mxPoint(state.x + state.width + 30, y1), false);
      const x = (pt != null ? pt.x : state.x + state.width) + 30;
      return [new mxPoint(x, y1), new mxPoint(x, y2)];
    },
  };
  const perimeterOf = (style: Record<string, unknown>) => {
    const named = style.perimeter;
    const found = typeof named === 'string' ? mxStyleRegistry.getValue(named) : named;
    return typeof found === 'function' ? found : null;
  };
  const view: any = {
    scale: 1, translate: new mxPoint(0, 0), graph: sequenceGraph,
    getPixelSize: () => 1,
    transformControlPoint: (state: any, pt: any) => (state && pt ? new mxPoint(pt.x + state.origin.x, pt.y + state.origin.y) : null),
    getPerimeterPoint(terminal: any, next: any, orthogonal: boolean, border = 0) {
      const perimeter = perimeterOf(terminal.style);
      if (!perimeter || !next) return new mxPoint(terminal.getCenterX(), terminal.getCenterY());
      const grow = border + (Number.parseFloat(terminal.style.perimeterSpacing) || 0);
      const bounds = new mxRectangle(terminal.x - grow, terminal.y - grow, terminal.width + 2 * grow, terminal.height + 2 * grow);
      return perimeter(bounds, terminal, next, orthogonal) ?? new mxPoint(terminal.getCenterX(), terminal.getCenterY());
    },
  };
  const stateOf = (terminal: RouteTerminal) => {
    const state = new mxRectangle(terminal.x, terminal.y, terminal.width, terminal.height);
    return Object.assign(state, { style: terminal.style, view, cell: { lifeline: terminal.lifeline ?? null } });
  };
  const point = (at: Point2d | null) => (at ? new mxPoint(at.x, at.y) : null);

  return {
    router(name) {
      const route = mxStyleRegistry.getValue(name);
      if (typeof route !== 'function') return null;
      return (edge, source, target, hints, result) => {
        const state = { view, style: edge.style, origin: point(edge.origin), absolutePoints: edge.absolutePoints.map(point) };
        const out: any[] = [point(result[0] ?? null)];
        route(state, source && stateOf(source), target && stateOf(target), hints.map(point), out);
        for (const at of out.slice(1)) result.push(at ? { x: at.x, y: at.y } : null);
      };
    },
    perimeter(name) {
      const outline = mxStyleRegistry.getValue(name);
      if (typeof outline !== 'function') return null;
      return (bounds, shape, next, orthogonal) => {
        const at = outline(new mxRectangle(bounds.x, bounds.y, bounds.width, bounds.height), { style: shape.style ?? {}, view }, new mxPoint(next.x, next.y), orthogonal);
        return at ? { x: at.x, y: at.y } : null;
      };
    },
    has: (name) => name in registry || mxStencilRegistry.getStencil(name.toLowerCase()) != null,
    addStencils(stencils) {
      for (const [name, element] of stencils) {
        if (mxStencilRegistry.getStencil(name) == null) mxStencilRegistry.addStencil(name, new mx.mxStencil(domOf(element)));
      }
    },
    names: () => Object.keys(registry),
    draw(style, width, height) {
      const name = style.shape ?? '';
      const Shape = registry[name];
      const stencil = Shape ? null : mxStencilRegistry.getStencil(name.toLowerCase());
      if (!Shape && !stencil) return null;
      // A shape whose code needs what only draw.io's editor has throws: it is reported as not drawn, never fatal.
      try {
        const shape = Shape ? new Shape() : new mx.mxShape(stencil);
        // The node's own fill and line, as marker colours; draw.io's own defaults when the style sets none.
        // The node turns by `rotation` (OpenFlowKit's own transform); draw.io's code draws the shape unturned.
        const { rotation: _turn, ...unturned } = style;
        const marked = { ...unturned, fillColor: style.fillColor === 'none' ? 'none' : STENCIL_FILL, strokeColor: style.strokeColor === 'none' ? 'none' : STENCIL_STROKE };
        shape.fill = STENCIL_FILL; shape.stroke = STENCIL_STROKE; shape.strokewidth = 1; shape.scale = 1;
        shape.apply({ style: marked, view: { graph }, cell: {} });
        shape.bounds = new mxRectangle(0, 0, width, height);
        // mxCellRenderer.initializeShape: a shape that draws a picture (draw.io's label card) takes the cell's `image`.
        if (style.image) shape.image = style.image;
        // A sketched shape's fill style follows its own fill, which the canvas holds a stand-in for (drawioSketch).
        shape.sketchFill = style.fillColor; shape.sketchGradient = style.gradientColor;
        shape.shapePointerEvents = false; shape.stencilPointerEvents = false;
        shape.updateSvgFilters = () => { /* no page */ };
        shape.isOpacityGroup = () => false;
        const canvas = new Recorder();
        canvas.pointerEvents = false;
        paintAsDrawio(shape, canvas);
        return { parts: canvas.parts, images: canvas.images };
      } catch { return null; }
    },
    drawLine(style, points) {
      const Shape = registry[style.shape ?? ''];
      if (!Shape || points.length < 2) return null;
      try {
        const shape = new Shape();
        // A line has no fill unless its style sets one; draw.io's edge style sets none.
        const fillColor = style.fillColor === undefined || style.fillColor === 'none' ? 'none' : STENCIL_FILL;
        shape.apply({ style: { ...style, fillColor, strokeColor: style.strokeColor === 'none' ? 'none' : STENCIL_STROKE }, view: { graph }, cell: {} });
        shape.scale = 1;
        shape.points = points.map((at) => new mxPoint(at.x, at.y));
        const xs = points.map((at) => at.x); const ys = points.map((at) => at.y);
        shape.bounds = new mxRectangle(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        shape.shapePointerEvents = false; shape.stencilPointerEvents = false;
        shape.updateSvgFilters = () => { /* no page */ };
        shape.isOpacityGroup = () => false;
        const canvas = new Recorder();
        canvas.pointerEvents = false;
        paintAsDrawio(shape, canvas);
        return canvas.parts.length ? canvas.parts : null;
      } catch { return null; }
    },
  };
}

let loaded: Promise<DrawioShapes> | null = null;
/** draw.io's shapes, loaded on first use (their own file, ~270 KB compressed) and kept. */
export function loadDrawioShapes(measure?: MeasureText): Promise<DrawioShapes> {
  loaded ??= Promise.all([import('../../vendor/drawio/shapes.js'), import('../../vendor/drawio/rough.js')])
    .then(([{ runDrawioShapes }, { rough }]) => createDrawioShapes(runDrawioShapes, measure, rough));
  return loaded;
}

/**
 * Loads draw.io's shape code in the background once the app is idle, and draws every draw.io shape with it from then
 * on: a saved document's draw.io shapes are redrawn at their own size, and an import doesn't wait for the download.
 */
export function warmDrawioShapes(): void {
  const start = () => {
    loadDrawioShapes()
      .then((code) => {
        provideDrawnShapes((style, width, height) => code.draw(style, width, height)?.parts ?? null);
        provideDrawnLines((style, points) => code.drawLine(style, points));
      })
      .catch(() => { /* saved parts are drawn instead; an import loads the code itself */ });
  };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start, { timeout: 5000 });
  else window.setTimeout(start, 2000);
}
