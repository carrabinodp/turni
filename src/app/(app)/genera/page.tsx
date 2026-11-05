import { requireManager } from '@/lib/session';
import { fetchAll } from '@/lib/fetchAll';
import { addDays, dayStart, localDate, todayIn, weekStart } from '@/lib/time';
import { italianHolidays } from '@/lib/report';
import { profileFromHistory, withGenDefaults, type Absence, type FixedDay, type History, type Pref } from '@/lib/generator';
import type { Activity } from '@/lib/types';
import type { IntervalAgg } from '@/lib/calls';
import { bestMethod, byDay, forecastDays, requiredAgents, withForecastDefaults } from '@/lib/forecast';
import GeneratorView from './GeneratorView';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const minOfDay = (ms: number, tz: string) => {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
};

export default async function GeneraPage({ searchParams }: { searchParams: { m?: string } }) {
  const { supabase, tz, settings } = await requireManager();
  const today = todayIn(tz);
  const nextMonth = addDays(today.slice(0, 8) + '01', 32).slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(searchParams.m ?? '') ? searchParams.m! : nextMonth;
  const first = `${month}-01`;
  const next = addDays(first, 32).slice(0, 8) + '01';
  const histFrom = addDays(weekStart(first), -70);
  const rangeEnd = addDays(weekStart(addDays(next, -1)), 7);

  const [{ data: people }, { data: acts }, { data: dts }, { data: prefs }, { data: pub }, events] = await Promise.all([
    supabase.from('people').select('id, full_name, email, aliases, role, active, shift_hours, days_per_week, gen_exclude, can_weekend, team, contract').eq('active', true).order('full_name'),
    supabase.from('activity_types').select('*').order('sort_order'),
    supabase.from('day_types').select('id, name, color, place, archived').order('sort_order'),
    supabase.from('gen_preferences').select('*').eq('month', month).order('created_at'),
    supabase.from('schedule_weeks').select('week_start').gte('week_start', weekStart(first)).lt('week_start', rangeEnd),
    fetchAll<{ person_id: string; activity_id: string; starts_at: string; ends_at: string }>((a, b) =>
      supabase
        .from('events')
        .select('person_id, activity_id, starts_at, ends_at')
        .gte('starts_at', new Date(dayStart(histFrom, tz)).toISOString())
        .lt('starts_at', new Date(dayStart(rangeEnd, tz)).toISOString())
        .order('starts_at')
        .order('id')
        .range(a, b),
    ),
  ]);

  const activities = (acts ?? []) as Activity[];
  const kind = new Map(activities.map((a) => [a.id, a.kind]));
  const cfg = withGenDefaults(settings.generator);

  // turni per persona e giorno (inizio e fine delle attività lavorative)
  const work = new Map<string, { person_id: string; day: string; start: number; end: number }>();
  const absences: Absence[] = [];
  const absName = new Map(activities.map((a) => [a.id, a.name]));
  for (const e of events) {
    const s = Date.parse(e.starts_at), en = Date.parse(e.ends_at);
    const day = localDate(s, tz);
    const k = kind.get(e.activity_id);
    if (k === 'absence') {
      if (day >= first && day < next) absences.push({ person_id: e.person_id, day, full: en - s >= 5 * 3600000, name: absName.get(e.activity_id) ?? 'Assenza', s, e: en });
      // assenze lunghe che coprono più giorni
      for (let d = addDays(day, 1); dayStart(d, tz) < en && d < next; d = addDays(d, 1)) if (d >= first) absences.push({ person_id: e.person_id, day: d, full: true, name: absName.get(e.activity_id) ?? 'Assenza' });
      continue;
    }
    if (k !== 'work') continue;
    const key = `${e.person_id}|${day}`;
    const w = work.get(key);
    const a = minOfDay(s, tz), b = Math.min(1440, minOfDay(en, tz) || 1440);
    if (!w) work.set(key, { person_id: e.person_id, day, start: a, end: b });
    else {
      w.start = Math.min(w.start, a);
      w.end = Math.max(w.end, b);
    }
  }
  const shifts = Array.from(work.values());
  const before = shifts.filter((s) => s.day < first);
  const existingInMonth = shifts.filter((s) => s.day >= first && s.day < next).length;

  const openM = Number((cfg.weekday.open ?? '08:00').slice(0, 2)) * 60 + Number(cfg.weekday.open.slice(3));
  const closeM = Number(cfg.weekday.close.slice(0, 2)) * 60 + Number(cfg.weekday.close.slice(3));
  const history: History = { saturdays: {}, sundays: {}, closings: {}, openings: {}, rec: {}, reclami: {} };
  const bump = (m: Record<string, number>, id: string) => (m[id] = (m[id] ?? 0) + 1);
  for (const s of before.filter((x) => x.day >= addDays(first, -56))) {
    const dow = new Date(s.day + 'T12:00:00Z').getUTCDay();
    if (dow === 6) bump(history.saturdays, s.person_id);
    if (dow === 0) bump(history.sundays, s.person_id);
    if (dow >= 1 && dow <= 5 && s.end >= closeM) bump(history.closings, s.person_id);
    if (dow >= 1 && dow <= 5 && s.start <= openM) bump(history.openings, s.person_id);
  }
  const fixed: FixedDay[] = before.filter((s) => s.day >= weekStart(first)).map((s) => ({ ...s }));
  const suggest = Object.fromEntries(profileFromHistory(before.filter((s) => s.day >= addDays(first, -63))));

  // operativi necessari per fascia oraria secondo il forecast (media per giorno della settimana)
  let forecastTargets: Record<string, number[]> | null = null;
  try {
    const rows = await fetchAll<IntervalAgg>((a, b) =>
      supabase
        .from('call_intervals')
        .select('day, slot, queue, offered, answered, abandoned, short_abandoned, ans_10, ans_20, ans_30, ans_60, ans_120, wait_sum_sec, handle_sum_sec')
        .gte('day', addDays(first, -7 * 20))
        .order('day').order('slot').order('queue')
        .range(a, b),
    );
    if (rows.length) {
      const policy = withForecastDefaults(settings.forecast_policy);
      const hist = byDay(rows);
      const monthDays: string[] = [];
      for (let d = first; d < next; d = addDays(d, 1)) monthDays.push(d);
      const fc = forecastDays(hist, monthDays, policy, bestMethod(hist, policy).method);
      const sum: Record<string, number[]> = {}, n: Record<string, number> = {};
      for (const f of fc) {
        if (f.holiday) continue;
        const wd = String(((new Date(f.day + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1);
        sum[wd] ??= new Array(24).fill(0);
        n[wd] = (n[wd] ?? 0) + 1;
        for (let h = 0; h < 24; h++) {
          const r = Math.max(requiredAgents(f.calls[h * 2]!, f.aht[h * 2]!, policy), requiredAgents(f.calls[h * 2 + 1]!, f.aht[h * 2 + 1]!, policy));
          sum[wd]![h]! += r;
        }
      }
      forecastTargets = Object.fromEntries(Object.entries(sum).map(([wd, arr]) => [wd, arr.map((v) => Math.round(v / n[wd]!))]));
    }
  } catch {
    forecastTargets = null; // forecast non ancora attivo
  }

  const holidays = new Set<string>();
  [Number(month.slice(0, 4))].forEach((y) => italianHolidays(y).forEach((_, k) => k.startsWith(month) && holidays.add(k)));

  return (
    <GeneratorView
      month={month}
      tz={tz}
      today={today}
      config={cfg}
      officeDaysPerWeek={settings.office_days_per_week ?? 3}
      breakPolicy={settings.break_policy ?? null}
      breakActivityId={settings.break_activity_id ?? null}
      lunchActivityId={settings.lunch_activity_id ?? null}
      snapMinutes={settings.snap_minutes}
      people={(people ?? []).map((p) => ({
        id: p.id as string, name: p.full_name as string, email: (p.email ?? null) as string | null, role: p.role as string, team: p.team as string | null,
        shift_hours: p.shift_hours === null ? null : Number(p.shift_hours), days_per_week: p.days_per_week as number | null,
        gen_exclude: !!p.gen_exclude, can_weekend: p.can_weekend !== false,
      }))}
      suggest={suggest}
      activities={activities.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name, kind: a.kind, color: a.color }))}
      dayTypes={(dts ?? []).filter((d) => !d.archived).map((d) => ({ id: d.id as string, name: d.name as string, color: d.color as string, place: (d.place ?? null) as 'office' | 'remote' | null }))}
      prefs={(prefs ?? []) as (Pref & { source: string; reviewed: boolean; month: string })[]}
      absences={absences}
      fixed={fixed}
      history={history}
      holidays={Array.from(holidays)}
      publishedWeeks={(pub ?? []).map((w) => w.week_start as string)}
      existingInMonth={existingInMonth}
      forecastTargets={forecastTargets}
    />
  );
}
