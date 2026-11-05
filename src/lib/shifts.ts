import type { Activity, EventRow, RequestRow } from './types';
import { fmtDay, fmtTime, localDate } from './time';
import { firstName } from './names';

export interface DayShift {
  person_id: string;
  day: string;
  start: number;
  end: number;
  blocks: { activity_id: string; s: number; e: number }[];
  absence: string | null; // nome assenza se presente
}

/** Raggruppa i blocchi per persona e giorno locale (il turno = dal primo all'ultimo blocco) */
export function groupShifts(events: EventRow[], activities: Activity[], tz: string): Map<string, DayShift> {
  const kind = new Map(activities.map((a) => [a.id, a]));
  const out = new Map<string, DayShift>();
  for (const ev of events) {
    const s = Date.parse(ev.starts_at);
    const e = Date.parse(ev.ends_at);
    const day = localDate(s, tz);
    const k = `${ev.person_id}|${day}`;
    const a = kind.get(ev.activity_id);
    let cur = out.get(k);
    if (!cur) {
      cur = { person_id: ev.person_id, day, start: Infinity, end: -Infinity, blocks: [], absence: null };
      out.set(k, cur);
    }
    if (a?.kind === 'absence') {
      cur.absence = a.name;
    } else {
      cur.start = Math.min(cur.start, s);
      cur.end = Math.max(cur.end, e);
    }
    cur.blocks.push({ activity_id: ev.activity_id, s, e });
  }
  return out;
}

export function shiftText(sh: DayShift | undefined, tz: string): string {
  if (!sh) return 'nessun turno';
  if (!Number.isFinite(sh.start)) return sh.absence ?? 'assenza';
  return `${fmtTime(sh.start, tz)}–${fmtTime(sh.end, tz)}`;
}

export function describeRequest(
  r: RequestRow,
  names: Map<string, string>,
  acts: Map<string, Activity>,
  shifts: Map<string, DayShift>,
  tz: string,
): string {
  const n = (id: string | null) => (id ? firstName(names.get(id) ?? '?') : '?');
  if (r.kind === 'swap') {
    const a = shifts.get(`${r.requester_id}|${r.day_a}`) ?? shifts.get(`${r.target_id}|${r.day_a}`);
    const b = shifts.get(`${r.target_id}|${r.day_b}`) ?? shifts.get(`${r.requester_id}|${r.day_b}`);
    if (r.day_a !== r.day_b) {
      return `Scambio di riposo: ${n(r.requester_id)} dà ${fmtDay(r.day_a!, 'EEE d MMM')} (${shiftText(a, tz)}) a ${n(r.target_id)} e lavora ${fmtDay(r.day_b!, 'EEE d MMM')} (${shiftText(b, tz)}) al suo posto`;
    }
    return `${n(r.requester_id)} dà ${fmtDay(r.day_a!, 'EEE d MMM')} (${shiftText(a, tz)}) a ${n(r.target_id)} e prende il suo (${shiftText(b, tz)})`;
  }
  if (r.kind === 'give') {
    const a = shifts.get(`${r.requester_id}|${r.day_a}`) ?? shifts.get(`${r.target_id}|${r.day_a}`);
    return r.target_id
      ? `${n(r.requester_id)} cede ${fmtDay(r.day_a!, 'EEE d MMM')} (${shiftText(a, tz)}) a ${n(r.target_id)}`
      : `${n(r.requester_id)} cede ${fmtDay(r.day_a!, 'EEE d MMM')} (${shiftText(a, tz)})`;
  }
  if (r.kind === 'change') {
    const sh = shifts.get(`${r.requester_id}|${r.day_a}`);
    return `${n(r.requester_id)}, ${fmtDay(r.day_a!, 'EEE d MMM')}${sh ? ` (turno ${shiftText(sh, tz)})` : ''}: ${r.note ?? ''}`;
  }
  const act = r.activity_id ? acts.get(r.activity_id)?.name ?? 'Assenza' : 'Assenza';
  const days = r.from_date === r.to_date ? fmtDay(r.from_date!, 'EEE d MMM') : `dal ${fmtDay(r.from_date!, 'd MMM')} al ${fmtDay(r.to_date!, 'd MMM')}`;
  const hours = r.time_from ? `, ${r.time_from.slice(0, 5)}–${r.time_to?.slice(0, 5)}` : '';
  return `${n(r.requester_id)}: ${act} ${days}${hours}`;
}
