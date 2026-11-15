import type { Bounds2d } from '../../domain/geometry/types';
import type { ConnectorPathCommand } from '../../domain/connectors/types';
import type { DrawGradient, DrawOp, DrawPaint } from '../../domain/animation/drawList';
import { gradientAxis } from '../../domain/nodes/nodeStyle';

// Executes a draw list. Every decision — what to draw, in what order, where —
// is already in the ops; this file only maps world coordinates to device
// pixels and calls the canvas. Used by the worker's OffscreenCanvas and by the
// MediaRecorder fallback's real canvas, so both encode the same picture.

type FrameCanvas2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function trace(context: FrameCanvas2d, commands: readonly ConnectorPathCommand[]): void {
  for (const command of commands) {
    if (command.kind === 'cubic') {
      context.bezierCurveTo(
        command.control1.x, command.control1.y,
        command.control2.x, command.control2.y,
        command.point.x, command.point.y,
      );
    } else if (command.kind === 'move') {
      context.moveTo(command.point.x, command.point.y);
    } else {
      context.lineTo(command.point.x, command.point.y);
    }
  }
}

function gradientStyle(context: FrameCanvas2d, from: string, gradient: DrawGradient): CanvasGradient {
  const { width, height } = gradient;
  const axis = gradientAxis(gradient.direction);
  const style = axis
    ? context.createLinearGradient(axis.from.x * width, axis.from.y * height, axis.to.x * width, axis.to.y * height)
    : context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 2);
  style.addColorStop(0, from);
  style.addColorStop(1, gradient.color);
  return style;
}

function fillWith(context: FrameCanvas2d, fill: DrawPaint | null, opacity: number, gradient?: DrawGradient): void {
  if (!fill) return;
  context.fillStyle = gradient ? gradientStyle(context, fill.color, gradient) : fill.color;
  context.globalAlpha = opacity * fill.alpha;
  context.fill();
}

function strokeWith(
  context: FrameCanvas2d, stroke: DrawPaint | null, width: number, opacity: number,
): void {
  if (!stroke) return;
  context.strokeStyle = stroke.color;
  context.lineWidth = width;
  context.globalAlpha = opacity * stroke.alpha;
  context.stroke();
}

function traceClip(context: FrameCanvas2d, points: readonly { readonly x: number; readonly y: number }[]): void {
  context.beginPath();
  points.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
  context.closePath();
  context.clip();
}

function paintPath(context: FrameCanvas2d, op: Extract<DrawOp, { kind: 'path' }>): void {
  context.beginPath();
  trace(context, op.commands);
  if (op.closed) context.closePath();
  context.setLineDash([...op.dash]);
  context.lineDashOffset = op.dashOffset;
  context.lineJoin = op.lineJoin;
  if (op.shadow) {
    // One shadow for the whole element, like the SVG filter: lay the shape
    // down shadowed first, then paint it clean over itself.
    context.shadowColor = `${op.shadow.color.slice(0, 7)}${Math.round(op.shadow.alpha * op.opacity * 255).toString(16).padStart(2, '0')}`;
    context.shadowBlur = op.shadow.blur;
    context.shadowOffsetX = op.shadow.offsetX;
    context.shadowOffsetY = op.shadow.offsetY;
    if (op.fill) fillWith(context, op.fill, op.opacity, op.gradient);
    else strokeWith(context, op.stroke, op.strokeWidth, op.opacity);
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
  }
  fillWith(context, op.fill, op.opacity, op.gradient);
  strokeWith(context, op.stroke, op.strokeWidth, op.opacity);
}

function paintText(context: FrameCanvas2d, op: Extract<DrawOp, { kind: 'text' }>): void {
  context.font = `${op.fontStyle === 'italic' ? 'italic ' : ''}${op.fontWeight} ${op.fontSize}px ${op.fontFamily}`;
  context.letterSpacing = `${op.letterSpacing}px`;
  context.textAlign = op.align;
  context.textBaseline = op.baseline;
  context.fillStyle = op.color;
  context.globalAlpha = op.opacity;
  context.fillText(op.text, op.x, op.y);
  if (!op.decoration) return;
  const width = context.measureText(op.text).width;
  const left = op.align === 'start' ? op.x : op.align === 'end' ? op.x - width : op.x - width / 2;
  context.fillRect(left, op.decoration.y - op.decoration.thickness / 2, width, op.decoration.thickness);
}

export function paintFrame(
  context: FrameCanvas2d, ops: readonly DrawOp[], viewBox: Bounds2d, scale: number,
): void {
  const { width, height } = context.canvas;
  const offsetX = (width - viewBox.width * scale) / 2;
  const offsetY = (height - viewBox.height * scale) / 2;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.lineCap = 'butt';
  // SVG's own defaults, so a miter is clipped the way the file clips it.
  context.lineJoin = 'miter';
  context.miterLimit = 4;
  for (const op of ops) {
    if (op.kind === 'fallback') continue;
    const { transform } = op;
    context.save();
    context.setTransform(
      transform.a * scale, transform.b * scale, transform.c * scale, transform.d * scale,
      (transform.tx - viewBox.x) * scale + offsetX,
      (transform.ty - viewBox.y) * scale + offsetY,
    );
    if (op.clip) traceClip(context, op.clip);
    if (op.kind === 'rect') {
      context.beginPath();
      if (op.radius > 0) context.roundRect(op.x, op.y, op.width, op.height, op.radius);
      else context.rect(op.x, op.y, op.width, op.height);
      fillWith(context, op.fill, op.opacity);
      strokeWith(context, op.stroke, op.strokeWidth, op.opacity);
    } else if (op.kind === 'path') {
      paintPath(context, op);
    } else {
      paintText(context, op);
    }
    context.restore();
  }
}
