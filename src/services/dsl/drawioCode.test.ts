import { describe, expect, it } from 'vitest';
import { pageCells } from './drawioCells';
import { drawnContent, hasEnds, installDrawioCode, usesDrawioCode } from './drawioCode';
import { drawioSketchSeed } from './drawioSketch';
import { resolveDrawioStyle } from './drawioStyle';
import { parseXml } from './xmlReader';

const edge = (style: string) => resolveDrawioStyle(`;${style}`, 'edge');
const cells = (inner: string) => {
  const parsed = parseXml(`<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${inner}</root></mxGraphModel>`);
  if ('error' in parsed) throw new Error(parsed.error);
  return pageCells(parsed.root);
};

describe('hasEnds', () => {
  it('sees draw.io’s default arrow, and either end set to a head', () => {
    expect(hasEnds(edge(''))).toBe(true);
    expect(hasEnds(edge('endArrow=none;'))).toBe(false);
    expect(hasEnds(edge('endArrow=none;startArrow=halfCircle;'))).toBe(true);
  });
});

describe('usesDrawioCode', () => {
  it('loads draw.io’s code for a line with a head and for a lane, not for plain boxes and bare lines', () => {
    expect(usesDrawioCode(cells('<mxCell id="a" style="rounded=1;" vertex="1" parent="1"/>'))).toBe(false);
    expect(usesDrawioCode(cells('<mxCell id="e" style="endArrow=none;" edge="1" parent="1"/>'))).toBe(false);
    expect(usesDrawioCode(cells('<mxCell id="e" style="endArrow=dash;" edge="1" parent="1"/>'))).toBe(true);
    expect(usesDrawioCode(cells('<mxCell id="l" style="swimlane;startSize=30;" vertex="1" parent="1"/>'))).toBe(true);
  });
});

describe('sketched cells', () => {
  it('load draw.io’s code, a sketched line included', () => {
    expect(usesDrawioCode(cells('<mxCell id="e" style="endArrow=none;sketch=1;" edge="1" parent="1"/>'))).toBe(true);
    expect(usesDrawioCode(cells('<mxCell id="a" style="rounded=1;sketch=1;" vertex="1" parent="1"/>'))).toBe(true);
  });

  it('carry a seed from their id, so each draws by hand the same way each time', () => {
    const [cell] = cells('<mxCell id="a" style="sketch=1;" vertex="1" parent="1"/><mxCell id="b" style="" vertex="1" parent="1"/>').filter((c) => c.id === 'a');
    expect(cell!.style.sketchSeed).toBe(String(drawioSketchSeed('a')));
    expect(cells('<mxCell id="b" style="" vertex="1" parent="1"/>').find((c) => c.id === 'b')!.style.sketchSeed).toBeUndefined();
  });

  it('draw a box written without a shape by draw.io’s rectangle code, by hand; a plain one stays ours', async () => {
    const code = await installDrawioCode();
    const style = resolveDrawioStyle('rounded=1;sketch=1;sketchSeed=7;fillColor=#dae8fc;', 'vertex');
    const drawn = drawnContent(code, '', style, { width: 120, height: 60 });
    expect((drawn?.drawio as { shape?: string }).shape).toBe('rectangle');
    expect((drawn?.drawioParts as unknown[]).length).toBeGreaterThan(1);
    expect(drawnContent(code, '', resolveDrawioStyle('rounded=1;', 'vertex'), { width: 120, height: 60 })).toBeNull();
  });
});

describe('comic cells', () => {
  it('load draw.io’s code, carry a seed, and draw a box by draw.io’s comic jiggle', async () => {
    expect(usesDrawioCode(cells('<mxCell id="e" style="endArrow=none;comic=1;" edge="1" parent="1"/>'))).toBe(true);
    expect(cells('<mxCell id="a" style="comic=1;" vertex="1" parent="1"/>').find((c) => c.id === 'a')!.style.sketchSeed).toBe(String(drawioSketchSeed('a')));
    const code = await installDrawioCode();
    const drawn = drawnContent(code, '', resolveDrawioStyle('comic=1;sketchSeed=7;', 'vertex'), { width: 120, height: 60 });
    expect((drawn?.drawio as { shape?: string }).shape).toBe('rectangle');
  });
});
