/**
 * Forecast delle chiamate e persone necessarie.
 *
 * Previsione (per ogni giorno futuro):
 *  - volume del giorno = media pesata degli ultimi N stessi giorni della settimana
 *    (il più recente pesa di più), con un eventuale trend smorzato delle ultime 4
 *    settimane rispetto alle 4 precedenti;
 *  - distribuzione nella giornata = quota media di ogni mezz'ora negli stessi giorni;
 *  - durata media (AHT) per mezz'ora dallo storico.
 * Precisione: il metodo viene provato sulle ultime settimane già avvenute
 * ("previsione alla cieca") e si usa quello che sbaglia meno.
 * Persone necessarie: Erlang C per mezz'ora, con livello di servizio e
 * occupazione massima scelti nelle impostazioni.
 */
import type { IntervalAgg } from './calls';
import { addDays, dayStart, localDate, weekStart } from './time';
import { italianHolidays } from './report';

export interface ForecastPolicy {
  sl_target: number; // % di risposte entro sl_seconds
  sl_seconds: 10 | 20 | 30 | 60 | 120;
  max_occupancy: number; // %
  history_weeks: number;
}
export const DEFAULT_FORECAST: ForecastPolicy = { sl_target: 80, sl_seconds: 20, max_occupancy: 85, history_weeks: 8 };
export const withForecastDefaults = (p?: Partial<ForecastPolicy> | null): ForecastPolicy => ({ ...DEFAULT_FORECAST, ...(p ?? {}) });

const SLOT_SEC = 1800;
const SLOTS = 48;
const DECAY = 0.85;
/** durata usata quando il file non ha la durata delle chiamate */
export const DEFAULT_AHT = 180;
export const slotAht = (s: IntervalAgg) => (s.answered && s.handle_sum_sec ? s.handle_sum_sec / s.answered : DEFAULT_AHT);

/* ---------------- Erlang C ---------------- */
export function erlangC(n: number, a: number): number {
  if (n <= a) return 1;
  let b = 1;
  for (let k = 1; k <= n; k++) b = (a * b) / (k + a * b); // Erlang B iterativa
  return (n * b) / (n - a * (1 - b));
}

export function serviceLevel(n: number, calls: number, aht: number, t: number, intervalSec = SLOT_SEC): number {
  if (calls <= 0) return 1;
  const a = (calls * aht) / intervalSec;
  if (n <= a) return 0;
  return 1 - erlangC(n, a) * Math.exp((-(n - a) * t) / aht);
}

/** persone al telefono necessarie in una mezz'ora */
export function requiredAgents(calls: number, aht: number, p: ForecastPolicy, intervalSec = SLOT_SEC): number {
  if (calls <= 0.05 || aht <= 0) return 0;
  const a = (calls * aht) / intervalSec;
  let n = Math.max(1, Math.ceil(a));
  const target = p.sl_target / 100;
  const occ = p.max_occupancy / 100;
  while (n < 300 && (serviceLevel(n, calls, aht, p.sl_seconds, intervalSec) < target || a / n > occ)) n++;
  return n;
}

/* ---------------- storico ---------------- */
export interface DayData {
  day: string;
  slots: IntervalAgg[]; // 48 elementi, coda unica (somma delle code scelte)
  offered: number;
}

const empty = (day: string, slot: number): IntervalAgg => ({
  day, slot, queue: '', offered: 0, answered: 0, abandoned: 0, short_abandoned: 0,
  ans_10: 0, ans_20: 0, ans_30: 0, ans_60: 0, ans_120: 0, wait_sum_sec: 0, handle_sum_sec: 0,
});

