import { describe, expect, it } from 'vitest';
import {
  createTestConnector,
  createTestDocument,
  createTestNode,
} from '../../testing/builders/documentBuilder';
import { resolveConnectorPresentation } from './presentation';

function edge(appearance: Record<string, string | number>) {
  const page = createTestDocument({
    nodes: [createTestNode('a'), createTestNode('b')],
    connectors: [createTestConnector('edge', 'a', 'b', { appearance })],
  }).pages[0];
  return resolveConnectorPresentation(page.connectors[0]);
}

describe('connector presentation', () => {
  it('maps marker ends to glyphs', () => {
    expect(edge({ markerStart: 'none', markerEnd: 'none' }).sourceMarkers).toEqual([]);
    expect(edge({ markerStart: 'none', markerEnd: 'none' }).targetMarkers).toEqual([]);
    expect(edge({ markerEnd: 'arrow' }).targetMarkers).toEqual(['arrow']);
    expect(edge({ markerStart: 'dot' }).sourceMarkers).toEqual(['circle']);
    expect(edge({ markerEnd: 'dot' }).targetMarkers).toEqual(['circle']);
  });

  it('resolves stroke color, width, and dash', () => {
    const plain = edge({});
    expect(plain.stroke.color).toBe('#64748b');
    expect(plain.stroke.dash).toEqual([]);
    const styled = edge({ stroke: '#e95420', strokeWidth: 3, dashPattern: 'dashed' });
    expect(styled.stroke).toMatchObject({ color: '#e95420', width: 3, dash: [10, 6] });
  });
});

describe('a draw.io line on a dark canvas', () => {
  it('flips the colour it sets, as draw.io’s dark mode does; other lines keep theirs', async () => {
    const { connectorStrokeOnCanvas } = await import('./presentation');
    const { invertForDark } = await import('../color/adaptiveColor');
    const drawn = edge({ stroke: '#000000', darkColors: 'invert' }).stroke;
    expect(connectorStrokeOnCanvas(drawn, '#0f172a').color).toBe(invertForDark('#000000'));
    expect(connectorStrokeOnCanvas(drawn, '#ffffff').color).toBe('#000000');
    const ours = edge({ stroke: '#000000' }).stroke;
    expect(connectorStrokeOnCanvas(ours, '#0f172a').color).toBe('#000000');
  });
});
