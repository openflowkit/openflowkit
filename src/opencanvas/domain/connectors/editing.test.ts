import { describe, expect, it } from 'vitest';
import {
  createTestConnector,
  createTestDocument,
  createTestNode,
} from '../../testing/builders/documentBuilder';
import { applyDocumentCommand } from '../commands/execute';
import { projectConnector } from './routeProjection';
import type { ScenePage } from '../document/types';
import { createDefaultSceneLayer } from '../document/defaults';
import { validateSceneDocumentV1 } from '../document/validation';
import {
  addConnectorWaypoint,
  connectorEditHandles,
  createConnectorEditCommand,
  moveConnectorHandle,
  pickConnectorAtPoint,
  pickConnectorEditHandle,
  reconnectConnector,
  removeConnectorWaypoint,
  resetConnectorRoute,
  setPrimaryConnectorLabel,
} from './editing';

function pageWith(connector = createTestConnector('edge', 'a', 'b')): ScenePage {
  return {
    id: 'page',
    name: 'Page',
    diagramKind: 'flowchart',
    layers: [createDefaultSceneLayer()],
    nodes: [
      createTestNode('a'),
      createTestNode('b', {
        transform: { translation: { x: 240, y: 120 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
      }),
      createTestNode('c', {
        transform: { translation: { x: 480, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
      }),
    ],
    connectors: [connector],
    metadata: {},
    extensions: {},
  };
}

describe('connector editing', () => {
  it('exposes endpoint and route-specific anatomy', () => {
    const direct = pageWith();
    expect(connectorEditHandles(direct, direct.connectors[0]).map((handle) => handle.kind)).toEqual(
      ['endpoint', 'endpoint', 'segment']
    );
    const bezierConnector = createTestConnector('curve', 'a', 'b', {
      route: { kind: 'bezier', ownership: 'automatic' },
    });
    expect(
      connectorEditHandles(pageWith(bezierConnector), bezierConnector).map((handle) => handle.kind)
    ).toEqual(['endpoint', 'endpoint', 'control', 'control']);
  });

  it('drops midpoint handles on segments shorter than the minimum, keeping the endpoints', () => {
    const page = pageWith();
    const connector = page.connectors[0];
    const all = connectorEditHandles(page, connector);
    const segment = all.find((handle) => handle.kind === 'segment')!;
    const length = 2 * Math.hypot(segment.point.x - all[0]!.point.x, segment.point.y - all[0]!.point.y);
    expect(connectorEditHandles(page, connector, length - 1).map((handle) => handle.kind)).toContain('segment');
    expect(connectorEditHandles(page, connector, length + 1).map((handle) => handle.kind)).toEqual(['endpoint', 'endpoint']);
  });

  it('converts a direct segment edit into a persistent manual polyline', () => {
    const page = pageWith();
    const connector = page.connectors[0];
    const segment = connectorEditHandles(page, connector).find(
      (handle) => handle.kind === 'segment'
    );
    const edited = moveConnectorHandle(page, connector, segment!, { x: 160, y: 20 });

    expect(edited.route).toEqual({ kind: 'polyline', ownership: 'hybrid' });
    expect(edited.waypoints.length).toBeGreaterThan(0);
  });

  it('adds, moves, removes, and resets waypoints without changing semantics', () => {
    const page = pageWith();
    const connector = page.connectors[0];
    const added = addConnectorWaypoint(page, connector, { x: 160, y: 40 });
    const handle = connectorEditHandles(pageWith(added), added).find(
      (candidate) => candidate.kind === 'waypoint'
    );
    const moved = moveConnectorHandle(pageWith(added), added, handle!, { x: 170, y: 60 });
    const removed = removeConnectorWaypoint(moved, 0);

    expect(moved.waypoints[0]).toEqual({ x: 170, y: 60 });
    expect(removed.route.ownership).toBe('automatic');
    expect(resetConnectorRoute(moved).waypoints).toEqual([]);
    expect(moved.semantics).toBe(connector.semantics);
  });

  it('stores authored bezier controls as manual waypoints', () => {
    const connector = createTestConnector('curve', 'a', 'b', {
      route: { kind: 'bezier', ownership: 'automatic' },
    });
    const page = pageWith(connector);
    const control = connectorEditHandles(page, connector).find(
      (handle) => handle.kind === 'control' && handle.index === 0
    );
    const edited = moveConnectorHandle(page, connector, control!, { x: 80, y: -50 });

    expect(edited.route).toEqual({ kind: 'bezier', ownership: 'manual' });
    expect(edited.waypoints[0]).toEqual({ x: 80, y: -50 });
    expect(edited.waypoints).toHaveLength(2);
  });

  it('reconnects one endpoint and clears stale route geometry', () => {
    const connector = createTestConnector('edge', 'a', 'b', {
      route: { kind: 'orthogonal', ownership: 'imported-fixed' },
      waypoints: [{ x: 120, y: 80 }],
    });
    const reconnected = reconnectConnector(connector, 'target', {
      nodeId: 'c',
      portId: null,
      anchor: { kind: 'side', side: 'left', ratio: 0.5 },
      point: null,
    });

    expect(reconnected.target.nodeId).toBe('c');
    expect(reconnected.waypoints).toEqual([]);
    expect(reconnected.route.ownership).toBe('automatic');
  });

  it('creates one reversible command only for a real edit', () => {
    const connector = pageWith().connectors[0];
    const after = { ...connector, waypoints: [{ x: 10, y: 20 }] };
    expect(createConnectorEditCommand('page', connector, connector, 'Edit')).toBeNull();
    expect(createConnectorEditCommand('page', connector, after, 'Edit')).toMatchObject({
      kind: 'set-connector',
      before: connector,
      after,
    });
  });

  it('round-trips an authored route through command history and JSON', () => {
    const nodes = [createTestNode('a'), createTestNode('b')];
    const before = createTestConnector('edge', 'a', 'b');
    const page = createTestDocument({ nodes, connectors: [before] }).pages[0];
    const after = addConnectorWaypoint(page, before, { x: 80, y: 60 });
    const command = createConnectorEditCommand(page.id, before, after, 'Add bend')!;
    const applied = applyDocumentCommand(
      createTestDocument({ nodes, connectors: [before] }),
      command
    );
    const restored = applyDocumentCommand(applied.document, applied.inverse).document;
    const parsed: unknown = JSON.parse(JSON.stringify(applied.document));

    expect(applied.document.pages[0].connectors[0]).toEqual(after);
    expect(restored.pages[0].connectors[0]).toEqual(before);
    expect(validateSceneDocumentV1(parsed)).toEqual({ success: true, document: applied.document });
  });

  it('picks forgiving connector paths and prioritizes endpoint handles', () => {
    const page = pageWith();
    const connector = page.connectors[0];
    const handles = connectorEditHandles(page, connector);
    const source = handles.find(
      (handle) => handle.kind === 'endpoint' && handle.role === 'source'
    )!;

    expect(pickConnectorAtPoint(page, { x: 150, y: 70 }, 12)).toBe('edge');
    expect(pickConnectorAtPoint(page, { x: 150, y: 0 }, 4)).toBeNull();
    expect(pickConnectorEditHandle(handles, source.point, 10)).toEqual(source);
  });

  it('picks a connector through its label plate, off the line', () => {
    const page = pageWith(setPrimaryConnectorLabel(createTestConnector('edge', 'a', 'b'), 'calls'));
    const label = projectConnector(page, page.connectors[0])!.labels[0];
    expect(pickConnectorAtPoint(page, { x: label.point.x + 15, y: label.point.y - 6 }, 1)).toBe('edge');
    expect(pickConnectorAtPoint(page, { x: label.point.x + 40, y: label.point.y - 6 }, 1)).toBeNull();
  });

  it('creates, renames, and removes the primary label without disturbing secondary labels', () => {
    const connector = createTestConnector('edge', 'a', 'b');
    const created = setPrimaryConnectorLabel(connector, '  calls  ');
    expect(created.labels[0]).toMatchObject({
      id: 'edge:label', text: 'calls', pathRatio: 0.5, offset: { x: 0, y: -14 },
    });
    const renamed = setPrimaryConnectorLabel(created, 'returns');
    expect(renamed.labels[0].text).toBe('returns');
    expect(setPrimaryConnectorLabel(renamed, '   ').labels).toEqual([]);
  });

  it('picks a formatted label anywhere on the plate its larger words are drawn on', () => {
    const rich = [{ kind: 'text', runs: [{ text: 'calls', size: 40 }] }];
    const connector = { ...createTestConnector('edge', 'a', 'b'), labels: [{ id: 'edge:label', text: 'calls', pathRatio: 0.5, offset: { x: 0, y: 0 }, metadata: {}, richLabel: rich }] };
    const page = pageWith(connector);
    const label = projectConnector(page, connector)!.labels[0]!;
    // Plain 'calls' is about 40px wide; at 40px type the plate reaches well past that.
    expect(pickConnectorAtPoint(page, { x: label.point.x + 45, y: label.point.y + 15 }, 1)).toBe('edge');
    expect(pickConnectorAtPoint(page, { x: label.point.x + 200, y: label.point.y + 15 }, 1)).toBeNull();
  });

  it('drops the old words’ formatting when a label is renamed', () => {
    const connector = { ...createTestConnector('edge', 'a', 'b'), labels: [{ id: 'edge:label', text: 'calls', pathRatio: 0.5, offset: { x: 0, y: 0 }, metadata: {}, richLabel: [{ kind: 'text', runs: [{ text: 'calls', bold: true }] }] }] };
    expect(setPrimaryConnectorLabel(connector, 'returns').labels[0]).not.toHaveProperty('richLabel');
  });
});
