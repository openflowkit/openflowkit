import { describe, expect, it } from 'vitest';
import type { SceneConnector } from '../document/types';
import { invertForDark } from '../color/adaptiveColor';
import { connectorLabelLines, connectorLabelOnCanvas, connectorLabelPlate, LABEL_WRAP_WIDTH, ownLabelStyle, resolveConnectorLabelStyle } from './labelStyle';

function connector(appearance: SceneConnector['appearance']): SceneConnector {
  return {
    id: 'c', source: { nodeId: 'a', portId: null, anchor: null, point: null },
    target: { nodeId: 'b', portId: null, anchor: null, point: null },
    route: { kind: 'orthogonal', ownership: 'automatic' }, waypoints: [], labels: [],
    appearance, semantics: {}, metadata: {}, extensions: {},
  };
}

describe('resolveConnectorLabelStyle', () => {
  it('defaults to the 11px plate label', () => {
    expect(resolveConnectorLabelStyle(connector({}))).toMatchObject({
      fill: '#ffffff', stroke: '#e2e8f0', textColor: '#334155', fontSize: 12, fontWeight: 500, fontFamily: 'sans',
    });
  });
  it('reads label* keys', () => {
    expect(resolveConnectorLabelStyle(connector({
      labelBackground: 'transparent', labelColor: '#ff0000', labelFontSize: 14, labelFontFamily: 'mono', labelFontStyle: 'italic',
    }))).toMatchObject({ fill: 'transparent', textColor: '#ff0000', fontSize: 14, fontFamily: 'mono', fontStyle: 'italic' });
  });
  it('pads and rounds its plate unless the line sets its own (a draw.io line: tight and square)', () => {
    expect(resolveConnectorLabelStyle(connector({}))).toMatchObject({ textPadding: 5, cornerRadius: 4 });
    expect(resolveConnectorLabelStyle(connector({ labelPadding: 0, labelCornerRadius: 0 }))).toMatchObject({ textPadding: 0, cornerRadius: 0 });
  });
});

describe('connectorLabelLines and connectorLabelPlate', () => {
  const style = resolveConnectorLabelStyle(connector({}));
  const at = { x: 100, y: 50 };

  it('keeps a short label on one line, on the plate it always had', () => {
    expect(connectorLabelLines('yes', style)).toEqual(['yes']);
    expect(connectorLabelPlate('yes', style, at)).toEqual({ x: 100 - (3 * 12 * 0.58 + 10) / 2, y: 50 - (12 * 1.25 + 5) / 2, width: 3 * 12 * 0.58 + 10, height: 12 * 1.25 + 5 });
  });

  it('wraps a long label at the canvas width, and the plate grows down, not out', () => {
    const text = 'Gets account information from, and makes payments using';
    const lines = connectorLabelLines(text, style);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(' ')).toBe(text);
    for (const line of lines) expect(line.length * 12 * 0.5).toBeLessThanOrEqual(LABEL_WRAP_WIDTH);
    const plate = connectorLabelPlate(text, style, at);
    expect(plate.width).toBeLessThanOrEqual(LABEL_WRAP_WIDTH * (0.58 / 0.5) + 10);
    expect(plate.height).toBe(lines.length * 12 * 1.25 + 5);
    expect(plate.y + plate.height / 2).toBe(50);
  });

  it('wraps where Inter does: a 23-character label fits, a 29-character one does not', () => {
    expect(connectorLabelLines('cross head, circle tail', style)).toHaveLength(1);
    expect(connectorLabelLines('validates the request payload', style)).toHaveLength(2);
  });

  it('honours a line break the author wrote and never splits a word', () => {
    expect(connectorLabelLines('Rate limit\nexceeded?', style)).toEqual(['Rate limit', 'exceeded?']);
    expect(connectorLabelLines('internationalization-and-localization-pipeline', style)).toEqual(['internationalization-and-localization-pipeline']);
  });
});

describe('connector label wrap width', () => {
  it('wraps "POST /checkout [HTTPS]" at the width the canvas does, so the plate never fills a gap', () => {
    expect(connectorLabelLines('POST /checkout [HTTPS]', resolveConnectorLabelStyle(connector({}))).length).toBe(2);
  });

  it('flips a draw.io label’s own colours on a dark canvas, as draw.io’s dark mode does, and leaves others as set', () => {
    const drawio = resolveConnectorLabelStyle(connector({ darkColors: 'invert', labelColor: '#ff0000', labelBackground: '#ffff00' }));
    const dark = connectorLabelOnCanvas(drawio, '#1a1a1a');
    expect(dark).toMatchObject({ textColor: invertForDark('#ff0000'), fill: invertForDark('#ffff00'), invertColors: true });
    expect(connectorLabelOnCanvas(drawio, '#ffffff')).toMatchObject({ textColor: '#ff0000', invertColors: false });
    const ours = resolveConnectorLabelStyle(connector({ labelColor: '#ff0000' }));
    expect(connectorLabelOnCanvas(ours, '#1a1a1a').textColor).toBe('#ff0000');
  });
});

describe('ownLabelStyle', () => {
  it('puts a label on its own plate, and leaves one without on the connector\'s', () => {
    const style = resolveConnectorLabelStyle(connector({}));
    expect(ownLabelStyle(style, { background: 'transparent' }).fill).toBe('transparent');
    expect(ownLabelStyle(style, {})).toBe(style);
  });
});
