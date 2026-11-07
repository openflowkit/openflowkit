// Every target (the browsers the app supports, Node 20 for the MCP server) has Intl.Segmenter.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** `text` cut to at most `max` UTF-16 units (what `length` counts) at a character boundary, so no emoji is split. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = 0;
  for (const { index, segment } of graphemes.segment(text)) {
    if (index + segment.length > max) break;
    end = index + segment.length;
  }
  return text.slice(0, end);
}
