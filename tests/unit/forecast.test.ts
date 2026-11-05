import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import type { Rows } from '../../src/lib/import/parse';
import { detectCalls, parseCalls, parseSeconds, aggregate, type Call } from '../../src/lib/calls';
import { requiredAgents, serviceLevel, byDay, forecastDays, bestMethod, analyze, phoneStaffing, DEFAULT_FORECAST } from '../../src/lib/forecast';
import { addDays, localToUtc } from '../../src/lib/time';

const tz = 'Europe/Rome';

function roundtrip(aoa: unknown[][]): Rows {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Chiamate');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const back = XLSX.read(buf, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(back.Sheets['Chiamate']!, { header: 1, raw: true, defval: null }) as Rows;
}

test('durate in tutti i formati', () => {
  assert.equal(parseSeconds(83), 83);
  assert.equal(parseSeconds('00:01:23'), 83);
  assert.equal(parseSeconds('1:23'), 83);
  assert.equal(parseSeconds('1m 23s'), 83);
  assert.equal(parseSeconds(83 / 86400), 83);
  assert.equal(parseSeconds(''), null);
});

test('elenco chiamate tipico del centralino: colonne, esiti, uscenti, fasce', () => {
  const rows = roundtrip([
    ['Report chiamate'],
    ['Data e ora', 'Numero chiamante', 'Operatore', 'Esito', 'Tempo di attesa', 'Durata conversazione', 'Direzione'],
    ['05/11/2026 09:05:10', '3331234567', 'Mario', 'Risposta', '00:00:12', '00:03:00', 'Entrante'],
    ['05/11/2026 09:29:59', '3331234567', 'Mario', 'Non risposta', '00:00:40', '00:00:00', 'Entrante'],
    ['05/11/2026 09:30:00', '3331234567', 'Anna', 'Abbandonata', '00:00:03', '', 'Entrante'],
    ['05/11/2026 09:45:00', '3331234567', 'Anna', 'Risposta', '00:00:25', '00:05:00', 'Entrante'],
    ['05/11/2026 10:00:00', '3331234567', 'Anna', 'Risposta', '00:00:05', '00:02:00', 'Uscente'],
    ['', '', '', '', '', '', ''],
    ['data sbagliata', '', '', 'Risposta', '', '', 'Entrante'],
  ]);
  const map = detectCalls(rows)!;
  assert.ok(map);
  assert.equal(map.headerRow, 1);
  assert.equal(map.datetime, 0);
  assert.equal(map.outcome, 3);
  assert.equal(map.wait, 4);
  assert.equal(map.talk, 5);
  assert.equal(map.direction, 6);
  const p = parseCalls(rows, map, tz, 2026);
  assert.equal(p.calls.length, 4);
  assert.equal(p.outbound, 1);
  assert.equal(p.skipped, 1);
  const agg = aggregate(p.calls, tz, false);
  assert.deepEqual(agg.map((a) => [a.slot, a.offered, a.answered, a.abandoned, a.short_abandoned, a.ans_20]), [
    [18, 2, 1, 1, 0, 1],
    [19, 2, 1, 1, 1, 0],
  ]);
  assert.equal(agg[0]!.handle_sum_sec, 180);
  // nessun dato personale nei totali
  assert.ok(!JSON.stringify(agg).includes('Mario') && !JSON.stringify(agg).includes('333'));
});

test('data e ora in colonne separate, numeri Excel', () => {
  const rows = roundtrip([
    ['Data', 'Ora', 'Stato', 'Attesa (sec)', 'Durata'],
    [46331, 0.375, 'answered', 8, 200], // 5/11/2026 09:00
    [46331, 0.6, 'missed', 30, 0], // 14:24
  ]);
  const map = detectCalls(rows)!;
  assert.equal(map.date, 0);
  assert.equal(map.time, 1);
  const p = parseCalls(rows, map, tz, 2026);
  const agg = aggregate(p.calls, tz, false);
  assert.deepEqual(agg.map((a) => [a.day, a.slot, a.answered, a.abandoned]), [
    ['2026-11-05', 18, 1, 0],
    ['2026-11-05', 28, 0, 1],
  ]);
});

test('Erlang C: valori di riferimento e soglie', () => {
  // 100 chiamate in 30 min, 3 min l'una = 10 erlang
  const p = DEFAULT_FORECAST;
  const n = requiredAgents(100, 180, p);
  assert.ok(serviceLevel(n, 100, 180, 20) >= 0.8);
  assert.ok(serviceLevel(n - 1, 100, 180, 20) < 0.8 || 10 / (n - 1) > 0.85);
  assert.ok(n >= 12 && n <= 14, `n=${n}`);
  assert.equal(requiredAgents(0, 180, p), 0);
  assert.equal(requiredAgents(1, 180, p), 1);
  // più servizio = più persone
  assert.ok(requiredAgents(100, 180, { ...p, sl_target: 95 }) > n);
});

/** storico sintetico: lunedì 200 chiamate, altri giorni 100, domenica 20; picco alle 10 */
function synth(weeks: number, growth = 1): Call[] {
  const calls: Call[] = [];
  const start = '2026-08-03'; // lunedì
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let d = 0; d < weeks * 7; d++) {
    const day = addDays(start, d);
    const dow = d % 7;
    const base = (dow === 0 ? 200 : dow === 6 ? 20 : 100) * growth ** Math.floor(d / 7);
    const n = Math.round(base * (0.95 + rnd() * 0.1));
    for (let i = 0; i < n; i++) {
      // 9-18, più fitto alle 10
      const h = rnd() < 0.3 ? 10 : 9 + Math.floor(rnd() * 9);
      const m = Math.floor(rnd() * 60);
      const s = localToUtc(day, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, tz);
      const answered = rnd() < 0.9;
      calls.push({ s, answered, wait: Math.floor(rnd() * 40), handle: answered ? 150 + Math.floor(rnd() * 60) : 0, queue: '' });
    }
  }
  return calls;
}

