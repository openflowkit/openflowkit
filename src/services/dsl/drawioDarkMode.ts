import type { SceneNode } from '../../opencanvas/domain/document/types';
import { darkInkReadsOn } from '../../opencanvas/domain/color/adaptiveColor';

// draw.io's dark mode flips every colour a cell sets (`darkColors: 'invert'`, set by drawioNodeAppearance). A page
// drawn dark already suits a dark canvas, and flipping it would turn its slabs light under light words: it is kept
// as drawn.

/** Whether more of the page's solid fill area is dark than light. A page with no solid fills is drawn light. */
export function drawnDark(nodes: readonly SceneNode[]): boolean {
  let balance = 0;
  for (const { appearance, size } of nodes) {
    const fill = appearance.fill;
    if (typeof fill !== 'string' || !/^#[0-9a-f]{6}$/i.test(fill)) continue;
    balance += (darkInkReadsOn(fill) ? -1 : 1) * size.width * size.height;
  }
  return balance > 0;
}

/** Keeps a page drawn dark as it is in the dark theme: its nodes lose `darkColors`. */
export function keepDarkDrawnPage(nodes: SceneNode[]): void {
  if (!drawnDark(nodes)) return;
  for (const [index, node] of nodes.entries()) {
    if (node.appearance.darkColors === undefined) continue;
    const { darkColors: _flip, ...appearance } = node.appearance;
    nodes[index] = { ...node, appearance };
  }
}
