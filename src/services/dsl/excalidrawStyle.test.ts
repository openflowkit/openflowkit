import { describe, expect, it } from 'vitest';
import {
  excalidrawColor, excalidrawConnectorAppearance, excalidrawFont, excalidrawHead, excalidrawInk, excalidrawNodeAppearance, excalidrawStrokeContent,
  excalidrawWordInk,
} from './excalidrawStyle';

describe('Excalidraw styles', () => {
  it('keeps hex colours and transparent, and drops the rest', () => {
    expect(excalidrawColor('#1E1E1E')).toBe('#1e1e1e');
    // Short hex is the same colour: `#fff` washes on a dark canvas exactly as `#ffffff` does.
    expect(excalidrawColor('#FFF')).toBe('#ffffff');
    expect(excalidrawColor('transparent')).toBe('transparent');
    expect(excalidrawColor('red')).toBeUndefined();
    expect(excalidrawColor(undefined)).toBeUndefined();
  });

  it('names Excalidraw’s fonts by their look', () => {
    expect([1, 5, 8].map(excalidrawFont)).toEqual(['hand', 'hand', 'hand']);
    expect(excalidrawFont(3)).toBe('mono');
    expect(excalidrawFont(2)).toBe('sans');
  });

  it('carries a shape’s paint, and its label’s type and setting', () => {
    expect(excalidrawNodeAppearance({ backgroundColor: '#ffc9c9', strokeColor: '#e03131', strokeWidth: 4, strokeStyle: 'dotted', opacity: 60 }))
      .toEqual({ fill: '#ffc9c9', stroke: '#e03131', strokeWidth: 4, strokeStyle: 'dotted', opacity: 0.6 });
    expect(excalidrawNodeAppearance({}, { strokeColor: '#1971c2', fontSize: 28, fontFamily: 1, textAlign: 'left', verticalAlign: 'top' }))
      .toEqual({ textColor: '#1971c2', fontSize: 28, fontFamily: 'hand', textAlign: 'start', textVerticalAlign: 'top' });
  });

  it('draws the arrowheads we have and names the ones we don’t', () => {
    expect(excalidrawHead('triangle_outline')).toBe('arrow');
    expect(excalidrawHead('circle')).toBe('circle');
    expect(excalidrawHead('diamond_outline')).toBe('diamond');
    expect(excalidrawHead(null)).toBeNull();
    expect(excalidrawHead('crowfoot_many')).toEqual({ lost: 'crowfoot_many' });
  });

  it('paints connectors and freehand strokes in the keys they read', () => {
    expect(excalidrawConnectorAppearance({ strokeColor: '#2f9e44', strokeWidth: 1, strokeStyle: 'dashed' }))
      .toEqual({ stroke: '#2f9e44', strokeWidth: 1, dashPattern: 'dashed' });
    expect(excalidrawStrokeContent({ strokeColor: '#e03131', strokeWidth: 4, opacity: 50 }))
      .toEqual({ strokeColor: '#e03131', strokeWidth: 4, transparency: 0.5 });
  });

  it('leaves Excalidraw’s default ink to the theme, as Excalidraw’s dark mode shows it white', () => {
    expect(excalidrawInk('#1e1e1e')).toBeUndefined();
    expect(excalidrawInk('#000000')).toBeUndefined();
    expect(excalidrawInk('#e03131')).toBe('#e03131');
    expect(excalidrawConnectorAppearance({ strokeColor: '#1e1e1e', strokeWidth: 2 })).toEqual({ strokeWidth: 2 });
    expect(excalidrawStrokeContent({ strokeColor: '#1e1e1e', strokeWidth: 2 })).toEqual({ strokeWidth: 2 });
    expect(excalidrawNodeAppearance({ strokeColor: '#1e1e1e', backgroundColor: 'transparent' })).toEqual({ fill: 'transparent' });
    expect(excalidrawNodeAppearance({}, { strokeColor: '#1e1e1e', fontFamily: 2 })).toEqual({ fontFamily: 'sans' });
  });

  it('keeps default-ink words dark only over a fill that stays solid on a dark canvas', () => {
    expect(excalidrawWordInk('#1e1e1e', true)).toBe('#1e1e1e');
    expect(excalidrawWordInk('#000', true)).toBe('#000000');
    expect(excalidrawWordInk('#1e1e1e', false)).toBeUndefined();
    expect(excalidrawWordInk('#e03131', false)).toBe('#e03131');
    expect(excalidrawWordInk('transparent', true)).toBeUndefined();
  });
});
