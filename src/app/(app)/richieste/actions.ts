'use server';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { allActiveIds, managerIds, notify } from '@/lib/notify';
import { syncCalendars } from '@/lib/gcal';
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

export async function createSwap(dayA: string, target: string, dayB: string, note: string, reviewer: string | null = null): Promise<Res> {
  const { supabase, me } = await getSession();
  const { data, error } = await supabase.rpc('request_create', {
    p_kind: 'swap', p_target: target, p_day_a: dayA, p_day_b: dayB, p_note: note || null, p_reviewer: reviewer,
  });
  if (error) return { ok: false, error: error.message };
  const r = data as RequestRow;
  await notify([r.target_id], {
    title: `${firstName(me.full_name)} ti propone uno scambio`,
    body:
      dayA === dayB
        ? `Il suo turno di ${fmtDay(dayA, 'EEEE d MMM')} con il tuo dello stesso giorno.${note ? `\n“${note}”` : ''}`
        : `Scambio di riposo: tu lavoreresti ${fmtDay(dayA, 'EEEE d MMM')} al suo posto e riposeresti ${fmtDay(dayB, 'EEEE d MMM')}.${note ? `\n“${note}”` : ''}`,
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
    const reviewer = (r as RequestRow & { reviewer_id?: string | null }).reviewer_id;
    await notify((reviewer ? [reviewer] : await managerIds()).filter((x) => x !== me.id), {
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

export async function decide(id: string, approve: boolean, note: string, force = false): Promise<Res> {
  const { supabase, me } = await getSession();
  const { data, error } = await supabase.rpc('request_decide', { p_id: id, p_approve: approve, p_note: note || null, p_force: force });
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
  if (approve) await syncCalendars([r.requester_id, r.target_id]);
  return done(approve ? 'Approvata: turni aggiornati' : 'Richiesta rifiutata');
}

export async function createChange(day: string, note: string): Promise<Res> {
  const { supabase, me } = await getSession();
  const { error } = await supabase.rpc('request_change', { p_day: day, p_note: note });
  if (error) return { ok: false, error: error.message };
  await notify((await managerIds()).filter((id) => id !== me.id), {
    title: `Richiesta di modifica da ${firstName(me.full_name)}`,
    body: `${fmtDay(day, 'EEEE d MMM')}: ${note}`,
    url: '/richieste',
  });
  return done('Richiesta inviata ai manager');
}

export async function decideMany(ids: string[], approve: boolean, note: string): Promise<Res> {
  let ok = 0;
  const errors: string[] = [];
  for (const id of ids) {
    const r = await decide(id, approve, note);
    if (r.ok) ok++;
    else errors.push(r.error);
  }
  if (!ok) return { ok: false, error: errors[0] ?? 'Nessuna richiesta gestita' };
  return {
    ok: true,
    message: `${ok} ${approve ? 'approvate' : 'rifiutate'}${errors.length ? `, ${errors.length} non gestite (es. ${errors[0]})` : ''}`,
  };
}

export interface SwapBlock { s: string; e: string; name: string; color: string; kind: string }
export interface SwapCandidate {
  person_id: string;
  full_name: string;
  day: string;
  starts_at: string;
  ends_at: string;
  mode: 'same_day' | 'rest_swap';
  day_type: string | null;
  day_color: string | null;
  blocks: SwapBlock[];
  issues: string[];
}
export type SwapSearch =
  | { ok: true; mine: { blocks: SwapBlock[]; day_type: string | null; day_color: string | null }; candidates: SwapCandidate[] }
  | { ok: false; error: string };

/** Turni dei colleghi compatibili con il mio turno del giorno dayA */
export async function swapCandidatesAction(dayA: string, from: string, to: string): Promise<SwapSearch> {
  const { supabase, me, tz } = await getSession();
  const { data, error } = await supabase.rpc('swap_candidates', { p_day_a: dayA, p_from: from, p_to: to });
  if (error) return { ok: false, error: error.message };
  const { dayStart, addDays } = await import('@/lib/time');
  const [{ data: ev }, { data: acts }, { data: mk }] = await Promise.all([
    supabase
      .from('events')
      .select('starts_at, ends_at, activity_id')
      .eq('person_id', me.id)
      .gte('starts_at', new Date(dayStart(dayA, tz)).toISOString())
      .lt('starts_at', new Date(dayStart(addDays(dayA, 1), tz)).toISOString())
      .order('starts_at'),
    supabase.from('activity_types').select('id, name, color, kind'),
    supabase.from('day_marks').select('day_types(name, color)').eq('person_id', me.id).eq('day', dayA).maybeSingle(),
  ]);
  const act = new Map((acts ?? []).map((a) => [a.id as string, a]));
  const dt = (mk as { day_types?: { name: string; color: string } | null } | null)?.day_types ?? null;
  return {
    ok: true,
    mine: {
      blocks: (ev ?? []).map((e) => {
        const a = act.get(e.activity_id as string);
        return { s: e.starts_at as string, e: e.ends_at as string, name: (a?.name as string) ?? '', color: (a?.color as string) ?? '#999999', kind: (a?.kind as string) ?? 'work' };
      }),
      day_type: dt?.name ?? null,
      day_color: dt?.color ?? null,
    },
    candidates: (data ?? []) as SwapCandidate[],
  };
}
