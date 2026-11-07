import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  createTestConnector,
  createTestDocument,
  createTestNode,
} from '../../testing/builders/documentBuilder';
import { clearSelection, replaceSelection, type CanvasSelection } from '../../application/selection/selection';
import type { Bounds2d } from '../../domain/geometry/types';
import type { PixiRendererHost } from '../../infrastructure/pixi/PixiRendererHost';
import { useV2Pointer } from './useV2Pointer';
import { enteredGroup, type V2GestureApi } from './v2PointerGestures';
import { defaultShapeSize } from '../../domain/nodes/shapeNode';
import { DEFAULT_TOOL_CONFIG } from './v2ToolCatalog';
import type { V2Tool } from './V2CreationToolbar';

function setup(
  extraNodes: ReturnType<typeof createTestNode>[] = [],
  extraConnectors: ReturnType<typeof createTestConnector>[] = [],
  readOnly?: { onNodeDrag: (nodeId: string) => void; onNodeDoubleClick?: (nodeId: string) => void },
) {
  const page = createTestDocument({
    nodes: [createTestNode('a'), ...extraNodes],
    connectors: extraConnectors,
  }).pages[0];
  const section = document.createElement('section');
  const canvas = document.createElement('canvas');
  section.append(canvas);
  section.setPointerCapture = vi.fn();
  section.releasePointerCapture = vi.fn();
  const selectionRef = { current: clearSelection() };
  const selectedConnectorIdsRef = { current: [] as readonly string[] };
  const host = {
    screenToWorld: (point: { x: number; y: number }) => point,
    getViewportSize: vi.fn(() => ({ width: 1000, height: 800 })),
    pickNode: vi.fn((_point: { x: number; y: number }, _scope?: string | null): string | null => 'a'),
    pickConnector: vi.fn((): string | null => null),
    getSelectedConnectorId: vi.fn((): string | null => null),
    pickConnectorHandle: vi.fn(() => null),
    pickTransformHandle: vi.fn((): 'south-east' | null => null),
    pickConnectHandle: vi.fn(() => null),
    setMarquee: vi.fn(), setPlacementGhost: vi.fn(), setTransformPreview: vi.fn(), setAlignmentGuides: vi.fn(), setConnectionPreview: vi.fn(), setDropTarget: vi.fn(), setHoveredConnector: vi.fn(),
    setConnectorSelection: vi.fn(), setConnectorPreview: vi.fn(), setFreeformPreview: vi.fn(),
    setHover: vi.fn(), getNodesWorldBounds: vi.fn((_ids: readonly string[]): Bounds2d | null => null),
    pickNodesInScreenBounds: vi.fn((_bounds: Bounds2d): readonly string[] => []),
    pickConnectorsInScreenBounds: vi.fn((_bounds: Bounds2d): readonly string[] => []),
  };
  const commit = vi.fn();
  const applySelection = vi.fn((next: CanvasSelection) => { selectionRef.current = next; });
  const applyConnectorSelection = vi.fn((ids: readonly string[]) => { selectedConnectorIdsRef.current = ids; });
  const openEditor = vi.fn();
  const toolRef: { current: V2Tool } = { current: 'select' };
  const toolConfigRef = { current: DEFAULT_TOOL_CONFIG };
  const gestureApiRef = { current: null as V2GestureApi | null };
  const onToolChange = vi.fn();
  const updateCamera = vi.fn();
  const onCommentClick = vi.fn();
  const spacePanRef = { current: false };
  const { result } = renderHook(() => useV2Pointer({
    hostRef: { current: host as unknown as PixiRendererHost },
    cameraRef: { current: { x: 0, y: 0, zoom: 1 } }, pageRef: { current: page },
    selectionRef, selectedConnectorIdsRef, toolRef, toolConfigRef,
    spacePanRef, onCommentClick,
    readOnlyRef: { current: Boolean(readOnly) }, gestureApiRef, commit,
    ...(readOnly ? { onNodeDrag: readOnly.onNodeDrag } : {}),
    ...(readOnly?.onNodeDoubleClick ? { onNodeDoubleClick: readOnly.onNodeDoubleClick } : {}),
    applySelection, applyConnectorSelection,
    updateCamera, openEditor, openConnectorEditor: vi.fn(), onToolChange, mintId: () => 'new',
  }));
  function event(x: number, y: number, target: HTMLElement = canvas, button = 0): ReactPointerEvent<HTMLElement> {
    return { currentTarget: section, target, clientX: x, clientY: y, button,
      pointerId: 1, preventDefault: vi.fn() } as unknown as ReactPointerEvent<HTMLElement>;
  }
  return { result, host, commit, page, selectionRef, applySelection, applyConnectorSelection, openEditor, event, section,
    toolRef, toolConfigRef, gestureApiRef, onToolChange, updateCamera, onCommentClick, spacePanRef };
}

