import { describe, expect, it } from 'vitest';
import { compile } from '../../../dsl/compile';
import { createEmptyV2Page } from '../../presentation/v2/v2Document';
import type { ScenePage } from '../../domain/document/types';
import { createShapeNode } from '../../domain/nodes/shapeNode';
import { buildDslPageCommand } from '../dsl/dslPageCommand';
import { assistantContext, selectedFrameIds } from './assistantContext';

async function twoDiagrams() {
  const first = await compile('flowchart\ntitle: Checkout\nPay -> Ship');
  const second = await compile('flowchart\nLogin -> Home', { origin: { x: 900, y: 0 } });
  let page = (buildDslPageCommand({ ...createEmptyV2Page(), name: 'Flows' }, first) as { after: ScenePage }).after;
  page = (buildDslPageCommand(page, second) as { after: ScenePage }).after;
  return { page, first: first.frame.id, second: second.frame.id };
}

describe('assistant context', () => {
  it('shows the whole page: every diagram with its authored text', async () => {
    const { page, first, second } = await twoDiagrams();
    const context = assistantContext(page, [], 'page');
    expect(context.pageName).toBe('Flows');
    expect(context.frames.map(({ id }) => id)).toEqual([first, second]);
    expect(context.frames[0]).toMatchObject({ title: 'Checkout', family: 'flowchart' });
    expect(context.frames[0]!.dsl).toContain('Pay -> Ship');
    expect(context.outOfScope).toBe(0);
  });

  it('names a palette the text lacks, so a rewrite of it keeps the palette', async () => {
    const mono = await compile('flowchart\nPay -> Ship', { appearance: { palette: 'mono' } });
    const page = (buildDslPageCommand(createEmptyV2Page(), mono) as { after: ScenePage }).after;
    expect(assistantContext(page, [], 'page').frames[0]!.dsl).toContain('appearance: mono');
  });

  it('narrows to the diagram holding the selected shape and names it', async () => {
    const { page, second } = await twoDiagrams();
    expect(selectedFrameIds(page, ['login'])).toEqual([second]);
    const context = assistantContext(page, ['login'], 'selection');
    expect(context.frames.map(({ id }) => id)).toEqual([second]);
    expect(context.focus).toEqual(['Login']);
    expect(context.outOfScope).toBe(1);
  });

  it('counts a selected frame as its own diagram, without making it a focus label', async () => {
    const { page, first } = await twoDiagrams();
    const context = assistantContext(page, [first], 'selection');
    expect(context.frames.map(({ id }) => id)).toEqual([first]);
    expect(context.focus).toEqual([]);
  });

  it('gives a selected hand-drawn shape its id, so the tools can act on it', async () => {
    const { page } = await twoDiagrams();
    const drawn = { ...page, nodes: [...page.nodes,
      createShapeNode(page, { kind: 'rectangle', id: 'box', at: { x: 0, y: 900 }, label: 'Box' }),
      createShapeNode(page, { kind: 'ellipse', id: 'blank', at: { x: 300, y: 900 } })] };
    expect(assistantContext(drawn, ['box', 'blank', 'login'], 'selection').focus).toEqual(['Login', 'Box (shape id box)', 'ellipse (shape id blank)']);
  });
});
