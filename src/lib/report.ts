/**
 * Riepilogo mensile per operatore.
 * Regole di calcolo (riportate anche nella pagina):
 *  - Ore lavorate: dall'inizio alla fine delle attività lavorative, togliendo le
 *    pause lunghe (pranzo, ≥ 30 min) e i permessi a ore. Le pause brevi restano
 *    dentro (pause da videoterminale, retribuite).
 *  - Giorno lavorato: giorno con almeno un'attività lavorativa.
 *  - Assenza a giornata: assenza in un giorno senza lavoro → conta come giorno.
 *    Assenza a ore: assenza in un giorno con lavoro → conta in ore.
 *  - Ore per attività: in ogni momento conta l'attività più specifica (la più breve
 *    tra quelle sovrapposte), senza pause e assenze.
 */
import { addDays, dayStart, localDate } from './time';

export interface RBlock {
  person_id: string;
  activity_id: string;
  s: number;
  e: number;
}
export interface RActivity {
  id: string;
  name: string;
  kind: 'work' | 'break' | 'absence';
}
export interface RMark {
  person_id: string;
  day: string;
  type: string;
}

export interface DayDetail {
  day: string;
  start: number | null;
  end: number | null;
  workedMin: number;
  breakMin: number;
  lunchMin: number;
  dayType: string | null;
  absences: { name: string; min: number; fullDay: boolean }[];
  activities: Record<string, number>;
  sunday: boolean;
  holiday: string | null;
}

export interface PersonSummary {
  person_id: string;
  daysWorked: number;
  workedMin: number;
  breakMin: number;
  lunchMin: number;
  sundaysWorked: number;
  holidaysWorked: number;
  dayTypes: Record<string, number>;
  absenceDays: Record<string, number>;
  absenceMin: Record<string, number>;
  activityMin: Record<string, number>;
  days: DayDetail[];
}

const MIN = 60000;
const LUNCH_MIN = 30;

/* ---------------- festività nazionali italiane ---------------- */
function easter(y: number): string {
  // algoritmo di Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function italianHolidays(y: number, extra: Record<string, string> = {}): Map<string, string> {
  const m = new Map<string, string>([
    [`${y}-01-01`, 'Capodanno'],
    [`${y}-01-06`, 'Epifania'],
    [easter(y), 'Pasqua'],
    [addDays(easter(y), 1), 'Lunedì dell’Angelo'],
    [`${y}-04-25`, 'Festa della Liberazione'],
    [`${y}-05-01`, 'Festa del Lavoro'],
    [`${y}-06-02`, 'Festa della Repubblica'],
    [`${y}-08-15`, 'Ferragosto'],
    [`${y}-11-01`, 'Ognissanti'],
    [`${y}-12-08`, 'Immacolata'],
    [`${y}-12-25`, 'Natale'],
    [`${y}-12-26`, 'Santo Stefano'],
  ]);
  for (const [md, name] of Object.entries(extra)) m.set(`${y}-${md}`, name);
  return m;
}

