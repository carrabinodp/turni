import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { calendarConfigured, SCOPES } from '@/lib/gcal';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  if (!calendarConfigured()) {
    return NextResponse.redirect(`${origin}/impostazioni?calendar=${encodeURIComponent('Google Calendar non è ancora configurato dall’amministratore')}#calendario`);
  }
  const supabase = createClient();
  const { data: personId } = await supabase.rpc('current_person_id');
  if (!personId) return NextResponse.redirect(`${origin}/login`);
  const { data: me } = await supabase.from('people').select('email').eq('id', personId).single();

  const mode = url.searchParams.get('mode') === 'separate' ? 'separate' : 'primary';
  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${origin}/api/calendar/callback`,
    response_type: 'code',
    scope: SCOPES[mode],
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    ...(me?.email ? { login_hint: me.email } : {}),
    ...(process.env.NEXT_PUBLIC_GOOGLE_HD ? { hd: process.env.NEXT_PUBLIC_GOOGLE_HD } : {}),
  });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  res.cookies.set('cal_oauth', `${state}.${mode}.${personId}`, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' });
  return res;
}
