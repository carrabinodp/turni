'use server';
import { revalidatePath } from 'next/cache';
import { requireManager } from '@/lib/session';
import type { Role } from '@/lib/types';

type R = { ok: true; message: string } | { ok: false; error: string };
const done = (message: string): R => {
  revalidatePath('/team');
  revalidatePath('/timeline');
  return { ok: true, message };
};

export async function addPerson(fullName: string, email: string, contract: string, team = '', channels: string[] = []): Promise<R> {
  const { supabase } = await requireManager();
  const name = fullName.trim();
  if (!name) return { ok: false, error: 'Inserisci nome e cognome' };
  const em = email.trim().toLowerCase() || null;
  if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return { ok: false, error: 'Email non valida' };
  const { error } = await supabase.from('people').insert({ full_name: name, email: em, contract: contract.trim() || null, team: team.trim() || null, channels });
  if (error) return { ok: false, error: error.code === '23505' ? 'Questa email è già nel team' : error.message };
  return done(`${name} aggiunto. Al primo accesso con Google verrà collegato automaticamente.`);
}

type Patch = { full_name?: string; contract?: string | null; active?: boolean; role?: Role; team?: string | null; channels?: string[] };

export async function bulkUpdate(ids: string[], patch: Patch | { addChannel: string } | { removeChannel: string }): Promise<R> {
  const { supabase, me } = await requireManager();
  if (!ids.length) return { ok: false, error: 'Nessuna persona selezionata' };
  if ('active' in patch && patch.active === false && ids.includes(me.id)) return { ok: false, error: 'Non puoi disattivare te stesso' };
  if ('addChannel' in patch || 'removeChannel' in patch) {
    const { data } = await supabase.from('people').select('id, channels').in('id', ids);
    for (const p of data ?? []) {
      const cur: string[] = p.channels ?? [];
      const next = 'addChannel' in patch ? Array.from(new Set([...cur, patch.addChannel])) : cur.filter((c) => c !== patch.removeChannel);
      const { error } = await supabase.from('people').update({ channels: next }).eq('id', p.id);
      if (error) return { ok: false, error: error.message };
    }
  } else {
    const { error } = await supabase.from('people').update(patch).in('id', ids);
    if (error) return { ok: false, error: error.message };
  }
  return done(`Aggiornate ${ids.length} persone`);
}

export async function updatePerson(id: string, patch: Patch): Promise<R> {
  const { supabase, me } = await requireManager();
  if (id === me.id && (patch.active === false || (patch.role && patch.role !== me.role))) {
    return { ok: false, error: 'Non puoi disattivare o cambiare il ruolo del tuo stesso profilo' };
  }
  const { error } = await supabase.from('people').update(patch).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return done(patch.active === false ? 'Persona disattivata: non può più accedere' : patch.active ? 'Persona riattivata' : 'Salvato');
}

export async function mergePerson(fromId: string, intoId: string): Promise<R> {
  // unisce un profilo "da registrare" (creato dall'import) in uno esistente
  const { supabase } = await requireManager();
  if (fromId === intoId) return { ok: false, error: 'Scegli una persona diversa' };
  const { data: from } = await supabase.from('people').select('*').eq('id', fromId).single();
  if (!from || from.user_id) return { ok: false, error: 'Si possono unire solo profili non ancora registrati' };
  const { error: e1 } = await supabase.from('events').update({ person_id: intoId }).eq('person_id', fromId);
  if (e1) return { ok: false, error: e1.message };
  const { data: into } = await supabase.from('people').select('aliases').eq('id', intoId).single();
  await supabase.from('people').update({ aliases: Array.from(new Set([...(into?.aliases ?? []), from.full_name, ...from.aliases])) }).eq('id', intoId);
  const { error: e2 } = await supabase.from('people').delete().eq('id', fromId);
  if (e2) return { ok: false, error: e2.message };
  return done(`${from.full_name} unito: i suoi turni sono stati spostati`);
}
