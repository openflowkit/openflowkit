import { describe, expect, it } from 'vitest';
import {
  createTestConnector,
  createTestDocument,
  createTestNode,
} from '../../testing/builders/documentBuilder';
import { resolveConnectorLine, resolveConnectorPresentation } from './presentation';

function edge(appearance: Record<string, string | number>) {
  const page = createTestDocument({
    nodes: [createTestNode('a'), createTestNode('b')],
    connectors: [createTestConnector('edge', 'a', 'b', { appearance })],
  }).pages[0];
  return resolveConnectorPresentation(page.connectors[0]);
}

describe('connector presentation', () => {
  it('resolves the line alone exactly as the full presentation does', () => {
    const page = createTestDocument({
      nodes: [createTestNode('a'), createTestNode('b')],
      connectors: [createTestConnector('edge', 'a', 'b', { appearance: { markerStart: 'dot', markerEnd: 'arrow', strokeWidth: 3, strokeStyle: 'dashed' } })],
    }).pages[0];
    const { stroke, sourceMarkers, targetMarkers } = resolveConnectorPresentation(page.connectors[0]);
    expect(resolveConnectorLine(page.connectors[0])).toEqual({ stroke, sourceMarkers, targetMarkers });
  });

  it('maps marker ends to glyphs', () => {
    expect(edge({ markerStart: 'none', markerEnd: 'none' }).sourceMarkers).toEqual([]);
    expect(edge({ markerStart: 'none', markerEnd: 'none' }).targetMarkers).toEqual([]);
    expect(edge({ markerEnd: 'arrow' }).targetMarkers).toEqual(['arrow']);
    expect(edge({ markerStart: 'dot' }).sourceMarkers).toEqual(['circle']);
    expect(edge({ markerEnd: 'dot' }).targetMarkers).toEqual(['circle']);
    // Glyph names are drawn as named, several from the line's end inward.
    expect(edge({ markerEnd: 'triangle-filled' }).targetMarkers).toEqual(['triangle-filled']);
    expect(edge({ markerEnd: 'diamond-filled' }).targetMarkers).toEqual(['diamond-filled']);
    expect(edge({ markerStart: 'crow-foot circle' }).sourceMarkers).toEqual(['crow-foot', 'circle']);
    // OpenFlowKit's own `dot` is the open circle; draw.io's filled oval is `circle-filled`.
    expect(edge({ markerStart: 'circle-filled' }).sourceMarkers).toEqual(['circle-filled']);
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
