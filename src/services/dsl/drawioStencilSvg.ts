import type { XmlElement } from './xmlReader';
import type { DrawioStyle } from './drawioStyle';

// draw.io's stencil language, drawn as SVG. A stencil (`<shape>` from a draw.io library) is a small program of
// about 30 commands over a `w`×`h` grid; this follows draw.io's interpreter (mxStencil.drawShape / drawNode, and
// mxSvgCanvas2D's state rules) command for command, so every library shape, seen or not, draws as draw.io draws it.

/** Finds another stencil by its full name, for `include-shape`. */
export type StencilLookup = (name: string) => XmlElement | null;

interface Paint {
  fill: string | null; stroke: string | null; gradient: string | null; gradientDirection: string;
  strokeWidth: number; dashed: boolean; dashPattern: string; fixDash: boolean;
  alpha: number; fillAlpha: number; strokeAlpha: number;
  lineCap: string; lineJoin: string; miterLimit: number;
  fontColor: string; fontSize: number; fontFamily: string; fontStyle: number;
}

interface Frame { readonly x: number; readonly y: number; readonly sx: number; readonly sy: number }

const NONE = 'none';
const ROUNDING = 0.15; // mxConstants.RECTANGLE_ROUNDING_FACTOR

/** A style colour as SVG paint: draw.io's `default` is its light-page default, `light-dark(a,b)` its light half. */
export function stencilColor(value: string | undefined, fallback: string | null): string | null {
  if (value === undefined || value === '' || value === 'inherit') return fallback;
  if (value === NONE) return null;
  if (value === 'default') return fallback;
  const lightDark = /^light-dark\(\s*([^,]+),/.exec(value);
  return lightDark ? stencilColor(lightDark[1]!.trim(), fallback) : value;
}

const n = (value: string | undefined, fallback = 0): number => {
  const parsed = Number(value);
  return value === undefined || value === '' || !Number.isFinite(parsed) ? fallback : parsed;
};
const fmt = (value: number): string => String(Math.round(value * 100) / 100);
const esc = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The SVG canvas: draw.io's mxAbstractCanvas2D state stack, with paths and painted elements as SVG text. */
class SvgCanvas {
  state: Paint;
  private readonly stack: Paint[] = [];
  private path: string[] = [];
  private shape: string | null = null; // an element made by rect/roundrect/ellipse, waiting to be painted
  private readonly gradients: string[] = [];
  readonly out: string[] = [];
  extent = 0; // the widest line drawn, so the picture leaves room for it

  constructor(state: Paint) { this.state = state; }

  save(): void { this.stack.push({ ...this.state }); }
  restore(): void { const top = this.stack.pop(); if (top) this.state = top; }

  begin(): void { this.path = []; this.shape = null; }
  moveTo(x: number, y: number): void { this.shape = null; this.path.push(`M${fmt(x)} ${fmt(y)}`); }
  lineTo(x: number, y: number): void { this.path.push(`L${fmt(x)} ${fmt(y)}`); }
  quadTo(x1: number, y1: number, x2: number, y2: number): void { this.path.push(`Q${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)}`); }
  curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    this.path.push(`C${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(x3)} ${fmt(y3)}`);
  }
  arcTo(rx: number, ry: number, rotation: number, large: number, sweep: number, x: number, y: number): void {
    this.path.push(`A${fmt(rx)} ${fmt(ry)} ${fmt(rotation)} ${large ? 1 : 0} ${sweep ? 1 : 0} ${fmt(x)} ${fmt(y)}`);
  }
  close(): void { this.path.push('Z'); }
  rect(x: number, y: number, w: number, h: number): void {
    this.path = [];
    this.shape = `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}"`;
  }
  roundrect(x: number, y: number, w: number, h: number, r: number): void {
    this.path = [];
    this.shape = `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(r)}" ry="${fmt(r)}"`;
  }
  ellipse(x: number, y: number, w: number, h: number): void {
    this.path = [];
    this.shape = `<ellipse cx="${fmt(x + w / 2)}" cy="${fmt(y + h / 2)}" rx="${fmt(w / 2)}" ry="${fmt(h / 2)}"`;
  }

  /** Paints the current path or shape, as draw.io's fill/stroke/fillAndStroke do. */
  paint(filled: boolean, stroked: boolean): void {
    const geometry = this.shape ?? (this.path.length ? `<path d="${this.path.join('')}"` : null);
    if (!geometry) return;
    const s = this.state;
    const fill = filled && s.fill && s.fill !== NONE ? s.fill : null;
    const stroke = stroked && s.stroke && s.stroke !== NONE ? s.stroke : null;
    if (!fill && !stroke) return;
    const attrs: string[] = [];
    if (fill) {
      attrs.push(`fill="${esc(s.gradient && s.gradient !== NONE ? this.gradient(fill, s.gradient, s.gradientDirection) : fill)}"`);
      const opacity = s.alpha * s.fillAlpha;
      if (opacity < 1) attrs.push(`fill-opacity="${fmt(opacity)}"`);
    } else attrs.push('fill="none"');
    if (stroke) {
      const width = Math.max(0, s.strokeWidth);
      this.extent = Math.max(this.extent, width);
      attrs.push(`stroke="${esc(stroke)}"`, `stroke-width="${fmt(width)}"`);
      const opacity = s.alpha * s.strokeAlpha;
      if (opacity < 1) attrs.push(`stroke-opacity="${fmt(opacity)}"`);
      if (s.dashed) {
        // mxSvgCanvas2D.createDashPattern: each dash scaled by the line's width unless fixDash.
        const scale = s.fixDash ? 1 : Math.max(1, width);
        attrs.push(`stroke-dasharray="${s.dashPattern.split(/\s+/).filter(Boolean).map((part) => fmt(Number(part) * scale)).join(' ')}"`);
      }
      const cap = s.lineCap === 'flat' ? 'butt' : s.lineCap;
      if (cap !== 'butt') attrs.push(`stroke-linecap="${esc(cap)}"`);
      if (s.lineJoin !== 'miter') attrs.push(`stroke-linejoin="${esc(s.lineJoin)}"`);
      if (s.miterLimit !== 10) attrs.push(`stroke-miterlimit="${fmt(s.miterLimit)}"`);
    } else attrs.push('stroke="none"');
    this.out.push(`${geometry} ${attrs.join(' ')}/>`);
  }

  /** draw.io's linear gradient: from `from` to `to` toward `direction` (south by default). */
  private gradient(from: string, to: string, direction: string): string {
    const id = `g${this.gradients.length}`;
    const [x1, y1, x2, y2] = direction === 'north' ? [0, 1, 0, 0] : direction === 'east' ? [0, 0, 1, 0] : direction === 'west' ? [1, 0, 0, 0] : [0, 0, 0, 1];
    this.gradients.push(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${esc(from)}"/><stop offset="1" stop-color="${esc(to)}"/></linearGradient>`);
    return `url(#${id})`;
  }

  text(x: number, y: number, str: string, align: string, valign: string, rotation: number): void {
    const s = this.state;
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    // mxSvgCanvas2D.plainText: the first baseline sits a font size less one below `y`, moved up by half the block
    // (middle) or all of it and one more (bottom); each further line is a rounded 1.2 font sizes lower.
    const lines = str.split('\n');
    const size = s.fontSize;
    const step = Math.round(size * 1.2);
    const block = size + (lines.length - 1) * step;
    let baseline = y + size - 1 - (valign === 'middle' ? block / 2 : valign === 'bottom' ? block + 1 : 0);
    const weight = s.fontStyle & 1 ? ' font-weight="bold"' : '';
    const italic = s.fontStyle & 2 ? ' font-style="italic"' : '';
    const turn = rotation ? ` transform="rotate(${fmt(rotation)} ${fmt(x)} ${fmt(y)})"` : '';
    const opacity = s.alpha < 1 ? ` opacity="${fmt(s.alpha)}"` : '';
    const rows: string[] = [];
    for (const line of lines) {
      if (line.trim()) rows.push(`<text x="${fmt(x)}" y="${fmt(baseline)}">${esc(line)}</text>`);
      baseline += step;
    }
    this.out.push(`<g fill="${esc(s.fontColor)}" font-size="${fmt(size)}" font-family="${esc(s.fontFamily)}" text-anchor="${anchor}"${weight}${italic}${opacity}${turn}>${rows.join('')}</g>`);
  }

  image(x: number, y: number, w: number, h: number, src: string, flipH: boolean, flipV: boolean): void {
    if (!/^(data:image\/|https?:\/\/)/i.test(src)) return;
    const flip = flipH || flipV ? ` transform="translate(${fmt(flipH ? 2 * x + w : 0)} ${fmt(flipV ? 2 * y + h : 0)}) scale(${flipH ? -1 : 1} ${flipV ? -1 : 1})"` : '';
    this.out.push(`<image href="${esc(src)}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="none"${flip}/>`);
  }

  defs(): string { return this.gradients.length ? `<defs>${this.gradients.join('')}</defs>` : ''; }
}

/** mxStencil.computeAspect: the stencil grid's origin and scale inside the `w`×`h` box at `x`,`y`. */
function aspectFrame(shape: XmlElement, x: number, y: number, w: number, h: number, direction: string | undefined): Frame {
  const w0 = n(shape.attributes.w, 100) || 100;
  const h0 = n(shape.attributes.h, 100) || 100;
  let sx = w / w0;
  let sy = h / h0;
  let left = x;
  let top = y;
  const upright = direction === 'north' || direction === 'south';
  if (upright) {
    sy = w / h0;
    sx = h / w0;
    const shift = (w - h) / 2;
    left += shift;
    top -= shift;
  }
  if ((shape.attributes.aspect ?? 'variable') === 'fixed') {
    sx = sy = Math.min(sx, sy);
    if (upright) { left += (h - w0 * sx) / 2; top += (w - h0 * sy) / 2; } else { left += (w - w0 * sx) / 2; top += (h - h0 * sy) / 2; }
  }
  return { x: left, y: top, sx, sy };
}

/** mxShape.addPoints for a `rounded="1"` path: each corner cut `arc` short and turned with a quadratic curve. */
function roundedPoints(canvas: SvgCanvas, input: readonly { x: number; y: number }[], arc: number, closed: boolean): void {
  if (!input.length) return;
  const pe = input[input.length - 1]!;
  const pts = closed ? [{ x: pe.x + (input[0]!.x - pe.x) / 2, y: pe.y + (input[0]!.y - pe.y) / 2 }, ...input] : [...input];
  let pt = pts[0]!;
  canvas.moveTo(pt.x, pt.y);
  const at = (index: number) => pts[((index % pts.length) + pts.length) % pts.length]!;
  for (let i = 1; i < (closed ? pts.length : pts.length - 1); i += 1) {
    let tmp = at(i);
    let dx = pt.x - tmp.x;
    let dy = pt.y - tmp.y;
    if (dx !== 0 || dy !== 0) {
      let dist = Math.hypot(dx, dy);
      const x1 = tmp.x + dx * Math.min(arc, dist / 2) / dist;
      const y1 = tmp.y + dy * Math.min(arc, dist / 2) / dist;
      canvas.lineTo(x1, y1);
      let next = at(i + 1);
      while (i < pts.length - 2 && Math.round(next.x - tmp.x) === 0 && Math.round(next.y - tmp.y) === 0) { next = at(i + 2); i += 1; }
      dx = next.x - tmp.x;
      dy = next.y - tmp.y;
      dist = Math.max(1, Math.hypot(dx, dy));
      const x2 = tmp.x + dx * Math.min(arc, dist / 2) / dist;
      const y2 = tmp.y + dy * Math.min(arc, dist / 2) / dist;
      canvas.quadTo(tmp.x, tmp.y, x2, y2);
      tmp = { x: x2, y: y2 };
    } else canvas.lineTo(tmp.x, tmp.y);
    pt = tmp;
  }
  if (closed) canvas.close(); else canvas.lineTo(pe.x, pe.y);
}

interface Owner { readonly fill: string | null; readonly stroke: string | null; readonly style: DrawioStyle }

/** mxStencil.drawShape: the stencil's background, then its foreground, over the `w`×`h` box at `x`,`y`. */
function drawStencil(canvas: SvgCanvas, shape: XmlElement, owner: Owner, x: number, y: number, w: number, h: number, lookup: StencilLookup, depth: number): void {
  if (w <= 0 || h <= 0 || depth > 8) return;
  const frame = aspectFrame(shape, x, y, w, h, owner.style.direction);
  const min = Math.min(frame.sx, frame.sy);
  const declared = shape.attributes.strokewidth ?? '1';
  canvas.state.strokeWidth = declared === 'inherit' ? n(owner.style.strokeWidth, 1) : n(declared, 1) * min;
  const background = shape.children.find((child) => child.name === 'background');
  const foreground = shape.children.find((child) => child.name === 'foreground');
  for (const part of [background, foreground]) for (const node of part?.children ?? []) drawNode(canvas, node, owner, frame, lookup, depth);
}

/** mxStencil.drawNode: one command. */
function drawNode(canvas: SvgCanvas, node: XmlElement, owner: Owner, frame: Frame, lookup: StencilLookup, depth: number): void {
  const a = node.attributes;
  const { x: ox, y: oy, sx, sy } = frame;
  const min = Math.min(sx, sy);
  const X = (key: string) => ox + n(a[key]) * sx;
  const Y = (key: string) => oy + n(a[key]) * sy;
  const color = (value: string | undefined) => (value === 'stroke' ? owner.stroke : value === 'fill' ? owner.fill : value ?? null);
  switch (node.name) {
    case 'save': canvas.save(); return;
    case 'restore': canvas.restore(); return;
    case 'path': {
      canvas.begin();
      if (a.rounded === '1') {
        const runs: { x: number; y: number }[][] = [];
        const onlyLines = node.children.every((step) => step.name === 'move' || step.name === 'line');
        if (onlyLines && node.children.length) {
          for (const step of node.children) {
            if (step.name === 'move' || !runs.length) runs.push([]);
            runs[runs.length - 1]!.push({ x: ox + n(step.attributes.x) * sx, y: oy + n(step.attributes.y) * sy });
          }
          for (const run of runs) {
            const first = run[0]!;
            const last = run[run.length - 1]!;
            const closed = run.length > 1 && first.x === last.x && first.y === last.y;
            roundedPoints(canvas, closed ? run.slice(0, -1) : run, n(a.arcSize), closed);
          }
          return;
        }
      }
      for (const step of node.children) drawNode(canvas, step, owner, frame, lookup, depth);
      return;
    }
    case 'close': canvas.close(); return;
    case 'move': canvas.moveTo(X('x'), Y('y')); return;
    case 'line': canvas.lineTo(X('x'), Y('y')); return;
    case 'quad': canvas.quadTo(X('x1'), Y('y1'), X('x2'), Y('y2')); return;
    case 'curve': canvas.curveTo(X('x1'), Y('y1'), X('x2'), Y('y2'), X('x3'), Y('y3')); return;
    case 'arc':
      canvas.arcTo(n(a.rx) * sx, n(a.ry) * sy, n(a['x-axis-rotation']), n(a['large-arc-flag']), n(a['sweep-flag']), X('x'), Y('y'));
      return;
    case 'rect': canvas.rect(X('x'), Y('y'), n(a.w) * sx, n(a.h) * sy); return;
    case 'roundrect': {
      const size = (n(a.arcsize) || ROUNDING * 100) / 100;
      const w = n(a.w) * sx;
      const h = n(a.h) * sy;
      canvas.roundrect(X('x'), Y('y'), w, h, Math.min(w * size, h * size));
      return;
    }
    case 'ellipse': canvas.ellipse(X('x'), Y('y'), n(a.w) * sx, n(a.h) * sy); return;
    case 'image': canvas.image(X('x'), Y('y'), n(a.w) * sx, n(a.h) * sy, a.src ?? '', a.flipH === '1', a.flipV === '1'); return;
    case 'text': {
      const rotation = (a.vertical === '1' ? -90 : 0) - n(a.rotation);
      canvas.text(X('x'), Y('y'), a.str ?? node.text, a.align || 'left', a.valign || 'top', rotation);
      return;
    }
    case 'include-shape': {
      const included = a.name ? lookup(a.name.toLowerCase()) : null;
      if (included) drawStencil(canvas, included, owner, X('x'), Y('y'), n(a.w) * sx, n(a.h) * sy, lookup, depth + 1);
      return;
    }
    case 'fillstroke': canvas.paint(true, true); return;
    case 'fill': canvas.paint(true, false); return;
    case 'stroke': canvas.paint(false, true); return;
    case 'strokewidth': canvas.state.strokeWidth = n(a.width) * (a.fixed === '1' ? 1 : min); return;
    case 'dashed': canvas.state.dashed = a.dashed === '1'; return;
    case 'dashpattern':
      if (a.pattern) canvas.state.dashPattern = a.pattern.split(' ').filter(Boolean).map((part) => String(Number(part) * min)).join(' ');
      return;
    case 'strokecolor': canvas.state.stroke = color(a.color); return;
    case 'fillcolor': canvas.state.fill = color(a.color); return;
    case 'fontcolor': canvas.state.fontColor = color(a.color) ?? canvas.state.fontColor; return;
    case 'linecap': canvas.state.lineCap = a.cap ?? 'flat'; return;
    case 'linejoin': canvas.state.lineJoin = a.join ?? 'miter'; return;
    case 'miterlimit': canvas.state.miterLimit = n(a.limit, 10); return;
    // draw.io's interpreter sets the shared alpha for all three, so fillalpha also fades the line; drawn as draw.io does.
    case 'alpha': case 'fillalpha': case 'strokealpha': canvas.state.alpha = n(a.alpha, 1); return;
    case 'fontstyle': canvas.state.fontStyle = n(a.style); return;
    case 'fontfamily': canvas.state.fontFamily = a.family ?? canvas.state.fontFamily; return;
    case 'fontsize': canvas.state.fontSize = n(a.size, 11) * min; return;
    default: return;
  }
}

/** The paint a cell's style gives a shape before its stencil runs (mxShape.configureCanvas). */
function cellPaint(style: DrawioStyle): Paint {
  return {
    fill: stencilColor(style.fillColor, '#ffffff'),
    stroke: stencilColor(style.strokeColor, '#000000'),
    gradient: stencilColor(style.gradientColor, null),
    gradientDirection: style.gradientDirection ?? 'south',
    strokeWidth: n(style.strokeWidth, 1),
    dashed: style.dashed === '1',
    dashPattern: style.dashPattern ?? '3 3',
    fixDash: style.fixDash === '1',
    alpha: n(style.opacity, 100) / 100,
    fillAlpha: n(style.fillOpacity, 100) / 100,
    strokeAlpha: n(style.strokeOpacity, 100) / 100,
    lineCap: 'flat', lineJoin: 'miter', miterLimit: 10,
    fontColor: stencilColor(style.fontColor, '#000000') ?? '#000000',
    fontSize: 11, fontFamily: 'Arial, Helvetica', fontStyle: 0,
  };
}

const DIRECTION_TURN: Readonly<Record<string, number>> = { north: 270, west: 180, south: 90 };

export interface StencilPicture {
  /** The picture, as an SVG document. */
  readonly svg: string;
  /** How far the picture reaches past the cell's box on every side (half the widest line), in pixels. */
  readonly margin: number;
}

/**
 * A cell drawn by its stencil at `width`×`height`, as draw.io draws it: the stencil's commands over the cell's
 * fill, line, opacity, dashes and gradient, turned by `direction` and mirrored by `flipH`/`flipV`. The cell's own
 * rotation is not in the picture; it belongs to the node it sits on.
 */
export function stencilSvg(shape: XmlElement, style: DrawioStyle, width: number, height: number, lookup: StencilLookup = () => null, icon?: { readonly stencil: XmlElement; readonly kind: 'resource' }): StencilPicture {
  const paint = cellPaint(style);
  const canvas = new SvgCanvas(paint);
  const owner: Owner = { fill: paint.fill, stroke: paint.stroke, style };
  if (icon) {
    // mxgraph.aws4.resourceIcon: the box filled with the cell's fill, then the named icon in its line colour, 10% in.
    canvas.rect(0, 0, width, height);
    canvas.paint(true, false);
    canvas.state.fill = paint.stroke ?? '#000000';
    canvas.state.stroke = null;
    drawStencil(canvas, icon.stencil, owner, width * 0.1, height * 0.1, width * 0.8, height * 0.8, lookup, 0);
  } else drawStencil(canvas, shape, owner, 0, 0, width, height, lookup, 0);
  const margin = Math.ceil(canvas.extent / 2);
  const turn = DIRECTION_TURN[style.direction ?? ''] ?? 0;
  const flipH = (style.flipH === '1') !== (style.stencilFlipH === '1');
  const flipV = (style.flipV === '1') !== (style.stencilFlipV === '1');
  const cx = width / 2;
  const cy = height / 2;
  const transforms: string[] = [];
  if (flipH || flipV) transforms.push(`translate(${fmt(cx)} ${fmt(cy)}) scale(${flipH ? -1 : 1} ${flipV ? -1 : 1}) translate(${fmt(-cx)} ${fmt(-cy)})`);
  if (turn) transforms.push(`rotate(${turn} ${fmt(cx)} ${fmt(cy)})`);
  const body = canvas.out.join('');
  const group = transforms.length ? `<g transform="${transforms.join(' ')}">${body}</g>` : body;
  const W = width + 2 * margin;
  const H = height + 2 * margin;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}" height="${fmt(H)}" viewBox="${fmt(-margin)} ${fmt(-margin)} ${fmt(W)} ${fmt(H)}">${canvas.defs()}${group}</svg>`;
  return { svg, margin };
}

/** An SVG document as a URL our image node loads. */
export function svgDataUrl(svg: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(svg)) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}
