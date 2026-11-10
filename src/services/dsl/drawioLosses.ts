// How the importer words shapes it drew as boxes: grouped, so a file of 18 AWS icons says one line, not 18,
// and never with a packed stencil's base64 in it.

const humane = (icon: string) => icon.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/** One line per draw.io icon set (two or more kinds), per custom stencil count, and per other shape name. */
export function standInLosses(shapes: ReadonlyMap<string, number>): string[] {
  const stencils = [...shapes].filter(([name]) => name.startsWith('stencil(')).reduce((sum, [, count]) => sum + count, 0);
  const sets = new Map<string, Map<string, number>>();
  for (const [name, count] of shapes) {
    const set = /^mxgraph\.([^.]+)\.(.+)$/.exec(name);
    if (!set) continue;
    const icons = sets.get(set[1]!) ?? new Map<string, number>();
    icons.set(set[2]!, count);
    sets.set(set[1]!, icons);
  }
  const lines: string[] = [];
  const said = new Set<string>();
  for (const [name, count] of shapes) {
    if (name.startsWith('stencil(')) {
      if (!said.has('stencil')) lines.push(stencils === 1 ? '1 custom draw.io stencil is drawn as a box' : `${stencils} custom draw.io stencils are drawn as boxes`);
      said.add('stencil');
      continue;
    }
    const set = /^mxgraph\.([^.]+)\./.exec(name)?.[1];
    const icons = set ? sets.get(set) : undefined;
    if (set && icons && icons.size > 1) {
      if (said.has(set)) continue;
      said.add(set);
      const total = [...icons.values()].reduce((sum, each) => sum + each, 0);
      const names = [...icons.keys()].map(humane);
      const shown = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
      lines.push(`${total} icons from draw.io’s “${set}” set are drawn as boxes (${shown})`);
      continue;
    }
    lines.push(`draw.io’s “${name}” shape is drawn as a box${count > 1 ? ` (${count} shapes)` : ''}`);
  }
  return lines;
}

/** draw.io's rich text: words made bold, coloured or resized inside an `html=1` label. Line breaks aren't formatting. */
export const richText = (value: string): boolean => /<(b|strong|i|em|u|s|strike|font|span|sup|sub)\b/i.test(value);
