import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { detect, parse, detectLegend } from '../../src/lib/import/parse';
import { readSheets } from '../../src/lib/import/workbook';
import { fmtTime, localDate } from '../../src/lib/time';
const tz = 'Europe/Rome';
const wb = XLSX.read(readFileSync(process.argv[2]), { type: 'buffer', cellStyles: true });
const sheets = readSheets(XLSX, wb);
console.log('legenda:', JSON.stringify([...detectLegend(sheets)]));
for (const sh of sheets) {
  const opts = { tz, year: 2026, weekStart: '2026-11-09' };
  const t0 = Date.now();
  const map = detect(sh.rows, opts);
  if (!map) { console.log(sh.name, 'NON RICONOSCIUTO', sh.rows.length); continue; }
  const res = parse(sh.rows, map, opts, sh.fills);
  const days = res.items.map((i) => localDate(i.s, tz)).sort();
  const people = new Set(res.items.map((i) => i.name));
  const fills: Record<string, number> = {};
  res.items.forEach((i) => { const k = i.fill ?? '-'; fills[k] = (fills[k] ?? 0) + 1; });
  const labels: Record<string, number> = {};
  res.items.forEach((i) => { const k = i.activity ?? '-'; labels[k] = (labels[k] ?? 0) + 1; });
  console.log(`\n${sh.name}: ${map.format} · ${res.items.length} blocchi · ${people.size} persone · ${days[0]} → ${days.at(-1)} · riposi ${res.restCells} · problemi ${res.issues.length} · ${Date.now() - t0}ms`);
  if (map.format === 'gridCols') console.log('  persone:', map.personCols.map((p) => p.name).join(', '));
  console.log('  colori:', JSON.stringify(fills), ' etichette:', JSON.stringify(labels));
  res.issues.slice(0, 6).forEach((i) => console.log('  ! riga', i.row, 'col', i.col, JSON.stringify(i.text), i.message));
  const ex = res.items.find((i) => i.name === 'Borra');
  if (ex) console.log('  esempio Borra:', localDate(ex.s, tz), fmtTime(ex.s, tz), '-', fmtTime(ex.e, tz), ex.fill);
}
