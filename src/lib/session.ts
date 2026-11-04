import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Person, Settings } from '@/lib/types';
import { DEFAULT_TZ } from '@/lib/time';

export const getSession = cache(async () => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: me } = await supabase
    .from('people')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle<Person>();
  if (!me || !me.active) redirect('/accesso-negato');

  const { data: settings } = await supabase.from('settings').select('*').single<Settings>();
  const tz = settings?.timezone ?? DEFAULT_TZ;
  return {
    supabase,
    user,
    me,
    settings: settings!,
    tz,
    isManager: me.role !== 'agent',
    isAdmin: me.role === 'admin',
  };
});

export async function requireManager() {
  const s = await getSession();
  if (!s.isManager) redirect('/timeline');
  return s;
}
