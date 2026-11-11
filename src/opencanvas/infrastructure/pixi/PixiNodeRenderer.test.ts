import { Assets, Container, Texture } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '../../domain/document/json';
import type { SceneNode } from '../../domain/document/types';
import { createSceneIndex } from '../../domain/scene/spatialIndex';
import { createTestNode } from '../../testing/builders/documentBuilder';
import { DEFAULT_NODE_SIZING_POLICY } from '../../domain/node-sizing/model';
import { createPixiSpikePage } from './spikeFixture';
import { PixiContainerRenderer } from './PixiContainerRenderer';
import { PixiNodeRenderer } from './PixiNodeRenderer';

const at = (id: string, x: number, y: number, zIndex: number, overrides: Partial<SceneNode> = {}): SceneNode =>
  createTestNode(id, { zIndex, transform: { translation: { x, y }, rotationRadians: 0, scale: { x: 1, y: 1 } }, ...overrides });

function drawn(nodes: SceneNode[]) {
  const page = { ...createPixiSpikePage(1), nodes, connectors: [] };
  const renderer = new PixiNodeRenderer();
  renderer.draw(page, createSceneIndex(page));
  // The base layer's text first, then each overlap layer: fill, images, text.
  const [own, ...overlaps] = renderer.labels.children as Container[];
  const textLayers = [own!, ...overlaps.map((layer) => layer.children[2] as Container)];
  const labelOf = (id: string) => (renderer as unknown as { labelByNodeId: Map<string, Container> }).labelByNodeId.get(id);
  return { renderer, own: own!, overlaps, layerOf: (id: string) => textLayers.findIndex((text) => text.children.includes(labelOf(id)!)) };
}

afterEach(() => vi.restoreAllMocks());

