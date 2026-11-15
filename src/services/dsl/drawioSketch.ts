/* eslint-disable @typescript-eslint/no-explicit-any */
// draw.io's sketch look (`sketch=1`): every outline a shape draws is handed to Rough.js, which draws it by hand.
// Ported from draw.io's editor (Editor.createRoughCanvas and the canvas Graph installs as mxShape.createRoughCanvas,
// draw.io 26–32, Apache License 2.0), which its shape code alone doesn't carry; Rough.js is vendored beside the shapes.

/** The seed draw.io gives a cell's hand-drawn strokes, from its id: the same cell wobbles the same way each time. */
export function drawioSketchSeed(id: string): number {
  let seed = 1;
  for (let i = 0; i < id.length; i++) seed = ((seed << 5) - seed + id.charCodeAt(i)) << 0;
  return seed;
}

/** Fills draw.io draws solid under `fillStyle=auto`: white and the page's own background (white here). */
const SOLID_FILLS = new Set(['#ffffff', '#fff']);

/**
 * How draw.io fills a sketched shape: `fillStyle` as written (`dots` reads as `auto`); `auto` draws a white fill or a
 * gradient solid, and anything else hatched (Rough.js's own default).
 */
export function drawioSketchFillStyle(fillStyle: string | undefined, fill: string | undefined, gradient: string | undefined): string {
  const written = !fillStyle || fillStyle === 'dots' ? 'auto' : fillStyle;
  if (written !== 'auto') return written;
  const graded = gradient !== undefined && gradient !== 'none' && gradient !== '';
  return fill !== undefined && (graded || SOLID_FILLS.has(fill.toLowerCase())) ? 'solid' : 'hachure';
}

