import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

async function me() {
  const supabase = createClient();
  const { data: id } = await supabase.rpc('current_person_id');
  return { supabase, id: id as string | null };
}

export async function POST(req: Request) {
  const { supabase, id } = await me();
  if (!id) return NextResponse.json({ error: 'non autorizzato' }, { status: 401 });
  const sub = (await req.json()) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return NextResponse.json({ error: 'dati mancanti' }, { status: 400 });
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  const { error } = await supabase.from('push_subscriptions').insert({
    person_id: id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
    user_agent: req.headers.get('user-agent')?.slice(0, 200) ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { supabase, id } = await me();
  if (!id) return NextResponse.json({ error: 'non autorizzato' }, { status: 401 });
  const { endpoint } = (await req.json()) as { endpoint?: string };
  if (endpoint) await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  return NextResponse.json({ ok: true });
}
