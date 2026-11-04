/**
 * Sincronizzazione con Google Calendar.
 * Un evento Google per persona e per giornata ("Turno 09:00–18:00"), con
 * le attività nella descrizione. Si sincronizzano solo le settimane pubblicate,
 * da 7 giorni fa a 60 giorni avanti.
 * Il refresh token è cifrato (AES-256-GCM) prima di salvarlo nel database.
 */
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { addDays, dayStart, fmtDay, fmtTime, localDate, todayIn, weekStart } from '@/lib/time';

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

export const SCOPES = {
  primary: 'https://www.googleapis.com/auth/calendar.events',
  separate: 'https://www.googleapis.com/auth/calendar.app.created',
} as const;

const API = 'https://www.googleapis.com/calendar/v3';

export function calendarConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/* ---------------- cifratura token ---------------- */
function key() {
  const raw = process.env.CALENDAR_TOKEN_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return crypto.createHash('sha256').update(`turni-calendar:${raw}`).digest();
}
export function encrypt(text: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
export function decrypt(blob: string) {
  const [, iv, tag, data] = blob.split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv!, 'base64'));
  d.setAuthTag(Buffer.from(tag!, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data!, 'base64')), d.final()]).toString('utf8');
}

/* ---------------- OAuth ---------------- */
export async function exchangeCode(code: string, redirectUri: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error_description || j.error || 'Accesso a Google non riuscito');
  return j as { access_token: string; refresh_token?: string; scope: string; id_token?: string };
}

async function accessToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error === 'invalid_grant' ? 'Collegamento scaduto o revocato: ricollega Google Calendar' : j.error_description || j.error);
  return j.access_token as string;
}

export async function revoke(refreshToken: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' }).catch(() => undefined);
}

