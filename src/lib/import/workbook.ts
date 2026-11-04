import type { Fills, Rows } from './parse';

type XLSXLib = typeof import('xlsx');
type WorkBook = import('xlsx').WorkBook;

export interface SheetData {
  name: string;
  rows: Rows;
  fills: Fills;
}

/** Legge valori e colori di sfondo di ogni foglio (serve cellStyles: true in XLSX.read) */
export function readSheets(XLSX: XLSXLib, wb: WorkBook): SheetData[] {
  const out: SheetData[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]!;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true }) as Rows;
    // fogli "gonfiati" con un milione di righe vuote: tengo solo quelle con dati
    let last = rows.length - 1;
    while (last >= 0 && (rows[last] ?? []).every((v) => v === null || v === undefined || v === '')) last--;
    rows.length = last + 1;
    if (!rows.length) continue;
    const fills: Fills = rows.map(() => []);
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue;
      const cell = ws[addr] as { s?: { patternType?: string; fgColor?: { rgb?: string } } };
      const rgb = cell?.s?.fgColor?.rgb;
      if (!rgb || cell.s?.patternType === 'none') continue;
      const { r, c } = XLSX.utils.decode_cell(addr);
      if (r < rows.length) fills[r]![c] = rgb.slice(-6).toUpperCase();
    }
    out.push({ name, rows, fills });
  }
  return out;
}
