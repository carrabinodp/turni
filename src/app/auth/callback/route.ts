import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('Accesso annullato')}`);
  }
  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('Accesso non riuscito, riprova')}`);
  }
  // collega (o crea) il profilo; null = dominio non autorizzato
  const { data: personId } = await supabase.rpc('ensure_profile');
  if (!personId) {
    return NextResponse.redirect(`${origin}/accesso-negato`);
  }
  return NextResponse.redirect(`${origin}${safeNext}`);
}
