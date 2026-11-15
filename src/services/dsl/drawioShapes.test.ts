import { beforeAll, describe, expect, it } from 'vitest';
import { loadDrawioShapes, type DrawioPathCommand, type DrawioShapes } from './drawioShapes';

let shapes: DrawioShapes;
beforeAll(async () => { shapes = await loadDrawioShapes(); });

const points = (path: readonly DrawioPathCommand[]) => path.flatMap((command) => (command.kind === 'close' ? [] : [[command.kind, Math.round(command.x * 100) / 100, Math.round(command.y * 100) / 100]]));

describe('draw.io’s shapes, drawn by draw.io’s own code', () => {
  it('draws a note with its corner folded by its size, and the fold as a second part', () => {
    const note = shapes.draw({ shape: 'note' }, 120, 80)!;
    expect(points(note.parts[0]!.path)).toEqual([['move', 0, 0], ['line', 90, 0], ['line', 120, 30], ['line', 120, 80], ['line', 0, 80], ['line', 0, 0]]);
    expect(note.parts[0]).toMatchObject({ fill: 'fill', stroke: 'stroke', strokeWidth: 1 });
    expect(points(note.parts[1]!.path)).toEqual([['move', 90, 0], ['line', 90, 30], ['line', 120, 30]]);
    // draw.io's `size` setting moves the fold.
    expect(points(shapes.draw({ shape: 'note', size: '10' }, 120, 80)!.parts[0]!.path)[1]).toEqual(['line', 110, 0]);
  });

  it('keeps fixed-size parts fixed when the shape grows', () => {
    const fold = (width: number) => points(shapes.draw({ shape: 'note' }, width, 80)!.parts[1]!.path);
    expect(fold(400)).toEqual([['move', 370, 0], ['line', 370, 30], ['line', 400, 30]]);
  });

  it('draws curves as curves, from draw.io’s cylinder', () => {
    const kinds = shapes.draw({ shape: 'cylinder3' }, 60, 80)!.parts.flatMap((part) => part.path.map((command) => command.kind));
    expect(kinds).toContain('cubic');
  });

  it('turns a shape by its direction, about its centre, as draw.io does', () => {
    const east = shapes.draw({ shape: 'triangle' }, 100, 100)!.parts[0]!.path;
    const south = shapes.draw({ shape: 'triangle', direction: 'south' }, 100, 100)!.parts[0]!.path;
    // East points right (its tip at x = 100); south points down (its tip at y = 100).
    expect(Math.max(...points(east).map(([, x]) => x as number))).toBeCloseTo(100);
    expect(points(south).some(([, x, y]) => Math.abs((x as number) - 50) < 0.01 && Math.abs((y as number) - 100) < 0.01)).toBe(true);
  });

  it('paints the node’s own colours as roles, and the shape’s own colours as themselves', () => {
    const parts = shapes.draw({ shape: 'mxgraph.aws4.group', grIcon: 'mxgraph.aws4.group_aws_cloud' }, 200, 120)!.parts;
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.some((part) => part.stroke === 'stroke' || part.fill === 'fill')).toBe(true);
    expect(shapes.draw({ shape: 'note', fillColor: 'none' }, 120, 80)!.parts[0]!.fill).toBeNull();
  });

  it('knows every shape draw.io draws in code, and nothing else', () => {
    expect(shapes.has('note')).toBe(true);
    expect(shapes.has('mxgraph.mockup.containers.browserWindow')).toBe(true);
    expect(shapes.has('mxgraph.nowhere.at_all')).toBe(false);
    expect(shapes.draw({ shape: 'mxgraph.nowhere.at_all' }, 10, 10)).toBeNull();
  });

  it('draws the shapes ordinary diagrams use', () => {
    const names = 'note,card,cube,tape,document,step,process,delay,curlyBracket,umlLifeline,umlFrame,parallelogram,trapezoid,cylinder3,datastore,internalStorage,manualInput,offPageConnector,or,xor,mxgraph.basic.rect,mxgraph.bpmn.task,mxgraph.mockup.containers.browserWindow,mxgraph.android.tabBar,mxgraph.floorplan.wall'.split(',');
    for (const name of names) expect(shapes.draw({ shape: name }, 120, 80)?.parts.length ?? 0, name).toBeGreaterThan(0);
  });

  it('draws all but a known few of the shapes draw.io registers, with no setting at all', () => {
    let drawn = 0;
    for (const name of shapes.names()) {
      try { if ((shapes.draw({ shape: name }, 120, 80)?.parts.length ?? 0) > 0) drawn += 1; } catch { /* counted as not drawn */ }
    }
    // 832 registered: lines (connector, flexArrow, pipe…), invisible anchors, shapes needing a setting, and a
    // few needing their diagram are the rest. A drop means the stand-in for draw.io's editor broke something.
    expect(shapes.names().length).toBe(832);
    expect(drawn).toBeGreaterThanOrEqual(785);
  });
});

