import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { detect, parse, parseShiftCell, parseTime, parseDate, type Rows } from '../../src/lib/import/parse';
import { matchPerson, matchActivity } from '../../src/lib/import/match';
import { normName } from '../../src/lib/names';
import { fmtTime, localDate } from '../../src/lib/time';

const tz = 'Europe/Rome';
const opts = { tz, year: 2026, weekStart: '2026-11-09' };
const hm = (ms: number) => `${localDate(ms, tz)} ${fmtTime(ms, tz)}`;

/** passa da un vero file .xlsx come farà il browser */
function roundtrip(aoa: unknown[][]): Rows {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Turni');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const back = XLSX.read(buf, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(back.Sheets['Turni']!, { header: 1, raw: true, defval: null }) as Rows;
}

test('celle di turno', () => {
  assert.deepEqual(parseShiftCell('08:00-16:00'), { kind: 'segments', segments: [{ start: 480, end: 960, label: null }] });
  assert.deepEqual(parseShiftCell('8-12 / 13-17'), { kind: 'segments', segments: [{ start: 480, end: 720, label: null }, { start: 780, end: 1020, label: null }] });
  assert.deepEqual(parseShiftCell('Tel 8-12, Chat 13.30-17'), { kind: 'segments', segments: [{ start: 480, end: 720, label: 'Tel' }, { start: 810, end: 1020, label: 'Chat' }] });
  assert.deepEqual(parseShiftCell('8-12 Tel / 13-17 Chat'), { kind: 'segments', segments: [{ start: 480, end: 720, label: 'Tel' }, { start: 780, end: 1020, label: 'Chat' }] });
  assert.deepEqual(parseShiftCell('08:00 - 16:00 Telefono'), { kind: 'segments', segments: [{ start: 480, end: 960, label: 'Telefono' }] });
  assert.deepEqual(parseShiftCell('22-06'), { kind: 'segments', segments: [{ start: 1320, end: 1800, label: null }] });
  assert.deepEqual(parseShiftCell('dalle 9 alle 18'), { kind: 'segments', segments: [{ start: 540, end: 1080, label: null }] });
  assert.equal(parseShiftCell('R').kind, 'rest');
  assert.equal(parseShiftCell('Riposo').kind, 'rest');
  assert.equal(parseShiftCell(null).kind, 'rest');
  assert.deepEqual(parseShiftCell('Ferie'), { kind: 'allDay', label: 'Ferie' });
});

test('date e orari', () => {
  assert.equal(parseDate('Lun 10/11', 2026), '2026-11-10');
  assert.equal(parseDate('10/11/2026', 2026), '2026-11-10');
  assert.equal(parseDate('2026-11-10', 2026), '2026-11-10');
  assert.equal(parseDate('martedì 11 novembre', 2026), '2026-11-11');
  assert.equal(parseDate(46335, 2026), '2026-11-09');
  assert.equal(parseTime(0.375, 2026)?.min, 540);
  assert.equal(parseTime('8.30', 2026)?.min, 510);
  assert.deepEqual(parseTime('11/9/2026 2:30 PM', 2026), { date: '2026-11-09', min: 870 });
  assert.ok(parseTime('2026-11-09T08:00:00+01:00', 2026)?.abs);
});

test('griglia: persone × giorni', () => {
  const rows = roundtrip([
    ['Turni settimana 10-16 novembre'],
    [],
    ['Cognome', 'Nome', 'Lun 10/11', 'Mar 11/11', 'Mer 12/11', 'Gio 13/11'],
    ['Rossi', 'Giulia', '14-22', 'R', 'Tel 8-12 / Chat 13-17', 'Ferie'],
    ['Bianchi', 'Marco', '08:00-16:00', '22-06', '', 'xyz 1'],
    ['Totale', null, 2, 1, 1, 0],
  ]);
  const map = detect(rows, opts);
  assert.equal(map?.format, 'grid');
  if (map?.format !== 'grid') return;
  assert.deepEqual(map.nameCols, [0, 1]);
  assert.equal(map.dateCols.length, 4);
  const res = parse(rows, map, opts);
  const g = res.items.filter((i) => i.name === 'Rossi Giulia');
  assert.equal(g.length, 4);
  assert.equal(hm(g[0]!.s), '2026-11-10 14:00');
  assert.equal(g[1]!.activity, 'Tel');
  assert.equal(g[3]!.allDay, true);
  const night = res.items.find((i) => i.name === 'Bianchi Marco' && localDate(i.s, tz) === '2026-11-11')!;
  assert.equal(hm(night.e), '2026-11-12 06:00');
  assert.equal(res.issues.length, 1, 'la cella "xyz 1" è segnalata, non inventata');
  assert.ok(res.items.every((i) => i.name !== 'Totale'));
});

