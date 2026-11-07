import {
  describe, expect, it } from 'vitest';
import {
  drawioColor, drawioDarkInk, drawioStyleLosses, drawioConnectorAppearance, drawioErRelation, drawioImageUrl, drawioLabel, drawioNodeAppearance, drawioShape, drawioShapeName, parseDrawioStyle,
} from './drawioStyle';

describe('draw.io styles', () => {
  it('reads a style string, a bare word being the base shape', () => {
    const style = parseDrawioStyle('ellipse;fillColor=#FFF;;whiteSpace=wrap');
    expect(style).toEqual({ ellipse: '', fillColor: '#FFF', whiteSpace: 'wrap' });
    expect(drawioShapeName(style)).toBe('ellipse');
    expect(drawioShapeName(parseDrawioStyle('rounded=1;shape=cylinder3'))).toBe('cylinder3');
  });

  it('turns draw.io shapes into ours, and names the ones it cannot', () => {
    const shape = (style: string, width = 80, height = 40) => drawioShape(parseDrawioStyle(style), width, height);
    expect(shape('rounded=1;')).toEqual({ kind: 'rounded' });
    expect(shape('shape=rect;')).toEqual({ kind: 'rectangle' });
    expect(shape('rhombus;')).toEqual({ kind: 'diamond' });
    expect(shape('ellipse;', 40, 40)).toEqual({ kind: 'circle' });
    expect(shape('shape=mxgraph.bootstrap.rrect;')).toEqual({ kind: 'rounded' });
    expect(shape('shape=mxgraph.bootstrap.checkbox;')).toEqual({ kind: 'rectangle' });
    expect(shape('text;')).toEqual({ kind: 'text' });
    expect(shape('shape=mxgraph.flowchart.decision;')).toEqual({ kind: 'diamond' });
    expect(shape('shape=mxgraph.flowchart.on-page_reference;')).toEqual({ kind: 'circle' });
    expect(shape('shape=mxgraph.aws4.lambda_function;')).toEqual({ kind: 'rectangle', unknown: 'mxgraph.aws4.lambda_function' });
  });

  it('finds the picture a cell shows, if a browser can load it', () => {
    const image = (value: string) => drawioImageUrl(parseDrawioStyle(`shape=image;image=${value}`));
    // A style can't hold `;`, so draw.io leaves `;base64` off embedded pictures; a browser needs it back.
    expect(image('data:image/svg+xml,PHN2Zy8+')).toBe('data:image/svg+xml;base64,PHN2Zy8+');
    expect(image('data:image/png,iVBOR')).toBe('data:image/png;base64,iVBOR');
    expect(image('data:image/svg+xml,%3Csvg%2F%3E')).toBe('data:image/svg+xml,%3Csvg%2F%3E');
    expect(image('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(image('img/lib/ibm/vpc/Router.svg')).toBeNull();
    expect(drawioImageUrl({})).toBeNull();
  });

  it('keeps hex colours, makes none transparent, and drops the rest', () => {
    expect(drawioColor('#AbC')).toBe('#abc');
    expect(drawioColor('none')).toBe('transparent');
    expect(drawioColor('default')).toBeUndefined();
    expect(drawioColor(undefined)).toBeUndefined();
  });

  it('carries paint, type and label placement; unset paint is left to the theme', () => {
    expect(drawioNodeAppearance(parseDrawioStyle('fillColor=#dae8fc;fontStyle=3;fontSize=16;dashed=1;opacity=50'))).toEqual({
      fill: '#dae8fc', fontWeight: 700, fontStyle: 'italic', fontSize: 16, strokeStyle: 'dashed', opacity: 0.5, textPadding: 2,
    });
    expect(drawioNodeAppearance(parseDrawioStyle('align=left;spacingLeft=10;verticalAlign=top'))).toEqual({
      textAlign: 'start', textVerticalAlign: 'top', textPadding: 12,
    });
    // A centred label's one-sided spacing doesn't squeeze it from both sides.
    expect(drawioNodeAppearance(parseDrawioStyle('spacingRight=30')).textPadding).toBe(2);
    expect(drawioNodeAppearance(parseDrawioStyle('shape=mxgraph.bootstrap.anchor;fillColor=#fff'))).toMatchObject({ fill: 'transparent', stroke: 'transparent' });
  });

  it('gives edges draw.io’s arrow unless told otherwise', () => {
    expect(drawioConnectorAppearance({})).toEqual({ markerEnd: 'arrow' });
    expect(drawioConnectorAppearance(parseDrawioStyle('endArrow=none;startArrow=oval;dashed=1;strokeColor=#f00'))).toEqual({
      markerStart: 'circle', dashPattern: 'dashed', stroke: '#f00',
    });
  });

  it('reads crow’s-foot ends as the relation our entity diagrams draw', () => {
    expect(drawioErRelation(parseDrawioStyle('startArrow=ERoneToMany;endArrow=ERmandOne'))).toBe('}|--||');
    expect(drawioErRelation(parseDrawioStyle('startArrow=ERzeroToOne;endArrow=ERzeroToMany;dashed=1'))).toBe('|o..o{');
    expect(drawioErRelation(parseDrawioStyle('startArrow=ERmandOne'))).toBeNull();
    expect(drawioErRelation({})).toBeNull();
  });

  it('reads an html label as plain text with its line breaks', () => {
    const html = parseDrawioStyle('html=1');
    expect(drawioLabel('<b>Take</b><br>pay&amp;ment&nbsp;now', html)).toBe('Take\npay&ment now');
    expect(drawioLabel('<p>One</p><p>Two</p>', html)).toBe('One\nTwo');
    expect(drawioLabel('Central<div>Management</div><div>Service</div>', html)).toBe('Central\nManagement\nService');
    expect(drawioLabel('One<br><br>Two', html)).toBe('One\n\nTwo');
    expect(drawioLabel('  <b>as written</b> ', {})).toBe('<b>as written</b>');
  });

  it('reads an html label the way a browser lays it out', () => {
    const html = { html: '1' };
    expect(drawioLabel('one\n  two   three', html)).toBe('one two three');
    expect(drawioLabel('<ul><li>Apples</li><li>Pears</li></ul>', html)).toBe('Apples\nPears');
    expect(drawioLabel('<style>b{color:red}</style><script>alert(1)</script>Kept', html)).toBe('Kept');
    expect(drawioLabel('&lt;b&gt; stays text', html)).toBe('<b> stays text');
    expect(drawioLabel('plain\nkeeps lines', {})).toBe('plain\nkeeps lines');
  });

  it('reads a hostile html label in linear time', () => {
    const started = performance.now();
    expect(drawioLabel('<'.repeat(200_000), { html: '1' })).toBe('<'.repeat(200_000));
    expect(drawioLabel('<script>'.repeat(50_000) + 'x', { html: '1' })).toBe('');
    expect(drawioLabel('<style></style>'.repeat(50_000) + 'y', { html: '1' })).toBe('y');
    drawioLabel('<div>'.repeat(100_000) + '&amp;'.repeat(100_000), { html: '1' });
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('drawioDarkInk', () => {
  it('knows the near-black greys draw.io writes for a light page, in any case', () => {
    for (const ink of ['#000', '#000000', '#333333', '#555555', '#2B2B2B']) expect(drawioDarkInk(ink), ink).toBe(true);
    for (const ink of ['#666666', '#1c2b55', '#ff0000', 'default', 'none', undefined, 7]) expect(drawioDarkInk(ink), String(ink)).toBe(false);
  });

  it('leaves draw.io’s default black lines unset and keeps picked ones', () => {
    expect(drawioNodeAppearance({ strokeColor: '#000000' }).stroke).toBeUndefined();
    expect(drawioNodeAppearance({ strokeColor: '#B85450' }).stroke).toBe('#b85450');
    expect(drawioConnectorAppearance({ strokeColor: '#000' }).stroke).toBeUndefined();
    expect(drawioConnectorAppearance({ strokeColor: '#333333' }).stroke).toBeUndefined();
    expect(drawioConnectorAppearance({ strokeColor: '#666666' }).stroke).toBe('#666666');
  });
});

describe('drawioStyleLosses', () => {
  it('names each style a shape or line has that we don’t draw', () => {
    expect(drawioStyleLosses(parseDrawioStyle('rounded=1;fillColor=#dae8fc;strokeColor=default;fontColor=none;fillColor2=x;fontFamily=Helvetica;'), 'shape')).toEqual([]);
    expect(drawioStyleLosses(parseDrawioStyle(
      'gradientColor=#7ea6e0;shadow=1;sketch=1;fillStyle=hatch;glass=1;fillColor=light-dark(#fff,#000);fontFamily=Comic Sans MS;'), 'shape')).toEqual([
      'gradient fills are drawn solid', 'shadows are left off', 'the hand-drawn sketch look is drawn clean',
      'hatched and patterned fills are drawn solid', 'the glass shine is left off',
      'colours not written as #hex use the theme’s instead', 'the “Comic Sans MS” font is drawn in ours',
    ]);
    expect(drawioStyleLosses(parseDrawioStyle('gradientColor=default;'), 'shape')).toEqual([]);
    expect(drawioStyleLosses(parseDrawioStyle('gradientColor=none;shadow=0;fillStyle=solid;fillStyle=auto;'), 'shape')).toEqual([]);
  });

  it('names arrow heads we don’t draw, and only those', () => {
    const heads = (style: string) => drawioStyleLosses(parseDrawioStyle(style), 'connector');
    expect(heads('endArrow=classic;startArrow=block;')).toEqual([]);
    expect(heads('endArrow=open;startArrow=oval;')).toEqual([]);
    expect(heads('endArrow=diamondThin;startArrow=cross;')).toEqual([]);
    expect(heads('endArrow=circle;startArrow=circlePlus;')).toEqual([]);
    expect(drawioConnectorAppearance(parseDrawioStyle('endArrow=circle;startArrow=circlePlus;'))).toMatchObject({ markerEnd: 'circle', markerStart: 'circle' });
    // Entity-relation ends are drawn as a pair; one on its own is drawn as an arrow, and says so.
    expect(heads('endArrow=ERmany;startArrow=ERmandOne;')).toEqual([]);
    expect(heads('endArrow=ERmany;')).toEqual(['draw.io’s “ERmany” arrow head is drawn as an arrow']);
    expect(heads('endArrow=dash;startArrow=halfCircle;')).toEqual([
      'draw.io’s “dash” arrow head is drawn as an arrow', 'draw.io’s “halfCircle” arrow head is drawn as an arrow',
    ]);
  });

  it('reads a hostile style in linear time', () => {
    const style = parseDrawioStyle(Array.from({ length: 100_000 }, (_, i) => `k${i}=v`).join(';') + ';shadow=1');
    const started = performance.now();
    expect(drawioStyleLosses(style, 'shape')).toEqual(['shadows are left off']);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
