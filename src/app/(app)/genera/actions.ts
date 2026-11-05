'use server';
import { revalidatePath } from 'next/cache';
import { getSession, requireManager } from '@/lib/session';
import { parsePref, type GenConfig, type PrefKind } from '@/lib/generator';

type R = { ok: true; message: string } | { ok: false; error: string };
const MONTH = /^\d{4}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const KINDS: PrefKind[] = ['off', 'start_after', 'end_by', 'no_close', 'no_open', 'shift', 'no_weekend', 'note'];

export async function saveGenConfig(c: GenConfig): Promise<R> {
  const { supabase } = await requireManager();
  const { error } = await supabase.rpc('save_generator_config', { p: c });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/genera');
  return { ok: true, message: 'Regole salvate' };
}

export async function saveProfiles(rows: { id: string; shift_hours: number | null; days_per_week: number | null; gen_exclude: boolean; can_weekend: boolean }[]): Promise<R> {
  const { supabase } = await requireManager();
  const clean = rows.map((r) => ({
    id: r.id,
    shift_hours: r.shift_hours && r.shift_hours >= 1 && r.shift_hours <= 13 ? Math.round(r.shift_hours * 2) / 2 : null,
    days_per_week: r.days_per_week && r.days_per_week >= 1 && r.days_per_week <= 7 ? Math.round(r.days_per_week) : null,
    gen_exclude: !!r.gen_exclude,
    can_weekend: !!r.can_weekend,
  }));
  const { error } = await supabase.rpc('save_generator_profiles', { p: clean });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/genera');
  return { ok: true, message: 'Persone salvate' };
}

export interface PrefInput {
  id?: string;
  month: string;
  person_id: string;
  text: string;
  kind: PrefKind;
  day: string | null;
  weekday: number | null;
  time_a: string | null;
  time_b: string | null;
  reviewed: boolean;
}

function cleanPref(p: PrefInput) {
  if (!MONTH.test(p.month)) throw new Error('Mese non valido');
  if (!p.text.trim()) throw new Error('Scrivi la preferenza');
  return {
    month: p.month,
    person_id: p.person_id,
    text: p.text.trim().slice(0, 300),
    kind: KINDS.includes(p.kind) ? p.kind : 'note',
    day: p.day && ISO.test(p.day) ? p.day : null,
    weekday: p.weekday && p.weekday >= 1 && p.weekday <= 7 ? p.weekday : null,
    time_a: p.time_a && TIME.test(p.time_a) ? p.time_a : null,
    time_b: p.time_b && TIME.test(p.time_b) ? p.time_b : null,
    reviewed: !!p.reviewed,
  };
}

export async function savePref(p: PrefInput): Promise<R> {
  const { supabase, me } = await requireManager();
  try {
    const row = { ...cleanPref(p), source: p.id ? undefined : 'manager', created_by: p.id ? undefined : me.id };
    const { error } = p.id ? await supabase.from('gen_preferences').update(row).eq('id', p.id) : await supabase.from('gen_preferences').insert(row);
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath('/genera');
  return { ok: true, message: 'Preferenza salvata' };
}

export async function deletePref(id: string): Promise<R> {
  const { supabase } = await getSession();
  const { error } = await supabase.from('gen_preferences').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/genera');
  revalidatePath('/i-miei-turni');
  return { ok: true, message: 'Preferenza eliminata' };
}

/** preferenze da un file: una riga per persona, una o più colonne di testo */
export async function importPrefs(month: string, rows: { person_id: string; text: string }[]): Promise<R> {
  const { supabase, me } = await requireManager();
  if (!MONTH.test(month)) return { ok: false, error: 'Mese non valido' };
  const list = rows
    .filter((r) => r.person_id && r.text.trim())
    .slice(0, 500)
    .map((r) => ({ month, person_id: r.person_id, text: r.text.trim().slice(0, 300), ...parsePref(r.text, month), source: 'manager', created_by: me.id }));
  if (!list.length) return { ok: false, error: 'Nessuna preferenza da importare' };
  const { error } = await supabase.from('gen_preferences').insert(list);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/genera');
  return { ok: true, message: `${list.length} preferenze importate` };
}

/** preferenze dell'operatore (dal suo calendario) */
export async function addMyPref(month: string, text: string): Promise<R> {
  const { supabase, me } = await getSession();
  if (!MONTH.test(month) || !text.trim()) return { ok: false, error: 'Scrivi la preferenza' };
  const parsed = parsePref(text, month);
  const { error } = await supabase.from('gen_preferences').insert({ month, person_id: me.id, text: text.trim().slice(0, 300), ...parsed });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/i-miei-turni');
  return { ok: true, message: 'Preferenza inviata' };
}

export interface DraftWeek {
  from_date: string;
  to_date: string;
  persons: string[];
  rows: { person_id: string; activity_id: string; starts_at: string; ends_at: string; note?: string }[];
  marks: { person_id: string; day: string; day_type_id: string }[];
}

export async function saveDraftWeek(p: DraftWeek): Promise<R> {
  const { supabase } = await requireManager();
  if (!ISO.test(p.from_date) || !ISO.test(p.to_date)) return { ok: false, error: 'Periodo non valido' };
  if (p.rows.length > 6000) return { ok: false, error: 'Troppi blocchi in una settimana' };
  const { data, error } = await supabase.rpc('generator_save', { payload: p });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/timeline');
  const r = data as { inserted: number };
  return { ok: true, message: `${r.inserted} blocchi salvati` };
}
