import {
  describe, expect, it } from 'vitest';
import {
  drawioColor, drawioDarkInk, drawioStyleLosses, drawioConnectorAppearance, drawioErRelation, drawioImageUrl, drawioLabel, drawioNodeAppearance, drawioShape, drawioShapeName, resolveDrawioStyle,
} from './drawioStyle';

// A style with none of draw.io's defaults under it (a leading `;`), so each test sees only its own keys.
const parseDrawioStyle = (style: string) => resolveDrawioStyle(`;${style}`, 'vertex');

describe('draw.io styles', () => {
  it('reads a style string, a bare word being the base shape', () => {
    const style = parseDrawioStyle('ellipse;fillColor=#FFF;;whiteSpace=wrap');
    expect(style).toEqual({ shape: 'ellipse', perimeter: 'ellipsePerimeter', ellipse: '', fillColor: '#FFF', whiteSpace: 'wrap' });
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
      fill: '#dae8fc', fontWeight: 700, fontStyle: 'italic', fontSize: 16, strokeStyle: 'dashed', opacity: 0.5, textPadding: 2, darkColors: 'invert',
    });
    expect(drawioNodeAppearance(parseDrawioStyle('align=left;spacingLeft=10;verticalAlign=top'))).toEqual({
      textAlign: 'start', textVerticalAlign: 'top', textPadding: 12, fontWeight: 400, darkColors: 'invert',
    });
    // A centred label's one-sided spacing doesn't squeeze it from both sides.
    expect(drawioNodeAppearance(parseDrawioStyle('spacingRight=30')).textPadding).toBe(2);
    expect(drawioNodeAppearance(parseDrawioStyle('shape=mxgraph.bootstrap.anchor;fillColor=#fff'))).toMatchObject({ fill: 'transparent', stroke: 'transparent' });
  });

  it('gives edges draw.io’s arrow unless told otherwise', () => {
    const drawn = { darkColors: 'invert', cornerRadius: 10, labelBorder: 'transparent', labelFontSize: 11 };
    expect(drawioConnectorAppearance({})).toEqual({ markerEnd: 'triangle-filled', ...drawn });
    expect(drawioConnectorAppearance(parseDrawioStyle('endArrow=none;startArrow=oval;dashed=1;strokeColor=#f00'))).toEqual({
      markerStart: 'circle', dashPattern: 'dashed', stroke: '#f00', ...drawn,
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
    // A break that ends a cell or paragraph starts no line; a table's rows are lines, its cells side by side (database_3).
    expect(drawioLabel('<table><tr><td>PK</td><td>uniqueId</td></tr><tr><td>FK1<br></td><td>foreignKey<br></td></tr></table>', html)).toBe('PK uniqueId\nFK1 foreignKey');
    expect(drawioLabel('<p>field4<br></p><p>field5</p>', html)).toBe('field4\nfield5');
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

describe('fill, line and shadow', () => {
  it('sees a fill and a line through by their own opacity, and keeps the shadow', () => {
    expect(drawioNodeAppearance(parseDrawioStyle('fillColor=#ff0000;fillOpacity=50;strokeColor=#00f;strokeOpacity=0;shadow=1;'))).toMatchObject({
      fill: '#ff000080', stroke: '#0000ff00', shadow: true,
    });
    // Fully seen, or the theme's own colour, stays as it is.
    expect(drawioNodeAppearance(parseDrawioStyle('fillColor=#ff0000;fillOpacity=100;strokeOpacity=40;'))).not.toHaveProperty('stroke');
    expect(drawioNodeAppearance(parseDrawioStyle('fillColor=#ff0000;fillOpacity=100;')).fill).toBe('#ff0000');
  });

  it('casts draw.io’s shadow, with its defaults where the shape sets none', () => {
    expect(drawioNodeAppearance(parseDrawioStyle('shadow=1;'))).toMatchObject({
      shadow: true, shadowColor: '#000000', shadowOffsetX: 2, shadowOffsetY: 3, shadowBlur: 1, shadowOpacity: 0.25,
    });
    expect(drawioNodeAppearance(parseDrawioStyle('shadow=1;shadowColor=#FF0000;shadowOffsetX=-4;shadowOffsetY=6;shadowBlur=8;shadowOpacity=60;'))).toMatchObject({
      shadowColor: '#ff0000', shadowOffsetX: -4, shadowOffsetY: 6, shadowBlur: 4, shadowOpacity: 0.6,
    });
    expect(drawioNodeAppearance(parseDrawioStyle('shadow=0;shadowColor=#ff0000;'))).not.toHaveProperty('shadowColor');
  });

  it('runs a gradient from the fill to its colour, in draw.io’s direction', () => {
    expect(drawioNodeAppearance(parseDrawioStyle('fillColor=#dae8fc;gradientColor=#7ea6e0;'))).toMatchObject({ gradientColor: '#7ea6e0' });
    expect(drawioNodeAppearance(parseDrawioStyle('fillColor=#dae8fc;gradientColor=#7ea6e0;'))).not.toHaveProperty('gradientDirection');
    expect(drawioNodeAppearance(parseDrawioStyle('gradientColor=#7ea6e0;gradientDirection=radial;')).gradientDirection).toBe('radial');
    expect(drawioNodeAppearance(parseDrawioStyle('fillColor=none;gradientColor=#7ea6e0;'))).not.toHaveProperty('gradientColor');
    expect(drawioStyleLosses(parseDrawioStyle('gradientColor=#7ea6e0;'), 'shape')).toEqual([]);
  });

  it('fades a line by its own opacity times the cell’s', () => {
    expect(drawioConnectorAppearance(parseDrawioStyle('opacity=50;strokeOpacity=50;')).opacity).toBe(0.25);
    expect(drawioConnectorAppearance(parseDrawioStyle('strokeOpacity=100;'))).not.toHaveProperty('opacity');
  });
});

describe('drawioStyleLosses', () => {
  it('names each style a shape or line has that we don’t draw', () => {
    expect(drawioStyleLosses(parseDrawioStyle('rounded=1;fillColor=#dae8fc;strokeColor=default;fontColor=none;fillColor2=x;fontFamily=Helvetica;'), 'shape')).toEqual([]);
    expect(drawioStyleLosses(parseDrawioStyle(
      'gradientColor=default;shadow=1;sketch=1;fillStyle=hatch;glass=1;fillColor=light-dark(#fff,#000);fontFamily=Comic Sans MS;'), 'shape')).toEqual([
      'gradient fills are drawn solid', 'the hand-drawn sketch look is drawn clean',
      'hatched and patterned fills are drawn solid', 'the glass shine is left off',
      'colours not written as #hex use the theme’s instead', 'the “Comic Sans MS” font is drawn in ours',
    ]);
    // `default` fades to the page's colour: draw.io draws it as a gradient too.
    expect(drawioStyleLosses(parseDrawioStyle('gradientColor=default;'), 'shape')).toEqual(['gradient fills are drawn solid']);
    expect(drawioStyleLosses(parseDrawioStyle('gradientColor=none;shadow=0;fillStyle=solid;fillStyle=auto;'), 'shape')).toEqual([]);
  });

  it('draws each arrow head as the glyph closest to draw.io’s, hollow when its fill is off', () => {
    const ends = (style: string) => {
      const appearance = drawioConnectorAppearance(parseDrawioStyle(style));
      return [appearance.markerStart, appearance.markerEnd];
    };
    expect(ends('startArrow=block;endArrow=classic;')).toEqual(['triangle-filled', 'triangle-filled']);
    expect(ends('startArrow=block;startFill=0;endArrow=blockThin;endFill=0;')).toEqual(['triangle-open', 'triangle-open']);
    expect(ends('startArrow=open;endArrow=openThin;')).toEqual(['arrow', 'arrow']);
    expect(ends('startArrow=diamondThin;endArrow=diamond;endFill=0;')).toEqual(['diamond-filled', 'diamond-open']);
    expect(ends('startArrow=ERmandOne;endArrow=ERzeroToMany;')).toEqual(['bar bar', 'crow-foot circle']);
  });

  it('names arrow heads we don’t draw, and only those', () => {
    const heads = (style: string) => drawioStyleLosses(parseDrawioStyle(style), 'connector');
    expect(heads('endArrow=classic;startArrow=block;')).toEqual([]);
    expect(heads('endArrow=open;startArrow=oval;')).toEqual([]);
    expect(heads('endArrow=diamondThin;startArrow=cross;')).toEqual([]);
    expect(heads('endArrow=circle;startArrow=circlePlus;')).toEqual([]);
    expect(drawioConnectorAppearance(parseDrawioStyle('endArrow=circle;startArrow=circlePlus;'))).toMatchObject({ markerEnd: 'circle', markerStart: 'circle' });
    // Entity-relation ends are drawn as a pair, or on their own as their glyphs.
    expect(heads('endArrow=ERmany;startArrow=ERmandOne;')).toEqual([]);
    expect(heads('endArrow=ERmany;')).toEqual([]);
    expect(heads('endArrow=dash;startArrow=halfCircle;')).toEqual([
      'draw.io’s “dash” arrow head is drawn as a filled triangle', 'draw.io’s “halfCircle” arrow head is drawn as a filled triangle',
    ]);
  });

  it('reads a hostile style in linear time', () => {
    const style = parseDrawioStyle(Array.from({ length: 100_000 }, (_, i) => `k${i}=v`).join(';') + ';glass=1');
    const started = performance.now();
    expect(drawioStyleLosses(style, 'shape')).toEqual(['the glass shine is left off']);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
