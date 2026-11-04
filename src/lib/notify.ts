import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/server';

export interface Notice {
  title: string;
  body?: string;
  url?: string;
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? '';

let vapidReady = false;
function setupVapid() {
  if (vapidReady) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com', pub, priv);
  vapidReady = true;
  return true;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

async function sendEmail(to: string, n: Notice) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return;
  const link = n.url ? `${SITE}${n.url}` : SITE;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1d2433;max-width:520px">
    <p style="font-size:17px;font-weight:600;margin:0 0 8px">${escapeHtml(n.title)}</p>
    ${n.body ? `<p style="margin:0 0 16px;white-space:pre-line">${escapeHtml(n.body)}</p>` : ''}
    <p><a href="${link}" style="background:#3157d5;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;display:inline-block">Apri i turni</a></p>
  </div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject: n.title, html, text: `${n.title}\n\n${n.body ?? ''}\n\n${link}` }),
  }).catch(() => undefined);
}

/**
 * Notifica le persone indicate: notifica in-app + email + push.
 * Non blocca mai l'azione dell'utente: gli errori vengono ignorati.
 */
export async function notify(personIds: (string | null | undefined)[], n: Notice) {
  const ids = Array.from(new Set(personIds.filter(Boolean) as string[]));
  if (!ids.length) return;
  const admin = createAdminClient();
  if (!admin) return;

  try {
    const { data: people } = await admin
      .from('people')
      .select('id, email, email_notifications, active')
      .in('id', ids);
    const targets = (people ?? []).filter((p) => p.active);
    if (!targets.length) return;

    await admin.from('notifications').insert(
      targets.map((p) => ({ person_id: p.id, title: n.title, body: n.body ?? null, url: n.url ?? null })),
    );

    const jobs: Promise<unknown>[] = [];
    for (const p of targets) {
      if (p.email && p.email_notifications) jobs.push(sendEmail(p.email, n));
    }

    if (setupVapid()) {
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .in(
          'person_id',
          targets.map((p) => p.id),
        );
      const payload = JSON.stringify({ title: n.title, body: n.body ?? '', url: n.url ?? '/' });
      for (const s of subs ?? []) {
        jobs.push(
          webpush
            .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
            .catch(async (err: { statusCode?: number }) => {
              // sottoscrizione scaduta: la rimuovo
              if (err?.statusCode === 404 || err?.statusCode === 410) {
                await admin.from('push_subscriptions').delete().eq('id', s.id);
              }
            }),
        );
      }
    }
    await Promise.allSettled(jobs);
  } catch {
    // le notifiche non devono mai far fallire l'azione principale
  }
}

export async function managerIds(): Promise<string[]> {
  const admin = createAdminClient();
  if (!admin) return [];
  const { data } = await admin
    .from('people')
    .select('id')
    .in('role', ['manager', 'admin', 'team_lead'])
    .eq('active', true)
    .eq('notify_requests', true);
  return (data ?? []).map((p) => p.id);
}

export async function allActiveIds(): Promise<string[]> {
  const admin = createAdminClient();
  if (!admin) return [];
  const { data } = await admin.from('people').select('id').eq('active', true).not('user_id', 'is', null);
  return (data ?? []).map((p) => p.id);
}
