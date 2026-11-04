'use server';
import { revalidatePath } from 'next/cache';
import { requireManager } from '@/lib/session';
import type { ActivityKind } from '@/lib/types';

type R = { ok: true; message: string } | { ok: false; error: string };

export interface ActivityInput {
  id?: string;
  name: string;
  color: string;
  kind: ActivityKind;
  aliases: string;
  requestable: boolean;
  archived: boolean;
  sort_order: number;
}

export async function saveActivity(a: ActivityInput): Promise<R> {
  const { supabase } = await requireManager();
  const row = {
    name: a.name.trim(),
    color: a.color,
    kind: a.kind,
    aliases: a.aliases.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    requestable: a.kind === 'absence' ? a.requestable : false,
    archived: a.archived,
    sort_order: a.sort_order,
  };
  if (!row.name) return { ok: false, error: 'Il nome è obbligatorio' };
  const { error } = a.id
    ? await supabase.from('activity_types').update(row).eq('id', a.id)
    : await supabase.from('activity_types').insert(row);
  if (error) return { ok: false, error: error.code === '23505' ? 'Esiste già un’attività con questo nome' : error.message };
  revalidatePath('/configura');
  revalidatePath('/timeline');
  return { ok: true, message: 'Attività salvata' };
}

export async function saveSettings(s: {
  org_name: string;
  allowed_domains: string;
  admin_emails: string;
  min_rest_hours: number;
  split_gap_hours: number;
  snap_minutes: number;
  timezone: string;
}): Promise<R> {
  const { supabase, isAdmin } = await requireManager();
  if (!isAdmin) return { ok: false, error: 'Solo l’amministratore può cambiare le impostazioni' };
  const list = (v: string) => v.split(/[\s,;]+/).map((x) => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const { error } = await supabase
    .from('settings')
    .update({
      org_name: s.org_name.trim() || 'Turni',
      allowed_domains: list(s.allowed_domains),
      admin_emails: list(s.admin_emails),
      min_rest_hours: s.min_rest_hours,
      split_gap_hours: s.split_gap_hours,
      snap_minutes: s.snap_minutes,
      timezone: s.timezone,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Impostazioni salvate' };
}
