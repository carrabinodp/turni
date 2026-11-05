/**
 * Generatore di turni mensile.
 *
 * Non sostituisce il responsabile: produce una bozza che rispetta le regole del
 * team e segnala ciò che non è riuscito a rispettare. La bozza si salva nelle
 * settimane non pubblicate e si ritocca in timeline prima di pubblicarla.
 *
 * Regole (configurabili in GenConfig):
 *  Lun–ven, 08–20
 *   - 3 operativi aprono alle 8 e 3 chiudono alle 20; ognuno al massimo una chiusura a settimana
 *   - dopo le 18 almeno 6 operativi, dopo le 18:30 almeno 4; il resto entra alle 9 (picco di chiamate)
 *   - ogni giorno una persona fa REC (08:30–17:30, o il suo orario) e non conta come operativa;
 *     se fa REC una persona con un "affiancamento", un'altra fa REC nel pomeriggio (es. 14:30–18:30)
 *   - una persona a settimana fa Reclami: non è operativa e si usa per aprire o chiudere
 *   - all'apertura e alla chiusura almeno 2 persone in ufficio
 *   - 3 giorni in ufficio e il resto in smart (sabato e domenica sempre smart)
 *  Sabato 09–20: 6 persone (max 7), almeno 5 alle 10 e 4 dalle 14 alle 18, 1 (max 2) fino alle 20
 *  Domenica: 1 persona 10–18
 *  Chi lavora nel weekend riposa un giorno in settimana; sabati e domeniche a rotazione.
 *  Ferie, malattie e permessi a giornata sono vincoli fissi; le preferenze sono rispettate
 *  quando possibile e, se no, segnalate.
 */

export interface GenPerson {
  id: string;
  name: string;
  shiftHours: number; // durata del turno, pausa pranzo compresa (9 = 8 ore + pranzo)
  daysPerWeek: number;
  canWeekend: boolean;
  /** giorni in ufficio a settimana (vuoto = regola generale; 5 = mai in smart) */
  officeDays?: number | null;
  /** ora di ingresso più tarda possibile (es. 09:30) */
  maxStart?: string | null;
  /** turno fisso: giorni (1 = lun … 7 = dom) e orario */
  fixed?: { days: number[]; start: string; end: string } | null;
  /** settimana con il weekend: giorni totali, quanti feriali lunghi, ore dei feriali corti */
  weekendWeek?: { days: number; longDays: number; shortHours: number } | null;
  /** lavora in un'altra sede: sempre "in presenza", ma non occupa posti qui e non conta per apertura/chiusura */
  otherSite?: boolean;
}

export type PersonRule = Pick<GenPerson, 'officeDays' | 'maxStart' | 'fixed' | 'weekendWeek' | 'otherSite'>;

export interface RecEntry { person_id: string; start: string; end: string }
export interface Companion { when: string; person_id: string; start: string; end: string }

export interface GenConfig {
  weekday: {
    open: string; close: string; openOps: number; closeOps: number;
    after1800: number; after1830: number; officeAtOpen: number; officeAtClose: number; maxClosePerWeek: number;
    /** persone al massimo in ufficio nello stesso giorno */
    maxOffice: number;
  };
  saturday: { enabled: boolean; open: string; close: string; people: number; maxPeople: number; at1000: number; afternoon: number; closeMin: number; closeMax: number };
  sunday: { enabled: boolean; people: number; start: string; end: string };
  rec: { pool: RecEntry[]; companions: Companion[]; saturday: boolean };
  reclami: { pool: string[] };
  officeDaysPerWeek: number;
  maxSaturdaysPerMonth: number;
  activities: { phone: string | null; rec: string | null; reclami: string | null; sunday?: string | null };
  dayTypes: { office: string | null; remote: string | null };
  /** operativi desiderati per fascia oraria: giorno della settimana (1–7) → 24 valori, uno per ora (null = nessuna preferenza) */
  targets?: Record<string, (number | null)[]>;
  /** regole particolari per persona */
  personRules?: Record<string, PersonRule>;
  /** assegnazioni scelte a mano per settimana (lunedì → persona) */
  weekRoles?: Record<string, { rec?: string | null; reclami?: string | null }>;
}

export const DEFAULT_GEN: GenConfig = {
  weekday: { open: '08:00', close: '20:00', openOps: 3, closeOps: 3, after1800: 6, after1830: 4, officeAtOpen: 2, officeAtClose: 2, maxClosePerWeek: 1, maxOffice: 12 },
  saturday: { enabled: true, open: '09:00', close: '20:00', people: 6, maxPeople: 7, at1000: 5, afternoon: 4, closeMin: 1, closeMax: 2 },
  sunday: { enabled: true, people: 1, start: '10:00', end: '18:00' },
  rec: { pool: [], companions: [], saturday: false },
  reclami: { pool: [] },
  officeDaysPerWeek: 3,
  maxSaturdaysPerMonth: 2,
  activities: { phone: null, rec: null, reclami: null },
  dayTypes: { office: null, remote: null },
};

export function withGenDefaults(c?: Partial<GenConfig> | null): GenConfig {
  const x = c ?? {};
  return {
    ...DEFAULT_GEN,
    ...x,
    weekday: { ...DEFAULT_GEN.weekday, ...(x.weekday ?? {}) },
    saturday: { ...DEFAULT_GEN.saturday, ...(x.saturday ?? {}) },
    sunday: { ...DEFAULT_GEN.sunday, ...(x.sunday ?? {}) },
    rec: { ...DEFAULT_GEN.rec, ...(x.rec ?? {}) },
    reclami: { ...DEFAULT_GEN.reclami, ...(x.reclami ?? {}) },
    activities: { ...DEFAULT_GEN.activities, ...(x.activities ?? {}) },
    dayTypes: { ...DEFAULT_GEN.dayTypes, ...(x.dayTypes ?? {}) },
  };
}

