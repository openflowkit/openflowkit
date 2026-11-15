import type { DrawnPart, DrawnPathCommand } from '../../opencanvas/domain/nodes/drawnShape';
import type { Cell } from './drawioCells';

// The lines draw.io's containers paint over themselves. The grid a draw.io table (`shape=table`) paints over its rows (TableShape.paintTableForeground, Graph.getTableLines):
// a line under every row but the last (`rowLines`), and one right of every cell but a row's last (`columnLines`), in
// the table's own line colour. Our table is a container that draws none, so its grid is a part drawn under its rows.

/** The line under a lane's title band (mxSwimlane.paintSeparator), unless `swimlaneLine=0`; null without a band. */
export function drawioLaneLine(lane: Cell, width: number, height: number, start: number, strokeWidth: number): DrawnPart | null {
  if (lane.style.swimlaneLine === '0' || start <= 0) return null;
  const across = lane.style.horizontal !== '0';
  if (start >= (across ? height : width)) return null;
  const path: DrawnPathCommand[] = across
    ? [{ kind: 'move', x: 0, y: start }, { kind: 'line', x: width, y: start }]
    : [{ kind: 'move', x: start, y: 0 }, { kind: 'line', x: start, y: height }];
  return { path, fill: null, stroke: 'stroke', strokeWidth, dash: [], fillOpacity: 1, strokeOpacity: 1 };
}

/** The style name the grid is drawn by: not one of draw.io's, so only its saved lines ever draw it. */
export const TABLE_LINES = 'openflowkit.tableLines';

/** The table's grid in its own box, or null when it has none (no rows, or both kinds of line turned off). */
export function drawioTableLines(table: Cell, rowsOf: (id: string) => readonly Cell[], strokeWidth: number): DrawnPart | null {
  const rowLines = table.style.rowLines !== '0';
  const columnLines = table.style.columnLines !== '0';
  if (!rowLines && !columnLines) return null;
  const rows = rowsOf(table.id).filter((row) => row.vertex && row.visible && row.geometry);
  const path: DrawnPathCommand[] = [];
  const segment = (x1: number, y1: number, x2: number, y2: number) => path.push({ kind: 'move', x: x1, y: y1 }, { kind: 'line', x: x2, y: y2 });
  for (const [index, row] of rows.entries()) {
    const { x, y, width, height } = row.geometry!;
    if (rowLines && index < rows.length - 1) segment(x, y + height, x + width, y + height);
    if (!columnLines) continue;
    const cells = rowsOf(row.id).filter((cell) => cell.vertex && cell.visible && cell.geometry);
    for (const cell of cells.slice(0, -1)) {
      const right = x + cell.geometry!.x + cell.geometry!.width;
      segment(right, y, right, y + height);
    }
  }
  if (!path.length) return null;
  return { path, fill: null, stroke: 'stroke', strokeWidth, dash: [], fillOpacity: 1, strokeOpacity: 1 };
}