async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('V2 direct manipulation', () => {
  it('selects on first press; sub-threshold jitter creates no history', () => {
    const { result, event, selectionRef, commit, host } = setup();
    act(() => result.current.handlePointerDown(event(100, 100)));
    expect(selectionRef.current.nodeIds).toEqual(['a']);
    act(() => result.current.handlePointerMove(event(102, 101)));
    act(() => result.current.handlePointerUp(event(102, 101)));
    expect(commit).not.toHaveBeenCalled();
    expect(host.setTransformPreview).not.toHaveBeenCalledWith(expect.objectContaining({ nodes: expect.anything() }));
  });

  it('moves without default snapping and commits final release coordinates once', () => {
    const { result, event, commit, page } = setup();
    act(() => result.current.handlePointerDown(event(100, 100)));
    act(() => result.current.handlePointerMove(event(113, 107)));
    act(() => result.current.handlePointerUp(event(117, 109)));
    expect(commit).toHaveBeenCalledOnce();
    const command = commit.mock.calls[0][0];
    expect(command.after.transform.translation).toEqual({
      x: page.nodes[0].transform.translation.x + 17,
      y: page.nodes[0].transform.translation.y + 9,
    });
  });

  it('snaps a move onto another node and shows the guide; Alt bypasses; guide clears on release', async () => {
    const other = createTestNode('b', {
      size: { width: 200, height: 50 },
      transform: { translation: { x: 300, y: 300 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    });
    const { result, event, host, commit, page } = setup([other]);
    const start = page.nodes[0].transform.translation;
    // Drag so a's left edge lands 4px right of b's left edge (300) → snaps to 300.
    act(() => result.current.handlePointerDown(event(100, 100)));
    act(() => result.current.handlePointerMove(event(100 + 304 - start.x, 100)));
    await flushFrame();
    expect(host.setAlignmentGuides).toHaveBeenLastCalledWith({ x: 300, y: null });
    expect(host.setTransformPreview.mock.calls.at(-1)?.[0].bounds.x).toBe(300);
    act(() => result.current.handlePointerMove({ ...event(100 + 304 - start.x, 100), metaKey: true }));
    await flushFrame();
    expect(host.setAlignmentGuides).toHaveBeenLastCalledWith(null);
    expect(host.setTransformPreview.mock.calls.at(-1)?.[0].bounds.x).toBe(304);
    act(() => result.current.handlePointerUp(event(100 + 304 - start.x, 100)));
    expect(host.setAlignmentGuides).toHaveBeenLastCalledWith(null);
    expect(commit.mock.calls[0][0].after.transform.translation.x).toBe(300);
  });

  it('collapses a coalesced burst to its latest point with one preview per frame', async () => {
    const { result, event, host } = setup();
    act(() => result.current.handlePointerDown(event(100, 100)));
    const burst = (x: number, y: number) => ({
      ...event(x, y),
      nativeEvent: {
        getCoalescedEvents: () => [{ clientX: x - 30, clientY: y }, { clientX: x, clientY: y }],
      } as unknown as PointerEvent,
    });
    act(() => {
      result.current.handlePointerMove(burst(150, 120));
      result.current.handlePointerMove(burst(170, 130));
      result.current.handlePointerMove(burst(190, 140));
    });
    expect(host.setTransformPreview).not.toHaveBeenCalled();
    await flushFrame();
    // One preview for the whole burst, at the latest coalesced point (+90/+40).
    expect(host.setTransformPreview).toHaveBeenCalledOnce();
    expect(host.setTransformPreview.mock.calls[0][0].bounds.x).toBe(90);
    expect(host.setTransformPreview.mock.calls[0][0].bounds.y).toBe(40);
  });

  it('Escape mid-drag cancels the queued frame and commits nothing', async () => {
    const { result, event, host, commit, page } = setup();
    act(() => result.current.handlePointerDown(event(100, 100)));
    act(() => result.current.handlePointerMove(event(190, 140)));
    act(() => result.current.handlePointerCancel());
    await flushFrame();
    expect(host.setTransformPreview).toHaveBeenLastCalledWith(null);
    expect(host.setTransformPreview).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(page.nodes[0].transform.translation).toEqual({ x: 0, y: 0 });
  });

  it('finishes a drag from a window pointerup after the browser drops capture', () => {
    const { result, event, commit, page } = setup();
    act(() => result.current.handlePointerDown(event(100, 100)));
    act(() => result.current.handlePointerMove(event(130, 120)));
    // Chrome releases mouse capture early on trackpads; the up then lands
    // on whatever is under the pointer, or outside the section entirely.
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 150, clientY: 130, bubbles: true }));
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0].after.transform.translation).toEqual({
      x: page.nodes[0].transform.translation.x + 50,
      y: page.nodes[0].transform.translation.y + 30,
    });
    act(() => result.current.handlePointerUp(event(150, 130)));
    expect(commit).toHaveBeenCalledOnce();
  });

  it('ignores floating controls and cancels preview without committing', () => {
    const { result, event, host, commit, selectionRef } = setup();
    act(() => result.current.handlePointerDown(event(100, 100, document.createElement('button'))));
    expect(selectionRef.current.nodeIds).toEqual([]);
    act(() => result.current.handlePointerDown(event(100, 100)));
    act(() => result.current.handlePointerMove(event(130, 120)));
    act(() => result.current.handlePointerCancel());
    act(() => result.current.handlePointerUp(event(140, 140)));
    expect(host.setTransformPreview).toHaveBeenLastCalledWith(null);
    expect(commit).not.toHaveBeenCalled();
  });

  it('picks resize handles before the shape body', () => {
    const { result, event, host, selectionRef, commit } = setup();
    selectionRef.current = replaceSelection(['a']);
    host.pickTransformHandle.mockReturnValue('south-east');
    act(() => result.current.handlePointerDown(event(100, 100)));
    act(() => result.current.handlePointerMove(event(200, 150)));
    act(() => result.current.handlePointerUp(event(220, 160)));
    expect(commit.mock.calls[0][0].label).toBe('Resize selection');
    expect(host.pickNode).not.toHaveBeenCalled();
  });

  it('haloes the line under the pointer only when no shape or handle is there', () => {
    const { result, event, host } = setup();
    const canvas = document.createElement('canvas');
    const hover = (x: number) => act(() => result.current.handlePointerMove({ ...event(x, 25), target: canvas }));
    host.pickNode.mockReturnValue(null);
    host.pickConnector.mockReturnValue('edge');
    hover(300);
    expect(host.setHoveredConnector).toHaveBeenLastCalledWith('edge');
    host.pickNode.mockReturnValue('a');
    hover(40);
    expect(host.setHoveredConnector).toHaveBeenLastCalledWith(null);
    act(() => result.current.handlePointerLeave());
    expect(host.setHoveredConnector).toHaveBeenLastCalledWith(null);
  });

  it('selecting a connector clears node selection', () => {
    const { result, event, host, selectionRef, applyConnectorSelection } = setup();
    selectionRef.current = replaceSelection(['a']);
    host.pickNode.mockReturnValue(null);
    host.pickConnector.mockReturnValue('edge');
    act(() => result.current.handlePointerDown(event(100, 100)));
    expect(selectionRef.current.nodeIds).toEqual([]);
    expect(applyConnectorSelection).toHaveBeenCalledWith(['edge']);
  });

  it('a marquee selects the nodes and the connectors it crosses', () => {
    const { result, event, host, selectionRef, applyConnectorSelection } = setup();
    host.pickNode.mockReturnValue(null);
    host.pickNodesInScreenBounds.mockReturnValue(['a']);
    host.pickConnectorsInScreenBounds.mockReturnValue(['edge', 'free']);
    act(() => result.current.handlePointerDown(event(10, 10)));
    act(() => result.current.handlePointerMove(event(300, 300)));
    act(() => result.current.handlePointerUp(event(300, 300)));
    expect(selectionRef.current.nodeIds).toEqual(['a']);
    expect(applyConnectorSelection).toHaveBeenLastCalledWith(['edge', 'free']);
  });

  it('read-only (Map): a drag from a box moves nothing, draws no marquee and reports the box; a click still selects', () => {
    const onNodeDrag = vi.fn();
    const { result, event, host, commit, selectionRef } = setup([], [], { onNodeDrag });
    act(() => result.current.handlePointerDown(event(100, 100)));
    act(() => result.current.handlePointerMove(event(160, 140)));
    act(() => result.current.handlePointerUp(event(160, 140)));
    expect(onNodeDrag).toHaveBeenCalledWith('a');
    expect(host.setMarquee).not.toHaveBeenCalledWith(expect.objectContaining({ width: expect.any(Number) }));
    expect(commit).not.toHaveBeenCalled();
    act(() => result.current.handlePointerDown(event(100, 100)));
    act(() => result.current.handlePointerUp(event(100, 100)));
    expect(onNodeDrag).toHaveBeenCalledOnce();
    expect(selectionRef.current.nodeIds).toEqual(['a']);
  });

  it('read-only (Map): a double-click on a box reports it instead of opening the label editor', () => {
    const onNodeDoubleClick = vi.fn();
    const { result, event, openEditor } = setup([], [], { onNodeDrag: vi.fn(), onNodeDoubleClick });
    act(() => result.current.handleDoubleClick(event(100, 100)));
    expect(onNodeDoubleClick).toHaveBeenCalledWith('a');
    expect(openEditor).not.toHaveBeenCalled();
  });
});