export function byDay(rows: IntervalAgg[], queue: string | null = null): Map<string, DayData> {
  const m = new Map<string, DayData>();
  for (const r of rows) {
    if (queue !== null && r.queue !== queue) continue;
    let d = m.get(r.day);
    if (!d) {
      d = { day: r.day, slots: Array.from({ length: SLOTS }, (_, i) => empty(r.day, i)), offered: 0 };
      m.set(r.day, d);
    }
    const s = d.slots[r.slot]!;
    for (const k of ['offered', 'answered', 'abandoned', 'short_abandoned', 'ans_10', 'ans_20', 'ans_30', 'ans_60', 'ans_120', 'wait_sum_sec', 'handle_sum_sec'] as const) {
      s[k] += Number(r[k]) || 0;
    }
    d.offered += Number(r.offered) || 0;
  }
  return m;
}

const dow = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();
const holidaysFor = (days: string[]) => {
  const years = new Set(days.map((d) => Number(d.slice(0, 4))));
  const set = new Set<string>();
  years.forEach((y) => italianHolidays(y).forEach((_, k) => set.add(k)));
  return set;
};

export function slAnswered(s: IntervalAgg, secs: ForecastPolicy['sl_seconds']) {
  return ({ 10: s.ans_10, 20: s.ans_20, 30: s.ans_30, 60: s.ans_60, 120: s.ans_120 } as const)[secs];
}

/* ---------------- previsione ---------------- */
export type Method = 'media' | 'trend';

export interface ForecastDay {
  day: string;
  total: number;
  calls: number[]; // 48
  aht: number[]; // 48, secondi
  basis: number; // giorni di storico usati
  holiday: string | null;
}

export function forecastDays(hist: Map<string, DayData>, targets: string[], p: ForecastPolicy, method: Method, cutoff?: string): ForecastDay[] {
  const allDays = Array.from(hist.keys()).sort();
  const hol = holidaysFor([...allDays, ...targets]);
  const holNames = new Map<string, string>();
  new Set([...targets].map((d) => Number(d.slice(0, 4)))).forEach((y) => italianHolidays(y).forEach((n, k) => holNames.set(k, n)));

  // AHT medio complessivo come riserva
  let hs = 0, an = 0;
  hist.forEach((d) => d.slots.forEach((s) => { hs += s.handle_sum_sec; an += s.answered; }));
  const ahtAll = an && hs ? hs / an : DEFAULT_AHT;

  return targets.flatMap((day) => {
    const cut = cutoff && cutoff < day ? cutoff : day;
    const usable = allDays.filter((d) => d < cut && hist.get(d)!.offered > 0 && !hol.has(d));
    const w = hol.has(day) ? 0 : dow(day);
    const same = usable.filter((d) => dow(d) === w).slice(-p.history_weeks).reverse();
    if (same.length < 2) return [];
    const weights = same.map((_, i) => DECAY ** i);
    const sw = weights.reduce((a, b) => a + b, 0);
    let total = same.reduce((t, d, i) => t + weights[i]! * hist.get(d)!.offered, 0) / sw;

    if (method === 'trend') {
      const last = usable.slice(-28), prev = usable.slice(-56, -28);
      if (last.length >= 14 && prev.length >= 14) {
        const mean = (l: string[]) => l.reduce((t, d) => t + hist.get(d)!.offered, 0) / l.length;
        const r = mean(last) / Math.max(1, mean(prev));
        total *= Math.min(1.15, Math.max(0.85, Math.sqrt(r)));
      }
    }

    const calls: number[] = [];
    const aht: number[] = [];
    for (let s = 0; s < SLOTS; s++) {
      let share = 0, hsum = 0, asum = 0;
      same.forEach((d, i) => {
        const dd = hist.get(d)!;
        const x = dd.slots[s]!;
        share += weights[i]! * (x.offered / dd.offered);
        hsum += weights[i]! * x.handle_sum_sec;
        asum += weights[i]! * x.answered;
      });
      calls.push((share / sw) * total);
      aht.push(asum > 0.5 && hsum > 0 ? hsum / asum : ahtAll);
    }
    return [{ day, total, calls, aht, basis: same.length, holiday: holNames.get(day) ?? null }];
  });
}

/* ---------------- precisione (prova alla cieca) ---------------- */
export interface Accuracy {
  method: Method;
  dailyError: number | null; // WAPE giornaliero, 0..1
  intervalError: number | null; // WAPE per mezz'ora
  days: number;
}

