'use server';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { notify } from '@/lib/notify';
import { syncCalendars } from '@/lib/gcal';
import { addDays, fmtDay, weekStart } from '@/lib/time';
import type { ImportPayload, ImportResult } from '@/components/import/Importer';

export async function importAction(p: ImportPayload): Promise<ImportResult> {
  const { supabase, isManager, me } = await getSession();
  if (!isManager) return { ok: false, error: 'Solo i manager possono importare' };
  if (p.rows.length > 20000) return { ok: false, error: 'File troppo grande: massimo 20.000 blocchi per volta' };

  const { publish, color_map, ...payload } = p;
  const { data, error } = await supabase.rpc('import_schedule', { payload });
  if (error) return { ok: false, error: error.message };

  // ricorda gli abbinamenti dei colori per i prossimi import
  if (color_map.length) {
    const [{ data: acts }, { data: dts }] = await Promise.all([
      supabase.from('activity_types').select('id, name'),
      supabase.from('day_types').select('id, name'),
    ]);
    const byName = (list: { id: string; name: string }[] | null, n?: string) =>
      n ? list?.find((x) => x.name.trim().toLowerCase() === n.trim().toLowerCase())?.id ?? null : null;
    const rows = color_map
      .map((c) => {
        const activity_id = c.target === 'activity' ? c.activity_id ?? byName(acts, c.activity_name) : null;
        const day_type_id = c.target === 'day_type' ? c.day_type_id ?? byName(dts, c.day_type_name) : null;
        return { fill: c.fill, target: c.target, activity_id, day_type_id, label: c.label, updated_at: new Date().toISOString() };
      })
      .filter((r) => (r.target !== 'activity' || r.activity_id) && (r.target !== 'day_type' || r.day_type_id));
    await supabase.from('import_color_map').upsert(rows, { onConflict: 'fill' });
  }

  const published: string[] = [];
  if (publish) {
    const persons = new Set<string>();
    for (let w = weekStart(p.from_date); w <= p.to_date; w = addDays(w, 7)) {
      const { data: ids, error: e2 } = await supabase.rpc('publish_week', { p_week: w, p_publish: true });
      if (e2) return { ok: false, error: `Import riuscito, ma la pubblicazione non è andata: ${e2.message}` };
      published.push(w);
      ((ids ?? []) as string[]).forEach((id) => persons.add(id));
    }
    persons.delete(me.id);
    await notify(Array.from(persons), {
      title: 'Nuovi turni pubblicati',
      body: `Sono disponibili i turni dal ${fmtDay(p.from_date, 'd MMM')} al ${fmtDay(p.to_date, 'd MMM')}.`,
      url: '/i-miei-turni',
    });
  }
  await syncCalendars((data.persons ?? []) as string[]);
  revalidatePath('/timeline');
  return { ok: true, inserted: data.inserted, deleted: data.deleted, people_created: data.people_created, marks: data.marks ?? 0, published };
}
