import type { SceneConnector, SceneNode } from '../../opencanvas/domain/document/types';

// draw.io's dark mode flips every colour a cell sets (`darkColors: 'invert'`, set by drawioNodeAppearance) unless the
// page says otherwise: its `adaptiveColors` (Graph.getAdaptiveColors). `auto`, draw.io's default, flips them;
// `simple` keeps the colours a cell sets (mxUtils.parseLightDarkColor's useLightColor); `none` keeps the whole page
// light. The page decides, never a guess from its colours.

/** Whether a page's `adaptiveColors` keeps the colours its cells set on a dark canvas. */
export const keepsSetColors = (adaptiveColors: string | undefined): boolean => adaptiveColors === 'simple' || adaptiveColors === 'none';

/** Leaves a page's colours as drawn on a dark canvas when its `adaptiveColors` says to; else draw.io flips them. */
export function applyAdaptiveColors(nodes: SceneNode[], connectors: SceneConnector[], adaptiveColors: string | undefined): void {
  if (!keepsSetColors(adaptiveColors)) return;
  const unflip = <T extends SceneNode | SceneConnector>(items: T[]) => {
    for (const [index, item] of items.entries()) {
      if (item.appearance.darkColors === undefined) continue;
      const { darkColors: _flip, ...appearance } = item.appearance;
      items[index] = { ...item, appearance };
    }
  };
  unflip(nodes);
  unflip(connectors);
}
