import { describe, expect, it } from 'vitest';
import { cssColorName } from './cssColorNames';

describe('cssColorName', () => {
  it('reads CSS colour names in any case, both spellings of grey included', () => {
    expect(cssColorName('gray')).toBe('#808080');
    expect(cssColorName('Grey')).toBe('#808080');
    expect(cssColorName('rebeccapurple')).toBe('#663399');
    expect(cssColorName(' White ')).toBe('#ffffff');
  });

  it('leaves anything else alone', () => {
    expect(cssColorName('swimlane')).toBeUndefined();
    expect(cssColorName('#808080')).toBeUndefined();
    expect(cssColorName('')).toBeUndefined();
  });
});
