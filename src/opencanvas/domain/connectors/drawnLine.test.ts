import { afterEach, describe, expect, it } from 'vitest';
import type { SceneConnector } from '../document/types';
import type { DrawnPart } from '../nodes/drawnShape';
import { drawnLineOf, drawnLineParts, keepsLook, provideDrawnLines } from './drawnLine';

const part: DrawnPart = { path: [{ kind: 'move', x: 0, y: 0 }, { kind: 'line', x: 100, y: 0 }], fill: 'fill', stroke: 'stroke', strokeWidth: 2, dash: [], fillOpacity: 1, strokeOpacity: 1 };
const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
const saved = { style: { shape: 'flexArrow' }, fill: '#cccccc', points, parts: [part] };
const connector = (drawioLine: unknown) => ({ extensions: { drawioLine } }) as unknown as Pick<SceneConnector, 'extensions'>;

afterEach(() => provideDrawnLines(null));

describe('drawnLineOf', () => {
  it('reads the draw.io line a connector keeps, and nothing from an ordinary one', () => {
    expect(drawnLineOf(connector(saved))).toEqual(saved);
    expect(drawnLineOf(connector(undefined))).toBeNull();
    expect(drawnLineOf(connector({ style: {}, fill: 1 }))).toBeNull();
  });
});

describe('drawnLineParts', () => {
  it('draws the saved parts on the saved route, and moved with it when the whole line moves', () => {
    expect(drawnLineParts(saved, points)).toEqual([part]);
    expect(drawnLineParts(saved, points.map(({ x, y }) => ({ x: x + 10, y: y + 5 })))![0]!.path).toEqual([{ kind: 'move', x: 10, y: 5 }, { kind: 'line', x: 110, y: 5 }]);
  });

  it('draws a line that saved no drawing plain, until draw.io\'s code is to hand', () => {
    expect(drawnLineParts({ ...saved, parts: [] }, points)).toBeNull();
  });

  it('draws a line whose route changed shape plain, unless draw.io\'s code can redraw it', () => {
    const bent = [{ x: 0, y: 0 }, { x: 50, y: 50 }];
    expect(drawnLineParts(saved, bent)).toBeNull();
    provideDrawnLines((style, at) => [{ ...part, path: at.map((point, index) => ({ kind: index ? 'line' : 'move', ...point })) }]);
    expect(drawnLineParts(saved, bent)![0]!.path).toEqual([{ kind: 'move', x: 0, y: 0 }, { kind: 'line', x: 50, y: 50 }]);
  });
});

describe('keepsLook', () => {
  const look = { width: 1, dash: [], start: [], end: ['triangle-filled'] };
  it('keeps draw.io drawing a line until its width, dash or ends change here; a shaped line always', () => {
    expect(keepsLook(look, { ...look })).toBe(true);
    expect(keepsLook(look, { ...look, width: 3 })).toBe(false);
    expect(keepsLook(look, { ...look, dash: [6, 4] })).toBe(false);
    expect(keepsLook(look, { ...look, end: ['circle'] })).toBe(false);
    expect(keepsLook(undefined, { ...look, width: 3 })).toBe(true);
  });

  it('reads the look a line was imported with', () => {
    expect(drawnLineOf(connector({ ...saved, look }))).toMatchObject({ look });
  });
});
