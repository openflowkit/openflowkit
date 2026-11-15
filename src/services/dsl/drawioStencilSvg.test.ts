import { describe, expect, it } from 'vitest';
import { parseXml, type XmlElement } from './xmlReader';
import { stencilColor, stencilSvg } from './drawioStencilSvg';

const shape = (xml: string): XmlElement => {
  const parsed = parseXml(xml);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.root;
};

const square = shape(`<shape w="10" h="20" aspect="variable" strokewidth="inherit"><background><rect x="0" y="0" w="10" h="20"/></background>
  <foreground><fillstroke/><path><move x="0" y="10"/><line x="10" y="10"/></path><stroke/></foreground></shape>`);

describe('stencilSvg', () => {
  it('stretches the stencil grid over the cell and paints it in the cell’s colours', () => {
    const { svg } = stencilSvg(square, { fillColor: '#dae8fc', strokeColor: '#6c8ebf', strokeWidth: '2' }, 100, 40);
    expect(svg).toContain('<rect x="0" y="0" width="100" height="40" fill="#dae8fc" stroke="#6c8ebf" stroke-width="2"/>');
    expect(svg).toContain('<path d="M0 20L100 20" fill="none" stroke="#6c8ebf" stroke-width="2"/>');
  });

  it('keeps a fixed-aspect stencil in proportion, centred in its box', () => {
    const fixed = shape('<shape w="10" h="10" aspect="fixed"><foreground><rect x="0" y="0" w="10" h="10"/><fill/></foreground></shape>');
    expect(stencilSvg(fixed, {}, 100, 40).svg).toContain('<rect x="30" y="0" width="40" height="40" fill="#ffffff" stroke="none"/>');
  });

  it('scales a declared stroke width by the smaller scale, and `fixed` keeps it as written', () => {
    const lines = shape(`<shape w="10" h="10" strokewidth="1"><foreground><path><move x="0" y="0"/><line x="10" y="0"/></path><stroke/>
      <strokewidth width="3" fixed="1"/><path><move x="0" y="5"/><line x="10" y="5"/></path><stroke/></foreground></shape>`);
    const { svg, margin } = stencilSvg(lines, {}, 40, 20);
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('stroke-width="3"');
    expect(margin).toBe(2);
  });

  it('reads `fill` and `stroke` as the cell’s own colours, and `none` as no paint', () => {
    const swapped = shape('<shape w="10" h="10"><foreground><fillcolor color="stroke"/><strokecolor color="none"/><ellipse x="0" y="0" w="10" h="10"/><fillstroke/></foreground></shape>');
    expect(stencilSvg(swapped, { strokeColor: '#ff0000' }, 10, 10).svg).toContain('<ellipse cx="5" cy="5" rx="5" ry="5" fill="#ff0000" stroke="none"/>');
  });

  it('save and restore bring back the paint they saved', () => {
    const scoped = shape(`<shape w="10" h="10"><foreground><save/><fillcolor color="#00ff00"/><rect x="0" y="0" w="5" h="5"/><fill/><restore/>
      <rect x="5" y="5" w="5" h="5"/><fill/></foreground></shape>`);
    const { svg } = stencilSvg(scoped, { fillColor: '#123456' }, 10, 10);
    expect(svg).toContain('fill="#00ff00"');
    expect(svg).toContain('<rect x="5" y="5" width="5" height="5" fill="#123456"');
  });

  it('fades by opacity and alpha, dashes by the line width, and draws curves and arcs as SVG does', () => {
    const drawn = shape(`<shape w="10" h="10"><foreground><alpha alpha="0.5"/><dashed dashed="1"/><path><move x="0" y="0"/>
      <curve x1="1" y1="2" x2="3" y2="4" x3="5" y3="6"/><arc rx="2" ry="2" x-axis-rotation="0" large-arc-flag="1" sweep-flag="0" x="10" y="10"/><close/></path>
      <fillstroke/></foreground></shape>`);
    const { svg } = stencilSvg(drawn, { opacity: '80', strokeWidth: '2' }, 10, 10);
    expect(svg).toContain('d="M0 0C1 2 3 4 5 6A2 2 0 1 0 10 10Z"');
    expect(svg).toContain('fill-opacity="0.5"');
    expect(svg).toContain('stroke-dasharray="3 3"');
  });

  it('rounds a rounded path’s corners by its arc size', () => {
    const rounded = shape('<shape w="10" h="10"><foreground><path rounded="1" arcSize="2"><move x="0" y="0"/><line x="10" y="0"/><line x="10" y="10"/></path><stroke/></foreground></shape>');
    expect(stencilSvg(rounded, {}, 10, 10).svg).toContain('d="M0 0L8 0Q10 0 10 2L10 10"');
  });

  it('turns by direction and mirrors by flip, around the box’s centre', () => {
    const { svg } = stencilSvg(square, { direction: 'south', flipH: '1' }, 20, 10);
    expect(svg).toContain('scale(-1 1)');
    expect(svg).toContain('rotate(90 10 5)');
  });

  it('draws a stencil another one includes', () => {
    const inner = shape('<shape w="10" h="10"><foreground><rect x="0" y="0" w="10" h="10"/><fill/></foreground></shape>');
    const outer = shape('<shape w="10" h="10"><foreground><include-shape name="mxgraph.test.inner" x="5" y="5" w="5" h="5"/></foreground></shape>');
    expect(stencilSvg(outer, {}, 10, 10, (name) => (name === 'mxgraph.test.inner' ? inner : null)).svg).toContain('<rect x="5" y="5" width="5" height="5"');
  });

  it('draws an AWS resource icon as a filled box with its icon in the line colour, 10% in', () => {
    const icon = shape('<shape w="10" h="10"><foreground><rect x="0" y="0" w="10" h="10"/><fill/></foreground></shape>');
    const { svg } = stencilSvg(icon, { fillColor: '#ED7100', strokeColor: '#ffffff' }, 50, 50, () => null, { stencil: icon, kind: 'resource' });
    expect(svg).toContain('<rect x="0" y="0" width="50" height="50" fill="#ED7100" stroke="none"/>');
    expect(svg).toContain('<rect x="5" y="5" width="40" height="40" fill="#ffffff" stroke="none"/>');
  });
});

describe('stencilColor', () => {
  it('reads draw.io’s default, none and light-dark colours', () => {
    expect(stencilColor('default', '#000000')).toBe('#000000');
    expect(stencilColor('none', '#000000')).toBeNull();
    expect(stencilColor('light-dark(#111111,#eeeeee)', null)).toBe('#111111');
    expect(stencilColor(undefined, '#ffffff')).toBe('#ffffff');
  });
});
