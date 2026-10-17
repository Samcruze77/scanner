// Reconciles a table's column grid (`w:tblGrid`) with its cells' own preferred widths (`w:tcW`).
//
// In WordprocessingML the grid is only a record of the column widths the producer last used; for an
// auto-fit table Word lays out from the cells' preferred widths. Some producers (docx.js and others)
// write a placeholder grid such as 100 twips per column while the cells carry the real widths. Taking
// the grid at face value then crushes every column to about 1.8 mm and the text wraps one letter per
// line. This keeps a sound grid exactly as it is and only replaces one that clearly disagrees with the
// cells. Pure maths on twips, so it can be unit-tested without a document.

export interface GridCell {
  gridStart: number;
  gridSpan: number;
  // The cell's `tcW` in twips (only `dxa` widths; percentages and "auto" are not given).
  preferredWidth?: number;
}

export function reconcileGrid(grid: number[], rows: { cells: GridCell[] }[]): number[] {
  const n = grid.length;
  if (n === 0) return grid;

  // Column widths implied by the cells: the widest single-column cell wins.
  const derived = new Array<number>(n).fill(0);
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.gridSpan === 1 && cell.preferredWidth && cell.preferredWidth > 0 && cell.gridStart < n) {
        derived[cell.gridStart] = Math.max(derived[cell.gridStart], cell.preferredWidth);
      }
    }
  }
  // A merged cell fills in columns nothing else describes: it shares what is left of its width.
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.gridSpan <= 1 || !cell.preferredWidth || cell.preferredWidth <= 0) continue;
      const cols = Array.from({ length: cell.gridSpan }, (_, i) => cell.gridStart + i).filter((c) => c < n);
      const unknown = cols.filter((c) => derived[c] === 0);
      if (unknown.length === 0) continue;
      const known = cols.reduce((sum, c) => sum + derived[c], 0);
      const rest = cell.preferredWidth - known;
      if (rest > 0) for (const c of unknown) derived[c] = rest / unknown.length;
    }
  }
  // Not every column can be worked out from the cells: leave the grid alone.
  if (derived.some((d) => d <= 0)) return grid;

  const gridTotal = grid.reduce((a, b) => a + b, 0);
  const derivedTotal = derived.reduce((a, b) => a + b, 0);
  const collapsed = grid.some((g, c) => g < derived[c] * 0.4) || gridTotal < derivedTotal * 0.6;
  return collapsed ? derived.map((d) => Math.round(d)) : grid;
}
