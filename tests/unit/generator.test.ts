import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, parsePref, parsePrefs, profileFromHistory, withGenDefaults, toMin, isoWeekday, type GenPerson, type Pref } from '../../src/lib/generator';

const people: GenPerson[] = [
  ...Array.from({ length: 18 }, (_, i) => ({ id: `f${i}`, name: `Full ${i}`, shiftHours: 9, daysPerWeek: 5, canWeekend: true })),
  ...Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Part ${i}`, shiftHours: 6, daysPerWeek: 5, canWeekend: true })),
  { id: 'gab', name: 'Gabriella', shiftHours: 6, daysPerWeek: 5, canWeekend: true },
  { id: 'ton', name: 'Tonia', shiftHours: 4, daysPerWeek: 5, canWeekend: true },
];
const config = withGenDefaults({
  weekday: { maxOffice: 99 } as never,
  rec: {
    pool: [{ person_id: 'f0', start: '08:30', end: '17:30' }, { person_id: 'f1', start: '08:30', end: '17:30' }, { person_id: 'gab', start: '08:30', end: '14:30' }],
    companions: [{ when: 'gab', person_id: 'ton', start: '14:30', end: '18:30' }],
    saturday: false,
  },
  reclami: { pool: ['f0', 'f2'] },
});
const empty = { saturdays: {}, sundays: {}, closings: {}, openings: {}, rec: {}, reclami: {} };
const run = (prefs: Pref[] = [], absences: Parameters<typeof generate>[0]['absences'] = []) =>
  generate({ month: '2027-02', people, config, prefs, absences, fixed: [], history: empty });

test('feriali: 3 aperture, 3 chiusure, sera coperta, REC e Reclami ogni giorno, 2 in ufficio ai bordi', () => {
  const r = run();
  const weekdays = r.days.filter((d) => isoWeekday(d) <= 5);
  for (const d of weekdays) {
    const day = r.shifts.filter((s) => s.day === d);
    const ops = day.filter((s) => s.role === 'op');
    assert.equal(ops.filter((s) => s.start === toMin('08:00')).length, 3, `${d} aperture`);
    assert.equal(ops.filter((s) => s.end === toMin('20:00')).length, 3, `${d} chiusure`);
    assert.ok(ops.filter((s) => s.end > toMin('18:00')).length >= 6, `${d} dopo le 18`);
    assert.ok(ops.filter((s) => s.end > toMin('18:30')).length >= 4, `${d} dopo le 18:30`);
    assert.equal(day.filter((s) => s.role === 'rec').length, 1, `${d} REC`);
    assert.equal(day.filter((s) => s.role === 'reclami').length, 1, `${d} reclami`);
    assert.ok(day.filter((s) => s.start <= toMin('08:00') && s.office).length >= 2, `${d} ufficio in apertura`);
    assert.ok(day.filter((s) => s.end >= toMin('20:00') && s.office).length >= 2, `${d} ufficio in chiusura`);
    // REC e Reclami non sono la stessa persona
    assert.notEqual(day.find((s) => s.role === 'rec')!.person_id, day.find((s) => s.role === 'reclami')!.person_id);
    // quando Gabriella fa REC, Tonia la affianca nel pomeriggio
    if (day.some((s) => s.role === 'rec' && s.person_id === 'gab')) {
      const t = day.find((s) => s.person_id === 'ton')!;
      assert.deepEqual([t.role, t.sub], ['companion', [toMin('14:30'), toMin('18:30')]]);
    }
  }
  assert.equal(r.issues.filter((i) => i.level === 'bad').length, 0, JSON.stringify(r.issues));
});

test('settimana: max una chiusura, 3 giorni in ufficio, giorni di contratto, riposo dopo il weekend', () => {
  const r = run();
  for (const w of Object.keys(r.roles)) {
    const wk = r.shifts.filter((s) => s.day >= w && s.day < w.slice(0, 8) + String(Number(w.slice(8)) + 7).padStart(2, '0'));
    const days = Array.from(new Set(wk.map((s) => s.day)));
    if (days.length < 7) continue; // settimane a cavallo
    for (const p of people) {
      const mine = wk.filter((s) => s.person_id === p.id);
      assert.ok(mine.filter((s) => s.role === 'op' && s.end === toMin('20:00') && isoWeekday(s.day) <= 5).length <= 1, `${p.id} chiusure`);
      assert.equal(mine.length, p.daysPerWeek, `${p.id} giorni nella settimana del ${w}`);
      const weekdays = mine.filter((s) => isoWeekday(s.day) <= 5);
      assert.equal(weekdays.filter((s) => s.office).length, Math.min(3, weekdays.length), `${p.id} ufficio`);
      assert.ok(mine.filter((s) => isoWeekday(s.day) >= 6).every((s) => !s.office), 'weekend in smart');
    }
  }
});

test('sabato e domenica', () => {
  const r = run();
  for (const d of r.days) {
    const day = r.shifts.filter((s) => s.day === d);
    if (isoWeekday(d) === 6) {
      assert.ok(day.length >= 6 && day.length <= 7, `${d} sabato ${day.length}`);
      assert.ok(day.filter((s) => s.start <= toMin('10:00') && s.end > toMin('10:00')).length >= 5, `${d} alle 10`);
      assert.ok(day.filter((s) => s.start <= toMin('14:00') && s.end >= toMin('18:00')).length >= 4, `${d} 14–18`);
      const late = day.filter((s) => s.end === toMin('20:00')).length;
      assert.ok(late >= 1 && late <= 2, `${d} fino alle 20`);
      assert.ok(day.every((s) => s.start >= toMin('09:00')));
    }
    if (isoWeekday(d) === 7) {
      assert.equal(day.length, 1);
      assert.deepEqual([day[0]!.start, day[0]!.end], [toMin('10:00'), toMin('18:00')]);
    }
  }
  // al massimo 2 sabati al mese a testa
  const sat = new Map<string, number>();
  r.shifts.filter((s) => isoWeekday(s.day) === 6).forEach((s) => sat.set(s.person_id, (sat.get(s.person_id) ?? 0) + 1));
  assert.ok(Math.max(...sat.values()) <= 2);
});

test('ferie e preferenze', () => {
  const prefs: Pref[] = [
    { id: '1', person_id: 'f5', text: 'riposo il 10', kind: 'off', day: '2027-02-10', weekday: null, time_a: null, time_b: null },
    { id: '2', person_id: 'f6', text: 'il martedì entro alle 10', kind: 'start_after', day: null, weekday: 2, time_a: '10:00', time_b: null },
    { id: '3', person_id: 'f7', text: 'niente chiusure', kind: 'no_close', day: null, weekday: null, time_a: null, time_b: null },
    { id: '4', person_id: 'f8', text: 'il 11 esco alle 17', kind: 'end_by', day: '2027-02-11', weekday: null, time_a: '17:00', time_b: null },
  ];
  const r = run(prefs, [{ person_id: 'f9', day: '2027-02-15', full: true, name: 'Ferie' }, { person_id: 'f9', day: '2027-02-16', full: true, name: 'Ferie' }]);
  assert.ok(!r.shifts.some((s) => s.person_id === 'f5' && s.day === '2027-02-10'));
  assert.ok(r.shifts.filter((s) => s.person_id === 'f6' && isoWeekday(s.day) === 2).every((s) => s.start >= toMin('10:00')));
  assert.ok(r.shifts.filter((s) => s.person_id === 'f7').every((s) => s.end < toMin('20:00')));
  assert.ok(r.shifts.filter((s) => s.person_id === 'f8' && s.day === '2027-02-11').every((s) => s.end <= toMin('17:00')));
  assert.ok(!r.shifts.some((s) => s.person_id === 'f9' && (s.day === '2027-02-15' || s.day === '2027-02-16')));
  assert.equal(r.issues.filter((i) => i.text.startsWith('Preferenza')).length, 0);
  // stessa variante, stessa bozza
  assert.deepEqual(run(prefs).shifts, run(prefs).shifts);
});

test('preferenze scritte a mano', () => {
  const m = '2027-02';
  assert.deepEqual(parsePref('Vorrei riposo il 12', m), { kind: 'off', day: '2027-02-12', weekday: null, time_a: null, time_b: null });
  assert.equal(parsePref('il martedì entrare dopo le 10', m).kind, 'start_after');
  assert.equal(parsePref('il martedì entrare dopo le 10', m).weekday, 2);
  assert.equal(parsePref('il martedì entrare dopo le 10', m).time_a, '10:00');
  assert.equal(parsePref('niente chiusure', m).kind, 'no_close');
  assert.equal(parsePref('no sabato', m).kind, 'no_weekend');
  const e = parsePref('il 20 devo uscire alle 16:30', m);
  assert.deepEqual([e.kind, e.day, e.time_a], ['end_by', '2027-02-20', '16:30']);
  assert.equal(parsePref('mi piacerebbe lavorare con Anna', m).kind, 'note');
});

test('profilo dallo storico', () => {
  const h = [] as { person_id: string; day: string; start: number; end: number }[];
  for (let d = 1; d <= 28; d++) {
    const day = `2026-10-${String(d).padStart(2, '0')}`;
    const wd = isoWeekday(day);
    if (wd <= 5) h.push({ person_id: 'a', day, start: 540, end: 1080 });
    if (wd <= 5) h.push({ person_id: 'b', day, start: 540, end: 900 });
  }
  const p = profileFromHistory(h);
  assert.deepEqual([p.get('a')!.shiftHours, p.get('a')!.daysPerWeek], [9, 5]);
  assert.deepEqual([p.get('b')!.shiftHours, p.get('b')!.daysPerWeek], [6, 5]);
});

test('regole particolari: ingresso massimo, ufficio, turno fisso, settimana lunga, mai smart', () => {
  const team: GenPerson[] = [
    ...people.filter((p) => !['f10', 'f11', 'f12', 'f13'].includes(p.id)),
    { id: 'van', name: 'Vanessa', shiftHours: 9, daysPerWeek: 5, canWeekend: true, officeDays: 2, maxStart: '09:30' },
    { id: 'bar', name: 'Barbara', shiftHours: 5, daysPerWeek: 4, canWeekend: true, fixed: { days: [1, 2, 3, 4], start: '09:00', end: '14:00' } },
    { id: 'fra', name: 'Francesca', shiftHours: 9, daysPerWeek: 5, canWeekend: true, weekendWeek: { days: 6, longDays: 1, shortHours: 6 } },
    { id: 'vin', name: 'Vincenzo', shiftHours: 9, daysPerWeek: 5, canWeekend: false, officeDays: 5 },
  ];
  const r = generate({ month: '2027-02', people: team, config, prefs: [], absences: [], fixed: [], history: empty });
  const of = (id: string) => r.shifts.filter((s) => s.person_id === id);
  assert.ok(of('van').every((s) => s.start <= toMin('09:30')), 'Vanessa entra entro le 9:30');
  assert.ok(of('bar').every((s) => isoWeekday(s.day) <= 4 && s.start === toMin('09:00') && s.end === toMin('14:00')), 'Barbara fissa lun–gio 9–14');
  assert.equal(of('bar').filter((s) => s.day >= '2027-02-01' && s.day <= '2027-02-07').length, 4);
  assert.ok(of('vin').every((s) => isoWeekday(s.day) <= 5 && s.office), 'Vincenzo: niente weekend, sempre in ufficio');
  // settimane piene
  for (const w of ['2027-02-01', '2027-02-08', '2027-02-15', '2027-02-22']) {
    const wk = (id: string) => of(id).filter((s) => s.day >= w && s.day <= `2027-02-${String(Number(w.slice(8)) + 6).padStart(2, '0')}`);
    assert.equal(wk('van').filter((s) => s.office).length, 2, `Vanessa 2 in ufficio (${w})`);
    const f = wk('fra');
    if (f.some((s) => isoWeekday(s.day) >= 6)) {
      assert.equal(f.length, 6, `Francesca 6 giorni nella settimana del weekend (${w})`);
      const weekdays = f.filter((s) => isoWeekday(s.day) <= 5).map((s) => (s.end - s.start) / 60).sort();
      assert.deepEqual(weekdays, [6, 6, 6, 6, 9]);
      assert.equal((f.find((s) => isoWeekday(s.day) >= 6)!.end - f.find((s) => isoWeekday(s.day) >= 6)!.start) / 60, isoWeekday(f.find((s) => isoWeekday(s.day) >= 6)!.day) === 7 ? 8 : 9);
    } else assert.equal(f.length, 5);
  }
  assert.ok(of('fra').some((s) => isoWeekday(s.day) >= 6), 'Francesca fa almeno un weekend nel mese');
});

test('preferenze del modulo Google (dicembre)', () => {
  const m = '2026-12';
  const k = (t: string) => parsePrefs(t, m).map((p) => [p.kind, p.day?.slice(5) ?? p.weekday ?? null, p.time_a, p.time_b, p.place ?? null, p.alt_day?.slice(5) ?? null, !!p.outside]);
  assert.deepEqual(k('turno 9-9.30/18-18.30 con solita pausa 13-14 per via della stanza condivisa'), [['start_window', null, '09:00', '09:30', null, null, false], ['lunch_at', null, '13:00', '14:00', null, null, false]]);
  assert.deepEqual(k('18/12 mattina please'), [['morning', '12-18', null, null, null, null, false]]);
  assert.deepEqual(k('09.00-15.00'), [['week_shift', null, '09:00', '15:00', null, null, false]]);
  assert.deepEqual(k('SE POSSIBILE NON LAVORARE SABATO 26/12/2026 E DOMENICA 27/12/2026').map((x) => x.slice(0, 2)), [['off', '12-26'], ['off', '12-27']]);
  assert.deepEqual(k('mercoledi 16 preferirei turno 08.00-12.00 in smart'), [['shift', '12-16', '08:00', '12:00', 'remote', null, false]]);
  assert.deepEqual(k('30/10').map((x) => x[6]), [true]);
  assert.deepEqual(k('se devo fare il sabato intero  chiedo il: 12/12').map((x) => x.slice(0, 2)), [['sat_pick', '12-12']]);
  assert.deepEqual(k('02/12 turno di chiusura').map((x) => x.slice(0, 2)), [['want_close', '12-02']]);
  assert.deepEqual(k('se il 24 non posso fare ferie chiedo possibilmente turno  8-12').map((x) => x.slice(0, 4)), [['shift', '12-24', '08:00', '12:00']]);
  assert.deepEqual(k('AVERE WE LIBERI NEL MESE- Disponibile a lavorare se necassario 5-12-13-19 (il 19 entro le 18)').map((x) => x.slice(0, 3)), [
    ['no_weekend', null, null], ['weekend_ok', '12-05', null], ['weekend_ok', '12-12', null], ['weekend_ok', '12-13', null], ['weekend_ok', '12-19', null], ['end_by', '12-19', '18:00'],
  ]);
  assert.deepEqual(k('riposo il 5 se non avrò riposo il 15').map((x) => [x[0], x[1], x[5]]), [['off', '12-05', '12-15']]);
  assert.deepEqual(k('no 8').map((x) => x.slice(0, 2)), [['off', '12-08']]);
  assert.deepEqual(k('11/12 ore 8-17 in smart'), [['shift', '12-11', '08:00', '17:00', 'remote', null, false]]);
  assert.deepEqual(k('domenica 20 riposo').map((x) => x.slice(0, 2)), [['off', '12-20']]);
  assert.deepEqual(k('Il mercoledì sera ho il corso di pilates, chiedo gentilmente di non fare chiusura. Grazie').map((x) => x.slice(0, 2)), [['no_close', 3]]);
});

test('il generatore applica le nuove preferenze', () => {
  const P = (id: string, person_id: string, kind: Pref['kind'], extra: Partial<Pref> = {}): Pref => ({ id, person_id, text: kind, kind, day: null, weekday: null, time_a: null, time_b: null, ...extra });
  const prefs: Pref[] = [
    P('a', 'f3', 'morning', { day: '2027-02-10' }),
    P('b', 'f4', 'want_close', { day: '2027-02-09' }),
    P('c', 'p0', 'week_shift', { time_a: '09:00', time_b: '15:00' }),
    P('d', 'p0', 'week_shift', { time_a: '10:00', time_b: '16:00' }),
    P('e', 'f5', 'start_window', { time_a: '09:00', time_b: '09:30' }),
    P('f', 'f5', 'lunch_at', { time_a: '13:00', time_b: '14:00' }),
    P('g', 'f6', 'shift', { day: '2027-02-11', time_a: '08:00', time_b: '17:00', place: 'remote' }),
    P('h', 'f7', 'off', { day: '2027-02-15' }),
    P('i', 'f7', 'off', { day: '2027-02-05', alt_for: 'h' }),
    P('j', 'f8', 'no_weekend'),
    P('k', 'f8', 'weekend_ok', { day: '2027-02-13' }),
  ];
  const r = run(prefs);
  const on = (id: string, d: string) => r.shifts.find((s) => s.person_id === id && s.day === d);
  assert.ok(on('f3', '2027-02-10')!.start <= toMin('09:00'));
  assert.equal(on('f4', '2027-02-09')!.end, toMin('20:00'));
  const p0 = r.shifts.filter((s) => s.person_id === 'p0' && isoWeekday(s.day) <= 5);
  for (const w of ['2027-02-01', '2027-02-08']) {
    const wk = p0.filter((s) => s.day >= w && s.day < (w === '2027-02-01' ? '2027-02-06' : '2027-02-13'));
    assert.equal(new Set(wk.map((s) => s.start)).size, 1, 'stessa fascia tutta la settimana');
  }
  assert.notEqual(p0.find((s) => s.day < '2027-02-06')!.start, p0.find((s) => s.day >= '2027-02-08' && s.day < '2027-02-13')!.start, 'settimana dopo, fascia diversa');
  assert.ok(r.shifts.filter((s) => s.person_id === 'f5' && isoWeekday(s.day) <= 5).every((s) => s.start >= toMin('09:00') && s.start <= toMin('09:30') && s.lunch === toMin('13:00')));
  const g = on('f6', '2027-02-11')!;
  assert.deepEqual([g.start, g.end, g.office], [toMin('08:00'), toMin('17:00'), false]);
  assert.ok(!on('f7', '2027-02-15'), 'riposo principale dato');
  assert.ok(r.shifts.filter((s) => s.person_id === 'f8' && isoWeekday(s.day) >= 6).every((s) => s.day === '2027-02-13'), 'weekend solo nel giorno disponibile');
  assert.equal(r.issues.filter((i) => i.text.startsWith('Preferenza')).length, 0, JSON.stringify(r.issues.filter((i) => i.text.startsWith('Preferenza'))));
});

test('massimo in ufficio e operativi desiderati per fascia oraria', () => {
  const targets: Record<string, (number | null)[]> = {};
  for (const wd of [1, 2, 3, 4, 5]) {
    const t: (number | null)[] = new Array(24).fill(null);
    t[9] = 14; t[10] = 16; t[11] = 16; t[14] = 12; t[15] = 12;
    targets[String(wd)] = t;
  }
  const cfg = withGenDefaults({ ...config, weekday: { ...config.weekday, maxOffice: 12 }, targets });
  const r = generate({ month: '2027-02', people, config: cfg, prefs: [], absences: [], fixed: [], history: empty });
  for (const d of r.days.filter((x) => isoWeekday(x) <= 5)) {
    const day = r.shifts.filter((s) => s.day === d);
    assert.ok(day.filter((s) => s.office).length <= 12, `${d} max 12 in ufficio`);
    assert.ok(day.filter((s) => s.start <= toMin('08:00') && s.office).length >= 2, `${d} presenza in apertura`);
  }
  assert.ok(r.shifts.filter((s) => isoWeekday(s.day) >= 6).every((s) => !s.office), 'weekend smart');
  // 25 persone × 3 giorni non entrano in 12 posti: lo segnala
  assert.ok(r.issues.some((i) => i.text.includes('ufficio pieno')));
  // con gli obiettivi per fascia la mattina è più coperta che con tutti alle 9 e basta
  const at = (d: string, h: number) => r.shifts.filter((s) => s.day === d && s.role === 'op' && s.start <= h * 60 + 15 && s.end > h * 60 + 15).length;
  const d0 = '2027-02-03';
  assert.ok(at(d0, 10) >= at(d0, 15), 'più persone alle 10 che alle 15');
});
