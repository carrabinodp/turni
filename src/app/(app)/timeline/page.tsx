import { getSession } from '@/lib/session';
import { fetchAll } from '@/lib/fetchAll';
import Timeline from '@/components/timeline/Timeline';
import { addDays, dayStart, diffDays, isValidDate, todayIn, weekStart } from '@/lib/time';
import type { Activity, DayMark, DayType, EventRow, Person } from '@/lib/types';
import { copyWeekAction, eventHistoryAction, managerSwapAction, managerTimeOffAction, publishWeekAction, saveScheduleAction } from './actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function TimelinePage({ searchParams }: { searchParams: { d?: string; v?: string; to?: string } }) {
  const { supabase, me, tz, isManager, settings } = await getSession();
  const view = searchParams.v === 'week' ? 'week' : searchParams.v === 'custom' ? 'custom' : 'day';
  const date = isValidDate(searchParams.d) ? searchParams.d : todayIn(tz);
  let to = isValidDate(searchParams.to) && searchParams.to >= date ? searchParams.to : addDays(date, 27);
  if (diffDays(date, to) > 61) to = addDays(date, 61);
  const from = view === 'week' ? weekStart(date) : date;
  const end = view === 'day' ? addDays(from, 1) : view === 'week' ? addDays(from, 7) : addDays(to, 1);
  const startIso = new Date(dayStart(from, tz)).toISOString();
  const endIso = new Date(dayStart(end, tz)).toISOString();

  const [people, activities, events, weeks, dayTypes, marks] = await Promise.all([
    supabase.from('people').select('id, full_name, contract, user_id, team, channels').eq('active', true).order('full_name'),
    supabase.from('activity_types').select('*').order('sort_order'),
    fetchAll<EventRow>((a, b) =>
      supabase
        .from('events')
        .select('id, person_id, activity_id, starts_at, ends_at, note, source, updated_at, updated_by')
        .lt('starts_at', endIso)
        .gt('ends_at', startIso)
        .order('starts_at')
        .order('id')
        .range(a, b),
    ).then((data) => ({ data })),
    supabase.from('schedule_weeks').select('week_start').gte('week_start', weekStart(from)).lt('week_start', end),
    supabase.from('day_types').select('*').order('sort_order'),
    fetchAll<DayMark>((a, b) =>
      supabase.from('day_marks').select('person_id, day, day_type_id').gte('day', from).lt('day', end).order('day').order('person_id').range(a, b),
    ).then((data) => ({ data })),
  ]);

  const evs = (events.data ?? []) as EventRow[];
  const mk = (marks.data ?? []) as DayMark[];
  const pub = (weeks.data ?? []).map((w) => w.week_start as string);
  let h = 5381;
  for (const e of evs) for (const c of e.id + e.updated_at) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  for (const m of mk) for (const c of m.person_id + m.day + m.day_type_id) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  const serverKey = `${view}|${date}|${to}|${evs.length}|${mk.length}|${h}|${pub.join(',')}`;

  return (
    <Timeline
      view={view}
      date={date}
      to={view === 'custom' ? to : undefined}
      tz={tz}
      people={(people.data ?? []) as (Pick<Person, 'id' | 'full_name' | 'contract' | 'user_id' | 'team' | 'channels'>)[]}
      activities={(activities.data ?? []) as Activity[]}
      events={evs}
      dayTypes={(dayTypes.data ?? []) as DayType[]}
      marks={mk}
      publishedWeeks={pub}
      breakPolicy={settings.break_policy ?? null}
      breakActivityId={settings.break_activity_id ?? null}
      lunchActivityId={settings.lunch_activity_id ?? null}
      canEdit={isManager}
      meId={me.id}
      snapMinutes={settings.snap_minutes}
      serverKey={serverKey}
      onSave={saveScheduleAction}
      onPublish={publishWeekAction}
      onCopyWeek={copyWeekAction}
      onTimeOff={isManager ? managerTimeOffAction : undefined}
      onSwap={isManager ? managerSwapAction : undefined}
      onHistory={isManager ? eventHistoryAction : undefined}
    />
  );
}
