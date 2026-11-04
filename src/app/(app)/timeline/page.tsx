import { getSession } from '@/lib/session';
import Timeline from '@/components/timeline/Timeline';
import { addDays, dayStart, isValidDate, todayIn, weekStart } from '@/lib/time';
import type { Activity, EventRow, Person } from '@/lib/types';
import { copyWeekAction, publishWeekAction, saveScheduleAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function TimelinePage({ searchParams }: { searchParams: { d?: string; v?: string } }) {
  const { supabase, me, tz, isManager, settings } = await getSession();
  const view = searchParams.v === 'week' ? 'week' : 'day';
  const date = isValidDate(searchParams.d) ? searchParams.d : todayIn(tz);
  const from = view === 'day' ? date : weekStart(date);
  const to = addDays(from, view === 'day' ? 1 : 7);
  const startIso = new Date(dayStart(from, tz)).toISOString();
  const endIso = new Date(dayStart(to, tz)).toISOString();

  const [people, activities, events, week] = await Promise.all([
    supabase.from('people').select('id, full_name, contract, user_id').eq('active', true).order('full_name'),
    supabase.from('activity_types').select('*').order('sort_order'),
    supabase
      .from('events')
      .select('id, person_id, activity_id, starts_at, ends_at, note, source, updated_at')
      .lt('starts_at', endIso)
      .gt('ends_at', startIso)
      .order('starts_at')
      .limit(5000),
    supabase.from('schedule_weeks').select('week_start').eq('week_start', weekStart(date)).maybeSingle(),
  ]);

  const evs = (events.data ?? []) as EventRow[];
  let h = 5381;
  for (const e of evs) for (const c of e.id + e.updated_at) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  const serverKey = `${view}|${date}|${evs.length}|${h}|${!!week.data}`;

  return (
    <Timeline
      view={view}
      date={date}
      tz={tz}
      people={(people.data ?? []) as Pick<Person, 'id' | 'full_name' | 'contract' | 'user_id'>[]}
      activities={(activities.data ?? []) as Activity[]}
      events={evs}
      weekPublished={!!week.data}
      canEdit={isManager}
      meId={me.id}
      snapMinutes={settings.snap_minutes}
      serverKey={serverKey}
      onSave={saveScheduleAction}
      onPublish={publishWeekAction}
      onCopyWeek={copyWeekAction}
    />
  );
}
