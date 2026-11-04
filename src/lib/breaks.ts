/**
 * Pause automatiche: per ogni turno (blocchi lavorativi contigui di una
 * persona) aggiunge le pause previste dalle regole, se in quel punto non
 * c'è già una pausa.
 */
export interface BreakRule {
  min_shift_hours: number;
  from: 'start' | 'end';
  offset_minutes: number;
  duration_minutes: number;
}

export interface Block {
  person_id: string;
  s: number;
  e: number;
  kind: 'work' | 'break' | 'absence';
}

const MIN = 60000;

export const DEFAULT_RULES: BreakRule[] = [
  { min_shift_hours: 6, from: 'start', offset_minutes: 120, duration_minutes: 15 },
  { min_shift_hours: 6, from: 'end', offset_minutes: 120, duration_minutes: 15 },
];

/** Raggruppa i blocchi lavorativi in turni (buchi < 1 ora restano nello stesso turno) */
export function shiftsOf(blocks: Block[]): { person_id: string; s: number; e: number }[] {
  const out: { person_id: string; s: number; e: number }[] = [];
  const byPerson = new Map<string, Block[]>();
  for (const b of blocks) {
    if (b.kind === 'absence') continue;
    if (!byPerson.has(b.person_id)) byPerson.set(b.person_id, []);
    byPerson.get(b.person_id)!.push(b);
  }
  byPerson.forEach((list, pid) => {
    list.sort((a, b) => a.s - b.s);
    let cur: { person_id: string; s: number; e: number } | null = null;
    for (const b of list) {
      if (cur && b.s <= cur.e + 60 * MIN) cur.e = Math.max(cur.e, b.e);
      else {
        if (cur) out.push(cur);
        cur = { person_id: pid, s: b.s, e: b.e };
      }
    }
    if (cur) out.push(cur);
  });
  return out;
}

/** Pause da aggiungere; ignora i turni che hanno un'assenza sovrapposta */
export function autoBreaks(blocks: Block[], rules: BreakRule[], snapMinutes = 5): { person_id: string; s: number; e: number }[] {
  const out: { person_id: string; s: number; e: number }[] = [];
  const snap = (ms: number) => Math.round(ms / (snapMinutes * MIN)) * snapMinutes * MIN;
  for (const sh of shiftsOf(blocks)) {
    const len = (sh.e - sh.s) / 3600000;
    const absent = blocks.some((b) => b.person_id === sh.person_id && b.kind === 'absence' && b.s < sh.e && b.e > sh.s);
    if (absent) continue;
    for (const r of rules) {
      if (len < r.min_shift_hours) continue;
      const s = snap(r.from === 'start' ? sh.s + r.offset_minutes * MIN : sh.e - r.offset_minutes * MIN - r.duration_minutes * MIN);
      const e = s + r.duration_minutes * MIN;
      if (s <= sh.s || e >= sh.e) continue;
      const clash = [...blocks, ...out].some(
        (b) => b.person_id === sh.person_id && ('kind' in b ? b.kind === 'break' : true) && b.s < e + 60 * MIN && b.e > s - 60 * MIN,
      );
      if (!clash) out.push({ person_id: sh.person_id, s, e });
    }
  }
  return out;
}