test('previsione stabile: volume, profilo e precisione', () => {
  const hist = byDay(aggregate(synth(10), tz, false));
  const acc = bestMethod(hist, DEFAULT_FORECAST);
  assert.ok(acc.dailyError !== null && acc.dailyError < 0.06, `errore ${acc.dailyError}`);
  const next = ['2026-10-12', '2026-10-13', '2026-10-18']; // lun, mar, dom
  const f = forecastDays(hist, next, DEFAULT_FORECAST, acc.method);
  assert.equal(f.length, 3);
  assert.ok(Math.abs(f[0]!.total - 200) < 12, `lun ${f[0]!.total}`);
  assert.ok(Math.abs(f[1]!.total - 100) < 6, `mar ${f[1]!.total}`);
  assert.ok(Math.abs(f[2]!.total - 20) < 3, `dom ${f[2]!.total}`);
  // la fascia delle 10 è la più alta, di notte zero
  const peak = f[1]!.calls.indexOf(Math.max(...f[1]!.calls));
  assert.ok(peak === 20 || peak === 21);
  assert.equal(f[1]!.calls[4], 0);
  assert.ok(Math.abs(f[1]!.calls.reduce((a, b) => a + b, 0) - f[1]!.total) < 1e-6);
  assert.ok(f[1]!.aht[20]! > 150 && f[1]!.aht[20]! < 210);
});

test('previsione con crescita: il trend migliora la precisione', () => {
  const hist = byDay(aggregate(synth(10, 1.04), tz, false));
  const acc = bestMethod(hist, DEFAULT_FORECAST);
  assert.equal(acc.method, 'trend');
});

test('festivi: esclusi dallo storico e previsti come la domenica', () => {
  const hist = byDay(aggregate(synth(16), tz, false)); // fino a metà novembre
  const f = forecastDays(hist, ['2026-12-08'], DEFAULT_FORECAST, 'media'); // Immacolata, martedì
  assert.equal(f[0]!.holiday, 'Immacolata');
  assert.ok(f[0]!.total < 30);
});

test('copertura al telefono e analisi dello storico', () => {
  const day = '2026-11-05';
  const at = (h: string) => localToUtc(day, h, tz);
  const kinds: Record<string, string> = { tel: 'work', back: 'work', pausa: 'break', ferie: 'absence' };
  const blocks = [
    { person_id: 'a', activity_id: 'tel', s: at('09:00'), e: at('13:00') },
    { person_id: 'a', activity_id: 'pausa', s: at('10:05'), e: at('10:20') },
    { person_id: 'b', activity_id: 'tel', s: at('09:00'), e: at('18:00') },
    { person_id: 'b', activity_id: 'back', s: at('11:00'), e: at('12:00') },
    { person_id: 'c', activity_id: 'ferie', s: at('00:00'), e: at('23:59') },
  ];
  const st = phoneStaffing(blocks, (id) => kinds[id]!, new Set(['tel']), [day], tz).get(day)!;
  assert.equal(st[18], 2); // 09:00
  assert.equal(st[20], 1); // 10:00: a in pausa a metà fascia
  assert.equal(st[22], 1); // 11:00 b su back office
  assert.equal(st[26], 1); // 13:00 solo b
  const hist = byDay(aggregate(synth(2), tz, false));
  const an = analyze(hist, new Map(), DEFAULT_FORECAST);
  assert.equal(an.kpi.days, 14);
  assert.ok(an.kpi.sl! > 0 && an.kpi.sl! <= 1);
  assert.ok(an.cells.some((c) => c.weekday === 1 && c.slot === 20 && c.required > 0));
});

test('export "Segments - List" del centralino DentalPro (filtri sopra, durate mm:ss, "—" se non risposta)', () => {
  const rows = roundtrip([
    ['Applied filters:', 'Area IN ((empty value))'],
    [null, 'Date BETWEEN THIS-96 AND THIS'],
    [null, null],
    ['#', 'Date', 'Time', 'Agent', 'External Contact', 'Area', 'Customer Phone', 'Waiting', 'Talk Time', 'Wrap Up'],
    ['id1', 46330, '09:14', '', '+390000000001', '', 'sip:x', '00:07', '—', '—'],
    ['id2', 46330, '09:13', 'AZIENDA\\Op1', '+390000000002', '', 'sip:x', '00:05', '00:54', '00:01'],
    ['id3', 46330, '09:44', 'AZIENDA\\Op2', '+390000000003', '', 'sip:x', '01:38', '01:03', '01:00'],
  ]);
  const map = detectCalls(rows)!;
  assert.deepEqual([map.headerRow, map.date, map.time, map.wait, map.talk, map.acw], [3, 1, 2, 7, 8, 9]);
  const agg = aggregate(parseCalls(rows, map, tz, 2026).calls, tz, false);
  assert.deepEqual(agg.map((a) => [a.day, a.slot, a.offered, a.answered, a.abandoned, a.ans_20, a.handle_sum_sec]), [
    ['2026-11-04', 18, 2, 1, 1, 1, 55],
    ['2026-11-04', 19, 1, 1, 0, 0, 123],
  ]);
  assert.ok(!JSON.stringify(agg).includes('Op1') && !JSON.stringify(agg).includes('+39'));
});
