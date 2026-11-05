// Reads the MCL monthly workbook (one sheet per truck, e.g. "Nov 2026 Shale & Limestone.xlsx") and turns it
// into the same flat rows the template import uses (one row per truck per day), so the existing validation
// and database code can be reused unchanged.
//
// Layout it understands (found by reading the header row, so small column shifts do not matter):
//   DATE | Trip 1..13 (KG) | ... | Fuel (L) 1..3 | ... | EXPECTED Fuel Bal | ACTUAL Fuel Bal | ...
//   second "DATE" block: Trip 1..13 = material source letter (M, G, N, R, S, T)
//   the row labelled "Opening Balance" holds the month's opening litres in the EXPECTED column.
// The sheet tab name is the truck plate. Sheets that do not look like a truck sheet (SUMMARY, Standards ...) are ignored.

import * as XLSX from 'xlsx';
import { TRIP_NUMS, SOURCE_CODES } from '@/lib/mclGrid';
import { plateKey } from '@/lib/mclImport';

type Layout = {
  headerRow: number;      // zero-based row index of the header
  dateCol: number;        // first DATE column (weights block starts one column after it)
  srcCol: number;         // second DATE column (sources block starts one column after it)
  fuelCols: number[];     // Fuel (L) 1..3
  expectedCol: number;    // EXPECTED Fuel Bal (L)
  dipCol: number;         // ACTUAL Fuel Bal (L)
};

export type WorkbookRows = { rows: Record<string, any>[]; warnings: string[]; sheets: string[] };

const cellAt = (ws: XLSX.WorkSheet, r: number, c: number): XLSX.CellObject | undefined => ws[XLSX.utils.encode_cell({ r, c })];
const textAt = (ws: XLSX.WorkSheet, r: number, c: number) => {
  const v = cellAt(ws, r, c)?.v;
  return typeof v === 'string' ? v.trim() : '';
};
const numAt = (ws: XLSX.WorkSheet, r: number, c: number): number | null => {
  const v = cellAt(ws, r, c)?.v;
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
};

function findLayout(ws: XLSX.WorkSheet): Layout | null {
  const ref = ws['!ref'];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);
  const lastCol = Math.min(range.e.c, 120);

  for (let r = range.s.r; r <= Math.min(range.s.r + 12, range.e.r); r++) {
    const dateCols: number[] = [];
    const fuelCols: number[] = [];
    let expectedCol = -1, dipCol = -1;
    for (let c = range.s.c; c <= lastCol; c++) {
      const t = textAt(ws, r, c).toUpperCase();
      if (t === 'DATE' && textAt(ws, r, c + 1).toUpperCase() === 'TRIP 1') dateCols.push(c);
      const f = /^FUEL \(L\) ([123])$/.exec(t);
      if (f && fuelCols[Number(f[1]) - 1] === undefined) fuelCols[Number(f[1]) - 1] = c;
      if (t.startsWith('EXPECTED FUEL BAL') && expectedCol < 0) expectedCol = c;
      if (t.startsWith('ACTUAL FUEL BAL') && dipCol < 0) dipCol = c;
    }
    if (dateCols.length >= 2 && fuelCols.filter(x => x !== undefined).length === 3 && dipCol >= 0) {
      return { headerRow: r, dateCol: dateCols[0], srcCol: dateCols[1], fuelCols, expectedCol, dipCol };
    }
  }
  return null;
}

export function isMclWorkbook(wb: XLSX.WorkBook): boolean {
  return wb.SheetNames.some(n => findLayout(wb.Sheets[n]) !== null);
}

export function workbookToRows(wb: XLSX.WorkBook, kind: 'trips' | 'fuel'): WorkbookRows {
  const rows: Record<string, any>[] = [];
  const warnings: string[] = [];
  const sheets: string[] = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const L = findLayout(ws);
    if (!L) continue;
    sheets.push(name);

    // title cell (B2 in your sheets) should be the same plate as the tab name
    for (let r = 0; r < L.headerRow; r++) {
      const t = textAt(ws, r, L.dateCol);
      if (t && plateKey(t) !== plateKey(name) && /^[A-Za-z]{3}\s?\d{3}\s?[A-Za-z]$/.test(t)) {
        warnings.push(`Sheet "${name}": the plate written inside the sheet is "${t}". The tab name "${name}" was used.`);
      }
    }

    // opening balance row
    let openRow = -1;
    for (let r = L.headerRow + 1; r <= L.headerRow + 4; r++) {
      for (let c = 0; c <= L.dipCol; c++) if (/opening balance/i.test(textAt(ws, r, c))) openRow = r;
      if (openRow >= 0) break;
    }
    const first = (openRow >= 0 ? openRow : L.headerRow) + 1;
    const openingBalance = openRow >= 0
      ? (L.expectedCol >= 0 ? numAt(ws, openRow, L.expectedCol) : null) ?? numAt(ws, openRow, L.dipCol)
      : null;

    let openingPlaced = false;
    for (let r = first; r <= first + 45; r++) {
      const date = numAt(ws, r, L.dateCol);
      if (date === null || date < 20000) { if (r > first + 28) break; else continue; }
      const sheetRow = r + 1;
      const base: Record<string, any> = { date, truck: name, ref: name, ref_row: sheetRow };

      if (kind === 'trips') {
        const row = { ...base };
        let any = false;
        for (const k of TRIP_NUMS) {
          const kg = numAt(ws, r, L.dateCol + k);
          const src = textAt(ws, r, L.srcCol + k).toUpperCase();
          if (kg !== null && kg > 0) {
            any = true;
            row[`trip_${k}_kg`] = kg;
            if (!src) warnings.push(`${name} row ${sheetRow}: trip ${k} has a weight but no source letter, so it is read as M.`);
            else row[`trip_${k}_src`] = src;
          } else if (src && (SOURCE_CODES as readonly string[]).includes(src)) {
            warnings.push(`${name} row ${sheetRow}: trip ${k} has source "${src}" but no weight, so it is ignored.`);
          }
        }
        if (any) rows.push(row);
      } else {
        const row = { ...base };
        L.fuelCols.forEach((c, i) => { const v = numAt(ws, r, c); if (v !== null) row[`fuel_${i + 1}`] = v; });

        // Only a typed number is a dip reading. A formula in this column is the sheet's own calculation.
        const dipCell = cellAt(ws, r, L.dipCol);
        if (dipCell && !dipCell.f && typeof dipCell.v === 'number') {
          row.actual_balance = dipCell.v;
          if (dipCell.v === 0) warnings.push(`${name} row ${sheetRow}: the actual balance is 0 litres. Check it is a real dip reading.`);
        }
        if (!openingPlaced && openingBalance !== null) { row.opening_balance = openingBalance; openingPlaced = true; }
        if (row.fuel_1 !== undefined || row.fuel_2 !== undefined || row.fuel_3 !== undefined
          || row.actual_balance !== undefined || row.opening_balance !== undefined) rows.push(row);
      }
    }
  }
  return { rows, warnings, sheets };
}
