import type { DrawioBox } from './drawioLabelBox';
import type { DrawioStyle } from './drawioStyle';

// The part of its box a draw.io shape gives its words when they sit on it: a lane's title band, a lifeline's head,
// the body of a callout above its tail. A port of each shape's getLabelBounds / getLabelMargins.

const number = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** A swimlane's words sit in its title band (`startSize`, 40 unless set), which runs along its top, or its side when turned. */
function titleBand(box: DrawioBox, style: DrawioStyle, horizontal: boolean): DrawioBox {
  const flipH = style.flipH === '1';
  const flipV = style.flipV === '1';
  const direction = style.direction ?? 'east';
  const upright = direction === 'north' || direction === 'south';
  const reversed = direction === 'south' || direction === 'west';
  const across = horizontal === !upright;
  const fromEnd = (!across && flipH !== reversed) || (across && flipV !== reversed);
  const size = Math.max(0, number(style.startSize, 40));
  if (upright) {
    const width = Math.min(box.width, size);
    return { x: fromEnd ? box.x + box.width - width : box.x, y: box.y, width, height: box.height };
  }
  const height = Math.min(box.height, size);
  return { x: box.x, y: fromEnd ? box.y + box.height - height : box.y, width: box.width, height };
}

interface Margins { left: number; top: number; right: number; bottom: number }

/** The room a shape keeps clear of its words on each side, for a box `width` by `height`; null for none. */
function margins(shape: string, style: DrawioStyle, width: number, height: number): Margins | null {
  const bounded = style.boundedLbl === '1';
  const stroke = number(style.strokeWidth, 1);
  switch (shape) {
    case 'datastore': return { left: 0, top: 2.5 * Math.min(height / 2, Math.round(height / 8) + stroke - 1), right: 0, bottom: 0 };
    case 'document': return bounded ? { left: 0, top: 0, right: 0, bottom: number(style.size, 0.3) * height } : null;
    case 'callout': return { left: 0, top: 0, right: 0, bottom: number(style.size, 30) };
    case 'umlFrame': return { left: 0, top: 0, right: width - number(style.width, 60), bottom: height - number(style.height, 30) };
    case 'folder': return bounded && style.labelInHeader !== '1' ? { left: 0, top: Math.min(height, number(style.tabHeight, 15)), right: 0, bottom: 0 } : null;
    case 'cylinder3': {
      if (!bounded) return null;
      const lid = number(style.size, 15) / (style.lid === '0' ? 2 : 1);
      return { left: 0, top: Math.min(height, 2 * lid), right: 0, bottom: Math.max(0, 0.3 * lid) };
    }
    case 'mxgraph.c4.person': return { left: 0, top: 0.8 * Math.min(width / 2, height / 3), right: 0, bottom: 0 };
    case 'mxgraph.c4.person2': return { left: 0, top: 0.8 * Math.min(0.45 * width, 0.45 * height), right: 0, bottom: 0 };
    default: return null;
  }
}

/** mxShape.getLabelBounds with mxUtils.getDirectedBounds: the margins, turned with the shape's `direction` and flips. */
function inset(box: DrawioBox, style: DrawioStyle, shape: string, horizontal: boolean): DrawioBox {
  const direction = style.direction ?? 'east';
  const upright = direction === 'south' || direction === 'north';
  const swap = !upright && !horizontal;
  let m = margins(shape, style, swap ? box.height : box.width, swap ? box.width : box.height);
  if (!m) return box;
  let [flipH, flipV] = [style.flipH === '1', style.flipV === '1'];
  if (!horizontal) { m = { left: m.bottom, top: m.left, right: m.top, bottom: m.right }; [flipH, flipV] = [flipV, flipH]; }
  m = { left: Math.round(clamp(m.left, 0, box.width)), top: Math.round(clamp(m.top, 0, box.height)), right: Math.round(clamp(m.right, 0, box.width)), bottom: Math.round(clamp(m.bottom, 0, box.height)) };
  if ((flipV && upright) || (flipH && !upright)) m = { ...m, left: m.right, right: m.left };
  if ((flipH && upright) || (flipV && !upright)) m = { ...m, top: m.bottom, bottom: m.top };
  const turned = direction === 'south' ? { top: m.left, left: m.bottom, right: m.top, bottom: m.right }
    : direction === 'west' ? { top: m.bottom, left: m.right, right: m.left, bottom: m.top }
      : direction === 'north' ? { top: m.right, left: m.top, right: m.bottom, bottom: m.left } : m;
  return { x: box.x + turned.left, y: box.y + turned.top, width: box.width - turned.right - turned.left, height: box.height - turned.bottom - turned.top };
}

/**
 * Where on its box a shape lets its words sit, when they sit on it. `horizontal` is false for words running up it.
 * ponytail: note2, cube, tape, the arrows2 set and draw.io's rect callouts keep their whole box — port each
 * shape's rule when the checker shows its files.
 */
export function shapeLabelBounds(box: DrawioBox, style: DrawioStyle, shape: string, horizontal: boolean): DrawioBox {
  // A size bigger than the shape (`size=1` on a process) leaves draw.io a box turned inside out; ours ends at nothing.
  const { x, y, width, height } = shapeRule(box, style, shape, horizontal);
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

function shapeRule(box: DrawioBox, style: DrawioStyle, shape: string, horizontal: boolean): DrawioBox {
  const direction = style.direction ?? 'east';
  const stroke = number(style.strokeWidth, 1);
  const shrunk = (by: number): DrawioBox => ({ x: box.x + by, y: box.y + by, width: box.width - 2 * by, height: box.height - 2 * by });
  switch (shape) {
    case 'swimlane': return titleBand(box, style, horizontal);
    case 'table':
    case 'tableRow': return number(style.startSize, 40) === 0 ? box : titleBand(box, style, horizontal);
    case 'umlLifeline': return { ...box, height: clamp(number(style.size, 40), 0, box.height) };
    case 'umlControl': return { ...box, y: box.y + box.height / 8, height: (7 * box.height) / 8 };
    case 'process': {
      if (horizontal !== (direction === 'east' || direction === 'west')) return box;
      let side = box.width * clamp(number(style.size, 0.1), 0, 1);
      if (style.rounded === '1') { const arc = number(style.arcSize, 15) / 100; side = Math.max(side, Math.min(box.width * arc, box.height * arc)); }
      return { ...box, x: box.x + Math.round(side), width: box.width - Math.round(2 * side) };
    }
    case 'doubleEllipse': return shrunk(number(style.margin, Math.min(3 + stroke, Math.min(box.width / 5, box.height / 5))));
    case 'rhombus': return style.double === '1' ? shrunk(2 * Math.max(2, stroke + 1) + number(style.margin, 0)) : box;
    case 'ext': return style.double === '1' ? shrunk(Math.max(2, stroke + 1) + number(style.margin, 0)) : box;
    default: return inset(box, style, shape, horizontal);
  }
}