describe('shape placement', () => {
  it('ghosts the shape at its own size under the pointer; a click drops exactly that', () => {
    const { result, event, host, commit, toolRef, toolConfigRef } = setup();
    toolRef.current = 'shape';
    toolConfigRef.current = { ...DEFAULT_TOOL_CONFIG, shape: 'actor' };
    act(() => result.current.handlePointerMove(event(300, 200)));
    const ghost = host.setPlacementGhost.mock.lastCall?.[0];
    expect(ghost).toEqual({ shape: 'actor', bounds: { x: 300 - 56, y: 200 - 68, width: 112, height: 136 } });
    act(() => result.current.handlePointerDown(event(300, 200)));
    act(() => result.current.handlePointerUp(event(300, 200)));
    expect(host.setPlacementGhost).toHaveBeenLastCalledWith(null);
    const node = commit.mock.calls[0][0].node;
    expect(node.size).toEqual({ width: 112, height: 136 });
    expect(node.transform.translation).toEqual({ x: 300 - 56, y: 200 - 68 });
  });

  it('the ghost becomes the drag box past the click threshold', () => {
    const { result, event, host, toolRef } = setup();
    toolRef.current = 'rectangle';
    act(() => result.current.handlePointerDown(event(100, 100)));
    act(() => result.current.handlePointerMove(event(180, 150)));
    expect(host.setPlacementGhost).toHaveBeenLastCalledWith(
      { shape: 'rectangle', bounds: { x: 100, y: 100, width: 80, height: 50 } });
  });
});

