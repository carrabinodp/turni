'use server';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { notify } from '@/lib/notify';
import { syncCalendars } from '@/lib/gcal';
import { fmtDay } from '@/lib/time';
import type { ActionResult, SavePayload } from '@/components/timeline/Timeline';
import type { AbsenceInput, SwapInput } from '@/components/timeline/ManagerDialogs';
import type { RequestRow } from '@/lib/types';

export async function saveScheduleAction(p: SavePayload): Promise<ActionResult> {
  const { supabase, isManager, me } = await getSession();
  if (!isManager) return { ok: false, error: 'Solo i manager possono modificare i turni' };
  let data: { inserted?: number; updated?: number; deleted?: number; affected?: string[] } = {};
  if (p.upserts.length || p.deletes.length) {
    const res = await supabase.rpc('save_schedule', { payload: { upserts: p.upserts, deletes: p.deletes } });
    if (res.error) return { ok: false, error: res.error.message };
    data = res.data ?? {};
  }
  let nMarks = 0;
  if (p.marks?.length) {
    const res = await supabase.rpc('save_day_marks', { marks: p.marks });
    if (res.error) return { ok: false, error: res.error.message };
    nMarks = p.marks.length;
    data.affected = [...(data.affected ?? []), ...p.marks.map((m) => m.person_id)];
  }

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
  await syncCalendars(data.affected ?? []);
  revalidatePath('/timeline');
  const n = (data?.inserted ?? 0) + (data?.updated ?? 0) + (data?.deleted ?? 0) + nMarks;
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
  await syncCalendars((data ?? []) as string[]); // anche il ritiro toglie i turni dai calendari
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

export async function managerTimeOffAction(p: AbsenceInput): Promise<ActionResult> {
  const { supabase, isManager, me } = await getSession();
  if (!isManager) return { ok: false, error: 'Solo i manager possono inserire assenze' };
  const { data, error } = await supabase.rpc('manager_time_off', {
    p_person: p.person_id, p_from: p.from, p_to: p.to, p_activity: p.activity_id,
    p_time_from: p.time_from, p_time_to: p.time_to, p_note: p.note || null,
  });
  if (error) return { ok: false, error: error.message };
  const r = data as RequestRow;
  const { data: act } = await supabase.from('activity_types').select('name').eq('id', p.activity_id).single();
  if (r.requester_id !== me.id) {
    await notify([r.requester_id], {
      title: `Inserito: ${act?.name ?? 'assenza'} ${p.from === p.to ? fmtDay(p.from, 'EEEE d MMM') : `dal ${fmtDay(p.from, 'd MMM')} al ${fmtDay(p.to, 'd MMM')}`}`,
      body: [p.time_from ? `Dalle ${p.time_from} alle ${p.time_to}` : null, p.note ? `Nota: ${p.note}` : null].filter(Boolean).join('\n') || undefined,
      url: '/i-miei-turni',
    });
  }
  await syncCalendars([r.requester_id]);
  revalidatePath('/timeline');
  return { ok: true, message: `${act?.name ?? 'Assenza'} inserita` };
}

export async function managerSwapAction(p: SwapInput): Promise<ActionResult> {
  const { supabase, isManager, me } = await getSession();
  if (!isManager) return { ok: false, error: 'Solo i manager possono spostare i turni' };
  const { data, error } = await supabase.rpc('manager_swap', {
    p_person_a: p.person_a, p_day_a: p.day_a, p_person_b: p.person_b, p_day_b: p.day_b,
    p_note: p.note || null, p_force: p.force,
  });
  if (error) return { ok: false, error: error.message };
  const r = data as RequestRow;
  const body = r.kind === 'swap'
    ? `Scambiati i turni di ${fmtDay(p.day_a, 'EEE d MMM')} e ${fmtDay(p.day_b, 'EEE d MMM')}.`
    : `Il turno di ${fmtDay(p.day_a, 'EEEE d MMM')} è stato spostato.`;
  await notify([p.person_a, p.person_b].filter((x) => x !== me.id), {
    title: 'I tuoi turni sono stati modificati da un manager',
    body: p.note ? `${body}\nNota: ${p.note}` : body,
    url: '/i-miei-turni',
  });
  await syncCalendars([p.person_a, p.person_b]);
  revalidatePath('/timeline');
  return { ok: true, message: r.kind === 'swap' ? 'Turni scambiati' : 'Turno spostato' };
}

export async function eventHistoryAction(eventId: string) {
  const { supabase, isManager } = await getSession();
  if (!isManager) return [];
  const { data } = await supabase.rpc('event_history', { p_event: eventId });
  return (data ?? []) as { at: string; actor: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[];
}
