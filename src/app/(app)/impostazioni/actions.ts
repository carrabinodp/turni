'use server';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { disconnect, syncPerson } from '@/lib/gcal';

type R = { ok: true; message: string } | { ok: false; error: string };

export async function savePrefs(p: { email_notifications: boolean; notify_requests: boolean }): Promise<R> {
  const { supabase, me } = await getSession();
  const { error } = await supabase.from('people').update(p).eq('id', me.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/impostazioni');
  return { ok: true, message: 'Preferenze salvate' };
}

export async function syncMyCalendar(): Promise<R> {
  const { me } = await getSession();
  const r = await syncPerson(me.id);
  revalidatePath('/impostazioni');
  return { ok: true, message: `Calendario aggiornato (${r.created} nuovi, ${r.updated} modificati, ${r.deleted} tolti)` };
}

export async function disconnectCalendar(): Promise<R> {
  const { me } = await getSession();
  await disconnect(me.id);
  revalidatePath('/impostazioni');
  return { ok: true, message: 'Google Calendar scollegato e turni rimossi dal calendario' };
}