describe('V2 quick-create from side handles', () => {
  // Node a spans (0,0)-(100,50); its right handle sits at (122,25).
  const boundsOf = (ids: readonly string[]): Bounds2d | null =>
    ids[0] === 'a' ? { x: 0, y: 0, width: 100, height: 50 }
    : ids[0] === 'b' ? { x: 400, y: 0, width: 100, height: 50 } : null;

  it('tracks hovered node and handle, and clears hover on press', () => {
    const { result, event, host } = setup();
    host.getNodesWorldBounds.mockImplementation(boundsOf);
    host.pickNodesInScreenBounds.mockReturnValue(['a']);
    act(() => result.current.handlePointerMove(event(100, 100)));
    expect(host.setHover).toHaveBeenLastCalledWith('a', null);
    act(() => result.current.handlePointerMove(event(122, 25)));
    expect(host.setHover).toHaveBeenLastCalledWith('a', 'right');
    act(() => result.current.handlePointerDown(event(122, 25)));
    expect(host.setHover).toHaveBeenLastCalledWith(null, null);
  });

  it('drags from a handle to empty canvas: same-size node centred where it was released, bound, editor open', () => {
    const { result, event, host, commit, selectionRef, openEditor } = setup();
    host.getNodesWorldBounds.mockImplementation(boundsOf);
    host.pickNodesInScreenBounds.mockReturnValue(['a']);
    host.pickNode.mockImplementation((point: { x: number }) => (point.x < 150 ? 'a' : null));
    act(() => result.current.handlePointerDown(event(122, 25)));
    expect(selectionRef.current.nodeIds).toEqual(['a']);
    act(() => result.current.handlePointerMove(event(322, 125)));
    act(() => result.current.handlePointerUp(event(322, 125)));
    expect(commit).toHaveBeenCalledOnce();
    const batch = commit.mock.calls[0][0];
    expect(batch.kind).toBe('batch');
    expect(batch.label).toBe('Quick create');
    const insertNode = batch.commands.find((command: { kind: string }) => command.kind === 'insert-node');
    expect(insertNode.node.size).toEqual({ width: 100, height: 50 });
    // Centred on the release point (FigJam/Miro), not parked at the fixed gap.
    expect(insertNode.node.transform.translation).toEqual({ x: 322 - 50, y: 125 - 25 });
    const insertEdge = batch.commands.find((command: { kind: string }) => command.kind === 'insert-connector');
    expect(insertEdge.connector.source).toMatchObject({ nodeId: 'a', portId: null });
    expect(insertEdge.connector.target).toMatchObject({ nodeId: insertNode.node.id, portId: null });
    expect(selectionRef.current.nodeIds).toEqual([insertNode.node.id]);
    expect(openEditor).toHaveBeenCalledWith(insertNode.node.id, { isNew: true });
  });

  it('clicks a handle without dragging: same quick-create in that direction', () => {
    const { result, event, host, commit, openEditor } = setup();
    host.getNodesWorldBounds.mockImplementation(boundsOf);
    host.pickNodesInScreenBounds.mockReturnValue(['a']);
    act(() => result.current.handlePointerDown(event(122, 25)));
    act(() => result.current.handlePointerUp(event(123, 25)));
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0].label).toBe('Quick create');
    expect(openEditor).toHaveBeenCalledWith('new', { isNew: true });
  });

  it('pans the least it takes, zoom kept, when the new node lands off-screen', () => {
    const { result, event, host, updateCamera } = setup();
    host.getNodesWorldBounds.mockImplementation(boundsOf);
    host.pickNodesInScreenBounds.mockReturnValue(['a']);
    host.getViewportSize.mockReturnValue({ width: 260, height: 800 });
    act(() => result.current.handlePointerDown(event(122, 25)));
    act(() => result.current.handlePointerUp(event(123, 25)));
    const camera = updateCamera.mock.calls.at(-1)?.[0];
    expect(camera?.zoom).toBe(1);
    // The node spans x 200–300; it ends inside the 260px viewport, its gap clear of the edge.
    expect(camera!.x).toBeLessThan(-40);
    expect(camera!.x).toBeGreaterThan(-120);
    expect(Math.abs(camera!.y)).toBeLessThan(40);
  });

  it('drags from a handle onto another node: binds node to node', () => {
    const other = createTestNode('b', {
      size: { width: 100, height: 50 },
      transform: { translation: { x: 400, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    });
    const { result, event, host, commit, selectionRef, applyConnectorSelection } = setup([other]);
    host.getNodesWorldBounds.mockImplementation(boundsOf);
    host.pickNodesInScreenBounds.mockReturnValue(['a']);
    host.pickNode.mockImplementation((point: { x: number }) => (point.x < 150 ? 'a' : 'b'));
    act(() => result.current.handlePointerDown(event(122, 25)));
    act(() => result.current.handlePointerMove(event(395, 25)));
    act(() => result.current.handlePointerUp(event(395, 25)));
    expect(commit).toHaveBeenCalledOnce();
    const edge = commit.mock.calls[0][0];
    expect(edge.label).toBe('Connect');
    expect(edge.connector.source).toMatchObject({ nodeId: 'a', portId: null });
    expect(edge.connector.target).toMatchObject({ nodeId: 'b', portId: null });
    expect(selectionRef.current.nodeIds).toEqual([]);
    expect(applyConnectorSelection).toHaveBeenCalledWith([edge.connector.id]);
  });

  it('outlines the shape a dragged connector will bind to, never its own source', () => {
    const other = createTestNode('b', {
      size: { width: 100, height: 50 },
      transform: { translation: { x: 400, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } },
    });
    const { result, event, host } = setup([other]);
    host.getNodesWorldBounds.mockImplementation(boundsOf);
    host.pickNodesInScreenBounds.mockReturnValue(['a']);
    host.pickNode.mockImplementation((point: { x: number }) => (point.x < 150 ? 'a' : point.x > 380 ? 'b' : null));
    act(() => result.current.handlePointerDown(event(122, 25)));
    act(() => result.current.handlePointerMove(event(140, 25)));
    expect(host.setDropTarget).toHaveBeenLastCalledWith(null);
    act(() => result.current.handlePointerMove(event(395, 25)));
    expect(host.setDropTarget).toHaveBeenLastCalledWith('b');
    act(() => result.current.handlePointerMove(event(300, 25)));
    expect(host.setDropTarget).toHaveBeenLastCalledWith(null);
  });

  it('outlines the shape an endpoint is dragged onto', () => {
    const edge = createTestConnector('edge', 'a', 'a');
    const { result, event, host } = setup([], [edge]);
    host.getSelectedConnectorId.mockReturnValue('edge');
    host.pickConnectorHandle.mockReturnValue({ kind: 'endpoint', role: 'target', point: { x: 50, y: 25 } });
    host.pickNode.mockReturnValue('a');
    act(() => result.current.handlePointerDown(event(50, 25)));
    act(() => result.current.handlePointerMove(event(200, 100)));
    expect(host.setDropTarget).toHaveBeenLastCalledWith('a');
  });

  it('shift-drags an endpoint free instead of rebinding it', () => {
    const edge = createTestConnector('edge', 'a', 'a');
    const { result, event, host, commit } = setup([], [edge]);
    host.getSelectedConnectorId.mockReturnValue('edge');
    host.pickConnectorHandle.mockReturnValue({ kind: 'endpoint', role: 'target', point: { x: 50, y: 25 } });
    host.pickNode.mockReturnValue(null);
    act(() => result.current.handlePointerDown(event(50, 25)));
    act(() => result.current.handlePointerMove({ ...event(200, 100), shiftKey: true }));
    act(() => result.current.handlePointerUp({ ...event(200, 100), shiftKey: true }));
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0]).toMatchObject({
      kind: 'set-connector',
      after: { target: { nodeId: null, point: { x: 200, y: 100 } } },
    });
  });

  it('Enter with a shape tool armed places that shape centred on the view, selected, tool back to select', () => {
    const { gestureApiRef, toolRef, commit, selectionRef, onToolChange } = setup();
    toolRef.current = 'select';
    expect(gestureApiRef.current!.placeShape({ x: 500, y: 300 })).toBe(false);
    toolRef.current = 'rectangle';
    expect(gestureApiRef.current!.placeShape({ x: 500, y: 300 })).toBe(true);
    expect(commit).toHaveBeenCalledOnce();
    const { node } = commit.mock.calls[0][0];
    expect(node.transform.translation.x + node.size.width / 2).toBe(500);
    expect(node.transform.translation.y + node.size.height / 2).toBe(300);
    expect(selectionRef.current.nodeIds).toEqual(['new']);
    expect(onToolChange).toHaveBeenLastCalledWith('select');
  });

  it('a second Enter steps off the first shape instead of stacking on it', () => {
    const size = defaultShapeSize('rectangle');
    const at = { x: 500 - size.width / 2, y: 300 - size.height / 2 };
    const { gestureApiRef, toolRef, commit } = setup([createTestNode('placed', {
      size, transform: { translation: at, rotationRadians: 0, scale: { x: 1, y: 1 } },
    })]);
    toolRef.current = 'rectangle';
    gestureApiRef.current!.placeShape({ x: 500, y: 300 });
    expect(commit.mock.calls[0][0].node.transform.translation).toEqual({ x: at.x + 24, y: at.y + 24 });
  });

  it('a keyboard pick in Shapes places the picked shape, whatever is armed', () => {
    const { gestureApiRef, commit } = setup();
    expect(gestureApiRef.current!.placeShape({ x: 0, y: 0 }, 'ellipse')).toBe(true);
    expect(commit.mock.calls[0][0].node.content.shape).toBe('ellipse');
  });

  it('connects exactly two selected shapes, first-selected to second, as one step', () => {
    const { gestureApiRef, commit, selectionRef, applyConnectorSelection } = setup([createTestNode('b')]);
    selectionRef.current = replaceSelection(['a']);
    expect(gestureApiRef.current!.connectSelection()).toBe(false);
    selectionRef.current = replaceSelection(['b', 'a']);
    expect(gestureApiRef.current!.connectSelection()).toBe(true);
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0]).toMatchObject({ kind: 'insert-connector', connector: { source: { nodeId: 'b' }, target: { nodeId: 'a' } } });
    expect(applyConnectorSelection).toHaveBeenLastCalledWith(['new']);
  });
});