async function g(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(j?.error?.message || `Google Calendar ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return j;
}

export async function createSeparateCalendar(token: string, name: string, tz: string) {
  const c = await g(token, 'POST', '/calendars', { summary: name, timeZone: tz, description: 'Turni di lavoro, aggiornati automaticamente.' });
  return c.id as string;
}

export async function newAccessToken(encrypted: string) {
  return accessToken(decrypt(encrypted));
}

/* ---------------- contenuto da sincronizzare ---------------- */
interface DayEvent {
  day: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  hash: string;
}

async function desiredFor(admin: Admin, personId: string, tz: string, orgName: string): Promise<DayEvent[]> {
  const today = todayIn(tz);
  const from = addDays(today, -7);
  const to = addDays(today, 61);
  const [{ data: evs }, { data: acts }, { data: weeks }, { data: marks }, { data: dts }] = await Promise.all([
    admin
      .from('events')
      .select('activity_id, starts_at, ends_at, note')
      .eq('person_id', personId)
      .gte('starts_at', new Date(dayStart(from, tz)).toISOString())
      .lt('starts_at', new Date(dayStart(to, tz)).toISOString())
      .order('starts_at'),
    admin.from('activity_types').select('id, name, kind'),
    admin.from('schedule_weeks').select('week_start').gte('week_start', weekStart(from)).lt('week_start', to),
    admin.from('day_marks').select('day, day_type_id').eq('person_id', personId).gte('day', from).lt('day', to),
    admin.from('day_types').select('id, name'),
  ]);
  const act = new Map((acts ?? []).map((a) => [a.id as string, a as { name: string; kind: string }]));
  const pub = new Set((weeks ?? []).map((w) => w.week_start as string));
  const dt = new Map((dts ?? []).map((d) => [d.id as string, d.name as string]));
  const mk = new Map((marks ?? []).map((m) => [m.day as string, dt.get(m.day_type_id as string) ?? null]));

  const byDay = new Map<string, { s: number; e: number; name: string; kind: string; note: string | null }[]>();
  for (const e of evs ?? []) {
    const s = Date.parse(e.starts_at as string);
    const day = localDate(s, tz);
    if (!pub.has(weekStart(day))) continue;
    const a = act.get(e.activity_id as string);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push({ s, e: Date.parse(e.ends_at as string), name: a?.name ?? 'Attività', kind: a?.kind ?? 'work', note: (e.note as string) ?? null });
  }

  const out: DayEvent[] = [];
  byDay.forEach((list, day) => {
    const work = list.filter((x) => x.kind !== 'absence');
    const abs = list.filter((x) => x.kind === 'absence');
    const pool = work.length ? work : abs;
    const s = Math.min(...pool.map((x) => x.s));
    const e = Math.max(...pool.map((x) => x.e));
    const tag = mk.get(day);
    let summary: string;
    if (!work.length) summary = Array.from(new Set(abs.map((x) => x.name))).join(', ');
    else summary = `Turno ${fmtTime(s, tz)}–${fmtTime(e, tz)}${abs.length ? ` · ${abs.map((x) => x.name).join(', ')}` : ''}${tag ? ` · ${tag}` : ''}`;
    const description = [
      ...list.sort((a, b) => a.s - b.s).map((x) => `${fmtTime(x.s, tz)}–${fmtTime(x.e, tz)} ${x.name}${x.note ? ` (${x.note})` : ''}`),
      '',
      `${orgName} · ${fmtDay(day, 'EEEE d MMMM')}`,
    ].join('\n');
    const start = new Date(s).toISOString();
    const end = new Date(e).toISOString();
    const hash = crypto.createHash('sha1').update([summary, description, start, end].join('|')).digest('hex');
    out.push({ day, summary, description, start, end, hash });
  });
  return out;
}

/* ---------------- sincronizzazione ---------------- */
export async function syncPerson(personId: string): Promise<{ created: number; updated: number; deleted: number }> {
  const admin = createAdminClient();
  if (!admin || !calendarConfigured()) return { created: 0, updated: 0, deleted: 0 };
  const { data: link } = await admin.from('calendar_links').select('*').eq('person_id', personId).maybeSingle();
  if (!link) return { created: 0, updated: 0, deleted: 0 };
  const { data: settings } = await admin.from('settings').select('timezone, org_name').single();
  const tz = settings?.timezone ?? 'Europe/Rome';
  const counts = { created: 0, updated: 0, deleted: 0 };
  try {
    const token = await newAccessToken(link.refresh_token);
    const cal = encodeURIComponent(link.calendar_id);
    const desired = await desiredFor(admin, personId, tz, settings?.org_name ?? 'Turni');
    const today = todayIn(tz);
    const { data: rows } = await admin
      .from('calendar_events')
      .select('day, google_event_id, hash')
      .eq('person_id', personId)
      .gte('day', addDays(today, -7));
    const existing = new Map((rows ?? []).map((r) => [r.day as string, r as { day: string; google_event_id: string; hash: string }]));
    const want = new Map(desired.map((d) => [d.day, d]));

    const body = (d: DayEvent) => ({
      summary: d.summary,
      description: d.description,
      start: { dateTime: d.start, timeZone: tz },
      end: { dateTime: d.end, timeZone: tz },
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: { private: { turni: '1', day: d.day } },
      transparency: 'opaque',
    });

    const jobs: (() => Promise<void>)[] = [];
    want.forEach((d) => {
      const ex = existing.get(d.day);
      if (ex && ex.hash === d.hash) return;
      jobs.push(async () => {
        if (ex) {
          try {
            await g(token, 'PUT', `/calendars/${cal}/events/${encodeURIComponent(ex.google_event_id)}`, body(d));
            await admin.from('calendar_events').update({ hash: d.hash }).eq('person_id', personId).eq('day', d.day);
            counts.updated++;
            return;
          } catch (e) {
            if (![404, 410].includes((e as { status?: number }).status ?? 0)) throw e;
          }
        }
        const created = await g(token, 'POST', `/calendars/${cal}/events`, body(d));
        await admin.from('calendar_events').upsert({ person_id: personId, day: d.day, google_event_id: created.id, hash: d.hash });
        counts.created++;
      });
    });
    existing.forEach((ex) => {
      if (want.has(ex.day)) return;
      jobs.push(async () => {
        try {
          await g(token, 'DELETE', `/calendars/${cal}/events/${encodeURIComponent(ex.google_event_id)}`);
        } catch (e) {
          if (![404, 410].includes((e as { status?: number }).status ?? 0)) throw e;
        }
        await admin.from('calendar_events').delete().eq('person_id', personId).eq('day', ex.day);
        counts.deleted++;
      });
    });
    await runLimited(jobs, 4);
    await admin.from('calendar_links').update({ last_sync_at: new Date().toISOString(), last_error: null }).eq('person_id', personId);
  } catch (e) {
    await admin
      .from('calendar_links')
      .update({ last_error: e instanceof Error ? e.message.slice(0, 300) : 'Errore di sincronizzazione' })
      .eq('person_id', personId);
  }
  return counts;
}

async function runLimited(jobs: (() => Promise<void>)[], n: number) {
  let i = 0;
  const errors: unknown[] = [];
  await Promise.all(
    Array.from({ length: Math.min(n, jobs.length) }, async () => {
      while (i < jobs.length) {
        const job = jobs[i++]!;
        try {
          await job();
        } catch (e) {
          errors.push(e);
        }
      }
    }),
  );
  if (errors.length) throw errors[0];
}

/** Sincronizza le persone indicate che hanno collegato il calendario (mai bloccante) */
export async function syncCalendars(personIds: (string | null | undefined)[], budgetMs = 20000) {
  try {
    const admin = createAdminClient();
    if (!admin || !calendarConfigured()) return;
    const ids = Array.from(new Set(personIds.filter(Boolean) as string[]));
    if (!ids.length) return;
    const { data } = await admin.from('calendar_links').select('person_id').in('person_id', ids);
    const linked = (data ?? []).map((r) => r.person_id as string);
    const t0 = Date.now();
    let i = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, linked.length) }, async () => {
        while (i < linked.length && Date.now() - t0 < budgetMs) await syncPerson(linked[i++]!);
      }),
    );
  } catch {
    // il calendario non deve mai bloccare le modifiche ai turni
  }
}

export async function syncAll(budgetMs = 50000) {
  const admin = createAdminClient();
  if (!admin) return 0;
  const { data } = await admin.from('calendar_links').select('person_id');
  const ids = (data ?? []).map((r) => r.person_id as string);
  await syncCalendars(ids, budgetMs);
  return ids.length;
}

export async function disconnect(personId: string) {
  const admin = createAdminClient();
  if (!admin) return;
  const { data: link } = await admin.from('calendar_links').select('*').eq('person_id', personId).maybeSingle();
  if (!link) return;
  try {
    const refresh = decrypt(link.refresh_token);
    const token = await accessToken(refresh);
    if (link.mode === 'separate') {
      await g(token, 'DELETE', `/calendars/${encodeURIComponent(link.calendar_id)}`).catch(() => undefined);
    } else {
      const { data: rows } = await admin.from('calendar_events').select('google_event_id').eq('person_id', personId);
      await runLimited(
        (rows ?? []).map((r) => () => g(token, 'DELETE', `/calendars/primary/events/${encodeURIComponent(r.google_event_id as string)}`).then(() => undefined).catch(() => undefined)),
        4,
      );
    }
    await revoke(refresh);
  } catch {
    // anche se Google non risponde, scolleghiamo comunque
  }
  await admin.from('calendar_events').delete().eq('person_id', personId);
  await admin.from('calendar_links').delete().eq('person_id', personId);
}
