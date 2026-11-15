import { describe, expect, it } from 'vitest';
import { applyDocumentCommand } from './execute';
import { createEmptyV2Document } from '../../presentation/v2/v2Document';
import {
  createTestConnector,
  createTestDocument,
  createTestNode,
} from '../../testing/builders/documentBuilder';
import { buildStyleConnectorCommand } from './styleConnectors';

function pageWithEdge() {
  return createTestDocument({
    nodes: [createTestNode('a'), createTestNode('b')],
    connectors: [createTestConnector('edge', 'a', 'b')],
  }).pages[0];
}

describe('v2 connector style command', () => {
  it('patches appearance as one set-connector and ignores no-ops', () => {
    const page = pageWithEdge();
    const command = buildStyleConnectorCommand(page, 'edge', {
      color: '#e95420', strokeWidth: 3, dash: 'dashed', markerStart: 'dot', markerEnd: 'none',
    })!;
    expect(command.kind).toBe('set-connector');
    expect(command.after.appearance).toMatchObject({
      stroke: '#e95420', strokeWidth: 3, dashPattern: 'dashed',
      markerStart: 'dot', markerEnd: 'none',
    });
    const applied = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [page] },
      command
    );
    expect(applied.document.pages[0].connectors[0].appearance.stroke).toBe('#e95420');
    const undone = applyDocumentCommand(applied.document, applied.inverse);
    expect(undone.document.pages[0].connectors[0].appearance).toEqual(
      page.connectors[0].appearance
    );
    expect(buildStyleConnectorCommand(applied.document.pages[0], 'edge', {
      color: '#e95420', strokeWidth: 3, dash: 'dashed', markerStart: 'dot', markerEnd: 'none',
    })).toBeNull();
  });

  it('clears dash keys for solid and rejects unknown connectors', () => {
    const page = pageWithEdge();
    const dashed = applyDocumentCommand(
      { ...createEmptyV2Document('doc-1'), pages: [page] },
      buildStyleConnectorCommand(page, 'edge', { dash: 'dashed' })!
    ).document.pages[0];
    const solid = buildStyleConnectorCommand(dashed, 'edge', { dash: 'solid' })!;
    expect(solid.after.appearance.dashPattern).toBeUndefined();
    expect(solid.after.appearance.strokeDasharray).toBeUndefined();
    expect(() => buildStyleConnectorCommand(page, 'ghost', {})).toThrow(RangeError);
  });
});

describe('route kind patch', () => {
  it('switches the path shape and drops manual bends', () => {
    const page = createTestDocument({
      nodes: [createTestNode('a'), createTestNode('b')],
      connectors: [createTestConnector('e', 'a', 'b', {
        route: { kind: 'orthogonal', ownership: 'hybrid' }, waypoints: [{ x: 5, y: 5 }],
      })],
    }).pages[0];
    const command = buildStyleConnectorCommand(page, 'e', { route: 'bezier' })!;
    expect(command.after.route).toEqual({ kind: 'bezier', ownership: 'automatic' });
    expect(command.after.waypoints).toEqual([]);
    expect(buildStyleConnectorCommand(page, 'e', { route: 'orthogonal' })).toBeNull();
  });
});

describe('markers and polyline', () => {
  it('accepts the diamond marker and keeps bends when switching to polyline', () => {
    const page = createTestDocument({
      nodes: [createTestNode('a'), createTestNode('b')],
      connectors: [createTestConnector('e', 'a', 'b', {
        route: { kind: 'orthogonal', ownership: 'hybrid' }, waypoints: [{ x: 5, y: 5 }],
      })],
    }).pages[0];
    const markers = buildStyleConnectorCommand(page, 'e', { markerEnd: 'diamond' })!;
    expect(markers.after.appearance.markerEnd).toBe('diamond');
    const polyline = buildStyleConnectorCommand(page, 'e', { route: 'polyline' })!;
    expect(polyline.after.route).toEqual({ kind: 'polyline', ownership: 'automatic' });
    expect(polyline.after.waypoints).toEqual([{ x: 5, y: 5 }]);
  });
});

describe('reverse and label keys', () => {
  it('swaps ends, mirrors bends and labels, writes label keys', () => {
    const page = createTestDocument({
      nodes: [createTestNode('a'), createTestNode('b')],
      connectors: [createTestConnector('e', 'a', 'b', {
        waypoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
        labels: [{ id: 'l', text: 'x', pathRatio: 0.25, offset: { x: 0, y: 0 }, metadata: {} }],
      })],
    }).pages[0];
    const command = buildStyleConnectorCommand(page, 'e', {
      reverse: true, labelColor: '#ff0000', labelFontSize: 14, cornerRadius: 0, dash: 'dotted', markerEnd: 'cross',
    })!;
    expect(command.after.source.nodeId).toBe('b');
    expect(command.after.target.nodeId).toBe('a');
    expect(command.after.waypoints).toEqual([{ x: 2, y: 2 }, { x: 1, y: 1 }]);
    expect(command.after.labels[0].pathRatio).toBe(0.75);
    expect(command.after.appearance).toMatchObject({
      labelColor: '#ff0000', labelFontSize: 14, cornerRadius: 0, dashPattern: 'dotted', markerEnd: 'cross',
    });
  });
});

describe('a draw.io line restyled', () => {
  it('keeps the picked colours on a dark canvas; the ones it came with still flip', async () => {
    const { resolveConnectorLine } = await import('../connectors/presentation');
    const { resolveConnectorLabelStyle, connectorLabelOnCanvas } = await import('../connectors/labelStyle');
    const document = createTestDocument({
      nodes: [createTestNode('a'), createTestNode('b')],
      connectors: [createTestConnector('edge', 'a', 'b', { appearance: { stroke: '#000000', labelColor: '#000000', labelBackground: '#ffffff', darkColors: 'invert' } })],
    });
    const lined = buildStyleConnectorCommand(document.pages[0]!, 'edge', { color: '#e95420', labelColor: '#2563eb' })!.after;
    expect(resolveConnectorLine(lined).stroke.invertOnDark).toBeUndefined();
    const dark = connectorLabelOnCanvas(resolveConnectorLabelStyle(lined), '#191b19');
    expect(dark.textColor).toBe('#2563eb');
    expect(dark.fill).not.toBe('#ffffff');
  });
});
