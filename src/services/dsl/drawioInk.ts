import type { SceneNode } from '../../opencanvas/domain/document/types';
import { DEFAULT_CANVAS_COLOR, contrastRatio, darkInkReadsOn, paintOver, readableTextOn } from '../../opencanvas/domain/color/adaptiveColor';
import { resolveNodeStyle } from '../../opencanvas/domain/nodes/nodeStyle';
import { drawioDarkInk } from './drawioStyle';

/** Our dark canvas: what shows through a see-through fill or a dark wash. */
const DARK_CANVAS = '#191b19';
const LIGHT_CANVAS = DEFAULT_CANVAS_COLOR;

interface Paint { readonly dark: string; readonly light: string }
const CANVASES: Paint = { dark: DARK_CANVAS, light: LIGHT_CANVAS };
const CELL = 256;

/** How many shapes deep the paint under a label is looked for: past this, the rest is taken as the canvas. */
const DEPTH = 32;

/**
 * The nodes drawn before node `index` whose boxes hold its centre, topmost first. Boxes are bucketed on a coarse
 * grid so a 50,000-cell file stays near one pass; a box too big to bucket is checked on every lookup.
 * ponytail: turned boxes count as upright.
 */
function covering(nodes: readonly SceneNode[]): (index: number) => Generator<number> {
  const at: { x: number; y: number }[] = [];
  const byId = new Map<string, number>();
  const grid = new Map<string, number[]>();
  const big: number[] = [];
  for (const [index, node] of nodes.entries()) {
    const parent = node.parentId ? at[byId.get(node.parentId) ?? -1] : undefined;
    const corner = { x: (parent?.x ?? 0) + node.transform.translation.x, y: (parent?.y ?? 0) + node.transform.translation.y };
    at.push(corner);
    byId.set(node.id, index);
    if (node.kind === 'text') continue;
    const [left, top] = [Math.floor(corner.x / CELL), Math.floor(corner.y / CELL)];
    const [right, bottom] = [Math.floor((corner.x + node.size.width) / CELL), Math.floor((corner.y + node.size.height) / CELL)];
    if ((right - left + 1) * (bottom - top + 1) > 64) { big.push(index); continue; }
    for (let gx = left; gx <= right; gx += 1) {
      for (let gy = top; gy <= bottom; gy += 1) {
        const key = `${gx},${gy}`;
        const list = grid.get(key);
        if (list) list.push(index); else grid.set(key, [index]);
      }
    }
  }
  const holds = (other: number, x: number, y: number) => {
    const { width, height } = nodes[other]!.size;
    return x >= at[other]!.x && x <= at[other]!.x + width && y >= at[other]!.y && y <= at[other]!.y + height;
  };
  return function* (index) {
    const { width, height } = nodes[index]!.size;
    const [cx, cy] = [at[index]!.x + width / 2, at[index]!.y + height / 2];
    const bucket = grid.get(`${Math.floor(cx / CELL)},${Math.floor(cy / CELL)}`) ?? [];
    // Both lists rise in drawing order: walk them down together, from just under this node.
    let [b, g] = [bucket.length - 1, big.length - 1];
    while (b >= 0 && bucket[b]! >= index) b -= 1;
    while (g >= 0 && big[g]! >= index) g -= 1;
    while (b >= 0 || g >= 0) {
      const next = g < 0 || (b >= 0 && bucket[b]! > big[g]!) ? bucket[b--]! : big[g--]!;
      if (holds(next, cx, cy)) yield next;
    }
  };
}

const inked = (node: SceneNode, ink: string): SceneNode => node.kind === 'text'
  ? { ...node, content: { ...node.content, customColor: ink } }
  : { ...node, appearance: { ...node.appearance, textColor: ink } };

/**
 * draw.io's ink is picked for a white page. It stays where the theme doesn't change what is under the words
 * (a deep fill stays solid in both), or where it also reads on what our dark theme shows there (teal, a pastel lane
 * seen through a washed white card); anywhere else it is left to the theme, so it turns white on dark. Near-black
 * looks the same either way; a colour (AWS navy, red on a see-through fill) is counted in the report, since light
 * loses it too. What shows is every shape drawn under the words, bottom up, then the node's own fill.
 */
