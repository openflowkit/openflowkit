import { describe, expect, it } from 'vitest';
import { resolveDrawioStyle } from './drawioStyle';

// draw.io reads a cell's style over its built-in sheet (mxStylesheet.getCellStyle); these are its rules.
describe('resolveDrawioStyle', () => {
  it('starts a shape from draw.io’s default shape style and a connector from its default connector style', () => {
    expect(resolveDrawioStyle('', 'vertex')).toMatchObject({ align: 'center', verticalAlign: 'middle', fontSize: '12', fontFamily: 'Helvetica' });
    expect(resolveDrawioStyle('', 'edge')).toMatchObject({ rounded: '1', fontSize: '11', endArrow: 'classic', labelBackgroundColor: 'default' });
  });

  it('merges a named style where its word stands, and keeps the word', () => {
    expect(resolveDrawioStyle('text;html=1;', 'vertex')).toMatchObject({ text: '', align: 'left', verticalAlign: 'top', fillColor: 'none', html: '1' });
    expect(resolveDrawioStyle('image;image=a.png;', 'vertex')).toMatchObject({ shape: 'image', verticalLabelPosition: 'bottom', verticalAlign: 'top' });
    expect(resolveDrawioStyle('swimlane;', 'vertex')).toMatchObject({ shape: 'swimlane', startSize: '23', fontStyle: '1' });
    expect(resolveDrawioStyle('ellipse;', 'vertex')).toMatchObject({ ellipse: '', shape: 'ellipse', perimeter: 'ellipsePerimeter' });
  });

  it('lets a key set after a named style win, and a named style after a key win', () => {
    expect(resolveDrawioStyle('text;align=center;', 'vertex').align).toBe('center');
    expect(resolveDrawioStyle('align=center;text;', 'vertex').align).toBe('left');
  });

  it('keeps no default under a style that starts with “;”, as draw.io does', () => {
    expect(resolveDrawioStyle(';fontSize=9', 'vertex')).toEqual({ fontSize: '9' });
  });

  it('leaves the default shape name out, so a bare word still names the shape', () => {
    expect(resolveDrawioStyle('text;', 'vertex').shape).toBeUndefined();
    expect(resolveDrawioStyle('', 'edge').shape).toBeUndefined();
  });

  it('keeps an unknown word as a word and never reads a style off Object’s prototype', () => {
    const style = resolveDrawioStyle('constructor;__proto__=x;', 'vertex');
    expect(style.constructor).toBe('');
    expect(style.__proto__).toBe('x');
  });
});