/** Installs draw.io's sketch canvas: a shape whose style has `sketch=1` is drawn through Rough.js onto draw.io's canvas. */
export function installDrawioSketch(mx: Record<string, any>, rough: { canvas(canvas: { getContext(): unknown }): any }): void {
  const { mxShape, mxUtils, mxConstants } = mx;
  const value = (style: any, key: string, fallback: unknown) => mxUtils.getValue(style, key, fallback);

  // Editor.createRoughCanvas: Rough.js drawing its strokes back onto draw.io's canvas.
  function roughOn(canvas: any) {
    const rc = rough.canvas({ getContext: () => canvas });
    rc.draw = function draw(drawable: any) {
      const options = drawable.options || this.getDefaultOptions();
      for (const set of drawable.sets || []) {
        if (set.type === 'path') { if (options.stroke != null) this._drawToContext(canvas, set, options); }
        else if (set.type === 'fillPath') this._drawToContext(canvas, set, options);
        else if (set.type === 'fillSketch') this.fillSketch(canvas, set, options);
      }
    };
    // Hatching is drawn as lines in the fill's colour.
    rc.fillSketch = function fillSketch(context: any, set: any, options: any) {
      const { strokeColor, strokeWidth, strokeAlpha, dashed } = canvas.state;
      const weight = options.fillWeight < 0 ? options.strokeWidth / 2 : options.fillWeight;
      canvas.setStrokeAlpha(canvas.state.fillAlpha); canvas.setStrokeColor(options.fill || ''); canvas.setStrokeWidth(weight); canvas.setDashed(false);
      this._drawToContext(context, set, options);
      canvas.setDashed(dashed); canvas.setStrokeWidth(strokeWidth); canvas.setStrokeColor(strokeColor); canvas.setStrokeAlpha(strokeAlpha);
    };
    rc._drawToContext = function drawToContext(context: any, set: any, options: any) {
      context.begin();
      for (const { op, data } of set.ops) {
        if (op === 'move') context.moveTo(data[0], data[1]);
        else if (op === 'bcurveTo') context.curveTo(data[0], data[1], data[2], data[3], data[4], data[5]);
        else if (op === 'lineTo') context.lineTo(data[0], data[1]);
      }
      context.end();
      if (set.type === 'fillPath' && options.filled) context.fill(); else context.stroke();
    };
    return rc;
  }

  const DRAWN = ['begin', 'end', 'rect', 'roundrect', 'ellipse', 'lineTo', 'moveTo', 'quadTo', 'curveTo', 'arcTo', 'close', 'fill', 'stroke', 'fillAndStroke'] as const;

  // The canvas draw.io installs for a sketched shape: it gathers each outline, then has Rough.js draw it.
  function RoughCanvas(this: any, canvas: any, rc: any, shape: any) {
    this.canvas = canvas; this.rc = rc; this.shape = shape;
    canvas.setLineJoin('round'); canvas.setLineCap('round');
    this.original = {};
    for (const name of DRAWN) {
      this.original[name] = canvas[name];
      canvas[name] = (...args: unknown[]) => (this.passThrough ? this.original[name].apply(canvas, args) : this[name](...args));
    }
    this.path = [];
    this.passThrough = false;
  }
  const proto = RoughCanvas.prototype;
  proto.getStyle = function getStyle(this: any, stroked: boolean, filled: boolean) {
    const { state } = this.canvas; const style = this.shape.style; const defaults = this.rc.getDefaultOptions();
    const options: any = { strokeWidth: state.strokeWidth, seed: Number(style?.sketchSeed ?? 1), preserveVertices: true };
    options.stroke = stroked ? (state.strokeColor === mxConstants.NONE ? 'transparent' : state.strokeColor) : mxConstants.NONE;
    options.filled = filled;
    options.fill = filled ? (state.fillColor === mxConstants.NONE ? '' : state.fillColor) : '';
    options.bowing = value(style, 'bowing', defaults.bowing);
    options.hachureAngle = value(style, 'hachureAngle', defaults.hachureAngle);
    options.curveFitting = value(style, 'curveFitting', defaults.curveFitting);
    options.roughness = value(style, 'jiggle', defaults.roughness);
    options.simplification = value(style, 'simplification', defaults.simplification);
    options.disableMultiStroke = value(style, 'disableMultiStroke', defaults.disableMultiStroke);
    options.disableMultiStrokeFill = value(style, 'disableMultiStrokeFill', defaults.disableMultiStrokeFill);
    const gap = value(style, 'hachureGap', -1);
    options.hachureGap = gap === 'auto' ? -1 : gap;
    options.dashGap = value(style, 'dashGap', gap); options.dashOffset = value(style, 'dashOffset', gap); options.zigzagOffset = value(style, 'zigzagOffset', gap);
    const weight = value(style, 'fillWeight', -1);
    options.fillWeight = weight === 'auto' ? -1 : weight;
    // draw.io judges `auto` by the cell's own fill; the canvas holds a stand-in colour for it here (drawioShapes).
    options.fillStyle = drawioSketchFillStyle(style?.fillStyle, this.shape.sketchFill, this.shape.sketchGradient);
    return options;
  };
  proto.begin = function begin(this: any) { this.path = []; };
  proto.end = function end() { /* drawn by fill / stroke */ };
  proto.addOp = function addOp(this: any, op: string, ...xy: number[]) {
    this.path.push(op);
    for (let i = 0; i < xy.length; i += 2) { this.lastX = xy[i]; this.lastY = xy[i + 1]; this.path.push(this.canvas.format(this.lastX), this.canvas.format(this.lastY)); }
  };
  proto.lineTo = function lineTo(this: any, x: number, y: number) { this.addOp('L', x, y); };
  proto.moveTo = function moveTo(this: any, x: number, y: number) { this.addOp('M', x, y); };
  proto.close = function close(this: any) { this.addOp('Z'); };
  proto.quadTo = function quadTo(this: any, x1: number, y1: number, x2: number, y2: number) { this.addOp('Q', x1, y1, x2, y2); };
  proto.curveTo = function curveTo(this: any, ...xy: number[]) { this.addOp('C', ...xy); };
  proto.arcTo = function arcTo(this: any, rx: number, ry: number, angle: number, large: number, sweep: number, x: number, y: number) {
    const curves = mxUtils.arcToCurves(this.lastX, this.lastY, rx, ry, angle, large, sweep, x, y);
    for (let i = 0; curves != null && i < curves.length; i += 6) this.curveTo(...curves.slice(i, i + 6));
    this.lastX = x; this.lastY = y;
  };
  proto.rect = function rect(this: any, x: number, y: number, w: number, h: number) {
    this.path = []; this.nextShape = this.rc.generator.rectangle(x, y, w, h, this.getStyle(true, true));
  };
  proto.ellipse = function ellipse(this: any, x: number, y: number, w: number, h: number) {
    this.path = []; this.nextShape = this.rc.generator.ellipse(x + w / 2, y + h / 2, w, h, this.getStyle(true, true));
  };
  proto.roundrect = function roundrect(this: any, x: number, y: number, w: number, h: number, dx: number, dy: number) {
    this.begin(); this.moveTo(x + dx, y); this.lineTo(x + w - dx, y); this.quadTo(x + w, y, x + w, y + dy);
    this.lineTo(x + w, y + h - dy); this.quadTo(x + w, y + h, x + w - dx, y + h); this.lineTo(x + dx, y + h);
    this.quadTo(x, y + h, x, y + h - dy); this.lineTo(x, y + dy); this.quadTo(x, y, x + dx, y);
  };
  proto.drawPath = function drawPath(this: any, options: any) {
    if (this.path.length > 0) {
      this.passThrough = true;
      try { this.rc.path(this.path.join(' '), options); } catch { /* draw.io skips a path Rough.js can't read */ }
      this.passThrough = false;
    } else if (this.nextShape != null) {
      Object.assign(this.nextShape.options, options);
      if (options.stroke === mxConstants.NONE || options.stroke == null) delete this.nextShape.options.stroke;
      if (!options.filled) delete this.nextShape.options.fill;
      this.passThrough = true;
      this.rc.draw(this.nextShape);
      this.passThrough = false;
    }
  };
  proto.stroke = function stroke(this: any) { this.drawPath(this.getStyle(true, false)); };
  proto.fill = function fill(this: any) { this.drawPath(this.getStyle(false, true)); };
  proto.fillAndStroke = function fillAndStroke(this: any) { this.drawPath(this.getStyle(true, true)); };
  proto.destroy = function destroy(this: any) { for (const name of DRAWN) this.canvas[name] = this.original[name]; };

  // Graph's mxShape.createHandJiggle: a sketched shape draws through Rough.js. draw.io's comic jiggle (`comic=1`,
  // `sketchStyle=comic`) needs its editor's settings, so those shapes draw clean (named in drawioStyleLosses).
  mxShape.prototype.createHandJiggle = function createHandJiggle(this: any, canvas: any) {
    if (this.outline || this.style == null || value(this.style, 'sketch', '0') === '0') return null;
    if (value(this.style, 'sketchStyle', 'rough') === 'comic') return null;
    return new (RoughCanvas as any)(canvas, roughOn(canvas), this);
  };
}