import { parsePrefs, type PrefKind } from './prefParse';
export { parsePrefs, type PrefKind };
export interface Pref {
  id: string;
  person_id: string;
  text: string;
  kind: PrefKind;
  day: string | null; // giorno preciso
  weekday: number | null; // 1 = lunedì … 7 = domenica (ricorrente)
  time_a: string | null;
  time_b: string | null;
  place?: 'office' | 'remote' | null;
  /** alternativa a un'altra preferenza: vale solo se quella viene tolta */
  alt_for?: string | null;
}

export interface Absence { person_id: string; day: string; full: boolean; name: string; s?: number; e?: number }
/** turni già esistenti nei giorni fuori dal mese (settimane a cavallo) */
export interface FixedDay { person_id: string; day: string; start: number; end: number }
/** conteggi delle settimane precedenti, per ruotare in modo equo */
export interface History { saturdays: Record<string, number>; sundays: Record<string, number>; closings: Record<string, number>; openings: Record<string, number>; rec: Record<string, number>; reclami: Record<string, number> }

export type Role = 'op' | 'rec' | 'reclami' | 'companion';
export interface GenShift {
  person_id: string;
  day: string;
  start: number; // minuti dalla mezzanotte
  end: number;
  role: Role;
  sub?: [number, number]; // blocco REC dentro il turno (affiancamento)
  office: boolean;
  fixed?: boolean;
  /** pranzo a orario fisso (minuti) */
  lunch?: number;
}

export interface GenIssue { day: string | null; person_id?: string; level: 'warn' | 'bad'; text: string }

export interface GenResult {
  shifts: GenShift[];
  issues: GenIssue[];
  roles: Record<string, { rec: string | null; reclami: string | null }>; // per settimana
  days: string[];
}