export function backtest(hist: Map<string, DayData>, p: ForecastPolicy, method: Method, weeks = 4): Accuracy {
  const days = Array.from(hist.keys()).sort();
  if (!days.length) return { method, dailyError: null, intervalError: null, days: 0 };
  const last = days[days.length - 1]!;
  let dErr = 0, dAct = 0, iErr = 0, iAct = 0, n = 0;
  for (let k = 0; k < weeks; k++) {
    const ws = addDays(weekStart(last), -7 * k);
    const test = days.filter((d) => d >= ws && d < addDays(ws, 7) && hist.get(d)!.offered > 0);
    if (!test.length) continue;
    for (const f of forecastDays(hist, test, p, method, ws)) {
      const a = hist.get(f.day)!;
      dErr += Math.abs(f.total - a.offered);
      dAct += a.offered;
      f.calls.forEach((c, s) => {
        iErr += Math.abs(c - a.slots[s]!.offered);
        iAct += a.slots[s]!.offered;
      });
      n++;
    }
  }
  return { method, dailyError: dAct ? dErr / dAct : null, intervalError: iAct ? iErr / iAct : null, days: n };
}

export function bestMethod(hist: Map<string, DayData>, p: ForecastPolicy): Accuracy {
  const a = backtest(hist, p, 'media');
  const b = backtest(hist, p, 'trend');
  if (a.dailyError === null) return b;
  if (b.dailyError === null) return a;
  return b.dailyError < a.dailyError - 0.002 ? b : a;
}

/* ---------------- persone pianificate al telefono ---------------- */
export interface SBlock { person_id: string; activity_id: string; s: number; e: number }

/** persone che a metà di ogni mezz'ora sono su un'attività telefonica (non in pausa né assenti) */
export function phoneStaffing(blocks: SBlock[], kindOf: (activityId: string) => string, phoneIds: Set<string>, days: string[], tz: string): Map<string, number[]> {
  const out = new Map<string, number[]>(days.map((d) => [d, new Array(SLOTS).fill(0)]));
  const byPerson = new Map<string, SBlock[]>();
  for (const b of blocks) {
    if (!byPerson.has(b.person_id)) byPerson.set(b.person_id, []);
    byPerson.get(b.person_id)!.push(b);
  }
  for (const day of days) {
    const arr = out.get(day)!;
    const ds = dayStart(day, tz);
    const de = dayStart(addDays(day, 1), tz);
    byPerson.forEach((list) => {
      const today = list.filter((b) => b.s < de && b.e > ds);
      if (!today.length) return;
      for (let s = 0; s < SLOTS; s++) {
        const mid = ds + (s * SLOT_SEC + SLOT_SEC / 2) * 1000;
        if (mid >= de) break;
        let best: SBlock | null = null;
        let blocked = false;
        for (const b of today) {
          if (b.s > mid || b.e <= mid) continue;
          const k = kindOf(b.activity_id);
          if (k !== 'work') blocked = true;
          else if (!best || b.e - b.s < best.e - best.s) best = b;
        }
        if (!blocked && best && phoneIds.has(best.activity_id)) arr[s]!++;
      }
    });
  }
  return out;
}

/* ---------------- analisi dello storico ---------------- */
export interface Cell {
  weekday: number; // 1 = lunedì … 7 = domenica
  slot: number;
  days: number;
  offered: number; // media per giorno
  abandoned: number;
  sl: number | null; // 0..1
  staff: number; // media pianificati al telefono
  required: number; // media necessari (sul volume reale)
}

export interface HistoryAnalysis {
  kpi: { offered: number; answered: number; abandoned: number; shortAbandoned: number; sl: number | null; asa: number | null; aht: number | null; days: number };
  cells: Cell[];
  daily: { day: string; offered: number; abandoned: number; sl: number | null; staffHours: number; requiredHours: number }[];
}

