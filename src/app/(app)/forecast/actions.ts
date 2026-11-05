'use server';
import { revalidatePath } from 'next/cache';
import { requireManager } from '@/lib/session';
import type { IntervalAgg } from '@/lib/calls';
import type { ForecastPolicy } from '@/lib/forecast';

type R = { ok: true; message: string } | { ok: false; error: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const INT_KEYS = ['offered', 'answered', 'abandoned', 'short_abandoned', 'ans_10', 'ans_20', 'ans_30', 'ans_60', 'ans_120', 'wait_sum_sec', 'handle_sum_sec'] as const;

/**
 * Salva i totali per mezz'ora. Arrivano a pezzi: il primo pezzo (first) cancella
 * il periodo già presente, così ricaricare lo stesso file non raddoppia nulla.
 */
export async function saveIntervals(input: { from: string; to: string; rows: IntervalAgg[]; first: boolean }): Promise<R> {
  const { supabase } = await requireManager();
  if (!ISO.test(input.from) || !ISO.test(input.to) || input.from > input.to) return { ok: false, error: 'Periodo non valido' };
  if (input.rows.length > 5000) return { ok: false, error: 'Troppe righe in un solo invio' };
  const rows = [];
  for (const r of input.rows) {
    if (!ISO.test(r.day) || r.day < input.from || r.day > input.to) return { ok: false, error: `Giorno fuori periodo: ${r.day}` };
    if (!Number.isInteger(r.slot) || r.slot < 0 || r.slot > 47) return { ok: false, error: 'Fascia non valida' };
    const row: Record<string, string | number> = { day: r.day, slot: r.slot, queue: String(r.queue ?? '').slice(0, 80) };
    for (const k of INT_KEYS) {
      const v = Math.round(Number(r[k]) || 0);
      if (v < 0) return { ok: false, error: 'Valori negativi' };
      row[k] = v;
    }
    rows.push(row);
  }
  if (input.first) {
    const { error } = await supabase.from('call_intervals').delete().gte('day', input.from).lte('day', input.to);
    if (error) return { ok: false, error: error.message };
  }
  if (rows.length) {
    const { error } = await supabase.from('call_intervals').upsert(rows, { onConflict: 'day,slot,queue' });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, message: `${rows.length} fasce salvate` };
}

export async function logUpload(input: { file_name: string; from: string; to: string; calls: number; queues: string[] }): Promise<R> {
  const { supabase, me } = await requireManager();
  const { error } = await supabase.from('call_uploads').insert({
    file_name: input.file_name.slice(0, 200),
    from_day: input.from,
    to_day: input.to,
    calls: Math.max(0, Math.round(input.calls)),
    queues: input.queues.slice(0, 50).map((q) => q.slice(0, 80)),
    uploaded_by: me.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/forecast');
  return { ok: true, message: 'Caricamento completato' };
}

export async function deleteRange(from: string, to: string): Promise<R> {
  const { supabase } = await requireManager();
  if (!ISO.test(from) || !ISO.test(to)) return { ok: false, error: 'Periodo non valido' };
  const { error } = await supabase.from('call_intervals').delete().gte('day', from).lte('day', to);
  if (error) return { ok: false, error: error.message };
  await supabase.from('call_uploads').delete().gte('from_day', from).lte('to_day', to);
  revalidatePath('/forecast');
  return { ok: true, message: 'Dati eliminati' };
}

export async function saveForecastSettings(p: ForecastPolicy, activityIds: string[]): Promise<R> {
  const { supabase } = await requireManager();
  const clean: ForecastPolicy = {
    sl_target: Math.min(99, Math.max(50, Math.round(p.sl_target))),
    sl_seconds: ([10, 20, 30, 60, 120] as const).includes(p.sl_seconds) ? p.sl_seconds : 20,
    max_occupancy: Math.min(100, Math.max(50, Math.round(p.max_occupancy))),
    history_weeks: Math.min(26, Math.max(3, Math.round(p.history_weeks))),
  };
  const { error } = await supabase.rpc('save_forecast_settings', { p_policy: clean, p_activities: activityIds });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/forecast');
  return { ok: true, message: 'Impostazioni salvate' };
}
