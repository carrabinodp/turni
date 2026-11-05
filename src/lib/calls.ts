/**
 * Lettura dell'elenco chiamate (Excel/CSV del centralino) e aggregazione per
 * mezz'ora. Gira nel browser: al server arrivano solo i totali per fascia, mai
 * operatori o numeri di telefono.
 */
import { plain, parseDate, parseTime, type Cell, type Rows } from './import/parse';
import { localDate, localToUtc } from './time';

export interface CallMapping {
  headerRow: number;
  datetime: number | null; // data e ora nella stessa colonna
  date: number | null;
  time: number | null;
  outcome: number | null;
  wait: number | null;
  talk: number | null;
  acw: number | null; // lavoro post-chiamata
  queue: number | null;
  direction: number | null;
}

export interface Call {
  s: number; // ms UTC
  answered: boolean;
  wait: number; // secondi
  handle: number; // secondi
  queue: string;
}

export interface IntervalAgg {
  day: string;
  slot: number;
  queue: string;
  offered: number;
  answered: number;
  abandoned: number;
  short_abandoned: number;
  ans_10: number;
  ans_20: number;
  ans_30: number;
  ans_60: number;
  ans_120: number;
  wait_sum_sec: number;
  handle_sum_sec: number;
}

const SYN = {
  datetime: ['data e ora', 'data/ora', 'data ora', 'datetime', 'date time', 'timestamp', 'start time', 'ora inizio chiamata', 'inizio chiamata', 'data inizio', 'start', 'call start', 'started at', 'received at', 'ricevuta il'],
  date: ['data', 'date', 'giorno', 'day', 'data chiamata', 'call date'],
  time: ['ora', 'orario', 'time', 'ora chiamata', 'ora arrivo', 'call time', 'ora inizio'],
  outcome: ['esito', 'stato', 'status', 'outcome', 'risultato', 'result', 'disposition', 'tipo esito', 'call result', 'risposta'],
  wait: ['attesa', 'tempo attesa', 'tempo di attesa', 'tempo in coda', 'attesa in coda', 'wait', 'wait time', 'queue time', 'hold time in queue', 'time in queue', 'ring time', 'squillo'],
  talk: ['durata', 'conversazione', 'durata conversazione', 'tempo conversazione', 'talk time', 'talk', 'duration', 'handle time', 'durata chiamata', 'tempo di gestione'],
  acw: ['post chiamata', 'post-chiamata', 'acw', 'after call work', 'wrap up', 'wrap-up', 'wrap time', 'tempo post chiamata'],
  queue: ['coda', 'queue', 'servizio', 'skill', 'gruppo', 'linea', 'canale', 'numero chiamato', 'ivr'],
  direction: ['direzione', 'direction', 'tipo chiamata', 'call type', 'verso', 'tipo'],
};

function find(header: string[], keys: string[], used: Set<number>) {
  for (const k of keys) {
    const i = header.findIndex((h, j) => !used.has(j) && h === k);
    if (i >= 0) return i;
  }
  for (const k of keys) {
    if (k.length < 5) continue;
    const i = header.findIndex((h, j) => !used.has(j) && h.includes(k));
    if (i >= 0) return i;
  }
  return null;
}

export function detectCalls(rows: Rows): CallMapping | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const header = (rows[r] ?? []).map(plain);
    const used = new Set<number>();
    const take = (k: keyof typeof SYN) => {
      const c = find(header, SYN[k], used);
      if (c !== null) used.add(c);
      return c;
    };
    const datetime = take('datetime');
    const date = datetime === null ? take('date') : null;
    const time = datetime === null ? take('time') : null;
    const outcome = take('outcome');
    const wait = take('wait');
    const acw = take('acw');
    const talk = take('talk');
    const queue = take('queue');
    const direction = take('direction');
    const hasWhen = datetime !== null || date !== null;
    if (hasWhen && (outcome !== null || talk !== null)) {
      // una colonna "data" che contiene anche l'ora vale come data e ora
      let dt = datetime, d = date, t = time;
      if (dt === null && d !== null && t === null) {
        const sample = rows.slice(r + 1, r + 20).map((x) => x?.[d!]);
        if (sample.some((v) => (typeof v === 'number' && v % 1 > 0) || (typeof v === 'string' && /\d{1,2}[:.]\d{2}/.test(v)))) {
          dt = d;
          d = null;
        }
      }
      return { headerRow: r, datetime: dt, date: d, time: t, outcome, wait, talk, acw, queue, direction };
    }
  }
  return null;
}

