import { describe, expect, it } from 'vitest';
import { layoutRichLabel, richLabelOf, richLabelText, type RichBase, type RichBlock } from './richLabel';

const BASE: RichBase = { fontSize: 10, fontWeight: 400, italic: false, underline: false, strike: false, color: '#111111', lineHeight: 1.2, align: 'start' };
/** Every character is 10px wide at 10px: easy sums. */
const measure = (text: string, size: number) => text.length * size;

describe('rich labels', () => {
  it('reads a stored rich label, dropping anything malformed, and its words as plain text', () => {
    const blocks = richLabelOf({ richLabel: [
      { kind: 'text', align: 'center', spaceBefore: 4, runs: [{ text: 'Holiday', bold: true, underline: true }, { text: 7 }] },
      { kind: 'rule' }, 'junk', { kind: 'text', indent: 8, runs: [{ text: 'IdHoliday', color: '#ABCDEF', size: -1 }] },
    ] })!;
    expect(blocks).toEqual([
      { kind: 'text', align: 'center', spaceBefore: 4, runs: [{ text: 'Holiday', bold: true, underline: true }] },
      { kind: 'rule' },
      { kind: 'text', indent: 8, runs: [{ text: 'IdHoliday', color: '#abcdef' }] },
    ]);
    expect(richLabelText(blocks)).toBe('Holiday\nIdHoliday');
    expect(richLabelOf({ richLabel: 'x' })).toBeNull();
    expect(richLabelOf({})).toBeNull();
  });

  it('sets a centred title, a divider and indented fields, with the larger margin between blocks', () => {
    const blocks: RichBlock[] = [
      { kind: 'text', align: 'center', spaceBefore: 4, spaceAfter: 2, runs: [{ text: 'Hi', bold: true }] },
      { kind: 'rule', spaceBefore: 6, spaceAfter: 6 },
      { kind: 'text', indent: 8, runs: [{ text: 'Id' }] },
    ];
    const layout = layoutRichLabel(blocks, BASE, 100, { measure });
    expect(layout.lines.map((line) => [line.y, line.pieces.map((piece) => [piece.x, piece.text, piece.weight])])).toEqual([
      [4, [[40, 'Hi', 700]]],
      [4 + 12 + 6 + 1 + 6, [[8, 'Id', 400]]],
    ]);
    expect(layout.rules).toEqual([{ x: 0, y: 4 + 12 + 6 + 0.5, width: 100 }]);
    expect(layout.height).toBe(4 + 12 + 6 + 1 + 6 + 12);
  });

  it('wraps between words across runs, a line taking its tallest run’s height, spaces at an end taking no room', () => {
    const layout = layoutRichLabel([{ kind: 'text', runs: [{ text: 'aa bb ' }, { text: 'cc', size: 20 }] }], BASE, 60, { measure });
    expect(layout.lines.map((line) => line.pieces.map((piece) => piece.text).join(''))).toEqual(['aa bb', 'cc']);
    expect(layout.lines.map((line) => line.height)).toEqual([12, 24]);
    expect(layout.lines[0]!.pieces.at(-1)!.width).toBe(20);
  });

  it('breaks a word wider than the line into letters, or keeps it whole when asked', () => {
    const blocks: RichBlock[] = [{ kind: 'text', runs: [{ text: 'abcdefgh' }] }];
    expect(layoutRichLabel(blocks, BASE, 30, { measure }).lines.map((line) => line.pieces[0]!.text)).toEqual(['abc', 'def', 'gh']);
    expect(layoutRichLabel(blocks, BASE, 30, { measure, keepWords: true }).lines.map((line) => line.pieces[0]!.text)).toEqual(['abcdefgh']);
  });

  it('starts a new line at a line break, keeps an empty paragraph at no height, and right-aligns in the widest line when it never wraps', () => {
    const layout = layoutRichLabel([
      { kind: 'text', runs: [{ text: 'one\ntwo three' }] },
      { kind: 'text', runs: [] },
      { kind: 'text', align: 'end', runs: [{ text: 'x' }] },
    ], BASE, null, { measure });
    expect(layout.lines.map((line) => [line.y, line.pieces.map((piece) => `${piece.x}:${piece.text}`).join(' ')])).toEqual([
      [0, '0:one'], [12, '0:two 30:  40:three'], [24, '80:x'],
    ]);
    expect(layout.width).toBe(90);
  });

  it('centres a line that never wraps in the label’s box, or in the widest line when that is wider', () => {
    const blocks: RichBlock[] = [{ kind: 'text', align: 'center', runs: [{ text: 'ab' }] }, { kind: 'text', runs: [{ text: 'abcd' }] }];
    expect(layoutRichLabel(blocks, BASE, null, { measure, box: 100 }).lines[0]!.pieces[0]!.x).toBe(40);
    expect(layoutRichLabel(blocks, BASE, null, { measure, box: 10 }).lines[0]!.pieces[0]!.x).toBe(10);
  });

  it('sets a table’s rows in shared columns, each its widest cell, a full table stretched to the label', () => {
    const blocks: RichBlock[] = [
      { kind: 'text', background: '#e4e4e4', padding: 2, runs: [{ text: 'T' }] },
      { kind: 'row', table: 0, padding: 2, full: true, cells: [{ runs: [{ text: 'PK' }] }, { runs: [{ text: 'id' }] }] },
      { kind: 'row', table: 0, padding: 2, full: true, cells: [{ runs: [] }, { runs: [{ text: 'name' }], align: 'end' }] },
    ];
    const layout = layoutRichLabel(blocks, BASE, 100, { measure });
    // The band: the paragraph's 12px line inside 2px of padding each side, the label's width; its words 2px in.
    expect(layout.bands).toEqual([{ x: 0, y: 0, width: 100, height: 16, color: '#e4e4e4' }]);
    expect(layout.lines[0]!.pieces[0]!.x).toBe(2);
    // Columns 24 and 44 wide by nature share the 32px left over 24:44, so the second starts at 24 + 32·24/68.
    const [first, second] = layout.lines.slice(1);
    expect(first).toMatchObject({ y: 16, height: 16, columns: true });
    expect(first!.pieces.map((piece) => piece.x)).toEqual([2, 24 + (32 * 24) / 68 + 2]);
    // An end-aligned cell sits against its column's right padding.
    expect(second!.pieces[0]!.x).toBeCloseTo(100 - 2 - 40);
    expect(layout.height).toBe(48);
    expect(richLabelText(blocks)).toBe('T\nPK id\n name');
  });

  it('keeps a table that isn’t full width as wide as its cells', () => {
    const row: RichBlock = { kind: 'row', table: 0, cells: [{ runs: [{ text: 'ab' }] }, { runs: [{ text: 'c' }] }] };
    const layout = layoutRichLabel([row], BASE, null, { measure, box: 200 });
    expect(layout.lines[0]!.pieces.map((piece) => piece.x)).toEqual([0, 20]);
    expect(layout.width).toBe(200);
  });
});
