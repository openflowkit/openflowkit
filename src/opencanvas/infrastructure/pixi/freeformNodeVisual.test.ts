import { describe, expect, it } from 'vitest';
import { createPixiSpikePage } from './spikeFixture';
import { projectFreeformNodeVisual } from './freeformNodeVisual';

describe('Pixi freeform node visual adapter', () => {
  it('projects text, image, and annotation through distinct visual contracts', () => {
    const visuals = createPixiSpikePage(8).nodes.slice(5, 8).map(projectFreeformNodeVisual);
    expect(visuals.map((visual) => visual?.kind)).toEqual(['text', 'image', 'annotation']);
    expect(visuals[0]).toMatchObject({ kind: 'text', hasBackground: true });
    expect(visuals[1]).toMatchObject({
      kind: 'image',
      presentation: { sourceUrl: expect.stringMatching(/^data:image\//) },
    });
    expect(visuals[2]).toMatchObject({ kind: 'annotation', presentation: { colorKey: 'yellow' } });
  });

  it('draws renderer-exact Mermaid nodes as an image of their sanitized SVG', () => {
    const base = createPixiSpikePage(8).nodes[6];
    const visual = projectFreeformNodeVisual({
      ...base,
      kind: 'mermaid_svg',
      content: { label: 'Flow', mermaidSvg: '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script><rect/></svg>' },
    });
    expect(visual?.kind).toBe('image');
    const url = (visual as { presentation: { sourceUrl: string } }).presentation.sourceUrl;
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(url)).not.toContain('<script');
    expect(projectFreeformNodeVisual({ ...base, kind: 'mermaid_svg', content: {} }))
      .toMatchObject({ kind: 'image', presentation: { sourceUrl: null } });
  });

  it('draws a pen stroke with no colour of its own in ink that shows on the dark canvas, and a picked colour as picked', () => {
    const base = createPixiSpikePage(8).nodes[6];
    const pen = (content: Record<string, unknown>) => ({ ...base, kind: 'pen', content: { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], ...content } });
    expect(projectFreeformNodeVisual(pen({}), '#191b19')?.stroke).toBe(0xe2e8f0);
    expect(projectFreeformNodeVisual(pen({}), '#f7f7f5')?.stroke).toBe(0x334155);
    expect(projectFreeformNodeVisual(pen({ strokeColor: '#334155' }), '#191b19')?.stroke).toBe(0x334155);
  });
});
