import { NextResponse } from 'next/server';
import { syncAll } from '@/lib/gcal';

export const maxDuration = 60;

/** Sincronizzazione giornaliera di tutti i calendari collegati (Vercel Cron) */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'non autorizzato' }, { status: 401 });
  }
  const n = await syncAll(55000);
  return NextResponse.json({ ok: true, people: n });
}
