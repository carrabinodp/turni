import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { createSeparateCalendar, encrypt, exchangeCode, syncPerson } from '@/lib/gcal';

export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const back = (msg: string) => NextResponse.redirect(`${origin}/impostazioni?calendar=${encodeURIComponent(msg)}#calendario`);

  const saved = cookies().get('cal_oauth')?.value ?? '';
  cookies().delete('cal_oauth');
  const [state, mode, personId] = saved.split('.');
  if (url.searchParams.get('error')) return back('Collegamento annullato');
  if (!state || state !== url.searchParams.get('state')) return back('Sessione scaduta, riprova');

  // la persona che ha avviato il collegamento deve essere quella collegata ora
  const supabase = createClient();
  const { data: me } = await supabase.rpc('current_person_id');
  if (!me || me !== personId) return back('Accedi di nuovo e riprova');

  const admin = createAdminClient();
  if (!admin) return back('Google Calendar non è configurato');

  try {
    const tokens = await exchangeCode(url.searchParams.get('code') ?? '', `${origin}/api/calendar/callback`);
    if (!tokens.refresh_token) return back('Google non ha concesso l’accesso permanente: scollega l’app dal tuo account Google e riprova');
    const { data: settings } = await admin.from('settings').select('org_name, timezone').single();
    let calendarId = 'primary';
    if (mode === 'separate') {
      calendarId = await createSeparateCalendar(tokens.access_token, settings?.org_name ?? 'Turni', settings?.timezone ?? 'Europe/Rome');
    }
    const { data: person } = await admin.from('people').select('email').eq('id', personId).single();
    await admin.from('calendar_events').delete().eq('person_id', personId);
    const { error } = await admin.from('calendar_links').upsert({
      person_id: personId,
      refresh_token: encrypt(tokens.refresh_token),
      mode: mode === 'separate' ? 'separate' : 'primary',
      calendar_id: calendarId,
      google_email: person?.email ?? null,
      connected_at: new Date().toISOString(),
      last_error: null,
    });
    if (error) return back(error.message);
    const r = await syncPerson(personId!);
    return back(`ok:${r.created}`);
  } catch (e) {
    return back(e instanceof Error ? e.message : 'Collegamento non riuscito');
  }
}