/* ---------------- utilità ---------------- */
export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const addDays = (d: string, n: number) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, dd! + n)).toISOString().slice(0, 10);
};
const isoDow = (d: string) => ((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1; // 1 = lun
const weekOf = (d: string) => addDays(d, -(isoDow(d) - 1));

/** generatore pseudo-casuale riproducibile: stessa bozza a parità di dati e "variante" */
function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/* ---------------- preferenze ---------------- */
const MONTHWIDE: PrefKind[] = ['no_close', 'no_open', 'no_weekend', 'start_window', 'lunch_at', 'morning', 'want_close', 'place'];
const prefApplies = (p: Pref, day: string) => (p.day ? p.day === day : p.weekday ? p.weekday === isoDow(day) : MONTHWIDE.includes(p.kind));

interface DayRules {
  off: boolean; startAfter: number | null; startBy: number | null; endBy: number | null; noClose: boolean; noOpen: boolean;
  shift: [number, number] | null; wantClose: boolean; place: 'office' | 'remote' | null; lunch: number | null; weekendOk: boolean; prefs: Pref[];
}
function rulesFor(prefs: Pref[], day: string): DayRules {
  const r: DayRules = { off: false, startAfter: null, startBy: null, endBy: null, noClose: false, noOpen: false, shift: null, wantClose: false, place: null, lunch: null, weekendOk: false, prefs: [] };
  const weekend = isoDow(day) >= 6;
  if (prefs.some((p) => p.kind === 'weekend_ok' && p.day === day)) r.weekendOk = true;
  for (const p of prefs) {
    if (!prefApplies(p, day)) continue;
    if (p.kind === 'note' || p.kind === 'week_shift' || p.kind === 'sat_pick' || p.kind === 'weekend_ok') continue;
    r.prefs.push(p);
    if (p.kind === 'off') r.off = true;
    if (p.kind === 'no_weekend' && weekend && !r.weekendOk) r.off = true;
    if (p.kind === 'start_after' && p.time_a) r.startAfter = Math.max(r.startAfter ?? 0, toMin(p.time_a));
    if (p.kind === 'start_window' && p.time_a && p.time_b) {
      r.startAfter = Math.max(r.startAfter ?? 0, toMin(p.time_a));
      r.startBy = Math.min(r.startBy ?? 1440, toMin(p.time_b));
    }
    if (p.kind === 'morning') r.startBy = Math.min(r.startBy ?? 1440, toMin('09:00'));
    if (p.kind === 'end_by' && p.time_a) r.endBy = Math.min(r.endBy ?? 1440, toMin(p.time_a));
    if (p.kind === 'no_close') r.noClose = true;
    if (p.kind === 'no_open') r.noOpen = true;
    if (p.kind === 'want_close') r.wantClose = true;
    if (p.kind === 'lunch_at' && p.time_a) r.lunch = toMin(p.time_a);
    if (p.kind === 'shift' && p.time_a && p.time_b) r.shift = [toMin(p.time_a), toMin(p.time_b)];
    if ((p.kind === 'shift' || p.kind === 'place' || p.kind === 'morning') && p.place) r.place = p.place;
  }
  return r;
}

/* ---------------- generazione ---------------- */
export function generate(input: {
  month: string; // 'YYYY-MM'
  people: GenPerson[];
  config: GenConfig;
  prefs: Pref[];
  absences: Absence[];
  fixed: FixedDay[];
  history: History;
  holidays?: Set<string>; // festivi: come la domenica
  variant?: number;
}): GenResult {
  const { month, people, config: c } = input;
  const rand = rng(1 + (input.variant ?? 0) * 7919 + month.split('-').map(Number).reduce((a, b) => a * 13 + b, 0));
  const first = `${month}-01`;
  const next = addDays(first, 32).slice(0, 8) + '01';
  const monthDays: string[] = [];
  for (let d = first; d < next; d = addDays(d, 1)) monthDays.push(d);
  const weeks: string[] = [];
  for (let w = weekOf(first); w < next; w = addDays(w, 7)) weeks.push(w);
  const inMonth = (d: string) => d >= first && d < next;

  const byId = new Map(people.map((p) => [p.id, p]));
  // un'alternativa vale solo se la preferenza principale è stata tolta o lasciata come nota
  const prefById = new Map(input.prefs.map((p) => [p.id, p]));
  const activePrefs = input.prefs.filter((p) => !p.alt_for || !prefById.has(p.alt_for) || prefById.get(p.alt_for)!.kind === 'note');
  const prefsOf = new Map<string, Pref[]>();
  activePrefs.forEach((p) => {
    if (!prefsOf.has(p.person_id)) prefsOf.set(p.person_id, []);
    prefsOf.get(p.person_id)!.push(p);
  });
  const absKey = new Map<string, Absence>();
  input.absences.forEach((a) => {
    const k = `${a.person_id}|${a.day}`;
    const prev = absKey.get(k);
    if (!prev || a.full) absKey.set(k, a);
  });
  const fixedKey = new Map(input.fixed.map((f) => [`${f.person_id}|${f.day}`, f]));
  const isHoliday = (d: string) => input.holidays?.has(d) ?? false;

  const shifts: GenShift[] = [];
  const issues: GenIssue[] = [];
  const roles: GenResult['roles'] = {};

  // contatori del mese (+ storico pesato) per l'equità
  const cnt = {
    sat: new Map<string, number>(), sun: new Map<string, number>(), close: new Map<string, number>(),
    open: new Map<string, number>(), late: new Map<string, number>(), rec: new Map<string, number>(), recl: new Map<string, number>(),
  };
  const inc = (m: Map<string, number>, id: string, n = 1) => m.set(id, (m.get(id) ?? 0) + n);
  const get = (m: Map<string, number>, id: string) => m.get(id) ?? 0;
  people.forEach((p) => {
    cnt.sat.set(p.id, (input.history.saturdays[p.id] ?? 0) * 0.5);
    cnt.sun.set(p.id, (input.history.sundays[p.id] ?? 0) * 0.5);
    cnt.close.set(p.id, (input.history.closings[p.id] ?? 0) * 0.3);
    cnt.open.set(p.id, (input.history.openings[p.id] ?? 0) * 0.3);
    cnt.rec.set(p.id, input.history.rec[p.id] ?? 0);
    cnt.recl.set(p.id, input.history.reclami[p.id] ?? 0);
  });
  const satThisMonth = new Map<string, number>();

  const available = (pid: string, d: string) => {
    const a = absKey.get(`${pid}|${d}`);
    if (a?.full) return false;
    return !rulesFor(prefsOf.get(pid) ?? [], d).off;
  };
  const W = c.weekday;
  const openM = toMin(W.open), closeM = toMin(W.close);

  const weekOpts = (pid: string) =>
    (prefsOf.get(pid) ?? []).filter((p) => p.kind === 'week_shift' && p.time_a && p.time_b).sort((a, b) => (a.time_a! < b.time_a! ? -1 : 1));
  const satPicks = (pid: string) => (prefsOf.get(pid) ?? []).filter((p) => p.kind === 'sat_pick' && p.day).map((p) => p.day!);
  const reluctant = (pid: string, d: string) => (prefsOf.get(pid) ?? []).some((p) => p.kind === 'no_weekend') && rulesFor(prefsOf.get(pid) ?? [], d).weekendOk;
  let weekIndex = -1;
  for (const w of weeks) {
    weekIndex++;
    const days = Array.from({ length: 7 }, (_, i) => addDays(w, i));
    const free = days.filter(inMonth);
    if (!free.length) continue;
    const weekShifts: GenShift[] = [];

    // turni già fissati (giorni fuori dal mese)
    days.filter((d) => !inMonth(d)).forEach((d) => {
      people.forEach((p) => {
        const f = fixedKey.get(`${p.id}|${d}`);
        if (f) weekShifts.push({ person_id: p.id, day: d, start: f.start, end: f.end, role: 'op', office: false, fixed: true });
      });
    });
    const closesThisWeek = (pid: string) => weekShifts.filter((s) => s.person_id === pid && s.end >= closeM && s.role === 'op' && isoDow(s.day) <= 5).length;
    const worksOn = (pid: string, d: string) => weekShifts.some((s) => s.person_id === pid && s.day === d);
    const daysWorked = (pid: string) => new Set(weekShifts.filter((s) => s.person_id === pid).map((s) => s.day)).size;

    /* --- ruoli della settimana: REC e Reclami --- */
    const wdFree = free.filter((d) => isoDow(d) <= 5 && !isHoliday(d));
    const freeCount = (pid: string) => wdFree.filter((d) => available(pid, d)).length;
    const pickRole = (pool: string[], counter: Map<string, number>, exclude: (string | null)[]) =>
      pool
        .filter((id) => byId.has(id) && !exclude.includes(id) && freeCount(id) > 0)
        .sort((a, b) => freeCount(b) - freeCount(a) || get(counter, a) - get(counter, b) || a.localeCompare(b))[0] ?? null;
    const manual = c.weekRoles?.[w] ?? {};
    const recPool = c.rec.pool.map((r) => r.person_id);
    const recPerson = manual.rec !== undefined ? manual.rec : wdFree.length ? pickRole(recPool, cnt.rec, []) : null;
    const reclPerson = manual.reclami !== undefined ? manual.reclami : wdFree.length ? pickRole(c.reclami.pool, cnt.recl, [recPerson]) : null;
    roles[w] = { rec: recPerson, reclami: reclPerson };
    if (recPerson) inc(cnt.rec, recPerson);
    if (reclPerson) inc(cnt.recl, reclPerson);

    /* --- weekend: domenica e sabato --- */
    const weekendPicked = new Map<string, string[]>(); // persona → giorni weekend
    const sundays = free.filter((d) => isoDow(d) === 7 || (isHoliday(d) && isoDow(d) <= 6));
    const fixedOn = (p: GenPerson, d: string) => !!p.fixed && p.fixed.days.includes(isoDow(d));
    const pushFixedWeekend = (d: string) =>
      people
        .filter((p) => fixedOn(p, d) && available(p.id, d))
        .map((p) => {
          weekShifts.push({ person_id: p.id, day: d, start: toMin(p.fixed!.start), end: toMin(p.fixed!.end), role: 'op', office: false });
          weekendPicked.set(p.id, [...(weekendPicked.get(p.id) ?? []), d]);
          return p;
        }).length;
    for (const d of sundays) {
      if (!c.sunday.enabled) continue;
      const n = Math.max(0, c.sunday.people - pushFixedWeekend(d));
      const cand = people
        .filter((p) => {
          const rr = rulesFor(prefsOf.get(p.id) ?? [], d);
          const fitsHours = !(rr.startBy !== null && toMin(c.sunday.start) > rr.startBy) && !(rr.endBy !== null && toMin(c.sunday.end) > rr.endBy) && !(rr.startAfter !== null && toMin(c.sunday.start) < rr.startAfter);
          return p.canWeekend && !p.fixed && fitsHours && available(p.id, d) && p.id !== recPerson && p.id !== reclPerson;
        })
        .sort((a, b) => Number(reluctant(a.id, d)) - Number(reluctant(b.id, d)) || get(cnt.sun, a.id) - get(cnt.sun, b.id) || b.shiftHours - a.shiftHours || rand() - 0.5);
      const chosen = cand.slice(0, n);
      if (chosen.length < n) issues.push({ day: d, level: 'bad', text: `Domenica/festivo: ${chosen.length} persone su ${n}` });
      chosen.forEach((p) => {
        inc(cnt.sun, p.id);
        weekendPicked.set(p.id, [...(weekendPicked.get(p.id) ?? []), d]);
        weekShifts.push({ person_id: p.id, day: d, start: toMin(c.sunday.start), end: toMin(c.sunday.end), role: 'op', office: false });
      });
    }
    const sat = free.find((d) => isoDow(d) === 6 && !isHoliday(d));
    if (sat && c.saturday.enabled) {
      const S = c.saturday;
      const cand = people
        .filter((p) => p.canWeekend && !p.fixed && available(p.id, sat) && (S.people > 0) && !(weekendPicked.get(p.id)?.length) && p.id !== recPerson && p.id !== reclPerson && (satThisMonth.get(p.id) ?? 0) < c.maxSaturdaysPerMonth && (!satPicks(p.id).length || satPicks(p.id).includes(sat)))
        // prima chi ha chiesto proprio questo sabato, per ultimi i disponibili "solo se serve"
        .sort((a, b) => Number(satPicks(b.id).includes(sat)) - Number(satPicks(a.id).includes(sat)) || Number(reluctant(a.id, sat)) - Number(reluctant(b.id, sat)) || get(cnt.sat, a.id) - get(cnt.sat, b.id) || rand() - 0.5);
      const satOpen = toMin(S.open), satClose = toMin(S.close);
      const T10 = toMin('10:00'), T14 = toMin('14:00'), T18 = toMin('18:00');
      // copertura possibile con queste persone: un turno lungo copre mattina e pomeriggio, uno corto solo una delle due
      const feasible = (list: GenPerson[]) => {
        const closers = Math.min(S.closeMin, list.length);
        const longs = list.filter((p) => p.shiftHours >= 8).length - Math.min(closers, list.filter((p) => p.shiftHours >= 8).length);
        const shorts = list.length - closers - longs;
        const amNeed = Math.max(0, S.at1000 - longs);
        const pmNeed = Math.max(0, S.afternoon - longs - closers);
        return amNeed + pmNeed <= shorts;
      };
      const fixedSat = pushFixedWeekend(sat);
      let chosen = cand.slice(0, Math.max(0, S.people - fixedSat));
      let k = chosen.length;
      while (!feasible(chosen) && k < Math.min(S.maxPeople - fixedSat, cand.length)) chosen = cand.slice(0, ++k);
      if (!feasible(chosen)) {
        // sostituisci i turni corti con turni lunghi (i meno usati il sabato)
        const longs = cand.filter((p) => p.shiftHours >= 8 && !chosen.includes(p));
        for (let i = chosen.length - 1; i >= 0 && !feasible(chosen) && longs.length; i--) if (chosen[i]!.shiftHours < 8) chosen[i] = longs.shift()!;
      }
      if (chosen.length + fixedSat < S.people) issues.push({ day: sat, level: 'bad', text: `Sabato: ${chosen.length + fixedSat} persone su ${S.people}` });
      const plan: GenShift[] = [];
      const byLen = [...chosen].sort((a, b) => b.shiftHours - a.shiftHours);
      const closers = byLen.filter((p) => !rulesFor(prefsOf.get(p.id) ?? [], sat).noClose && !(p.maxStart && satClose - p.shiftHours * 60 > toMin(p.maxStart)) && !((rulesFor(prefsOf.get(p.id) ?? [], sat).startBy ?? 1440) < satClose - p.shiftHours * 60)).slice(0, Math.max(1, S.closeMin));
      closers.forEach((p) => plan.push({ person_id: p.id, day: sat, start: satClose - p.shiftHours * 60, end: satClose, role: 'op', office: false }));
      const covAm = () => plan.filter((s) => s.start <= T10 && s.end > T10).length;
      const covPm = () => plan.filter((s) => s.start <= T14 && s.end >= T18).length;
      for (const p of byLen) {
        if (closers.includes(p)) continue;
        const r = rulesFor(prefsOf.get(p.id) ?? [], sat);
        let start = Math.max(satOpen, r.startAfter ?? 0);
        if (p.shiftHours < 8) {
          const amDef = S.at1000 - covAm(), pmDef = S.afternoon - covPm();
          if (pmDef > amDef && (r.startBy ?? 1440) >= T18 - p.shiftHours * 60) start = Math.max(start, T18 - p.shiftHours * 60);
        }
        let end = Math.min(start + p.shiftHours * 60, satClose);
        if (r.endBy && end > r.endBy) { end = r.endBy; start = Math.max(satOpen, end - p.shiftHours * 60); }
        plan.push({ person_id: p.id, day: sat, start, end, role: 'op', office: false });
      }
      plan.forEach((s) => {
        weekShifts.push(s);
        inc(cnt.sat, s.person_id);
        satThisMonth.set(s.person_id, (satThisMonth.get(s.person_id) ?? 0) + 1);
        weekendPicked.set(s.person_id, [...(weekendPicked.get(s.person_id) ?? []), sat]);
      });
      const at10 = covAm();
      const pm = covPm();
      const late = plan.filter((s) => s.end >= satClose).length;
      if (at10 < S.at1000) issues.push({ day: sat, level: 'warn', text: `Sabato alle 10: ${at10} persone (servono ${S.at1000})` });
      if (pm < S.afternoon) issues.push({ day: sat, level: 'warn', text: `Sabato 14–18: ${pm} persone (servono ${S.afternoon})` });
      if (late > S.closeMax) issues.push({ day: sat, level: 'warn', text: `Sabato fino alle 20: ${late} persone (max ${S.closeMax})` });
    }

    /* --- giorni di riposo in settimana --- */
    // chi lavora nel weekend riposa nei giorni feriali; i riposi si distribuiscono sui giorni più "larghi"
    const restCount = new Map<string, number>(wdFree.map((d) => [d, 0]));
    const workdays = new Map<string, string[]>(); // persona → giorni feriali di lavoro
    const hoursOn = new Map<string, number>(); // durata del turno diversa dal solito in un giorno
    const orderPeople = [...people].sort((a, b) => (weekendPicked.get(b.id)?.length ?? 0) - (weekendPicked.get(a.id)?.length ?? 0) || rand() - 0.5);
    const weekdayHolidays = days.filter((d) => isoDow(d) <= 5 && isHoliday(d)).length;
    for (const p of orderPeople) {
      const fixedDays = days.filter((d) => !inMonth(d) && fixedKey.has(`${p.id}|${d}`)).length;
      const weekendDays = weekendPicked.get(p.id)?.length ?? 0;
      const avail = wdFree.filter((d) => available(p.id, d) && (!p.fixed || p.fixed.days.includes(isoDow(d))));
      if (p.fixed) {
        workdays.set(p.id, avail);
        continue;
      }
      const perWeek = weekendDays && p.weekendWeek ? p.weekendWeek.days : p.daysPerWeek;
      const need = Math.min(avail.length, Math.max(0, perWeek - weekendDays - fixedDays - weekdayHolidays));
      const pickedDays = [...avail];
      while (pickedDays.length > need) {
        // riposa nel giorno in cui riposano meno persone (il lunedì, con più chiamate, per ultimo)
        // mai a riposo nei giorni in cui ha chiesto un turno preciso, la mattina o la chiusura
        const wants = (d: string) => (prefsOf.get(p.id) ?? []).some((q) => q.day === d && ['shift', 'morning', 'want_close', 'place', 'end_by', 'start_after'].includes(q.kind));
        pickedDays.sort((x, y) => Number(wants(x)) - Number(wants(y)) || (restCount.get(x) ?? 0) - (restCount.get(y) ?? 0) || (isoDow(x) === 1 ? 1 : 0) - (isoDow(y) === 1 ? 1 : 0) || rand() - 0.5);
        const d = pickedDays.shift()!;
        restCount.set(d, (restCount.get(d) ?? 0) + 1);
      }
      workdays.set(p.id, pickedDays);
      // settimana con il weekend "lunga": alcuni feriali lunghi, gli altri corti
      if (weekendDays && p.weekendWeek) {
        pickedDays.sort().forEach((d, i) => {
          if (i >= p.weekendWeek!.longDays) hoursOn.set(`${p.id}|${d}`, p.weekendWeek!.shortHours);
        });
      }
    }

    /* --- turni feriali --- */
    for (const d of wdFree) {
      const working = people.filter((p) => workdays.get(p.id)?.includes(d));
      const L = (p: GenPerson) => (hoursOn.get(`${p.id}|${d}`) ?? p.shiftHours) * 60;
      const rules = new Map(working.map((p) => [p.id, rulesFor(prefsOf.get(p.id) ?? [], d)]));
      const dayShifts: GenShift[] = [];
      // REC del giorno: quello della settimana o, se assente, un altro del gruppo
      let rec: string | null = recPerson && working.some((p) => p.id === recPerson) ? recPerson : null;
      if (!rec && c.rec.pool.length) {
        rec = c.rec.pool.map((r) => r.person_id).find((id) => id !== reclPerson && working.some((p) => p.id === id)) ?? null;
        if (!rec) issues.push({ day: d, level: 'bad', text: 'Nessuno disponibile per il REC' });
      }
      if (rec) {
        const e = c.rec.pool.find((r) => r.person_id === rec) ?? { start: '08:30', end: '17:30' };
        dayShifts.push({ person_id: rec, day: d, start: toMin(e.start), end: toMin(e.end), role: 'rec', office: false });
        const comp = c.rec.companions.find((x) => x.when === rec);
        if (comp && working.some((p) => p.id === comp.person_id)) {
          const cp = byId.get(comp.person_id)!;
          const end = toMin(comp.end);
          dayShifts.push({ person_id: cp.id, day: d, start: end - L(cp), end, role: 'companion', sub: [toMin(comp.start), end], office: false });
        }
      }
      let recl = reclPerson && working.some((p) => p.id === reclPerson) ? reclPerson : null;
      if (!recl && reclPerson) recl = c.reclami.pool.find((id) => id !== rec && working.some((p) => p.id === id) && !dayShifts.some((s) => s.person_id === id)) ?? null;
      if (!recl && c.reclami.pool.length) issues.push({ day: d, level: 'warn', text: 'Nessuno disponibile per i reclami' });
      const taken = new Set(dayShifts.map((s) => s.person_id));
      if (recl) taken.add(recl);
      const ops = working.filter((p) => !taken.has(p.id));

      // turni fissi e turni imposti dalle preferenze ("turno preciso")
      for (const p of ops) {
        const r = rules.get(p.id)!;
        const opts = weekOpts(p.id);
        const wk = opts.length ? opts[weekIndex % opts.length]! : null;
        const fx: [number, number] | null = r.shift ?? (p.fixed ? [toMin(p.fixed.start), toMin(p.fixed.end)] : wk ? [toMin(wk.time_a!), toMin(wk.time_b!)] : null);
        if (fx) {
          dayShifts.push({ person_id: p.id, day: d, start: fx[0], end: fx[1], role: 'op', office: false });
          taken.add(p.id);
        }
      }
      const pool = () => ops.filter((p) => !taken.has(p.id));
      const fits = (p: GenPerson, start: number, end: number) => {
        const r = rules.get(p.id)!;
        if (p.maxStart && start > toMin(p.maxStart)) return false;
        if (r.startAfter !== null && start < r.startAfter) return false;
        if (r.startBy !== null && start > r.startBy) return false;
        if (r.endBy !== null && end > r.endBy) return false;
        return true;
      };
      const assign = (p: GenPerson, start: number) => {
        const s: GenShift = { person_id: p.id, day: d, start, end: start + L(p), role: 'op', office: false };
        dayShifts.push(s);
        taken.add(p.id);
        return s;
      };
      const noise = () => rand() * 0.4;

      // 1. chiusure
      let closers = 0;
      for (let i = 0; i < W.closeOps; i++) {
        const cand = pool().filter((p) => !rules.get(p.id)!.noClose && fits(p, closeM - L(p), closeM));
        const ok = cand.filter((p) => closesThisWeek(p.id) < W.maxClosePerWeek);
        const list = (ok.length ? ok : cand).sort((a, b) => Number(rules.get(b.id)!.wantClose) - Number(rules.get(a.id)!.wantClose) || get(cnt.close, a.id) + noise() - (get(cnt.close, b.id) + noise()));
        const p = list[0];
        if (!p) break;
        if (!ok.length) issues.push({ day: d, person_id: p.id, level: 'warn', text: `${p.name}: seconda chiusura della settimana` });
        const s = assign(p, closeM - L(p));
        weekShifts.push(s);
        inc(cnt.close, p.id);
        closers++;
      }
      if (closers < W.closeOps) issues.push({ day: d, level: 'bad', text: `Chiusura alle ${W.close}: ${closers} operativi su ${W.closeOps}` });

      // 2. aperture
      let openers = 0;
      for (let i = 0; i < W.openOps; i++) {
        const cand = pool()
          .filter((p) => !rules.get(p.id)!.noOpen && fits(p, openM, openM + L(p)))
          .sort((a, b) => get(cnt.open, a.id) + noise() - (get(cnt.open, b.id) + noise()));
        const p = cand[0];
        if (!p) break;
        assign(p, openM);
        inc(cnt.open, p.id);
        openers++;
      }
      if (openers < W.openOps) issues.push({ day: d, level: 'bad', text: `Apertura alle ${W.open}: ${openers} operativi su ${W.openOps}` });

      // 3. sera: fino alle 19 e alle 18:30
      const lateNeeds: [number, number][] = [
        [toMin('19:00'), Math.max(0, W.after1830 - W.closeOps)],
        [toMin('18:30'), Math.max(0, W.after1800 - Math.max(W.after1830, W.closeOps))],
      ];
      for (const [end, n] of lateNeeds) {
        for (let i = 0; i < n; i++) {
          const cand = pool()
            .filter((p) => fits(p, end - L(p), end) && end - L(p) >= openM)
            .sort((a, b) => L(b) - L(a) || get(cnt.late, a.id) + noise() - (get(cnt.late, b.id) + noise()));
          const p = cand[0];
          if (!p) break;
          assign(p, end - L(p));
          inc(cnt.late, p.id);
        }
      }

      // 4. tutti gli altri: alle 9 (picco di chiamate) oppure, se ci sono gli operativi desiderati
      //    per fascia oraria, dove mancano più persone
      const target = c.targets?.[String(isoDow(d))];
      const hasTarget = !!target?.some((x) => x !== null && x !== undefined);
      const present = (h: number) => dayShifts.filter((s) => s.role === 'op' && s.start <= h * 60 + 15 && s.end > h * 60 + 15).length;
      const rest = pool().sort((a, b) => L(b) - L(a)); // prima i turni lunghi
      for (const p of rest) {
        const r = rules.get(p.id)!;
        let start = toMin('09:00');
        if (p.maxStart) start = Math.min(start, toMin(p.maxStart));
        if (r.startBy !== null) start = Math.min(start, r.startBy);
        if (r.startAfter !== null) start = Math.max(start, r.startAfter);
        if (r.endBy !== null && start + L(p) > r.endBy) start = Math.max(openM, r.endBy - L(p));
        if (start + L(p) > closeM) start = closeM - L(p);
        if (hasTarget) {
          let best = start, bestScore = -Infinity;
          for (let st = openM; st + L(p) <= closeM; st += 30) {
            if (!fits(p, st, st + L(p))) continue;
            let score = 0;
            for (let h = Math.floor(st / 60); h * 60 < st + L(p); h++) {
              const want = target![h];
              if (want === null || want === undefined) continue;
              const mid = h * 60 + 15;
              if (mid < st || mid >= st + L(p)) continue;
              score += present(h) < want ? 10 : -1; // copre un buco · un'ora in più del necessario
            }
            score -= Math.abs(st - toMin('09:00')) / 600; // a parità, vicino alle 9
            if (score > bestScore) { bestScore = score; best = st; }
          }
          start = best;
        }
        assign(p, start);
      }
      if (hasTarget) {
        const short = Array.from({ length: 24 }, (_, h) => h).filter((h) => target![h] !== null && target![h] !== undefined && present(h) < target![h]!);
        if (short.length) issues.push({ day: d, level: 'warn', text: `Sotto gli operativi desiderati alle ${short.map((h) => `${h} (${present(h)}/${target![h]})`).join(', ')}` });
      }

      // 5. Reclami: apre o chiude dove serve presenza
      if (recl) {
        const rp = byId.get(recl)!;
        const r = rulesFor(prefsOf.get(recl) ?? [], d);
        const opensWeek = weekShifts.filter((s) => s.person_id === recl && s.role === 'reclami' && s.start === openM).length;
        const closesWeek = weekShifts.filter((s) => s.person_id === recl && s.role === 'reclami' && s.end === closeM).length;
        const close = !r.noClose && !(rp.maxStart && closeM - L(rp) > toMin(rp.maxStart)) && (r.noOpen || closesWeek <= opensWeek);
        const start = close ? closeM - L(rp) : openM;
        const s: GenShift = { person_id: recl, day: d, start, end: start + L(rp), role: 'reclami', office: false };
        dayShifts.push(s);
      }

      weekShifts.push(...dayShifts.filter((s) => !weekShifts.includes(s)));
    }

    /* --- ufficio / smart --- */
    const wdShifts = weekShifts.filter((s) => !s.fixed && isoDow(s.day) <= 5 && !isHoliday(s.day));
    const quota = new Map<string, number>();
    people.forEach((p) => {
      const n = new Set(wdShifts.filter((s) => s.person_id === p.id).map((s) => s.day)).size;
      quota.set(p.id, p.otherSite ? n : Math.min(p.officeDays ?? c.officeDaysPerWeek, n));
    });
    wdShifts.filter((s) => s.office).forEach((s) => quota.set(s.person_id, (quota.get(s.person_id) ?? 0) - 1));
    // posti occupati: persone in ufficio nello stesso momento (due part time che non si sovrappongono
    // usano lo stesso posto); chi lavora in un'altra sede non conta
    const elsewhere = new Set(people.filter((p) => p.otherSite).map((p) => p.id));
    const peak = (d: string, from = 0, to = 1440, add?: GenShift) => {
      const here = wdShifts.filter((x) => x.day === d && x.office && !elsewhere.has(x.person_id));
      if (add) here.push(add);
      let max = 0;
      for (let t = Math.floor(from / 30) * 30; t < to; t += 30) {
        const n = here.filter((x) => x.start <= t + 15 && x.end > t + 15).length;
        if (n > max) max = n;
      }
      return max;
    };
    const officeOn = (d: string) => peak(d);
    const fitsDesk = (s: GenShift) => elsewhere.has(s.person_id) || peak(s.day, s.start, s.end, s) <= W.maxOffice;
    const setOffice = (s: GenShift, force = false) => {
      if (lockedRemote.has(s)) return false;
      if (!force && !fitsDesk(s)) return false; // ufficio pieno
      s.office = true;
      quota.set(s.person_id, (quota.get(s.person_id) ?? 0) - 1);
      return true;
    };
    // dove l'operatore ha chiesto ufficio o smart in quel giorno
    const lockedRemote = new Set<GenShift>();
    for (const s of weekShifts.filter((x) => !x.fixed)) {
      const r = rulesFor(prefsOf.get(s.person_id) ?? [], s.day);
      if (r.lunch !== null && s.end - s.start >= 7 * 60) s.lunch = r.lunch;
      if (isoDow(s.day) > 5) continue;
      if (r.place === 'remote') lockedRemote.add(s);
      if (r.place === 'office' && !s.office) setOffice(s);
    }
    // prima i giorni in cui la presenza all'apertura/chiusura è più scarsa
    for (const d of wdFree) {
      const day = wdShifts.filter((s) => s.day === d && !elsewhere.has(s.person_id));
      for (const [group, need] of [
        [day.filter((s) => s.start <= openM), W.officeAtOpen],
        [day.filter((s) => s.end >= closeM), W.officeAtClose],
      ] as [GenShift[], number][]) {
        let have = group.filter((s) => s.office).length;
        // i reclami sono i primi a garantire la presenza fisica
        const cand = group.filter((s) => !s.office).sort((a, b) => (b.role === 'reclami' ? 1 : 0) - (a.role === 'reclami' ? 1 : 0) || (quota.get(b.person_id) ?? 0) - (quota.get(a.person_id) ?? 0));
        for (const s of cand) {
          if (have >= need) break;
          if ((quota.get(s.person_id) ?? 0) > 0 && setOffice(s)) have++;
        }
        if (have < need) issues.push({ day: d, level: 'warn', text: `${group === day.filter((s) => s.start <= openM) ? 'Apertura' : 'Chiusura'}: ${have} in ufficio (servono ${need})` });
      }
    }
    // il resto della quota: un giorno a testa per giro, nei giorni con meno persone in ufficio,
    // senza superare il massimo; prima chi deve stare sempre in ufficio
    for (let round = 0; round < 7; round++) {
      const order = [...people].sort((a, b) => (b.officeDays ?? 0) - (a.officeDays ?? 0) || (quota.get(b.id) ?? 0) - (quota.get(a.id) ?? 0) || rand() - 0.5);
      let moved = false;
      for (const p of order) {
        if ((quota.get(p.id) ?? 0) <= 0) continue;
        const free = wdShifts
          .filter((x) => x.person_id === p.id && !x.office && !lockedRemote.has(x) && fitsDesk(x))
          .sort((a, b) => peak(a.day, a.start, a.end) - peak(b.day, b.start, b.end) || rand() - 0.5);
        if (free[0] && setOffice(free[0])) moved = true;
      }
      if (!moved) break;
    }
    const short = people.filter((p) => (quota.get(p.id) ?? 0) > 0 && wdShifts.some((x) => x.person_id === p.id));
    if (short.length)
      issues.push({
        day: null, level: 'warn',
        text: `Settimana del ${w.slice(8)}/${w.slice(5, 7)}: con al massimo ${W.maxOffice} in ufficio, ${short.length} persone hanno meno giorni in ufficio del previsto (ufficio pieno): ${short.map((p) => `${p.name} −${quota.get(p.id)}`).join(', ')}`,
      });
    for (const d of wdFree) if (officeOn(d) > W.maxOffice) issues.push({ day: d, level: 'warn', text: `${officeOn(d)} persone in ufficio nello stesso momento (max ${W.maxOffice})` });

    // controlli finali della settimana
    for (const d of wdFree) {
      const ops = weekShifts.filter((s) => s.day === d && s.role === 'op');
      const after = (t: number) => ops.filter((s) => s.end > t).length;
      if (after(toMin('18:00')) < W.after1800) issues.push({ day: d, level: 'warn', text: `Dopo le 18: ${after(toMin('18:00'))} operativi (servono ${W.after1800})` });
      if (after(toMin('18:30')) < W.after1830) issues.push({ day: d, level: 'warn', text: `Dopo le 18:30: ${after(toMin('18:30'))} operativi (servono ${W.after1830})` });
    }
    for (const p of people) {
      const n = closesThisWeek(p.id);
      if (n > W.maxClosePerWeek) issues.push({ day: null, person_id: p.id, level: 'warn', text: `${p.name}: ${n} chiusure nella settimana del ${w.slice(8)}/${w.slice(5, 7)}` });
      const worked = daysWorked(p.id);
      // giorni in cui poteva lavorare: feriali disponibili + weekend effettivamente lavorati
      const canWork = days.filter((d) =>
        inMonth(d) ? (isoDow(d) <= 5 && !isHoliday(d) && available(p.id, d)) || weekShifts.some((x) => x.person_id === p.id && x.day === d && (isoDow(d) >= 6 || isHoliday(d))) : fixedKey.has(`${p.id}|${d}`),
      ).length;
      const perWeek = p.fixed ? p.fixed.days.length : weekendPicked.get(p.id)?.length && p.weekendWeek ? p.weekendWeek.days : p.daysPerWeek;
      const expected = Math.min(perWeek - weekdayHolidays, canWork);
      if (free.length === 7 && worked < expected) issues.push({ day: null, person_id: p.id, level: 'warn', text: `${p.name}: ${worked} giorni nella settimana del ${w.slice(8)}/${w.slice(5, 7)} invece di ${expected}` });
    }

    shifts.push(...weekShifts.filter((s) => !s.fixed));
  }

  // preferenze non rispettate
  for (const pr of activePrefs) {
    if (pr.kind === 'note' || pr.kind === 'week_shift' || pr.kind === 'weekend_ok' || pr.kind === 'lunch_at') continue;
    if (pr.kind === 'sat_pick') continue;
    const mine = shifts.filter((s) => s.person_id === pr.person_id && prefApplies(pr, s.day));
    const broken = mine.filter((s) => {
      if (pr.kind === 'off' || (pr.kind === 'no_weekend' && isoDow(s.day) >= 6 && !rulesFor(prefsOf.get(pr.person_id) ?? [], s.day).weekendOk)) return true;
      if (pr.kind === 'start_after' && pr.time_a) return s.start < toMin(pr.time_a);
      if (pr.kind === 'end_by' && pr.time_a) return s.end > toMin(pr.time_a);
      if (pr.kind === 'no_close') return s.end >= closeM;
      if (pr.kind === 'no_open') return s.start <= openM;
      if (pr.kind === 'shift' && pr.time_a && pr.time_b) return s.start !== toMin(pr.time_a) || s.end !== toMin(pr.time_b) || (pr.place === 'remote' && s.office);
      if (pr.kind === 'start_window' && pr.time_a && pr.time_b) return s.start < toMin(pr.time_a) || s.start > toMin(pr.time_b);
      if (pr.kind === 'morning') return s.start > toMin('09:00');
      if (pr.kind === 'want_close') return s.end < closeM && isoDow(s.day) <= 5;
      if (pr.kind === 'place' && isoDow(s.day) <= 5) return (pr.place === 'remote') === s.office;
      return false;
    });
    if (broken.length) issues.push({ day: broken[0]!.day, person_id: pr.person_id, level: 'warn', text: `Preferenza non rispettata (${byId.get(pr.person_id)?.name}): “${pr.text}”` });
  }

  return { shifts, issues, roles, days: monthDays };
}

/* ---------------- lettura delle preferenze scritte a mano ---------------- */
/** primo vincolo letto dal testo (per compatibilità); parsePrefs li restituisce tutti */
export function parsePref(text: string, month: string): Omit<Pref, 'id' | 'person_id' | 'text'> {
  const p = parsePrefs(text, month)[0]!;
  return { kind: p.kind, day: p.day, weekday: p.weekday, time_a: p.time_a, time_b: p.time_b };
}

/* ---------------- profili dallo storico ---------------- */
/** Ore del turno e giorni a settimana più frequenti negli ultimi turni di ogni persona */
export function profileFromHistory(shifts: { person_id: string; day: string; start: number; end: number }[]): Map<string, { shiftHours: number; daysPerWeek: number; samples: number }> {
  const out = new Map<string, { shiftHours: number; daysPerWeek: number; samples: number }>();
  const byP = new Map<string, typeof shifts>();
  shifts.forEach((s) => {
    if (!byP.has(s.person_id)) byP.set(s.person_id, []);
    byP.get(s.person_id)!.push(s);
  });
  byP.forEach((list, pid) => {
    const spans = new Map<number, number>();
    list.forEach((s) => {
      const h = Math.round(((s.end - s.start) / 60) * 2) / 2;
      spans.set(h, (spans.get(h) ?? 0) + 1);
    });
    const shiftHours = Array.from(spans).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
    const weeks = new Map<string, Set<string>>();
    list.forEach((s) => {
      const w = weekOf(s.day);
      if (!weeks.has(w)) weeks.set(w, new Set());
      weeks.get(w)!.add(s.day);
    });
    // il numero di giorni più frequente nelle settimane "normali" (3+ giorni: esclude ferie e settimane a cavallo)
    const freq = new Map<number, number>();
    Array.from(weeks.values()).forEach((x) => x.size >= 3 && freq.set(x.size, (freq.get(x.size) ?? 0) + 1));
    const daysPerWeek = Array.from(freq).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 5;
    out.set(pid, { shiftHours, daysPerWeek: Math.min(6, Math.max(1, daysPerWeek)), samples: list.length });
  });
  return out;
}

export const isoWeekday = isoDow;
export const mondayOf = weekOf;
export const shiftDays = addDays;