// The bar is Figma, with tldraw/Excalidraw where they agree: modifiers held at
// the press count, and a modifier pressed or let go mid-drag updates the drag.
describe('V2 modifier conventions', () => {
  const shift = (base: ReactPointerEvent<HTMLElement>) => ({ ...base, shiftKey: true });
  const alt = (base: ReactPointerEvent<HTMLElement>) => ({ ...base, altKey: true });

  it('⇧ held before grabbing a corner still resizes, with the aspect locked', () => {
    const { result, event, host, selectionRef, commit } = setup();
    selectionRef.current = replaceSelection(['a']);
    host.pickTransformHandle.mockReturnValue('south-east');
    act(() => result.current.handlePointerDown(shift(event(100, 50))));
    act(() => result.current.handlePointerMove(shift(event(300, 60))));
    act(() => result.current.handlePointerUp(shift(event(300, 60))));
    expect(commit).toHaveBeenCalledOnce();
    const after = commit.mock.calls[0][0].after;
    expect(commit.mock.calls[0][0].label).toBe('Resize selection');
    expect(after.size.width / after.size.height).toBeCloseTo(2);
    expect(selectionRef.current.nodeIds).toEqual(['a']);
  });

  it('⌥ held before grabbing a corner resizes from the centre', () => {
    const { result, event, host, selectionRef, commit } = setup();
    selectionRef.current = replaceSelection(['a']);
    host.pickTransformHandle.mockReturnValue('south-east');
    act(() => result.current.handlePointerDown(alt(event(100, 50))));
    act(() => result.current.handlePointerUp(alt(event(120, 60))));
    expect(commit.mock.calls[0][0].after).toMatchObject({
      size: { width: 140, height: 70 }, transform: { translation: { x: -20, y: -10 } },
    });
  });

  it('⇧ held on an unselected shape adds it and drags the whole selection along one axis', () => {
    const b = createTestNode('b', { transform: { translation: { x: 300, y: 0 }, rotationRadians: 0, scale: { x: 1, y: 1 } } });
    const { result, event, host, selectionRef, commit } = setup([b]);
    selectionRef.current = replaceSelection(['a']);
    host.pickNode.mockReturnValue('b');
    act(() => result.current.handlePointerDown(shift(event(350, 25))));
    expect(selectionRef.current.nodeIds).toEqual(['a', 'b']);
    act(() => result.current.handlePointerMove(shift(event(410, 45))));
    act(() => result.current.handlePointerUp(shift(event(410, 45))));
    const moved = commit.mock.calls[0][0].commands.map((command: { after: { id: string; transform: { translation: unknown } } }) =>
      [command.after.id, command.after.transform.translation]);
    expect(moved).toEqual([['a', { x: 60, y: 0 }], ['b', { x: 360, y: 0 }]]);
  });

  it('⇧-click without a drag still toggles: a selected shape leaves the selection, nothing is written', () => {
    const { result, event, selectionRef, commit } = setup([createTestNode('b')]);
    selectionRef.current = replaceSelection(['a', 'b']);
    act(() => result.current.handlePointerDown(shift(event(50, 25))));
    act(() => result.current.handlePointerUp(shift(event(51, 25))));
    expect(selectionRef.current.nodeIds).toEqual(['b']);
    expect(commit).not.toHaveBeenCalled();
  });

  it('a plain click (no drag) on one shape of a multi-selection selects just that one; a drag moves them all', () => {
    const { result, event, selectionRef, commit } = setup([createTestNode('b')]);
    selectionRef.current = replaceSelection(['a', 'b']);
    act(() => result.current.handlePointerDown(event(50, 25)));
    act(() => result.current.handlePointerMove(event(90, 25)));
    act(() => result.current.handlePointerUp(event(90, 25)));
    expect(commit.mock.calls[0][0].commands).toHaveLength(2);
    expect(selectionRef.current.nodeIds).toEqual(['a', 'b']);
    act(() => result.current.handlePointerDown(event(50, 25)));
    act(() => result.current.handlePointerUp(event(50, 25)));
    expect(selectionRef.current.nodeIds).toEqual(['a']);
  });

  it('⇧-click on a line toggles it into the selection, the shapes kept', () => {
    const { result, event, host, selectionRef, applyConnectorSelection } = setup();
    selectionRef.current = replaceSelection(['a']);
    host.pickNode.mockReturnValue(null);
    host.pickConnector.mockReturnValue('edge');
    act(() => result.current.handlePointerDown(shift(event(300, 300))));
    expect(selectionRef.current.nodeIds).toEqual(['a']);
    expect(applyConnectorSelection).toHaveBeenLastCalledWith(['edge']);
    act(() => result.current.handlePointerDown(shift(event(300, 300))));
    expect(applyConnectorSelection).toHaveBeenLastCalledWith([]);
  });

  it('⌥-drag leaves the original and drops a copy where the drag ends, as one step, the copy selected', () => {
    const { result, event, selectionRef, commit, host } = setup();
    act(() => result.current.handlePointerDown(alt(event(50, 25))));
    act(() => result.current.handlePointerMove(alt(event(250, 25))));
    act(() => result.current.handlePointerUp(alt(event(250, 25))));
    expect(commit).toHaveBeenCalledOnce();
    const batch = commit.mock.calls[0][0];
    expect(batch.kind).toBe('batch');
    expect(batch.commands).toHaveLength(1);
    expect(batch.commands[0]).toMatchObject({ kind: 'insert-node', node: { id: 'new', transform: { translation: { x: 200, y: 0 } } } });
    expect(selectionRef.current.nodeIds).toEqual(['new']);
    expect(host.setTransformPreview).toHaveBeenLastCalledWith(null);
  });

  it('a modifier pressed mid-drag re-previews at once, without waiting for the next move', async () => {
    const { result, event, host } = setup();
    act(() => result.current.handlePointerDown(event(50, 25)));
    act(() => result.current.handlePointerMove(event(150, 45)));
    await flushFrame();
    expect(host.setTransformPreview.mock.calls.at(-1)?.[0].bounds).toMatchObject({ x: 100, y: 20 });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true })); });
    await flushFrame();
    expect(host.setTransformPreview.mock.calls.at(-1)?.[0].bounds).toMatchObject({ x: 100, y: 0 });
    act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', shiftKey: false })); });
    await flushFrame();
    expect(host.setTransformPreview.mock.calls.at(-1)?.[0].bounds).toMatchObject({ x: 100, y: 20 });
    act(() => result.current.handlePointerCancel());
  });

  it('drawing a shape: ⇧ makes it 1:1, ⌥ grows it from the press', () => {
    const { result, event, commit, toolRef } = setup();
    toolRef.current = 'rectangle';
    act(() => result.current.handlePointerDown(shift(event(100, 100))));
    act(() => result.current.handlePointerMove(shift(event(180, 130))));
    act(() => result.current.handlePointerUp(shift(event(180, 130))));
    expect(commit.mock.calls[0][0].node.size).toEqual({ width: 80, height: 80 });
    toolRef.current = 'ellipse';
    act(() => result.current.handlePointerDown(alt(event(100, 100))));
    act(() => result.current.handlePointerUp(alt(event(180, 130))));
    expect(commit.mock.calls[1][0].node).toMatchObject({
      size: { width: 160, height: 60 }, transform: { translation: { x: 20, y: 70 } },
    });
  });

  it('the connector tool with ⇧ draws a free end on the nearest 45°', () => {
    const { result, event, commit, toolRef, host } = setup();
    toolRef.current = 'connector';
    host.pickNode.mockReturnValue(null);
    act(() => result.current.handlePointerDown(event(0, 0)));
    act(() => result.current.handlePointerMove(shift(event(200, 30))));
    act(() => result.current.handlePointerUp(shift(event(200, 30))));
    const target = commit.mock.calls[0][0].connector.target;
    expect(target.nodeId).toBeNull();
    expect(target.point.x).toBeCloseTo(200);
    expect(target.point.y).toBeCloseTo(0);
  });

  it('the pen with ⇧ draws a straight line from where the stroke began', () => {
    const { result, event, commit, toolRef } = setup();
    toolRef.current = 'pen';
    act(() => result.current.handlePointerDown(event(0, 0)));
    act(() => result.current.handlePointerMove(shift(event(40, 30))));
    act(() => result.current.handlePointerMove(shift(event(100, 20))));
    act(() => result.current.handlePointerUp(shift(event(100, 20))));
    expect(commit.mock.calls[0][0].node.content.points).toEqual([{ x: 0, y: 0 }, { x: 100, y: 20 }]);
  });
});

