import type { Bounds2d, Point2d } from '../../domain/geometry/types';
import { quadrantContent } from '../../domain/nodes/chartNodePresentation';
import { areStructurallyEqual } from '../../domain/commands/equality';
import { addToSelection, clearSelection, replaceSelection } from '../../application/selection/selection';
import { snapToAngle } from '../../domain/geometry/point';
import { createTransformCommand, transformBefore } from '../../domain/transforms/transformSelection';
import { reparentByPosition } from '../../domain/transforms/containment';
import { refitGroups } from '../../domain/commands/groupNodes';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import { boundsBetween, selectionAfterClick, transformLabel, updateTransformOperation } from './pointerOperations';
import { connectorEditLabel, updateConnectorOperation } from './v2ConnectorOperations';
import { createConnectorEditCommand } from '../../domain/connectors/editing';
import { ensureConnectorEndpointPorts } from '../../domain/connectors/portAuthoring';
import { buildInsertConnectorCommand } from '../../domain/commands/sceneEdits';
import {
  altDragCopy, buildEraseCommand, buildInkCommand, commitQuickCreateDelivery, connectNodes, connectorAppearance, connectorRoute,
  placeShape, quadrantValueAt,
} from './v2PointerCommands';
import { CLICK_THRESHOLD_PX, dragBox, enteredGroup, modifiersOf, OBJECT_SNAP_PX, type PointerLike, type V2Operation, type V2PointerOptions } from './v2PointerCore';

type Op<K extends V2Operation['kind']> = Extract<V2Operation, { kind: K }>;

/** Marquee release: a drag selects what it crossed, a click selects what is under it. */
function finishMarquee(operation: Op<'marquee'>, opts: V2PointerOptions, host: PixiRendererHost, point: Point2d): void {
  const bounds: Bounds2d = boundsBetween(operation.start, point);
  const moved = Math.hypot(point.x - operation.start.x, point.y - operation.start.y);
  host.setMarquee(null);
  if (operation.fromNode && moved >= CLICK_THRESHOLD_PX) {
    opts.onNodeDrag?.(operation.fromNode);
  } else if (moved >= CLICK_THRESHOLD_PX) {
    const ids = host.pickNodesInScreenBounds(bounds);
    const connectorIds = host.pickConnectorsInScreenBounds(bounds);
    opts.applySelection(
      operation.additive
        ? addToSelection(opts.selectionRef.current, ids)
        : replaceSelection(ids)
    );
    opts.applyConnectorSelection(operation.additive
      ? [...new Set([...opts.selectedConnectorIdsRef.current, ...connectorIds])]
      : connectorIds);
  } else {
    const page = opts.pageRef.current;
    const nodeId = host.pickNode(point, page ? enteredGroup(page, opts.selectionRef.current.nodeIds) : null);
    const connectorId = nodeId ? null : host.pickConnector(point);
    if (connectorId) {
      opts.applySelection(clearSelection());
      opts.applyConnectorSelection([connectorId]);
    } else {
      if (nodeId || !operation.additive) opts.applyConnectorSelection([]);
      opts.applySelection(
        selectionAfterClick(opts.selectionRef.current, nodeId, operation.additive)
      );
      if (nodeId && !operation.additive) opts.onNodeClick?.(nodeId);
    }
  }
}

