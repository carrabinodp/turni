'use server';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';

export async function markAllRead() {
  const { supabase, me } = await getSession();
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('person_id', me.id).is('read_at', null);
  revalidatePath('/', 'layout');
  return { ok: true as const, message: 'Fatto' };
}

export async function setEmailPref(on: boolean) {
  const { supabase, me } = await getSession();
  const { error } = await supabase.from('people').update({ email_notifications: on }).eq('id', me.id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/notifiche');
  return { ok: true as const, message: on ? 'Email attivate' : 'Email disattivate' };
}