test('griglia con soli giorni della settimana', () => {
  const rows = roundtrip([
    ['Operatore', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'],
    ['Anna Verdi', '9-18', '9-18', 'R', '9-18', '9-18', 'R', 'R'],
  ]);
  const map = detect(rows, opts);
  assert.equal(map?.format, 'grid');
  const res = parse(rows, map!, opts);
  assert.equal(res.items.length, 4);
  assert.equal(localDate(res.items[2]!.s, tz), '2026-11-12');
});

test('elenco stile export Assembled', () => {
  const rows = roundtrip([
    ['Agent name', 'Agent email', 'Event type', 'Start time', 'End time'],
    ['Claudia Borra', 'claudia.borra@azienda.it', 'Phone', '2026-11-04T08:00:00+01:00', '2026-11-04T12:00:00+01:00'],
    ['Claudia Borra', 'claudia.borra@azienda.it', 'Pranzo', '2026-11-04T12:00:00+01:00', '2026-11-04T13:00:00+01:00'],
  ]);
  const map = detect(rows, opts);
  assert.equal(map?.format, 'list');
  const res = parse(rows, map!, opts);
  assert.equal(res.items.length, 2);
  assert.equal(res.items[0]!.email, 'claudia.borra@azienda.it');
  assert.equal(hm(res.items[0]!.s), '2026-11-04 08:00');
  assert.equal(res.items[1]!.activity, 'Pranzo');
});

test('elenco con data e orari Excel', () => {
  const rows = roundtrip([
    ['Dipendente', 'Data', 'Inizio', 'Fine', 'Attività'],
    ['Luca Neri', 46335, 0.3333333333, 0.6666666667, 'Chat'],
    ['Luca Neri', '10/11/2026', '22:00', '06:00', 'Telefono'],
    ['Luca Neri', '11/11/2026', null, null, 'Ferie'],
  ]);
  const map = detect(rows, opts)!;
  const res = parse(rows, map, opts);
  assert.equal(res.items.length, 3);
  assert.equal(hm(res.items[0]!.s), '2026-11-09 08:00');
  assert.equal(hm(res.items[0]!.e), '2026-11-09 16:00');
  assert.equal(hm(res.items[1]!.e), '2026-11-11 06:00');
  assert.equal(res.items[2]!.allDay, true);
});

test('ora legale: 29 marzo 2027 resta alle 09:00 locali', () => {
  const rows = roundtrip([['Nome', 'Lun 29/03/2027', 'Mar 30/03/2027'], ['Anna Verdi', '9-17', '9-17']]);
  const res = parse(rows, detect(rows, opts)!, opts);
  assert.equal(hm(res.items[0]!.s), '2027-03-29 09:00');
});

test('collegamento persone e attività', () => {
  const people = [
    { id: '1', full_name: 'Giulia Rossi', email: 'giulia.rossi@azienda.it', aliases: [], user_id: 'u1' },
    { id: '2', full_name: 'Marco Bianchi', email: null, aliases: ['Bianchi M.'], user_id: null },
    { id: '3', full_name: 'Francesca Gennari', email: null, aliases: [], user_id: null },
  ];
  assert.equal(matchPerson('Rossi Giulia', null, people).person?.id, '1');
  assert.equal(matchPerson('Chiunque', 'giulia.rossi@azienda.it', people).status, 'email');
  assert.equal(matchPerson('Bianchi M.', null, people).status, 'alias');
  assert.equal(matchPerson('Rossi G.', null, people).person?.id, '1');
  assert.equal(matchPerson('Francesca Genari', null, people).status, 'fuzzy');
  assert.equal(matchPerson('Paolo Neri', null, people).status, 'none');
  assert.equal(normName("D'Angelo Màrio"), 'angelo d mario');

  const acts = [
    { id: 'a', name: 'Telefono', aliases: ['phone', 'tel'], kind: 'work', color: '#000000', requestable: false, sort_order: 0, archived: false },
    { id: 'b', name: 'Ferie', aliases: [], kind: 'absence', color: '#000000', requestable: true, sort_order: 0, archived: false },
  ] as const;
  assert.equal(matchActivity('Phone', [...acts])?.id, 'a');
  assert.equal(matchActivity('TEL', [...acts])?.id, 'a');
  assert.equal(matchActivity('Telefono IT', [...acts])?.id, 'a');
  assert.equal(matchActivity('Chat', [...acts]), null);
});