function finishTransform(operation: Op<'transform'>, opts: V2PointerOptions, host: PixiRendererHost, point: Point2d, event: PointerLike): void {
  // The release point is authoritative: a fast flick may never have
  // painted a preview frame, but a past-threshold release still commits.
  const worldPoint = host.screenToWorld(point);
  const releaseDistance = Math.hypot(worldPoint.x - operation.start.x, worldPoint.y - operation.start.y)
    * opts.cameraRef.current.zoom;
  const final = operation.result || releaseDistance >= CLICK_THRESHOLD_PX
    ? updateTransformOperation(operation, worldPoint, Boolean(opts.snapToGrid),
        OBJECT_SNAP_PX / opts.cameraRef.current.zoom, modifiersOf(event))
    : operation;
  host.setTransformPreview(null);
  host.setAlignmentGuides(null);
  opts.onTransformPreview?.(null);
  if (!final.result && operation.clickSelects) {
    opts.applyConnectorSelection([]);
    opts.applySelection(replaceSelection(operation.clickSelects));
  } else if (final.result && operation.transformKind === 'move' && event.altKey) {
    altDragCopy(opts, operation.page, operation.snapshot.nodes.map(({ id }) => id), {
      x: final.result.bounds.x - operation.snapshot.bounds.x, y: final.result.bounds.y - operation.snapshot.bounds.y,
    });
  } else if (final.result) {
    const before = transformBefore(operation.snapshot);
    // A move can drop nodes into or out of a section (FigJam); the
    // reparent rides in the same undo step.
    const after = operation.transformKind === 'move'
      ? reparentByPosition(operation.page, final.result.nodes) : final.result.nodes;
    const changed = after.some((node, index) => !areStructurallyEqual(node, before[index]));
    if (changed) {
      // A member edited inside a group: the group re-fits in the same step.
      const fitted = refitGroups(operation.page, before, after);
      opts.commit(createTransformCommand(operation.page.id, fitted.before, fitted.after, transformLabel(operation.transformKind)));
    }
  }
}

function finishCreate(operation: Op<'create'>, opts: V2PointerOptions, host: PixiRendererHost, point: Point2d, event: PointerLike): void {
  host.setPlacementGhost(null);
  const world = host.screenToWorld(point);
  const moved = Math.hypot(
    point.x - operation.startScreen.x,
    point.y - operation.startScreen.y
  );
  // A click places the default size centred on it; a drag commits the box it drew.
  placeShape(opts, operation.page, operation.shape, world,
    moved < CLICK_THRESHOLD_PX ? undefined : dragBox(operation.startWorld, world, operation.square || event.shiftKey, event.altKey),
    operation.square);
}

function finishInk(operation: Op<'ink'>, opts: V2PointerOptions, host: PixiRendererHost): void {
  host.setFreeformPreview(null);
  const command = buildInkCommand(opts, operation);
  if (command) {
    opts.commit(command);
    const nodeId = 'node' in command && command.kind === 'insert-node' ? command.node.id : null;
    if (nodeId) {
      opts.applyConnectorSelection([]);
      opts.applySelection(replaceSelection([nodeId]));
    }
  }
  opts.onToolChange('select');
}

function finishErase(operation: Op<'erase'>, opts: V2PointerOptions): void {
  const command = buildEraseCommand(operation);
  if (command) {
    opts.applyConnectorSelection([]);
    opts.applySelection(clearSelection());
    opts.commit(command);
  }
}

function finishChartPoint(operation: Op<'chart-point'>, opts: V2PointerOptions, host: PixiRendererHost, point: Point2d): void {
  const quadrant = quadrantContent(operation.node);
  const current = quadrant?.points[operation.index];
  const next = quadrantValueAt(operation.node, host.screenToWorld(point));
  if (quadrant && current
    && (Math.abs(current.x - next.x) > 1e-4 || Math.abs(current.y - next.y) > 1e-4)) {
    opts.commit({
      kind: 'set-node',
      id: `chart-point:${operation.node.id}:${operation.index}`,
      label: 'Move quadrant point',
      pageId: operation.page.id,
      before: operation.node,
      after: {
        ...operation.node,
        content: {
          ...operation.node.content,
          points: quadrant.points.map((entry, index) =>
            index === operation.index ? { ...entry, x: next.x, y: next.y } : entry),
        },
      },
    });
  }
}

