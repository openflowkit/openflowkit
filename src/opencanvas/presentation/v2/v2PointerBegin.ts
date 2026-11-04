import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Point2d } from '../../domain/geometry/types';
import type { ScenePage } from '../../domain/document/types';
import { buildNodeStateMap } from '../../domain/scene/nodeState';
import { addToSelection, clearSelection, replaceSelection } from '../../application/selection/selection';
import { beginTransformOperation } from './pointerOperations';
import { sideAnchor } from '../../domain/connectors/connectHandles';
import { beginConnectorOperation } from './v2ConnectorOperations';
import { buildNodeWorldMatrices } from '../../domain/scene/worldGeometry';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import {
  enteredGroup, inkPreview, nodeCenterWorld, pickChartPoint, pickHandleNear, toolShape, type V2Operation, type V2PointerOptions,
} from './v2PointerGestures';

/**
 * What a press on the canvas starts: the pan, a creation or ink gesture, a connector or transform drag, or a marquee.
 * Null starts none (the laser, a locked selection, or a click that only selected a connector: `release` lets go of the pointer).
 */
export function beginOperation(
  opts: V2PointerOptions, host: PixiRendererHost, page: ScenePage, event: ReactPointerEvent<HTMLElement>,
  point: Point2d, release: () => void,
): V2Operation | null {
  const tool = opts.toolRef.current;
  if (tool === 'hand' || opts.spacePanRef.current || event.button === 1) {
    return { kind: 'pan', pointerId: event.pointerId, last: point };
  }
  // The laser only points: V2LaserTrail draws it, the document never hears of it.
  if (tool === 'laser') return null;
  // A comment click is V2Comments' (it opens the composer); the document never hears of it, read-only pages included.
  if (tool === 'comment') return null;
  if (opts.readOnlyRef.current) {
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const fromNode = opts.onNodeDrag && !additive ? host.pickNode(point) : null;
    return {
      kind: 'marquee',
      pointerId: event.pointerId,
      start: point,
      current: point,
      additive,
      ...(fromNode ? { fromNode } : {}),
    };
  }
  const shape = toolShape(tool, opts.toolConfigRef.current);
  if (shape) {
    const world = host.screenToWorld(point);
    return {
      kind: 'create',
      pointerId: event.pointerId,
      shape,
      square: tool === 'square',
      page,
      startWorld: world,
      startScreen: point,
      currentScreen: point,
    };
  }
  if (tool === 'pen' || tool === 'highlighter') {
    const world = host.screenToWorld(point);
    host.setFreeformPreview(inkPreview(opts, tool, [world]));
    return {
      kind: 'ink', pointerId: event.pointerId, page, stroke: tool, points: [world],
    };
  }
  if (tool === 'eraser') {
    return {
      kind: 'erase', pointerId: event.pointerId, page,
      matrices: buildNodeWorldMatrices(page),
      from: host.screenToWorld(point), removed: new Set(),
    };
  }
  if (tool === 'connector') {
    // Starts anywhere: over a shape binds that end, empty canvas leaves
    // it free (ADR-001), like Excalidraw and tldraw arrows.
    const nodeId = host.pickNode(point);
    const world = host.screenToWorld(point);
    return {
      kind: 'connect',
      pointerId: event.pointerId,
      page,
      sourceNodeId: nodeId,
      sourceSide: null,
      fromWorld: (nodeId && nodeCenterWorld(page, nodeId)) || world,
      startScreen: point,
      toWorld: world,
    };
  }
  host.setHover(null, null);
  host.setHoveredConnector(null);
  const additive = event.shiftKey || event.metaKey || event.ctrlKey;
  const selectedConnectorId = host.getSelectedConnectorId();
  const selectedConnector = selectedConnectorId
    ? page.connectors.find(({ id }) => id === selectedConnectorId) ?? null
    : null;
  const connectorHandle = selectedConnector ? host.pickConnectorHandle(point) : null;
  if (selectedConnector && connectorHandle && !additive) {
    host.setConnectorSelection([selectedConnector.id], connectorHandle);
    return beginConnectorOperation(
      event.pointerId, page, selectedConnector, connectorHandle
    );
  }
  const states = buildNodeStateMap(page);
  const canTransform = opts.selectionRef.current.nodeIds.every((id) => !states.get(id)?.locked);
  const handle = canTransform ? host.pickTransformHandle(point) : null;
  // A handle is never a selection gesture: ⇧/⌥ held at the grab are the resize's modifiers.
  if (handle && opts.selectionRef.current.nodeIds.length > 0) {
    return beginTransformOperation(event.pointerId, page,
      opts.selectionRef.current.nodeIds, handle, host.screenToWorld(point));
  }
  // A side handle starts a quick-create drag from that side, whether or
  // not its node is selected; the preview runs from the side anchor.
  // Handles sit outside the node bounds, so search neighbours by
  // proximity (this also covers touch, which never hovers first).
  if (!additive) {
    const hit = pickHandleNear(host, opts, point, states);
    if (hit) {
      if (!opts.selectionRef.current.nodeIds.includes(hit.nodeId)) {
        opts.applyConnectorSelection([]);
        opts.applySelection(replaceSelection([hit.nodeId]));
      }
      return { kind: 'connect', pointerId: event.pointerId, page,
        sourceNodeId: hit.nodeId, sourceSide: hit.side,
        fromWorld: sideAnchor(hit.bounds, hit.side),
        startScreen: point, toWorld: host.screenToWorld(point) };
    }
  }
  const chartPoint = opts.readOnlyRef.current ? null
    : pickChartPoint(host, page, point, opts.cameraRef.current.zoom);
  if (chartPoint && !additive) {
    opts.applyConnectorSelection([]);
    opts.applySelection(replaceSelection([chartPoint.node.id]));
    return {
      kind: 'chart-point', pointerId: event.pointerId, page,
      node: chartPoint.node, index: chartPoint.index,
    };
  }
  const nodeId = host.pickNode(point, enteredGroup(page, opts.selectionRef.current.nodeIds));
  // ⇧/⌘ on a shape (Figma): it joins the selection at once and a drag moves them all; a click
  // without a drag on one already selected takes it back out.
  if (nodeId && additive) {
    const current = opts.selectionRef.current;
    const wasSelected = current.nodeIds.includes(nodeId);
    if (![...current.nodeIds, nodeId].some((id) => states.get(id)?.locked)) {
      opts.applyConnectorSelection([]);
      if (!wasSelected) opts.applySelection(addToSelection(current, [nodeId]));
      return {
        ...beginTransformOperation(event.pointerId, page, opts.selectionRef.current.nodeIds, null, host.screenToWorld(point)),
        ...(wasSelected ? { clickSelects: current.nodeIds.filter((id) => id !== nodeId) } : {}),
      };
    }
  }
  if (nodeId && !additive) {
    if (!opts.selectionRef.current.nodeIds.includes(nodeId)) {
      opts.applyConnectorSelection([]);
      opts.applySelection(replaceSelection([nodeId]));
    }
    if (opts.selectionRef.current.nodeIds.some((id) => states.get(id)?.locked)) return null;
    const many = opts.selectionRef.current.nodeIds.length > 1;
    return {
      ...beginTransformOperation(event.pointerId, page, opts.selectionRef.current.nodeIds, null, host.screenToWorld(point)),
      ...(many ? { clickSelects: [nodeId] } : {}),
    };
  }
  const connectorId = host.pickConnector(point);
  if (connectorId && !nodeId) {
    const connectors = opts.selectedConnectorIdsRef.current;
    if (additive) {
      // ⇧/⌘ toggles a line in or out, the shapes kept.
      opts.applyConnectorSelection(connectors.includes(connectorId)
        ? connectors.filter((id) => id !== connectorId) : [...connectors, connectorId]);
    } else {
      opts.applySelection(clearSelection());
      opts.applyConnectorSelection([connectorId]);
    }
    release();
    return null;
  }
  return {
    kind: 'marquee',
    pointerId: event.pointerId,
    start: point,
    current: point,
    additive,
  };
}
