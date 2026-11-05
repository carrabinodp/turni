/**
 * Pause automatiche.
 *  - Pausa breve: dopo `interval_minutes` di lavoro continuativo (di base 2 ore,
 *    come per i videoterminalisti) una pausa di `break_minutes` (15). Il conteggio
 *    riparte dopo ogni pausa e dopo il pranzo.
 *  - Sfalsamento: gli operatori che iniziano alla stessa ora fanno la prima
 *    pausa di ogni tratto con `stagger_minutes` (5) di differenza l'uno dall'altro,
 *    sempre in anticipo (mai oltre le 2 ore), ciclando su `stagger_slots` posizioni.
 *  - Pranzo: nei turni di almeno `lunch_min_shift_hours` (8) ore, `lunch_minutes`
 *    (60) dopo `lunch_after_hours` (4) dall'inizio del turno.
 * Pause e pranzi già presenti vengono rispettati (non si duplicano).
 */
export interface BreakPolicy {
  interval_minutes: number;
  break_minutes: number;
  stagger_minutes: number;
  stagger_slots: number;
  min_tail_minutes: number;
  lunch_min_shift_hours: number;
  lunch_after_hours: number;
  lunch_minutes: number;
}

export const DEFAULT_POLICY: BreakPolicy = {
  interval_minutes: 120,
  break_minutes: 15,
  stagger_minutes: 5,
  stagger_slots: 6,
  min_tail_minutes: 15,
  lunch_min_shift_hours: 8,
  lunch_after_hours: 4,
  lunch_minutes: 60,
};

export function withDefaults(p?: Partial<BreakPolicy> | null): BreakPolicy {
  return { ...DEFAULT_POLICY, ...(p ?? {}) };
}

export interface Block {
  person_id: string;
  s: number;
  e: number;
  kind: 'work' | 'break' | 'absence';
}

export interface PlannedBreak {
  person_id: string;
  s: number;
  e: number;
  type: 'break' | 'lunch';
}

const MIN = 60000;

/** Turni: blocchi lavorativi della stessa persona separati da meno di un'ora */
export function shiftsOf(blocks: Block[]): { person_id: string; s: number; e: number }[] {
  const out: { person_id: string; s: number; e: number }[] = [];
  const byPerson = new Map<string, Block[]>();
  for (const b of blocks) {
    if (b.kind !== 'work') continue;
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

/** intervallo [s,e) meno una lista di intervalli occupati */
function subtract(s: number, e: number, busy: { s: number; e: number }[]) {
  const segs: { s: number; e: number }[] = [];
  let cur = s;
  for (const b of [...busy].sort((a, c) => a.s - c.s)) {
    if (b.e <= cur || b.s >= e) continue;
    if (b.s > cur) segs.push({ s: cur, e: Math.min(b.s, e) });
    cur = Math.max(cur, b.e);
  }
  if (cur < e) segs.push({ s: cur, e });
  return segs;
}

/**
 * Pause da aggiungere.
 * `order` = persone nell'ordine con cui assegnare lo sfalsamento (es. alfabetico);
 * chi non c'è viene messo in fondo.
 */
export function planBreaks(blocks: Block[], policy: BreakPolicy = DEFAULT_POLICY, order: string[] = [], snapMinutes = 5): PlannedBreak[] {
  const p = withDefaults(policy);
  const snap = (ms: number) => Math.round(ms / (snapMinutes * MIN)) * snapMinutes * MIN;
  const rank = new Map(order.map((id, i) => [id, i]));
  const shifts = shiftsOf(blocks).sort(
    (a, b) => a.s - b.s || (rank.get(a.person_id) ?? 1e9) - (rank.get(b.person_id) ?? 1e9) || a.person_id.localeCompare(b.person_id),
  );

  // posizione nello sfalsamento: tra chi inizia alla stessa ora
  const sameStart = new Map<number, number>();
  const out: PlannedBreak[] = [];

  for (const sh of shifts) {
    const mine = blocks.filter((b) => b.person_id === sh.person_id && b.s < sh.e && b.e > sh.s);
    const absent = mine.filter((b) => b.kind === 'absence');
    const absentMin = absent.reduce((t, b) => t + (Math.min(b.e, sh.e) - Math.max(b.s, sh.s)), 0);
    if (absentMin >= (sh.e - sh.s) * 0.9) continue; // ferie o malattia sull'intero turno

    const idx = sameStart.get(sh.s) ?? 0;
    sameStart.set(sh.s, idx + 1);
    const offset = (idx % Math.max(1, p.stagger_slots)) * p.stagger_minutes * MIN;

    const existing = mine.filter((b) => b.kind === 'break');
    const busy: { s: number; e: number }[] = [...existing, ...absent];

    // pranzo
    const hasLunch = existing.some((b) => b.e - b.s >= 45 * MIN);
    if (!hasLunch && sh.e - sh.s >= p.lunch_min_shift_hours * 60 * MIN && p.lunch_minutes > 0) {
      const ls = snap(sh.s + p.lunch_after_hours * 60 * MIN);
      const le = ls + p.lunch_minutes * MIN;
      const clash = busy.some((b) => b.s < le && b.e > ls);
      if (le <= sh.e - p.min_tail_minutes * MIN && !clash) {
        out.push({ person_id: sh.person_id, s: ls, e: le, type: 'lunch' });
        busy.push({ s: ls, e: le });
      }
    }

    // pause brevi, tratto per tratto
    if (p.break_minutes <= 0 || p.interval_minutes <= 0) continue;
    for (const seg of subtract(sh.s, sh.e, busy)) {
      let cursor = seg.s;
      let first = true;
      for (let guard = 0; guard < 12; guard++) {
        const ideal = cursor + p.interval_minutes * MIN;
        let b = snap(first ? ideal - offset : ideal);
        if (b <= cursor) b = ideal;
        const be = b + p.break_minutes * MIN;
        if (be > seg.e - p.min_tail_minutes * MIN) break;
        out.push({ person_id: sh.person_id, s: b, e: be, type: 'break' });
        cursor = be;
        first = false;
      }
    }
  }
  return out;
}

/** Testo breve delle regole, per le etichette dell'interfaccia */
export function policyLabel(p: BreakPolicy) {
  const h = (m: number) => (m % 60 ? `${m} min` : `${m / 60} ${m === 60 ? 'ora' : 'ore'}`);
  return `${p.break_minutes} min ogni ${h(p.interval_minutes)} (sfalsate di ${p.stagger_minutes} min) · pranzo di ${h(p.lunch_minutes)} dopo ${p.lunch_after_hours} ore nei turni da ${p.lunch_min_shift_hours}+ ore`;
}
