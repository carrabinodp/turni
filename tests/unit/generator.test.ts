import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, parsePref, profileFromHistory, withGenDefaults, toMin, isoWeekday, type GenPerson, type Pref } from '../../src/lib/generator';

const people: GenPerson[] = [
  ...Array.from({ length: 18 }, (_, i) => ({ id: `f${i}`, name: `Full ${i}`, shiftHours: 9, daysPerWeek: 5, canWeekend: true })),
  ...Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Part ${i}`, shiftHours: 6, daysPerWeek: 5, canWeekend: true })),
  { id: 'gab', name: 'Gabriella', shiftHours: 6, daysPerWeek: 5, canWeekend: true },
  { id: 'ton', name: 'Tonia', shiftHours: 4, daysPerWeek: 5, canWeekend: true },
];
const config = withGenDefaults({
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