export function inkForEitherTheme(nodes: SceneNode[], loss: (message: string) => void): void {
  const under = covering(nodes);
  type Fill = { readonly fill: string; readonly opacity: number };
  // A node's fill follows from its kind, shape, colour word and own fill alone, and a big file repeats a few of
  // those: each distinct one is resolved once.
  const fills = new Map<string, { readonly dark: Fill; readonly light: Fill }>();
  const fillAt = new Map<number, { readonly dark: Fill; readonly light: Fill }>();
  const fillOf = (at: number) => {
    let known = fillAt.get(at);
    if (!known) fillAt.set(at, known = fillFor(at));
    return known;
  };
  const fillFor = (at: number) => {
    const { kind, content, appearance } = nodes[at]!;
    const key = `${kind}|${String(content.shape)}|${String(content.color)}|${String(appearance.fill)}|${String(appearance.opacity)}`;
    let fill = fills.get(key);
    if (!fill) fills.set(key, fill = { dark: resolveNodeStyle(nodes[at]!, DARK_CANVAS), light: resolveNodeStyle(nodes[at]!, LIGHT_CANVAS) });
    return fill;
  };
  const mixes = new Map<string, string>();
  const over = ({ fill, opacity }: Fill, below: string) => {
    const key = `${fill}|${below}|${opacity}`;
    let mixed = mixes.get(key);
    if (mixed === undefined) mixes.set(key, mixed = paintOver(fill, below, opacity));
    return mixed;
  };
  const solid = ({ fill, opacity }: Fill) => opacity >= 1 && /^#[0-9a-f]{6}$/i.test(fill);
  /**
   * What shows at node `index`'s centre once it is painted: the shapes under it from the first solid one up, then
   * its own fill. `covered` is false over the bare canvas.
   */
  const paintOf = (index: number): Paint & { readonly covered: boolean } => {
    const stack: number[] = [];
    for (const at of under(index)) {
      stack.push(at);
      if (stack.length >= DEPTH || (solid(fillOf(at).dark) && solid(fillOf(at).light))) break;
    }
    let paint = CANVASES;
    for (const at of [...stack.reverse(), index]) {
      if (nodes[at]!.kind === 'text') continue;
      const { dark, light } = fillOf(at);
      paint = { dark: over(dark, paint.dark), light: over(light, paint.light) };
    }
    return { ...paint, covered: stack.length > 0 };
  };
  let recoloured = 0;
  for (const [index, node] of nodes.entries()) {
    const ink = node.kind === 'text' ? node.content.customColor : node.appearance.textColor;
    const hex = typeof ink === 'string' && ink.startsWith('#') ? ink : undefined;
    const label = typeof node.content.label === 'string' && node.content.label.trim() !== '';
    // Words with no ink of their own are the theme's to colour, which picks it against the node's own fill; only
    // words with nothing solid of their own under them (free text, a see-through box) can be lost on what is below.
    const seeThrough = node.kind === 'text' || node.appearance.fill === 'transparent' || typeof node.appearance.opacity === 'number';
    if (!hex && (!label || !seeThrough)) continue;
    const backdrop = paintOf(index);
    if (!hex) {
      if (!backdrop.covered) continue;
      // No ink of its own: the theme picks one against the dark canvas, not the light shape under it. Where
      // dark ink reads on what shows in both themes, it is set.
      if (!darkInkReadsOn(backdrop.dark) || !darkInkReadsOn(backdrop.light)) continue;
      if (contrastRatio(resolveNodeStyle(node, DARK_CANVAS).textColor, backdrop.dark) < 4.5) nodes[index] = inked(node, readableTextOn(backdrop.dark));
      continue;
    }
    if (backdrop.dark === backdrop.light) continue;
    if (drawioDarkInk(hex)) {
      if (darkInkReadsOn(backdrop.dark)) continue;
    } else {
      if (contrastRatio(hex, backdrop.dark) >= Math.min(4.5, contrastRatio(hex, backdrop.light))) continue;
      recoloured += 1;
      // A see-through light fill turns mid-grey on the dark canvas, where the theme's white is lost too: dark ink
      // reads there and on the light page, so it is fixed for both.
      if (darkInkReadsOn(backdrop.dark) && darkInkReadsOn(backdrop.light)) {
        nodes[index] = inked(node, readableTextOn(backdrop.dark));
        continue;
      }
    }
    if (node.kind === 'text') {
      const { customColor: _ink, ...content } = node.content;
      nodes[index] = { ...node, content };
    } else {
      const { textColor: _ink, ...appearance } = node.appearance;
      nodes[index] = { ...node, appearance };
    }
  }
  if (recoloured) {
    loss(recoloured === 1 ? '1 label colour is changed so it reads on a dark canvas' : `${recoloured} label colours are changed so they read on a dark canvas`);
  }
}
