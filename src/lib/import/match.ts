import { levenshtein, normName } from '@/lib/names';
import { plain } from './parse';
import type { Activity, Person } from '@/lib/types';

export type PersonLite = Pick<Person, 'id' | 'full_name' | 'email' | 'aliases' | 'user_id'>;

export type MatchStatus = 'email' | 'name' | 'alias' | 'fuzzy' | 'none';

export interface PersonMatch {
  status: MatchStatus;
  person: PersonLite | null;
  candidates: PersonLite[];
}

/** "Rossi G." ↔ "Giulia Rossi": parole uguali + iniziali compatibili */
function initialsCompatible(fileName: string, person: string): boolean {
  const a = normName(fileName).split(' ').filter(Boolean);
  const b = normName(person).split(' ').filter(Boolean);
  if (!a.length || !b.length) return false;
  const full = a.filter((t) => t.length > 1);
  const ini = a.filter((t) => t.length === 1);
  if (!full.length) return false;
  const rest = [...b];
  for (const t of full) {
    const i = rest.indexOf(t);
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  return ini.every((c) => {
    const i = rest.findIndex((t) => t.startsWith(c));
    if (i < 0) return false;
    rest.splice(i, 1);
    return true;
  });
}

export function matchPerson(name: string, email: string | null, people: PersonLite[]): PersonMatch {
  if (email) {
    const p = people.find((x) => x.email === email);
    if (p) return { status: 'email', person: p, candidates: [] };
  }
  const n = normName(name);
  const byName = people.filter((x) => normName(x.full_name) === n);
  if (byName.length === 1) return { status: 'name', person: byName[0]!, candidates: [] };
  if (byName.length > 1) return { status: 'fuzzy', person: null, candidates: byName };

  const byAlias = people.filter((x) => x.aliases.some((a) => normName(a) === n));
  if (byAlias.length === 1) return { status: 'alias', person: byAlias[0]!, candidates: [] };

  const fuzzy = people.filter((x) => {
    if (initialsCompatible(name, x.full_name)) return true;
    const m = normName(x.full_name);
    return n.length >= 6 && levenshtein(n, m) <= (n.length > 12 ? 2 : 1);
  });
  if (fuzzy.length === 1) return { status: 'fuzzy', person: fuzzy[0]!, candidates: fuzzy };
  return { status: fuzzy.length ? 'fuzzy' : 'none', person: null, candidates: fuzzy };
}

export function matchActivity(label: string | null, activities: Activity[]): Activity | null {
  if (!label) return null;
  const t = plain(label);
  const live = activities.filter((a) => !a.archived);
  return (
    live.find((a) => plain(a.name) === t) ??
    live.find((a) => a.aliases.some((x) => plain(x) === t)) ??
    // "Telefono IT" → "Telefono" solo se l'etichetta inizia con un nome esistente
    live.find((a) => t.startsWith(plain(a.name) + ' ')) ??
    null
  );
}
