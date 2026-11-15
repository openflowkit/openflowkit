import { describe, expect, it } from 'vitest';
import type { RichBlock } from '../../opencanvas/domain/text/richLabel';
import { drawioRichLabel } from './drawioRichText';

describe('draw.io HTML labels as rich labels', () => {
  it('sets database_1’s table: a centred bold underlined title, a divider, indented fields', () => {
    const html = '<p style="margin-top:4px; text-align:center; text-decoration:underline"><strong>Holiday</strong></p><hr/>'
      + '<p style="margin-left:8px">IdHoliday<br/>Name</p>';
    expect(drawioRichLabel(html, 12)!.blocks).toEqual([
      { kind: 'text', align: 'center', spaceBefore: 4, spaceAfter: 12, runs: [{ underline: true, bold: true, text: 'Holiday' }] },
      { kind: 'rule', spaceBefore: 6, spaceAfter: 6 },
      { kind: 'text', indent: 8, spaceBefore: 12, spaceAfter: 12, runs: [{ text: 'IdHoliday\nName' }] },
    ]);
  });

  it('sets a UML class box: zero margins, italic stereotype over a bold name, a thin divider', () => {
    const html = '<p style="margin:0px;margin-top:4px;text-align:center;"><i>&lt;&lt;Interface&gt;&gt;</i><br/><b>Shape</b></p>'
      + '<hr size="1"/><p style="margin:0px;margin-left:4px;">+ field1: Type</p>';
    expect(drawioRichLabel(html, 12)!.blocks).toEqual([
      { kind: 'text', align: 'center', spaceBefore: 4, runs: [{ italic: true, text: '<<Interface>>' }, { text: '\n' }, { bold: true, text: 'Shape' }] },
      { kind: 'rule', spaceBefore: 6, spaceAfter: 6 },
      { kind: 'text', indent: 4, runs: [{ text: '+ field1: Type' }] },
    ]);
  });

  it('colours and resizes words by <font> and inline CSS, collapsing spaces as HTML does', () => {
    const html = 'Plain  <font color="#FF0000">red</font> <span style="font-size: 18px; color: rgb(0, 128, 0); font-weight: bold">big</span> <font size="1">tiny</font>';
    expect(drawioRichLabel(html, 12)!.blocks).toEqual([{ kind: 'text', runs: [
      { text: 'Plain ' }, { color: '#ff0000', text: 'red' }, { text: ' ' }, { size: 18, color: '#008000', bold: true, text: 'big' }, { text: ' ' }, { size: 10, text: 'tiny' },
    ] }]);
  });

  it('says nothing for a label that is only words and line breaks, so the plain label stands', () => {
    expect(drawioRichLabel('Global<div>Partnerships</div><br>', 12)).toBeNull();
    expect(drawioRichLabel('<span>Just words</span>', 12)).toBeNull();
  });

  it('sets a heading large and bold, ignores code and an unclosed tag', () => {
    const { blocks } = drawioRichLabel('<h1>Title</h1><script>alert(1)</script>x < y', 12)!;
    expect(blocks[0]).toMatchObject({ kind: 'text', runs: [{ bold: true, size: 24, text: 'Title' }] });
    // A browser's h1 margin: 0.67em of its own 24px.
    expect(blocks[0]!.kind === 'text' && blocks[0]!.spaceBefore).toBeCloseTo(16.08);
    expect(blocks[1]).toMatchObject({ kind: 'text', runs: [{ text: 'x < y' }] });
  });

  it('sets a table as rows of cells, with its cell padding and full width, and a header cell bold and centred', () => {
    // database_3's entity: a grey title band, then a table of keys and fields.
    const { blocks } = drawioRichLabel('<div style="box-sizing:border-box;width:100%;background:#e4e4e4;padding:2px;">Tablename</div>'
      + '<table style="width:100%;font-size:1em;" cellpadding="2" cellspacing="0"><tbody><tr><th>Key</th><td>Name</td></tr>'
      + '<tr><td>PK</td><td>unique<b>Id</b><br></td></tr><tr><td><br></td><td>fieldname</td></tr></tbody></table>', 12)!;
    expect(blocks[0]).toMatchObject({ kind: 'text', background: '#e4e4e4', padding: 2, runs: [{ text: 'Tablename' }] });
    expect(blocks.slice(1)).toEqual([
      { kind: 'row', table: 0, padding: 2, full: true, cells: [{ runs: [{ text: 'Key', bold: true }], align: 'center' }, { runs: [{ text: 'Name' }] }] },
      { kind: 'row', table: 0, padding: 2, full: true, cells: [{ runs: [{ text: 'PK' }] }, { runs: [{ text: 'unique' }, { text: 'Id', bold: true }] }] },
      { kind: 'row', table: 0, padding: 2, full: true, cells: [{ runs: [] }, { runs: [{ text: 'fieldname' }] }] },
    ]);
  });

  it('leaves a header cell on the left under a left-aligned label, as a browser does', () => {
    // authority_matrix: a `text` cell (draw.io aligns it left) whose table's headers sit left.
    const { blocks } = drawioRichLabel('<table><tr><th>Tasks</th><th align="center">Mid</th></tr></table>', 12, 'left')!;
    expect(blocks[0]).toMatchObject({ kind: 'row', cells: [{ runs: [{ text: 'Tasks', bold: true }] }, { align: 'center' }] });
    expect((blocks[0] as { readonly cells: readonly { readonly align?: string }[] }).cells[0]!.align).toBeUndefined();
  });

  it('reads a table’s cell widths, row and cell colours, its lines and its height, keeping colours set by HTML attributes in dark mode', () => {
    // educational's timetable and authority_matrix's grid.
    const { blocks } = drawioRichLabel('<table border="1" style="width: 100% ; height: 100% ; border-collapse: collapse">'
      + '<tr style="background-color: #a7c942 ; border: 1px solid #98bf21"><th width="4%">#</th><th bgcolor="#F00">Mon</th></tr>'
      + '<tr><td>1</td><td style="background-color: rgb(0, 0, 255)">x</td></tr></table>', 12)!;
    expect(blocks).toEqual([
      { kind: 'row', table: 0, padding: 1, full: true, fill: true, cells: [
        { runs: [{ text: '#', bold: true }], align: 'center', width: 0.04, background: '#a7c942', border: '#98bf21' },
        { runs: [{ text: 'Mon', bold: true }], align: 'center', background: '#ff0000', border: '#98bf21', keep: ['background'] },
      ] },
      { kind: 'row', table: 0, padding: 1, full: true, fill: true, cells: [
        { runs: [{ text: '1' }], border: '#808080', keep: ['border'] }, { runs: [{ text: 'x' }], background: '#0000ff', border: '#808080', keep: ['border'] },
      ] },
    ]);
  });

  it('keeps a table’s cells apart from the words after it, and numbers each table', () => {
    const { blocks } = drawioRichLabel('<table><tr><td>a</td><td>b</td></tr></table>after<table><tr><td>c</td></tr></table>', 12)!;
    expect(blocks.map((block) => block.kind === 'row' ? `row${block.table}` : block.kind)).toEqual(['row0', 'text', 'row1']);
    expect(blocks[0]).toMatchObject({ padding: 1 });
  });

  it('starts no line for a break that ends a paragraph or a cell (database_2, database_3)', () => {
    const fields = '<p style="margin: 0px ; margin-left: 8px">field4 = value4<br></p><p style="margin: 0px ; margin-left: 8px">field5 = value5<br></p>';
    expect(drawioRichLabel(fields, 12)!.blocks.map((block) => block.kind === 'text' && block.runs.map((run) => run.text).join(''))).toEqual(['field4 = value4', 'field5 = value5']);
  });

  it('puts each break and paragraph in a table cell on a line of its own (org charts’ name and position)', () => {
    const cells = (html: string) => (drawioRichLabel(`<table><tr><td>${html}</td></tr></table>`, 12)!.blocks[0] as Extract<RichBlock, { kind: 'row' }>).cells[0]!.runs.map((run) => run.text).join('');
    expect(cells('<b>Name</b><br>Position')).toBe('Name\nPosition');
    expect(cells('<div>Name</div><div>Position</div>')).toBe('Name\nPosition');
    expect(cells('Name<br><div>Position</div>')).toBe('Name\nPosition');
  });

  it('sets a table inside a cell as its words, a line for each of its rows, and keeps the outer table’s rows', () => {
    const html = '<table><tr><td>a<table><tr><td>b</td><td>c</td></tr><tr><td>d</td></tr></table></td><td>e</td></tr><tr><td>f</td></tr></table>';
    const rows = drawioRichLabel(html, 12)!.blocks.map((block) => block.kind === 'row' && block.cells.map((cell) => cell.runs.map((run) => run.text).join('')));
    expect(rows).toEqual([['a\nb c\nd', 'e'], ['f']]);
  });
});