// Figma: a click picks the whole group; a double-click enters it; once inside, clicks pick its members.
describe('V2 groups', () => {
  const group = () => [
    createTestNode('g', { kind: 'group' }),
    createTestNode('b', { parentId: 'g' }),
  ];
  const scoped = (_point: { x: number; y: number }, scope?: string | null) => (scope === 'g' ? 'b' : 'g');

  it('double-click on a group selects the member under the pointer, never opens an editor', () => {
    const { result, event, host, selectionRef, openEditor } = setup(group());
    host.pickNode.mockImplementation(scoped);
    act(() => result.current.handleDoubleClick(event(50, 25)));
    expect(selectionRef.current.nodeIds).toEqual(['b']);
    expect(openEditor).not.toHaveBeenCalled();
    // Inside the group, the next double-click is on the member itself: its label.
    act(() => result.current.handleDoubleClick(event(50, 25)));
    expect(openEditor).toHaveBeenCalledWith('b');
  });

  it('with a member selected, a click picks within the group', () => {
    const { result, event, host, selectionRef } = setup(group());
    host.pickNode.mockImplementation(scoped);
    selectionRef.current = replaceSelection(['b']);
    act(() => result.current.handlePointerDown(event(50, 25)));
    act(() => result.current.handlePointerUp(event(50, 25)));
    expect(selectionRef.current.nodeIds).toEqual(['b']);
    expect(host.pickNode).toHaveBeenCalledWith({ x: 50, y: 25 }, 'g');
  });
});