function finishConnect(operation: Op<'connect'>, opts: V2PointerOptions, host: PixiRendererHost, point: Point2d, event: PointerLike): void {
  host.setConnectionPreview(null);
  const moved = Math.hypot(
    point.x - operation.startScreen.x,
    point.y - operation.startScreen.y
  );
  const free = event.shiftKey && !operation.sourceSide;
  const targetId = free ? null : host.pickNode(point);
  if (operation.sourceSide && operation.sourceNodeId) {
    const sourceNodeId = operation.sourceNodeId;
    const sourceSide = operation.sourceSide;
    if (moved < CLICK_THRESHOLD_PX) {
      // Click on a handle: same as releasing on empty canvas that way.
      commitQuickCreateDelivery(opts, host, operation, sourceNodeId, sourceSide);
    } else if (targetId && targetId !== sourceNodeId) {
      connectNodes(opts, operation.page, sourceNodeId, targetId);
    } else if (targetId === null) {
      // A drag lands the new node where it was released (FigJam, Miro); a click keeps the fixed gap.
      commitQuickCreateDelivery(opts, host, operation, sourceNodeId, sourceSide, host.screenToWorld(point));
    }
    // Release back on the source node cancels; loops arrive in 1.6.
  } else if (moved >= CLICK_THRESHOLD_PX && !(targetId && targetId === operation.sourceNodeId)) {
    const id = opts.mintId('connector');
    const command = buildInsertConnectorCommand(operation.page, {
      id,
      source: operation.sourceNodeId
        ? { nodeId: operation.sourceNodeId }
        : { point: operation.fromWorld },
      target: targetId ? { nodeId: targetId }
        : { point: free ? snapToAngle(operation.fromWorld, host.screenToWorld(point), Math.PI / 4) : host.screenToWorld(point) },
      route: connectorRoute(opts), appearance: connectorAppearance(opts),
    });
    opts.commit(
      operation.sourceNodeId && targetId
        ? opts.extendConnectorCommand?.(command, operation.sourceNodeId, targetId) ?? command
        : command
    );
    opts.applySelection(clearSelection());
    opts.applyConnectorSelection([id]);
    opts.onToolChange('select');
  }
}

function finishConnectorEdit(operation: Op<'connector-edit'>, opts: V2PointerOptions, host: PixiRendererHost, point: Point2d, event: PointerLike): void {
  const final = updateConnectorOperation(
    operation,
    host.screenToWorld(point),
    operation.handle.kind === 'endpoint' && !event.shiftKey ? host.pickNode(point) : null
  );
  host.setConnectorPreview(null);
  const command = createConnectorEditCommand(
    operation.page.id,
    operation.before,
    final.preview,
    connectorEditLabel(operation.handle)
  );
  if (command) {
    // Ports bound live mid-drag materialise with the gesture: one step.
    const portFixings = ensureConnectorEndpointPorts(operation.page, final.preview);
    if (portFixings.length === 0) {
      opts.commit(command);
    } else {
      opts.commit({
        kind: 'batch',
        id: `${command.id}:ports`,
        label: command.label,
        commands: [
          ...portFixings.map((fixing) => ({
            kind: 'set-node' as const,
            id: `connect-port:${fixing.after.id}`,
            label: command.label,
            pageId: operation.page.id,
            before: fixing.before,
            after: fixing.after,
          })),
          command,
        ],
      });
    }
  }
  host.setConnectorSelection([operation.before.id], null);
}

/**
 * A released gesture becomes its one command (or a selection): the release point is
 * authoritative, so a fast flick that never painted a preview still commits.
 */
export function finishGesture(operation: V2Operation, opts: V2PointerOptions, host: PixiRendererHost, point: Point2d, event: PointerLike): void {
  if (operation.kind === 'marquee') finishMarquee(operation, opts, host, point);
  else if (operation.kind === 'transform') finishTransform(operation, opts, host, point, event);
  else if (operation.kind === 'create') finishCreate(operation, opts, host, point, event);
  else if (operation.kind === 'ink') finishInk(operation, opts, host);
  else if (operation.kind === 'erase') finishErase(operation, opts);
  else if (operation.kind === 'chart-point') finishChartPoint(operation, opts, host, point);
  else if (operation.kind === 'connect') finishConnect(operation, opts, host, point, event);
  else if (operation.kind === 'connector-edit') finishConnectorEdit(operation, opts, host, point, event);
  else if (operation.kind === 'comment' && Math.hypot(point.x - operation.start.x, point.y - operation.start.y) < CLICK_THRESHOLD_PX) {
    opts.onCommentClick?.(point);
  }
}
