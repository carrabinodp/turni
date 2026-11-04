import { getSession } from '@/lib/session';
import { groupShifts, shiftText } from '@/lib/shifts';
import { addDays, dayStart, isValidDate, todayIn, weekStart } from '@/lib/time';
import type { Activity, EventRow, RequestRow } from '@/lib/types';
import MyShifts, { type DayCard, type Colleague } from './MyShifts';

export const dynamic = 'force-dynamic';

export default async function MyShiftsPage({ searchParams }: { searchParams: { w?: string } }) {
  const { supabase, me, tz } = await getSession();
  const today = todayIn(tz);
  const week = weekStart(isValidDate(searchParams.w) ? searchParams.w : today);
  const horizon = addDays(today, 35);
  const from = week < today ? week : today;
  const to = addDays(week, 7) > horizon ? addDays(week, 7) : horizon;

  const [{ data: ev }, { data: acts }, { data: people }, { data: reqs }, { data: pub }, { data: dts }, { data: mks }] = await Promise.all([
    supabase
      .from('events')
      .select('id, person_id, activity_id, starts_at, ends_at, note, source, updated_at')
      .gte('starts_at', new Date(dayStart(from, tz)).toISOString())
      .lt('starts_at', new Date(dayStart(to, tz)).toISOString())
      .limit(10000),
    supabase.from('activity_types').select('*').order('sort_order'),
    supabase.from('people').select('id, full_name, user_id').eq('active', true).order('full_name'),
    supabase.from('requests').select('*').in('status', ['pending_peer', 'open', 'pending_manager']),
    supabase.from('schedule_weeks').select('week_start').gte('week_start', addDays(weekStart(from), 0)).lte('week_start', to),
    supabase.from('day_types').select('id, name, color'),
    supabase.from('day_marks').select('day, day_type_id').eq('person_id', me.id).gte('day', week).lt('day', addDays(week, 7)),
  ]);
  const dtById = new Map((dts ?? []).map((d) => [d.id as string, { name: d.name as string, color: d.color as string }]));
  const markByDay = new Map((mks ?? []).map((m) => [m.day as string, dtById.get(m.day_type_id as string) ?? null]));

  const activities = (acts ?? []) as Activity[];
  const events = (ev ?? []) as EventRow[];
  const shifts = groupShifts(events, activities, tz);
  const published = new Set((pub ?? []).map((w) => w.week_start as string));
  const open = (reqs ?? []) as RequestRow[];
  const busyDay = (pid: string, d: string) =>
    open.some((r) => r.kind !== 'time_off' && ((r.requester_id === pid && r.day_a === d) || (r.target_id === pid && r.day_b === d)));

  const days: DayCard[] = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(week, i);
    const sh = shifts.get(`${me.id}|${d}`);
    return {
      day: d,
      text: sh ? shiftText(sh, tz) : null,
      absence: sh?.absence ?? null,
      blocks: (sh?.blocks ?? []).map((b) => ({ ...b, color: activities.find((a) => a.id === b.activity_id)?.color ?? '#999', name: activities.find((a) => a.id === b.activity_id)?.name ?? '' })),
      hasShift: !!sh && Number.isFinite(sh.start),
      dayType: markByDay.get(d) ?? null,
      pending: busyDay(me.id, d),
      canAct: d >= today && published.has(weekStart(d)),
    };
  });

  const colleagues: Colleague[] = (people ?? [])
    .filter((p) => p.id !== me.id && p.user_id)
    .map((p) => ({
      id: p.id,
      name: p.full_name,
      shifts: Array.from(shifts.values())
        .filter((s) => s.person_id === p.id && s.day >= today && Number.isFinite(s.start) && !busyDay(p.id, s.day))
        .sort((a, b) => a.start - b.start)
        .map((s) => ({ day: s.day, text: shiftText(s, tz) })),
      busyDays: Array.from(shifts.values()).filter((s) => s.person_id === p.id).map((s) => s.day),
    }));

  const totalMin = days.reduce(
    (sum, d) => sum + d.blocks.filter((b) => activities.find((a) => a.id === b.activity_id)?.kind === 'work').reduce((x, b) => x + (b.e - b.s) / 60000, 0),
    0,
  );

  return (
    <MyShifts
      week={week}
      today={today}
      tz={tz}
      days={days}
      weekPublished={published.has(week)}
      colleagues={colleagues}
      totalMinutes={totalMin}
    />
  );
}