export function analyze(hist: Map<string, DayData>, staff: Map<string, number[]>, p: ForecastPolicy): HistoryAnalysis {
  const kpi = { offered: 0, answered: 0, abandoned: 0, shortAbandoned: 0, slOk: 0, wait: 0, handle: 0 };
  const cells = new Map<string, Cell & { _sla: number; _slb: number }>();
  const daily: HistoryAnalysis['daily'] = [];
  Array.from(hist.values())
    .sort((a, b) => a.day.localeCompare(b.day))
    .forEach((d) => {
      const wd = ((dow(d.day) + 6) % 7) + 1;
      const st = staff.get(d.day) ?? new Array(SLOTS).fill(0);
      let dAb = 0, dOk = 0, dBase = 0, sh = 0, rh = 0;
      d.slots.forEach((s, i) => {
        kpi.offered += s.offered;
        kpi.answered += s.answered;
        kpi.abandoned += s.abandoned;
        kpi.shortAbandoned += s.short_abandoned;
        kpi.slOk += slAnswered(s, p.sl_seconds);
        kpi.wait += s.wait_sum_sec;
        kpi.handle += s.handle_sum_sec;
        dAb += s.abandoned;
        dOk += slAnswered(s, p.sl_seconds);
        dBase += s.offered - s.short_abandoned;
        const req = s.offered ? requiredAgents(s.offered, slotAht(s), p) : 0;
        sh += st[i]! / 2;
        rh += req / 2;
        if (!s.offered && !st[i]) return;
        const k = `${wd}|${i}`;
        const c = cells.get(k) ?? { weekday: wd, slot: i, days: 0, offered: 0, abandoned: 0, sl: null, staff: 0, required: 0, _sla: 0, _slb: 0 };
        c.days++;
        c.offered += s.offered;
        c.abandoned += s.abandoned;
        c.staff += st[i]!;
        c.required += req;
        c._sla += slAnswered(s, p.sl_seconds);
        c._slb += s.offered - s.short_abandoned;
        cells.set(k, c);
      });
      daily.push({ day: d.day, offered: d.offered, abandoned: dAb, sl: dBase ? dOk / dBase : null, staffHours: sh, requiredHours: rh });
    });
  const base = kpi.offered - kpi.shortAbandoned;
  return {
    kpi: {
      offered: kpi.offered,
      answered: kpi.answered,
      abandoned: kpi.abandoned,
      shortAbandoned: kpi.shortAbandoned,
      sl: base ? kpi.slOk / base : null,
      asa: kpi.answered ? kpi.wait / kpi.answered : null,
      aht: kpi.answered ? kpi.handle / kpi.answered : null,
      days: hist.size,
    },
    cells: Array.from(cells.values()).map((c) => ({
      weekday: c.weekday, slot: c.slot, days: c.days,
      offered: c.offered / c.days, abandoned: c.abandoned / c.days,
      sl: c._slb ? c._sla / c._slb : null,
      staff: c.staff / c.days, required: c.required / c.days,
    })),
    daily,
  };
}

export const localDay = localDate;

/** previsione di un solo giorno (riga della timeline) */
export function dayForecast(rows: IntervalAgg[], day: string, p: ForecastPolicy) {
  const hist = byDay(rows);
  const actualDay = hist.get(day);
  const f = forecastDays(hist, [day], p, bestMethod(hist, p).method)[0];
  if (!f && !actualDay) return null;
  const calls = f ? f.calls : new Array(SLOTS).fill(0);
  const aht = f ? f.aht : actualDay!.slots.map(slotAht);
  // giorno passato con dati veri: necessari calcolati sulle chiamate arrivate
  const base = actualDay ? actualDay.slots.map((s) => s.offered) : calls;
  const ahtFor = (s: number) => (actualDay && actualDay.slots[s]!.answered ? slotAht(actualDay.slots[s]!) : aht[s]!);
  return {
    calls,
    required: base.map((c, s) => requiredAgents(c, ahtFor(s), p)),
    actual: actualDay ? actualDay.slots.map((s) => s.offered) : null,
    holiday: f?.holiday ?? null,
  };
}
