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

test('griglia trasposta (giorni sulle righe, persone sulle colonne) con colori', async () => {
  const { detectGridCols, detectLegend } = await import('../../src/lib/import/parse');
  const rows: Rows = [
    [null, 'Giorno', 'Borra', 'Dal Col', 'Gunia', 'Barbara Pertile', null, 'Apertura', 'Dopo 18:00'],
    [46293, 'lunedì', '09:00-18:00', 'MATERNITÀ', '09:30:18:30', '09:00-13:00', null, 6, 2],
    [46294, 'martedì', 'RIPOSO', 'MATERNITÀ', '11:00--20:00', 'RIPOSO', null, 5, 1],
    [46295, 'mercoledì', '08:00 -14:00', 'MATERNITÀ', 'RIPOSO', '14:00-20:00', null, 4, 1],
    [null, null, null, null, null, null],
    [null, null, '2 weekend', '0 weekend', '1 weekend', '1 weekend'],
    ['settimana 1', null, 1, 0, 1, 0],
    ['1° ore', null, 45, 0, 44.99999, 20],
    [null, null, null, null, null, null, null, null, null, null, 'Legenda'],
    [null, null, null, null, null, null, null, null, null, null, null, 'Ferie'],
  ];
  const fills = rows.map(() => [] as (string | null)[]);
  fills[1]![2] = 'FF0000'; // Rec
  fills[9]![10] = '92D050'; // legenda: verde = Ferie
  fills[3]![5] = '92D050';
  const map = detectGridCols(rows, opts);
  assert.ok(map);
  assert.deepEqual(map!.personCols.map((p) => p.name), ['Borra', 'Dal Col', 'Gunia', 'Barbara Pertile']);
  const res = parse(rows, map!, opts, fills);
  assert.equal(res.issues.length, 0, JSON.stringify(res.issues));
  assert.equal(res.items.filter((i) => i.name === 'Dal Col' && i.allDay).length, 3);
  assert.equal(res.items.find((i) => i.name === 'Borra')!.fill, 'FF0000');
  const gunia = res.items.filter((i) => i.name === 'Gunia');
  assert.equal(hm(gunia[0]!.s), '2026-09-28 09:30');
  assert.equal(hm(gunia[1]!.e), '2026-09-29 20:00');
  assert.equal(res.items.find((i) => i.name === 'Barbara Pertile' && i.fill)!.fill, '92D050');
  assert.equal(detectLegend([{ rows, fills }]).get('92D050'), 'Ferie');
  assert.ok(res.items.every((i) => !['settimana 1', '1° ore'].includes(i.name)));
});

test('cognome da solo collegato al nome completo', () => {
  const people = [
    { id: '1', full_name: 'Claudia Borra', email: null, aliases: [], user_id: 'u1' },
    { id: '2', full_name: 'Maria Li Vigni', email: null, aliases: [], user_id: 'u2' },
    { id: '3', full_name: 'Paolo Benincaso', email: null, aliases: [], user_id: 'u3' },
    { id: '4', full_name: 'Anna Rossi', email: null, aliases: [], user_id: 'u4' },
    { id: '5', full_name: 'Luca Rossi', email: null, aliases: [], user_id: 'u5' },
  ];
  assert.deepEqual([matchPerson('Borra', null, people).status, matchPerson('Borra', null, people).person?.id], ['surname', '1']);
  assert.equal(matchPerson('Li Vigni', null, people).person?.id, '2');
  assert.equal(matchPerson('Bennincaso', null, people).candidates[0]?.id, '3');
  assert.equal(matchPerson('Rossi', null, people).status, 'fuzzy', 'cognome condiviso: da confermare');
});

test('pause automatiche: 15 min ogni 2 ore, sfalsate di 5 min, pranzo dopo 4 ore', async () => {
  const { planBreaks, DEFAULT_POLICY } = await import('../../src/lib/breaks');
  const t = (h: number, m = 0) => Date.UTC(2026, 10, 10, h, m);
  const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  const w = (person_id: string, s: number, e: number) => ({ person_id, s, e, kind: 'work' as const });
  const blocks = [
    w('a', t(9), t(18)), // full time 9-18
    w('b', t(9), t(18)), // stessa ora: sfalsata di 5 min
    w('c', t(9), t(15)), // 6 ore: niente pranzo
    w('d', t(9), t(13)), // 4 ore
    w('e', t(9), t(18)),
    { person_id: 'e', s: t(9), e: t(18), kind: 'absence' as const }, // in ferie
    w('f', t(8), t(17)),
    { person_id: 'f', s: t(12), e: t(13), kind: 'break' as const }, // pranzo già presente
  ];
  const out = planBreaks(blocks, DEFAULT_POLICY, ['a', 'b', 'c', 'd', 'e', 'f']);
  const of = (id: string) => out.filter((x) => x.person_id === id).sort((x, y) => x.s - y.s).map((x) => `${x.type === 'lunch' ? 'P' : 'p'}${hm(x.s)}-${hm(x.e)}`);
  assert.deepEqual(of('a'), ['p11:00-11:15', 'P13:00-14:00', 'p16:00-16:15']);
  assert.deepEqual(of('b'), ['p10:55-11:10', 'P13:00-14:00', 'p15:55-16:10']);
  assert.deepEqual(of('c'), ['p10:50-11:05', 'p13:05-13:20']);
  assert.deepEqual(of('d'), ['p10:45-11:00']);
  assert.deepEqual(of('e'), []);
  assert.deepEqual(of('f'), ['p10:00-10:15', 'p15:00-15:15']);
});
test('token del calendario cifrato e decifrabile', async () => {
  process.env.CALENDAR_TOKEN_KEY = 'chiave-di-prova';
  const { encrypt, decrypt } = await import('../../src/lib/gcal');
  const blob = encrypt('1//0refresh-token');
  assert.ok(!blob.includes('refresh'), 'non in chiaro');
  assert.equal(decrypt(blob), '1//0refresh-token');
  process.env.CALENDAR_TOKEN_KEY = 'altra-chiave';
  assert.throws(() => decrypt(blob), 'chiave sbagliata non decifra');
});
