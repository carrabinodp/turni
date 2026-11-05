import { requireManager } from '@/lib/session';
import { fetchAll } from '@/lib/fetchAll';
import { addDays, dayStart, todayIn } from '@/lib/time';
import { monthlySummary, type RActivity } from '@/lib/report';
import ReportView from './ReportView';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function ReportPage({ searchParams }: { searchParams: { m?: string } }) {
  const { supabase, tz } = await requireManager();
  const today = todayIn(tz);
  // di base il mese appena concluso nei primi giorni del mese, altrimenti quello in corso
  const def = Number(today.slice(8)) <= 7 ? addDays(today.slice(0, 8) + '01', -1).slice(0, 7) : today.slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(searchParams.m ?? '') ? searchParams.m! : def;
  const first = `${month}-01`;
  const next = addDays(first, 32).slice(0, 8) + '01';

  const [{ data: people }, { data: acts }, { data: dts }, events, marks] = await Promise.all([
    supabase.from('people').select('id, full_name, email, team, contract, active').order('full_name'),
    supabase.from('activity_types').select('id, name, kind, color, sort_order').order('sort_order'),
    supabase.from('day_types').select('id, name'),
    fetchAll<{ person_id: string; activity_id: string; starts_at: string; ends_at: string }>((a, b) =>
      supabase
        .from('events')
        .select('person_id, activity_id, starts_at, ends_at')
        .gte('starts_at', new Date(dayStart(first, tz)).toISOString())
        .lt('starts_at', new Date(dayStart(next, tz)).toISOString())
        .order('starts_at')
        .order('id')
        .range(a, b),
    ),
    fetchAll<{ person_id: string; day: string; day_type_id: string }>((a, b) =>
      supabase.from('day_marks').select('person_id, day, day_type_id').gte('day', first).lt('day', next).order('day').order('person_id').range(a, b),
    ),
  ]);

  const dtName = new Map((dts ?? []).map((d) => [d.id as string, d.name as string]));
  const withData = new Set(events.map((e) => e.person_id));
  const list = (people ?? []).filter((p) => p.active || withData.has(p.id));
  const summaries = monthlySummary(
    events.map((e) => ({ person_id: e.person_id, activity_id: e.activity_id, s: Date.parse(e.starts_at), e: Date.parse(e.ends_at) })),
    (acts ?? []) as RActivity[],
    marks.map((m) => ({ person_id: m.person_id, day: m.day, type: dtName.get(m.day_type_id) ?? 'Altro' })),
    list.map((p) => p.id),
    month,
    tz,
  );

  return (
    <ReportView
      month={month}
      tz={tz}
      people={list.map((p) => ({ id: p.id, name: p.full_name, email: p.email, team: p.team, contract: p.contract, active: p.active }))}
      summaries={summaries}
      activityOrder={(acts ?? []).map((a) => ({ name: a.name as string, kind: a.kind as string, color: a.color as string }))}
      dayTypeOrder={(dts ?? []).map((d) => d.name as string)}
    />
  );
}
