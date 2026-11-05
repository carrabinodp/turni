import { getSession } from '@/lib/session';
import { fetchAll } from '@/lib/fetchAll';
import { groupShifts, shiftText } from '@/lib/shifts';
import { addDays, dayStart, isValidDate, todayIn, weekStart } from '@/lib/time';
import type { Activity, EventRow, RequestRow } from '@/lib/types';
import MyCalendar, { type CalEvent } from './MyCalendar';
import type { Colleague } from './MyShifts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function MyCalendarPage({ searchParams }: { searchParams: { d?: string; v?: string; w?: string } }) {
  const { supabase, me, tz } = await getSession();
  const today = todayIn(tz);
  const view = searchParams.v === 'day' ? 'day' : searchParams.v === 'month' ? 'month' : 'week';
  const date = isValidDate(searchParams.d) ? searchParams.d : isValidDate(searchParams.w) ? searchParams.w : today;

  let from: string, to: string;
  if (view === 'day') {
    from = date;
    to = addDays(date, 1);
  } else if (view === 'week') {
    from = weekStart(date);
    to = addDays(from, 7);
  } else {
    const first = date.slice(0, 8) + '01';
    from = weekStart(first);
    const nextMonth = addDays(first, 32).slice(0, 8) + '01';
    to = addDays(weekStart(addDays(nextMonth, -1)), 7);
  }
  // per gli scambi servono anche i turni dei colleghi nelle prossime settimane
  const horizon = addDays(today, 42);
  const qFrom = from < today ? from : today;
  const qTo = to > horizon ? to : horizon;

  const [{ data: ev }, { data: acts }, { data: people }, { data: reqs }, { data: pub }, { data: dts }, { data: mks }, { data: cal }] = await Promise.all([
    fetchAll<EventRow>((a, b) =>
      supabase
        .from('events')
        .select('id, person_id, activity_id, starts_at, ends_at, note, source, updated_at')
        .gte('starts_at', new Date(dayStart(qFrom, tz)).toISOString())
        .lt('starts_at', new Date(dayStart(qTo, tz)).toISOString())
        .order('starts_at')
        .order('id')
        .range(a, b),
    ).then((data) => ({ data })),
    supabase.from('activity_types').select('*').order('sort_order'),
    supabase.from('people').select('id, full_name, user_id, role').eq('active', true).order('full_name'),
    supabase.from('requests').select('*').in('status', ['pending_peer', 'open', 'pending_manager']),
    supabase.from('schedule_weeks').select('week_start').gte('week_start', weekStart(qFrom)).lt('week_start', qTo),
    supabase.from('day_types').select('id, name, color'),
    supabase.from('day_marks').select('day, day_type_id').eq('person_id', me.id).gte('day', from).lt('day', to),
    supabase.rpc('my_calendar_status'),
  ]);

  const activities = (acts ?? []) as Activity[];
  const events = (ev ?? []) as EventRow[];
  const shifts = groupShifts(events, activities, tz);
  const published = new Set((pub ?? []).map((w) => w.week_start as string));
  const open = (reqs ?? []) as RequestRow[];
  const busyDay = (pid: string, d: string) =>
    open.some((r) => r.kind !== 'time_off' && r.kind !== 'change' && ((r.requester_id === pid && r.day_a === d) || (r.target_id === pid && r.day_b === d)));

  const fromMs = dayStart(from, tz);
  const toMs = dayStart(to, tz);
  const mine: CalEvent[] = events
    .filter((e) => e.person_id === me.id && Date.parse(e.ends_at) > fromMs && Date.parse(e.starts_at) < toMs)
    .map((e) => {
      const a = activities.find((x) => x.id === e.activity_id);
      return { id: e.id, s: Date.parse(e.starts_at), e: Date.parse(e.ends_at), name: a?.name ?? '', color: a?.color ?? '#999999', kind: a?.kind ?? 'work', note: e.note };
    });

  const dtById = new Map((dts ?? []).map((d) => [d.id as string, { name: d.name as string, color: d.color as string }]));
  const marks: Record<string, { name: string; color: string }> = {};
  (mks ?? []).forEach((m) => {
    const d = dtById.get(m.day_type_id as string);
    if (d) marks[m.day as string] = d;
  });

  const myDays: Record<string, { text: string; canAct: boolean; pending: boolean }> = {};
  shifts.forEach((sh) => {
    if (sh.person_id !== me.id || !Number.isFinite(sh.start)) return;
    myDays[sh.day] = { text: shiftText(sh, tz), canAct: sh.day >= today && published.has(weekStart(sh.day)), pending: busyDay(me.id, sh.day) };
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

  const weeks: string[] = [];
  for (let w = weekStart(from); w < to; w = addDays(w, 7)) weeks.push(w);
  const calStatus = Array.isArray(cal) ? cal[0] ?? null : null;

  return (
    <MyCalendar
      me={{ name: me.full_name, email: me.email, channels: me.channels ?? [], team: me.team, contract: me.contract, role: me.role }}
      view={view}
      date={date}
      from={from}
      to={to}
      today={today}
      tz={tz}
      events={mine}
      marks={marks}
      days={myDays}
      unpublishedWeeks={weeks.filter((w) => !published.has(w))}
      colleagues={colleagues}
      absences={activities.filter((a) => a.kind === 'absence' && a.requestable && !a.archived)}
      calendarConnected={!!calStatus}
      swapDays={Array.from(shifts.values())
        .filter((sh) => sh.person_id === me.id && Number.isFinite(sh.start) && sh.day >= today && published.has(weekStart(sh.day)) && !busyDay(me.id, sh.day))
        .map((sh) => sh.day)
        .sort()}
      reviewers={(people ?? []).filter((p) => p.role !== 'agent' && p.user_id && p.id !== me.id).map((p) => ({ id: p.id as string, name: p.full_name as string }))}
    />
  );
}