describe('enteredGroup', () => {
  it('is the group every selected node sits directly in, else null', () => {
    const page = createTestDocument({ nodes: [
      createTestNode('g', { kind: 'group' }), createTestNode('b', { parentId: 'g' }), createTestNode('c', { parentId: 'g' }),
      createTestNode('s', { kind: 'section' }), createTestNode('d', { parentId: 's' }), createTestNode('e'),
    ] }).pages[0];
    expect(enteredGroup(page, ['b', 'c'])).toBe('g');
    expect(enteredGroup(page, ['b', 'e'])).toBeNull();
    expect(enteredGroup(page, ['d'])).toBeNull();
    expect(enteredGroup(page, [])).toBeNull();
  });
});

describe('the comment tool', () => {
  const click = (s: ReturnType<typeof setup>, x: number, y: number, target?: HTMLElement, button = 0) => {
    act(() => s.result.current.handlePointerDown(s.event(x, y, target, button)));
    act(() => s.result.current.handlePointerUp(s.event(x, y, target, button)));
  };

  it('a click on the canvas asks for a comment where it landed, and changes nothing else', () => {
    const s = setup();
    s.toolRef.current = 'comment';
    click(s, 120, 80);
    expect(s.onCommentClick).toHaveBeenCalledExactlyOnceWith({ x: 120, y: 80 });
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.selectionRef.current.nodeIds).toEqual([]);
  });

  it('a drag, a press on a control in the canvas, Space-pan and a middle-button pan never start a comment', () => {
    const s = setup();
    s.toolRef.current = 'comment';
    act(() => s.result.current.handlePointerDown(s.event(100, 100)));
    act(() => s.result.current.handlePointerMove(s.event(130, 100)));
    act(() => s.result.current.handlePointerUp(s.event(130, 100)));
    const button = document.createElement('button');
    s.section.append(button);
    click(s, 100, 100, button);
    s.spacePanRef.current = true;
    click(s, 100, 100);
    expect(s.updateCamera).not.toHaveBeenCalled();
    s.spacePanRef.current = false;
    click(s, 100, 100, undefined, 1);
    expect(s.onCommentClick).not.toHaveBeenCalled();
  });
});