/* ---------------- intervalli ---------------- */
type Iv = [number, number];
function union(list: Iv[]): Iv[] {
  const r = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Iv[] = [];
  for (const [a, b] of r) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
function minus(base: Iv[], cut: Iv[]): Iv[] {
  let cur = union(base);
  for (const [a, b] of union(cut)) {
    const next: Iv[] = [];
    for (const [x, y] of cur) {
      if (b <= x || a >= y) next.push([x, y]);
      else {
        if (a > x) next.push([x, a]);
        if (b < y) next.push([b, y]);
      }
    }
    cur = next;
  }
  return cur;
}
const len = (l: Iv[]) => l.reduce((t, [a, b]) => t + (b - a), 0) / MIN;

/* ---------------- calcolo ---------------- */
export function monthlySummary(
  blocks: RBlock[],
  activities: RActivity[],
  marks: RMark[],
  personIds: string[],
  month: string, // 'YYYY-MM'
  tz: string,
  extraHolidays: Record<string, string> = {},
): PersonSummary[] {
  const act = new Map(activities.map((a) => [a.id, a]));
  const first = `${month}-01`;
  const next = addDays(first, 32).slice(0, 8) + '01';
  const days: string[] = [];
  for (let d = first; d < next; d = addDays(d, 1)) days.push(d);
  const hol = italianHolidays(Number(month.slice(0, 4)), extraHolidays);
  const markOf = new Map(marks.map((m) => [`${m.person_id}|${m.day}`, m.type]));

  // blocchi per persona e giorno (giorno = data locale di inizio)
  const byPD = new Map<string, RBlock[]>();
  for (const b of blocks) {
    const d = localDate(b.s, tz);
    if (d < first || d >= next) continue;
    const k = `${b.person_id}|${d}`;
    if (!byPD.has(k)) byPD.set(k, []);
    byPD.get(k)!.push(b);
  }

  return personIds.map((pid) => {
    const sum: PersonSummary = {
      person_id: pid, daysWorked: 0, workedMin: 0, breakMin: 0, lunchMin: 0, sundaysWorked: 0, holidaysWorked: 0,
      dayTypes: {}, absenceDays: {}, absenceMin: {}, activityMin: {}, days: [],
    };
    for (const day of days) {
      const list = byPD.get(`${pid}|${day}`) ?? [];
      const kind = (b: RBlock) => act.get(b.activity_id)?.kind ?? 'work';
      const work = list.filter((b) => kind(b) === 'work');
      const brk = list.filter((b) => kind(b) === 'break');
      const abs = list.filter((b) => kind(b) === 'absence');
      const dow = new Date(day + 'T12:00:00Z').getUTCDay();
      const dt = markOf.get(`${pid}|${day}`) ?? null;
      const detail: DayDetail = {
        day, start: null, end: null, workedMin: 0, breakMin: 0, lunchMin: 0, dayType: dt, absences: [], activities: {},
        sunday: dow === 0, holiday: hol.get(day) ?? null,
      };

      if (work.length) {
        const span = union([...work, ...brk].map((b) => [b.s, b.e] as Iv));
        const lunches = brk.filter((b) => b.e - b.s >= LUNCH_MIN * MIN).map((b) => [b.s, b.e] as Iv);
        const shorts = brk.filter((b) => b.e - b.s < LUNCH_MIN * MIN).map((b) => [b.s, b.e] as Iv);
        const absIv = abs.map((b) => [b.s, b.e] as Iv);
        const worked = minus(span, [...lunches, ...absIv]);
        detail.start = Math.min(...span.map((x) => x[0]));
        detail.end = Math.max(...span.map((x) => x[1]));
        detail.workedMin = Math.round(len(worked));
        detail.lunchMin = Math.round(len(minus(union(lunches), absIv)));
        detail.breakMin = Math.round(len(minus(union(shorts), absIv)));

        // ore per attività: a passi di 5 minuti, vince il blocco più breve che copre l'istante
        for (let t = detail.start; t < detail.end; t += 5 * MIN) {
          const mid = t + 2.5 * MIN;
          if ([...lunches, ...shorts, ...absIv].some(([a, b]) => a <= mid && b > mid)) continue;
          let best: RBlock | null = null;
          for (const b of work) if (b.s <= mid && b.e > mid && (!best || b.e - b.s < best.e - best.s)) best = b;
          if (!best) continue;
          const name = act.get(best.activity_id)?.name ?? 'Attività';
          detail.activities[name] = (detail.activities[name] ?? 0) + 5;
        }

        sum.daysWorked++;
        sum.workedMin += detail.workedMin;
        sum.breakMin += detail.breakMin;
        sum.lunchMin += detail.lunchMin;
        if (detail.sunday) sum.sundaysWorked++;
        if (detail.holiday) sum.holidaysWorked++;
        if (dt) sum.dayTypes[dt] = (sum.dayTypes[dt] ?? 0) + 1;
        for (const [n, m] of Object.entries(detail.activities)) sum.activityMin[n] = (sum.activityMin[n] ?? 0) + m;
      }

      // assenze: giornata intera se quel giorno non si lavora, altrimenti a ore
      const absByType = new Map<string, Iv[]>();
      for (const b of abs) {
        const n = act.get(b.activity_id)?.name ?? 'Assenza';
        if (!absByType.has(n)) absByType.set(n, []);
        absByType.get(n)!.push([b.s, b.e]);
      }
      const dayIv: Iv = [dayStart(day, tz), dayStart(addDays(day, 1), tz)];
      absByType.forEach((iv, n) => {
        const clipped = union(iv.map(([a, b]) => [Math.max(a, dayIv[0]), Math.min(b, dayIv[1])] as Iv));
        const m = Math.round(len(clipped));
        const fullDay = !work.length;
        detail.absences.push({ name: n, min: m, fullDay });
        if (fullDay) sum.absenceDays[n] = (sum.absenceDays[n] ?? 0) + 1;
        else sum.absenceMin[n] = (sum.absenceMin[n] ?? 0) + m;
      });

      if (work.length || abs.length) sum.days.push(detail);
    }
    return sum;
  });
}

export const hours = (min: number) => Math.round((min / 60) * 100) / 100;
