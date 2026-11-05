import { requireManager } from '@/lib/session';
import { fetchAll } from '@/lib/fetchAll';
import { addDays, dayStart, isValidDate, todayIn, weekStart } from '@/lib/time';
import { phoneStaffing, withForecastDefaults } from '@/lib/forecast';
import type { IntervalAgg } from '@/lib/calls';
import ForecastView from './ForecastView';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HISTORY_DAYS = 371; // un anno di storico basta e avanza

export default async function ForecastPage({ searchParams }: { searchParams: { w?: string; from?: string; to?: string; tab?: string } }) {
  const { supabase, tz, settings } = await requireManager();
  const today = todayIn(tz);

  const [intervals, { data: uploads }, { data: acts }] = await Promise.all([
    fetchAll<IntervalAgg>((a, b) =>
      supabase
        .from('call_intervals')
        .select('day, slot, queue, offered, answered, abandoned, short_abandoned, ans_10, ans_20, ans_30, ans_60, ans_120, wait_sum_sec, handle_sum_sec')
        .gte('day', addDays(today, -HISTORY_DAYS))
        .order('day')
        .order('slot')
        .order('queue')
        .range(a, b),
    ),
    supabase.from('call_uploads').select('id, file_name, from_day, to_day, calls, queues, uploaded_at').order('uploaded_at', { ascending: false }).limit(20),
    supabase.from('activity_types').select('id, name, kind, color, archived, sort_order').order('sort_order'),
  ]);

  const lastDay = intervals.length ? intervals[intervals.length - 1]!.day : null;
  // periodo dello storico: di base le ultime 4 settimane con dati
  const to = isValidDate(searchParams.to) ? searchParams.to : lastDay ?? addDays(today, -1);
  const from = isValidDate(searchParams.from) && searchParams.from <= to ? searchParams.from : addDays(to, -27);
  // settimana della previsione: di base quella in corso
  const w = weekStart(isValidDate(searchParams.w) ? searchParams.w : today);

  const phoneIds = new Set(settings.forecast_activity_ids ?? []);
  const kind = new Map((acts ?? []).map((a) => [a.id as string, a.kind as string]));
  const kindOf = (id: string) => kind.get(id) ?? 'work';

  async function staffing(a: string, bExcl: string) {
    const ev = await fetchAll<{ person_id: string; activity_id: string; starts_at: string; ends_at: string }>((x, y) =>
      supabase
        .from('events')
        .select('person_id, activity_id, starts_at, ends_at')
        .lt('starts_at', new Date(dayStart(bExcl, tz)).toISOString())
        .gt('ends_at', new Date(dayStart(a, tz)).toISOString())
        .order('starts_at')
        .order('id')
        .range(x, y),
    );
    const days: string[] = [];
    for (let d = a; d < bExcl; d = addDays(d, 1)) days.push(d);
    const m = phoneStaffing(
      ev.map((e) => ({ person_id: e.person_id, activity_id: e.activity_id, s: Date.parse(e.starts_at), e: Date.parse(e.ends_at) })),
      kindOf,
      phoneIds,
      days,
      tz,
    );
    return Object.fromEntries(m);
  }

  const [histStaff, fcStaff] = await Promise.all([staffing(from, addDays(to, 1)), staffing(w, addDays(w, 7))]);

  return (
    <ForecastView
      tz={tz}
      today={today}
      intervals={intervals}
      uploads={(uploads ?? []) as { id: string; file_name: string | null; from_day: string; to_day: string; calls: number; queues: string[]; uploaded_at: string }[]}
      activities={(acts ?? []).filter((a) => a.kind === 'work' && !a.archived).map((a) => ({ id: a.id as string, name: a.name as string, color: a.color as string }))}
      phoneIds={Array.from(phoneIds)}
      policy={withForecastDefaults(settings.forecast_policy)}
      week={w}
      from={from}
      to={to}
      histStaff={histStaff}
      fcStaff={fcStaff}
      initialTab={searchParams.tab ?? null}
    />
  );
}
