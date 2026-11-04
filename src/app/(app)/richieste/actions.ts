'use server';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { allActiveIds, managerIds, notify } from '@/lib/notify';
import { fmtDay } from '@/lib/time';
import { firstName } from '@/lib/names';
import type { RequestRow } from '@/lib/types';

export type Res = { ok: true; message: string } | { ok: false; error: string };

type Db = Awaited<ReturnType<typeof getSession>>['supabase'];

async function nameOf(supabase: Db, id: string | null) {
  if (!id) return '';
  const { data } = await supabase.from('people').select('full_name').eq('id', id).maybeSingle();
  return data?.full_name ?? '';
}

function done(message: string): Res {
  revalidatePath('/richieste');
  revalidatePath('/i-miei-turni');
  revalidatePath('/timeline');
  return { ok: true, message };
}

export async function createSwap(dayA: string, target: string, dayB: string, note: string): Promise<Res> {
  const { supabase, me } = await getSession();
  const { data, error } = await supabase.rpc('request_create', {
    p_kind: 'swap', p_target: target, p_day_a: dayA, p_day_b: dayB, p_note: note || null,
  });
  if (error) return { ok: false, error: error.message };
  const r = data as RequestRow;
  await notify([r.target_id], {
    title: `${firstName(me.full_name)} ti propone uno scambio`,
    body: `Il suo turno di ${fmtDay(dayA, 'EEEE d MMM')} con il tuo di ${fmtDay(dayB, 'EEEE d MMM')}.${note ? `\n“${note}”` : ''}`,
    url: '/richieste',
  });
  return done('Richiesta inviata al collega');
}

export async function createGive(dayA: string, target: string | null, note: string): Promise<Res> {
  const { supabase, me } = await getSession();
  const { data, error } = await supabase.rpc('request_create', {
    p_kind: 'give', p_target: target, p_day_a: dayA, p_note: note || null,
  });
  if (error) return { ok: false, error: error.message };
  const r = data as RequestRow;
  if (r.target_id) {
    await notify([r.target_id], {
      title: `${firstName(me.full_name)} ti chiede di prendere un turno`,
      body: `${fmtDay(dayA, 'EEEE d MMM')}.${note ? `\n“${note}”` : ''}`,
      url: '/richieste',
    });
  } else {
    const all = (await allActiveIds()).filter((id) => id !== me.id);
    await notify(all, {
      title: 'Nuovo turno in bacheca',
      body: `${firstName(me.full_name)} cede il turno di ${fmtDay(dayA, 'EEEE d MMM')}.`,
      url: '/richieste',
    });
  }
  return done(r.target_id ? 'Richiesta inviata al collega' : 'Turno pubblicato in bacheca');
}

export async function createTimeOff(
  from: string, to: string, timeFrom: string | null, timeTo: string | null, activity: string, note: string,
): Promise<Res> {
  const { supabase, me } = await getSession();
  const { error } = await supabase.rpc('request_create', {
    p_kind: 'time_off', p_from: from, p_to: to, p_time_from: timeFrom || null, p_time_to: timeTo || null,
    p_activity: activity, p_note: note || null,
  });
  if (error) return { ok: false, error: error.message };
  await notify((await managerIds()).filter((id) => id !== me.id), {
    title: `Richiesta di assenza da ${firstName(me.full_name)}`,
    body: from === to ? fmtDay(from, 'EEEE d MMMM') : `Dal ${fmtDay(from, 'd MMM')} al ${fmtDay(to, 'd MMM')}`,
    url: '/richieste',
  });
  return done('Richiesta inviata ai manager');
}

export async function respond(id: string, accept: boolean): Promise<Res> {
  const { supabase, me } = await getSession();
  const { data, error } = await supabase.rpc('request_respond', { p_id: id, p_accept: accept });
  if (error) return { ok: false, error: error.message };
  const r = data as RequestRow;
  await notify([r.requester_id], {
    title: accept ? `${firstName(me.full_name)} ha accettato lo scambio` : `${firstName(me.full_name)} ha rifiutato lo scambio`,
    body: accept ? 'Ora manca solo l’approvazione di un manager.' : undefined,
    url: '/richieste',
  });
  if (accept) {
    await notify((await managerIds()).filter((x) => x !== me.id), {
      title: 'Scambio turni da approvare',
      body: `${await nameOf(supabase, r.requester_id)} ↔ ${me.full_name}`,
      url: '/richieste',
    });
  }
  return done(accept ? 'Accettato: ora decide un manager' : 'Richiesta rifiutata');
}

export async function take(id: string): Promise<Res> {
  const { supabase, me } = await getSession();
  const { data, error } = await supabase.rpc('request_take', { p_id: id });
  if (error) return { ok: false, error: error.message };
  const r = data as RequestRow;
  await notify([r.requester_id], {
    title: `${firstName(me.full_name)} vuole prendere il tuo turno`,
    body: `${fmtDay(r.day_a!, 'EEEE d MMM')}. Ora manca solo l’approvazione di un manager.`,
    url: '/richieste',
  });
  await notify((await managerIds()).filter((x) => x !== me.id), {
    title: 'Cessione turno da approvare',
    body: `${await nameOf(supabase, r.requester_id)} → ${me.full_name}, ${fmtDay(r.day_a!, 'EEE d MMM')}`,
    url: '/richieste',
  });
  return done('Inviato al manager per l’approvazione');
}

export async function cancel(id: string): Promise<Res> {
  const { supabase } = await getSession();
  const { data, error } = await supabase.rpc('request_cancel', { p_id: id });
  if (error) return { ok: false, error: error.message };
  const r = data as RequestRow;
  if (r.target_id) await notify([r.target_id], { title: 'Una richiesta di scambio è stata annullata', url: '/richieste' });
  return done('Richiesta annullata');
}

export async function decide(id: string, approve: boolean, note: string): Promise<Res> {
  const { supabase, me } = await getSession();
  const { data, error } = await supabase.rpc('request_decide', { p_id: id, p_approve: approve, p_note: note || null });
  if (error) return { ok: false, error: error.message };
  const r = data as RequestRow;
  const outcome = approve ? 'approvat' : 'rifiutat';
  const title =
    r.kind === 'time_off'
      ? `La tua richiesta di assenza è stata ${outcome}a`
      : r.kind === 'swap'
        ? `Lo scambio turni è stato ${outcome}o`
        : `La cessione del turno è stata ${outcome}a`;
  await notify([r.requester_id, r.target_id].filter((x) => x !== me.id), {
    title,
    body: note ? `Nota del manager: ${note}` : approve ? 'I turni sono già aggiornati.' : undefined,
    url: '/i-miei-turni',
  });
  return done(approve ? 'Approvata: turni aggiornati' : 'Richiesta rifiutata');
}