/** secondi da 83, "83", "00:01:23", "1:23", "1m 23s", frazione di giorno Excel */
export function parseSeconds(v: Cell): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (v < 0) return null;
    if (v > 0 && v < 1 && v % 1 !== 0) return Math.round(v * 86400); // orario Excel
    return Math.round(v);
  }
  const t = String(v).trim().toLowerCase();
  let m = t.match(/^(\d+):(\d{1,2}):(\d{1,2})(?:[.,]\d+)?$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = t.match(/^(\d+):(\d{1,2})(?:[.,]\d+)?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = t.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s(?:ec)?)?$/);
  if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
}

const ANSWERED = /(rispost|answered|gestit|complet|connect|accettat|servit|handled|ok\b|success)/;
const LOST = /(pers|abbandon|abandon|missed|non rispost|no answer|unanswered|timeout|occupat|busy|voicemail|segreteria|rifiutat|fallit|failed|lost|drop)/;
const OUTBOUND = /(uscent|outbound|outgoing|in uscita|\bout\b|effettuat)/;

export interface ParsedCalls {
  calls: Call[];
  skipped: number;
  outbound: number;
}

export function parseCalls(rows: Rows, map: CallMapping, tz: string, year: number): ParsedCalls {
  const calls: Call[] = [];
  let skipped = 0;
  let outbound = 0;
  for (let r = map.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => c === null || c === undefined || c === '')) continue;
    if (map.direction !== null && OUTBOUND.test(plain(row[map.direction]))) {
      outbound++;
      continue;
    }
    // quando
    let s: number | null = null;
    if (map.datetime !== null) {
      const t = parseTime(row[map.datetime], year);
      if (t?.abs !== undefined) s = t.abs;
      else if (t?.date) s = localToUtc(t.date, `${String(Math.floor(t.min / 60)).padStart(2, '0')}:${String(t.min % 60).padStart(2, '0')}`, tz);
    } else if (map.date !== null) {
      const d = parseDate(row[map.date], year);
      const t = map.time !== null ? parseTime(row[map.time], year) : null;
      if (d && t) s = localToUtc(d, `${String(Math.floor(t.min / 60) % 24).padStart(2, '0')}:${String(t.min % 60).padStart(2, '0')}`, tz);
    }
    if (s === null) {
      skipped++;
      continue;
    }
    const wait = map.wait !== null ? parseSeconds(row[map.wait]) ?? 0 : 0;
    const talk = map.talk !== null ? parseSeconds(row[map.talk]) ?? 0 : 0;
    const acw = map.acw !== null ? parseSeconds(row[map.acw]) ?? 0 : 0;
    let answered: boolean;
    if (map.outcome !== null) {
      const o = plain(row[map.outcome]);
      if (LOST.test(o)) answered = false;
      else if (ANSWERED.test(o)) answered = true;
      else answered = talk > 0;
    } else answered = talk > 0;
    const queue = map.queue !== null ? String(row[map.queue] ?? '').trim() : '';
    calls.push({ s, answered, wait, handle: answered ? talk + acw : 0, queue });
  }
  return { calls, skipped, outbound };
}

export function aggregate(calls: Call[], tz: string, byQueue: boolean): IntervalAgg[] {
  const m = new Map<string, IntervalAgg>();
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (const c of calls) {
    const day = localDate(c.s, tz);
    const hm = f.format(new Date(c.s));
    const [h, mi] = hm.split(':').map(Number);
    const slot = Math.min(47, h! * 2 + (mi! >= 30 ? 1 : 0));
    const queue = byQueue ? c.queue : '';
    const k = `${day}|${slot}|${queue}`;
    let a = m.get(k);
    if (!a) {
      a = { day, slot, queue, offered: 0, answered: 0, abandoned: 0, short_abandoned: 0, ans_10: 0, ans_20: 0, ans_30: 0, ans_60: 0, ans_120: 0, wait_sum_sec: 0, handle_sum_sec: 0 };
      m.set(k, a);
    }
    a.offered++;
    if (c.answered) {
      a.answered++;
      a.wait_sum_sec += c.wait;
      a.handle_sum_sec += c.handle;
      if (c.wait <= 10) a.ans_10++;
      if (c.wait <= 20) a.ans_20++;
      if (c.wait <= 30) a.ans_30++;
      if (c.wait <= 60) a.ans_60++;
      if (c.wait <= 120) a.ans_120++;
    } else {
      a.abandoned++;
      if (c.wait <= 5) a.short_abandoned++;
    }
  }
  return Array.from(m.values()).sort((x, y) => x.day.localeCompare(y.day) || x.slot - y.slot || x.queue.localeCompare(y.queue));
}

export const slotLabel = (slot: number) => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;
