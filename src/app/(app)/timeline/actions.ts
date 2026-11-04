'use server';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { notify } from '@/lib/notify';
import { fmtDay } from '@/lib/time';
import type { ActionResult, SavePayload } from '@/components/timeline/Timeline';

export async function saveScheduleAction(p: SavePayload): Promise<ActionResult> {
  const { supabase, isManager, me } = await getSession();
  if (!isManager) return { ok: false, error: 'Solo i manager possono modificare i turni' };
  const { data, error } = await supabase.rpc('save_schedule', {
    payload: { upserts: p.upserts, deletes: p.deletes },
  });
  if (error) return { ok: false, error: error.message };

  // avvisa chi ha subito modifiche in settimane già pubblicate
  if (p.weeks.length) {
    const { data: pub } = await supabase.from('schedule_weeks').select('week_start').in('week_start', p.weeks);
    if (pub?.length) {
      const affected = ((data?.affected ?? []) as string[]).filter((id) => id !== me.id);
      await notify(affected, {
        title: 'I tuoi turni sono stati aggiornati',
        body: `Un manager ha modificato i turni della settimana del ${pub.map((w) => fmtDay(w.week_start, 'd MMM')).join(', ')}.`,
        url: '/i-miei-turni',
      });
    }
  }
  revalidatePath('/timeline');
  const n = (data?.inserted ?? 0) + (data?.updated ?? 0) + (data?.deleted ?? 0);
  return { ok: true, message: `Salvate ${n} modifiche` };
}

export async function publishWeekAction(week: string, publish: boolean): Promise<ActionResult> {
  const { supabase, isManager, me } = await getSession();
  if (!isManager) return { ok: false, error: 'Solo i manager possono pubblicare' };
  const { data, error } = await supabase.rpc('publish_week', { p_week: week, p_publish: publish });
  if (error) return { ok: false, error: error.message };
  if (publish) {
    await notify(((data ?? []) as string[]).filter((id) => id !== me.id), {
      title: `Turni pubblicati: settimana del ${fmtDay(week, 'd MMMM')}`,
      body: 'Controlla i tuoi turni della prossima settimana.',
      url: `/i-miei-turni?w=${week}`,
    });
  }
  revalidatePath('/timeline');
  return { ok: true, message: publish ? 'Settimana pubblicata e team avvisato' : 'Settimana tornata in bozza' };
}

export async function copyWeekAction(src: string, dst: string): Promise<ActionResult> {
  const { supabase, isManager } = await getSession();
  if (!isManager) return { ok: false, error: 'Solo i manager possono copiare i turni' };
  const { data, error } = await supabase.rpc('copy_week', { p_src: src, p_dst: dst, p_replace: true });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/timeline');
  return { ok: true, message: `Copiati ${data ?? 0} blocchi` };
}