describe('a sequence diagram, routed and outlined by draw.io’s own code', () => {
  const lifeline = (id: string, x: number) => `<mxCell id="${id}" value="${id}" style="shape=umlLifeline;perimeter=lifelinePerimeter;container=1;size=40;" vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="100" height="300" as="geometry"/></mxCell>`;
  const open = async (message: string) => {
    const { drawioToDocument } = await import('./drawio');
    const file = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${lifeline('a', 0)}${lifeline('b', 200)}${message}</root></mxGraphModel>`;
    const result = await drawioToDocument(file, 'doc', '2026-11-13T00:00:00.000Z', { index: async () => null, library: async () => null });
    if ('error' in result) throw new Error(result.error);
    return result;
  };

  it('draws a message level at its saved height, ending on each lifeline’s dashed spine', async () => {
    const { document, losses } = await open('<mxCell id="m" style="endArrow=block;edgeStyle=sequenceEdgeStyle;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="150" y="150"/></Array></mxGeometry></mxCell>');
    expect(losses).toEqual([]);
    const message = document.pages[0]!.connectors[0]!;
    // The spine is the lifeline's middle, less draw.io's half-pixel line offset; the height is the saved 150 of 300.
    expect(message.source.anchor).toEqual({ kind: 'normalized', x: 0.495, y: 0.5 });
    expect(message.target.anchor).toEqual({ kind: 'normalized', x: 0.495, y: 0.5 });
    expect(message.waypoints).toEqual([{ x: 150, y: 150 }]);
  });

  it('draws a message with no saved height level, midway down the lifelines', async () => {
    const { document } = await open('<mxCell id="m" style="edgeStyle=sequenceEdgeStyle;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>');
    const message = document.pages[0]!.connectors[0]!;
    expect(message.source.anchor).toMatchObject({ y: 0.5 });
    expect(message.target.anchor).toMatchObject({ y: 0.5 });
  });
});

describe('draw.io’s label card', () => {
  it('is a box with its picture inside, where draw.io’s own code places it, and its words beside the picture', async () => {
    const { drawioToDocument } = await import('./drawio');
    const file = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="p" value="Tessa Miller" style="label;image=https://example.com/face.svg;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="100" y="50" width="180" height="70" as="geometry"/></mxCell>
    </root></mxGraphModel>`;
    const result = await drawioToDocument(file, 'doc', '2026-11-13T00:00:00.000Z', { index: async () => null, library: async () => null });
    if ('error' in result) throw new Error(result.error);
    const nodes = result.document.pages[0]!.nodes;
    const card = nodes.find((node) => node.id === 'p')!;
    const picture = nodes.find((node) => node.id === 'p:image')!;
    expect(card.kind).not.toBe('image');
    expect(card.size).toEqual({ width: 180, height: 70 });
    // spacing 2 + 5 in from the left, centred down the card; 42 px square (the label style's imageWidth/Height).
    expect(picture).toMatchObject({ kind: 'image', parentId: 'p', size: { width: 42, height: 42 }, content: { imageUrl: 'https://example.com/face.svg' } });
    expect(picture.transform.translation).toEqual({ x: 7, y: 14 });
    // The words start past the picture: left-aligned, 52 px in (the label style's spacingLeft).
    expect(card.appearance).toMatchObject({ textAlign: 'start' });
  });
});

describe('what draw.io’s code draws, kept to numbers a document holds', () => {
  it('rounds a corner by one radius both ways, and drops nothing from a shape drawn in full', () => {
    const parts = shapes.draw({ shape: 'mxgraph.bootstrap.rrect' }, 25, 16)!.parts;
    expect(parts.length).toBeGreaterThan(0);
    expect(JSON.stringify(parts)).not.toMatch(/null|NaN/);
  });
});

describe('a turned draw.io shape', () => {
  it('is drawn unturned: the node carries the turn, as every OpenFlowKit shape does', () => {
    const plain = shapes.draw({ shape: 'mxgraph.floorplan.wallU' }, 120, 240)!.parts[0]!.path;
    expect(shapes.draw({ shape: 'mxgraph.floorplan.wallU', rotation: '90' }, 120, 240)!.parts[0]!.path).toEqual(plain);
  });
});

describe('draw.io’s lines with a shape of their own, drawn along their points', () => {
  const along = [{ x: 0, y: 0 }, { x: 200, y: 0 }];

  it('draws a block arrow as a filled outline around the line, in the line’s own fill and colour', () => {
    const parts = shapes.drawLine({ shape: 'flexArrow', fillColor: '#ff0000', strokeColor: '#000000' }, along)!;
    expect(parts.length).toBeGreaterThan(0);
    expect(parts[0]).toMatchObject({ fill: 'fill', stroke: 'stroke' });
    const ys = parts[0]!.path.flatMap((command) => (command.kind === 'close' ? [] : [command.y]));
    // The arrow is a band either side of the line, not the line itself.
    expect(Math.min(...ys)).toBeLessThan(-2);
    expect(Math.max(...ys)).toBeGreaterThan(2);
  });

  it('draws a stencil-free code line (a network link) and leaves an unknown or point-less one undrawn', () => {
    expect(shapes.drawLine({ shape: 'link' }, along)?.length).toBeGreaterThan(0);
    expect(shapes.drawLine({ shape: 'no.such.line' }, along)).toBeNull();
    expect(shapes.drawLine({ shape: 'flexArrow' }, [{ x: 0, y: 0 }])).toBeNull();
  });
});
