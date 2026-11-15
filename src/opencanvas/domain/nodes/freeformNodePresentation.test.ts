import { describe, expect, it } from 'vitest';
import { createPixiSpikePage } from '../../infrastructure/pixi/spikeFixture';
import type { JsonObject } from '../document/json';
import type { SceneNode } from '../document/types';
import { resolveFreeformNodePresentation } from './freeformNodePresentation';

function node(kind: string, content: JsonObject = {}): SceneNode {
  return { ...createPixiSpikePage(1).nodes[0], kind, content };
}

describe('freeform node presentation', () => {
  it('resolves authored text typography and safe defaults', () => {
    expect(
      resolveFreeformNodePresentation(
        node('text', {
          label: 'Heading',
          fontSize: 'large',
          fontFamily: 'serif',
          fontWeight: '700',
        })
      )
    ).toMatchObject({
      kind: 'text',
      label: 'Heading',
      fontSizePx: 18,
      fontFamily: 'serif',
      fontWeight: '700',
    });
  });

  it('accepts renderable image URLs and preserves unresolved asset IDs', () => {
    expect(
      resolveFreeformNodePresentation(
        node('image', {
          imageUrl: 'data:image/png;base64,AA==',
          imageAssetId: 'sha256:abc',
          transparency: 2,
        })
      )
    ).toMatchObject({
      kind: 'image',
      sourceUrl: 'data:image/png;base64,AA==',
      assetId: 'sha256:abc',
      opacity: 1,
    });
    expect(
      resolveFreeformNodePresentation(node('image', { imageUrl: 'javascript:alert(1)' }))
    ).toMatchObject({ sourceUrl: null });
  });

  it('stretches an image to its box only when its content says so', () => {
    expect(resolveFreeformNodePresentation(node('image', { imageUrl: 'data:image/png;base64,AA==', imageFit: 'stretch' })))
      .toMatchObject({ fit: 'stretch' });
    expect(resolveFreeformNodePresentation(node('image', { imageUrl: 'data:image/png;base64,AA==' }))).not.toHaveProperty('fit');
  });

  it('resolves annotation content and rejects unrelated families', () => {
    expect(
      resolveFreeformNodePresentation(
        node('annotation', { label: 'Risk', subLabel: 'Rotate keys', color: 'amber' })
      )
    ).toMatchObject({ kind: 'annotation', title: 'Risk', body: 'Rotate keys', colorKey: 'amber' });
    expect(resolveFreeformNodePresentation(node('process'))).toBeNull();
  });

  it('resolves bounded stroke primitives and note variants', () => {
    expect(resolveFreeformNodePresentation(node('pen', {
      points: [{ x: 0, y: 1 }, { x: 20, y: 30 }], strokeWidth: 200,
    }))).toMatchObject({ kind: 'pen', width: 64, points: [{ x: 0, y: 1 }, { x: 20, y: 30 }] });
    expect(resolveFreeformNodePresentation(node('pen', {
      points: [{ x: 0, y: 1 }, { x: 20, y: 30 }],
      inputSamples: [
        { pressure: 0.2, tiltX: 10, tiltY: 20, twist: 30 },
        { pressure: 0.8, tiltX: 40, tiltY: 50, twist: 60 },
      ],
    }))).toMatchObject({
      inputSamples: [
        { pressure: 0.2, tiltX: 10, tiltY: 20, twist: 30 },
        { pressure: 0.8, tiltX: 40, tiltY: 50, twist: 60 },
      ],
    });
    expect(resolveFreeformNodePresentation(node('arrow', { points: [{ x: 0, y: 0 }] }))).toBeNull();
    expect(resolveFreeformNodePresentation(node('sticky', { subLabel: 'Remember' })))
      .toMatchObject({ kind: 'sticky', body: 'Remember' });
    expect(resolveFreeformNodePresentation(node('callout', { label: 'Watch out' })))
      .toMatchObject({ kind: 'callout', title: 'Watch out', body: '' });
  });
});