describe('Pixi node renderer', () => {
  // A v1 import once handed the canvas 0-wide class and architecture nodes; one
  // negative rect threw and took the whole renderer down with it.
  it.each([
    { width: 0, height: 0 },
    { width: 1, height: 1 },
    { width: 12, height: 8 },
  ])('draws every node kind at $width×$height without throwing', (size) => {
    const spike = createPixiSpikePage(40);
    const page = { ...spike, nodes: spike.nodes.map((node) => ({ ...node, size })) };
    const index = createSceneIndex(page);

    expect(() => new PixiNodeRenderer().draw(page, index)).not.toThrow();
    expect(() => new PixiContainerRenderer().draw(page, index)).not.toThrow();
  });

  // #92: Reorder changes zIndex, never array position, so painting in array order left the canvas unchanged.
  it('paints shapes and containers in zIndex order, not array order', () => {
    const spike = createPixiSpikePage(13);
    const page = { ...spike, nodes: spike.nodes.map((node, at) => ({ ...node, zIndex: 100 - at })) };
    const index = createSceneIndex(page);
    const painted = (renderer: PixiNodeRenderer | PixiContainerRenderer, ids: readonly string[]) => {
      renderer.draw(page, index);
      return renderer.getDebugSnapshot().map(({ id }) => id).filter((id) => ids.includes(id));
    };

    expect(painted(new PixiNodeRenderer(), ['node-0', 'node-1', 'node-2', 'node-3', 'node-4']))
      .toEqual(['node-4', 'node-3', 'node-2', 'node-1', 'node-0']);
    expect(painted(new PixiContainerRenderer(), ['node-10', 'node-11', 'node-12']))
      .toEqual(['node-12', 'node-11', 'node-10']);
  });

  // #92: text and images sat in one layer over every shape, so a shape sent back still showed its text through the front one.
  it('paints a shape that covers another in its own layer, over that shape\'s text', () => {
    const { own, overlaps, layerOf } = drawn([at('back', 0, 0, 1), at('front', 40, 20, 2), at('beside', 300, 0, 3)]);
    expect(overlaps).toHaveLength(1);
    expect(layerOf('back')).toBe(0);
    expect(layerOf('front')).toBe(1);
    // Side by side with the front shape: it shares the top layer instead of opening another.
    expect(layerOf('beside')).toBe(1);
    expect(own.children).toHaveLength(1);
  });

  it('keeps one layer for shapes that only touch, and follows zIndex, not array order', () => {
    expect(drawn([at('a', 0, 0, 1), at('b', 100, 0, 2), at('c', 0, 50, 3)]).overlaps).toHaveLength(0);
    const swapped = drawn([at('front', 40, 20, 5), at('back', 0, 0, 1)]);
    expect(swapped.layerOf('back')).toBe(0);
    expect(swapped.layerOf('front')).toBe(1);
  });

  it('opens a layer for text that spills past its own box onto the next shape', () => {
    // An unwrapped label (overflow: visible) runs past its 100 px box into the shape 4 px to its right.
    const label = (text: string) => ({ label: text, sizingPolicy: DEFAULT_NODE_SIZING_POLICY as unknown as JsonValue });
    expect(drawn([at('spill', 0, 0, 1, { content: label('A label far wider than its own box') }), at('next', 104, 0, 2)]).overlaps)
      .toHaveLength(1);
    expect(drawn([at('fits', 0, 0, 1, { content: label('Fits') }), at('next', 104, 0, 2)]).overlaps).toHaveLength(0);
  });

  // A shape turned a quarter kept its words upright, hung off its turned corner: an imported draw.io lane title
  // or a mindmap's branch name read flat across its line.
  it('turns a shape\'s words with the shape, and sets them straight again when it is', () => {
    const turned = (radians: number) => createTestNode('lane', {
      transform: { translation: { x: 0, y: 0 }, rotationRadians: radians, scale: { x: 1, y: 1 } }, content: { label: 'Lane 1' },
    });
    const text = (nodes: SceneNode[]) => {
      const renderer = new PixiNodeRenderer();
      const page = { ...createPixiSpikePage(1), nodes, connectors: [] };
      renderer.draw(page, createSceneIndex(page));
      const label = (renderer as unknown as { labelByNodeId: Map<string, Container> }).labelByNodeId.get('lane')!;
      return { renderer, rotation: label.children[0]!.rotation };
    };
    expect(text([turned(-Math.PI / 2)]).rotation).toBeCloseTo(-Math.PI / 2);
    expect(text([turned(Math.PI / 6)]).rotation).toBeCloseTo(Math.PI / 6);
    expect(text([turned(0)]).rotation).toBe(0);
  });

  // Two centred lines were drawn flush left inside their centred block ("Task 1" over "New"); the SVG export
  // centres each line, and so does the canvas.
  it('sets each line of a label to the side the label is aligned to', () => {
    const lineAlign = (textAlign: string) => {
      const renderer = new PixiNodeRenderer();
      const page = { ...createPixiSpikePage(1), nodes: [createTestNode('card', { content: { label: 'Task 1\nNew' }, appearance: { textAlign } })], connectors: [] };
      renderer.draw(page, createSceneIndex(page));
      const label = (renderer as unknown as { labelByNodeId: Map<string, Container> }).labelByNodeId.get('card')!;
      return (label.children[0] as unknown as { style: { align: string } }).style.align;
    };
    expect(lineAlign('center')).toBe('center');
    expect(lineAlign('start')).toBe('left');
    expect(lineAlign('end')).toBe('right');
  });

  it('opens a layer for a sticky whose body runs below its box onto the shape underneath', () => {
    const sticky = at('sticky', 0, 0, 1, { kind: 'sticky', size: { width: 160, height: 60 },
      content: { label: 'Note', subLabel: 'A long note body that wraps over many lines, far past the bottom of its little box' } });
    // 20 px below the sticky's box: only its overflowing text is there.
    expect(drawn([sticky, at('below', 0, 80, 2)]).overlaps).toHaveLength(1);
    expect(drawn([at('short', 0, 0, 1, { kind: 'sticky', size: { width: 160, height: 60 }, content: { label: 'Note', subLabel: 'Short' } }),
      at('below', 0, 80, 2)]).overlaps).toHaveLength(0);
  });

  it('opens no layer over ink or empty boxes, which leave nothing above their fill to cover', () => {
    const pen = (id: string, x: number, zIndex: number) => at(id, x, 0, zIndex, {
      kind: 'pen', content: { points: [{ x: 0, y: 0 }, { x: 100, y: 50 }], strokeWidth: 4 },
    });
    expect(drawn([pen('ink-1', 0, 1), pen('ink-2', 30, 2), pen('ink-3', 60, 3)]).overlaps).toHaveLength(0);
    expect(drawn([at('empty', 0, 0, 1, { content: { label: '' } }), at('over', 40, 20, 2)]).overlaps).toHaveLength(0);
    // Text under a stroke still gets covered.
    expect(drawn([at('text', 0, 0, 1), pen('ink', 30, 2)]).overlaps).toHaveLength(1);
  });

  it('hides text in every layer, never the shapes in an overlap layer, and draws nothing extra in the overview', () => {
    const { renderer, overlaps } = drawn([at('back', 0, 0, 1), at('front', 40, 20, 2)]);
    renderer.setLabelVisibility(null, 1);
    expect(overlaps[0]!.visible).toBe(true);
    expect(overlaps[0]!.children[0]!.visible).toBe(true);
    expect(overlaps[0]!.children[2]!.visible).toBe(false);
    renderer.setLabelVisibility(new Set(['back', 'front']), 1);
    expect(overlaps[0]!.children[2]!.visible).toBe(true);

    const page = { ...createPixiSpikePage(1), nodes: [at('back', 0, 0, 1), at('front', 40, 20, 2)], connectors: [] };
    renderer.draw(page, createSceneIndex(page), null, 'overview');
    expect(renderer.labels.children).toHaveLength(1);
  });

  it('places each image in its shape\'s layer and paint order, whatever order the images load in', async () => {
    const loads: ((texture: Texture) => void)[] = [];
    vi.spyOn(Assets, 'load').mockImplementation(() => new Promise((resolve) => loads.push(resolve as never)) as never);
    const image = (id: string, x: number, zIndex: number) =>
      at(id, x, 0, zIndex, { kind: 'image', content: { label: id, imageUrl: `data:image/png;base64,${id}` } });
    const page = { ...createPixiSpikePage(1), nodes: [image('low', 0, 1), image('mid', 200, 2), image('top', 40, 3)], connectors: [] };
    const renderer = new PixiNodeRenderer();
    renderer.draw(page, createSceneIndex(page));
    await vi.waitFor(() => expect(loads).toHaveLength(3));
    // Last first: the top image loads before the others.
    for (const resolve of [...loads].reverse()) resolve(new Texture());
    const overlap = (renderer.labels.children[1] as Container).children[1] as Container;
    await vi.waitFor(() => expect(renderer.media.children.length + overlap.children.length).toBe(3));
    renderer.media.sortChildren();
    // low and mid share the base layer in paint order; top covers low, so it paints in the overlap layer.
    expect(renderer.media.children.map((child) => child.zIndex)).toEqual([0, 1]);
    expect(overlap.children).toHaveLength(1);
    expect(overlap.children[0]!.zIndex).toBe(2);
  });
});
