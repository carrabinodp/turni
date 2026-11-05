/**
 * Lettura delle preferenze scritte a mano dagli operatori (modulo Google, chat, mail).
 * Una frase può contenere più vincoli: "non lavorare sabato 26/12 e domenica 27/12" → 2 riposi.
 * Quello che non si capisce resta come nota: il responsabile lo vede e lo sistema.
 */
export type PrefKind =
  | 'off' | 'start_after' | 'end_by' | 'no_close' | 'no_open' | 'shift' | 'no_weekend' | 'note'
  | 'morning' | 'want_close' | 'week_shift' | 'sat_pick' | 'weekend_ok' | 'start_window' | 'lunch_at' | 'place';

export const PREF_KINDS: PrefKind[] = ['off', 'start_after', 'end_by', 'no_close', 'no_open', 'shift', 'no_weekend', 'note', 'morning', 'want_close', 'week_shift', 'sat_pick', 'weekend_ok', 'start_window', 'lunch_at', 'place'];

export interface ParsedPref {
  kind: PrefKind;
  day: string | null;
  weekday: number | null;
  time_a: string | null;
  time_b: string | null;
  place: 'office' | 'remote' | null;
  /** alternativa: vale solo se non si può dare la preferenza di quel giorno */
  alt_day?: string | null;
  /** data che non è nel mese richiesto */
  outside?: boolean;
}

const WD: [RegExp, number][] = [[/\bluned/, 1], [/\bmarted/, 2], [/\bmercoled/, 3], [/\bgioved/, 4], [/\bvenerd/, 5], [/\bsabat/, 6], [/\bdomenic/, 7]];
const MONTHS = ['genn', 'febb', 'marz', 'apri', 'magg', 'giug', 'lugl', 'agos', 'sett', 'otto', 'nove', 'dice'];
const pad = (n: number) => String(n).padStart(2, '0');
const hm = (h: number, m = 0) => `${pad(h)}:${pad(m)}`;
const toM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export function parsePrefs(text: string, month: string): ParsedPref[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  let t = ` ${text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')} `;
  const place: ParsedPref['place'] = /\b(smart|da casa|remoto|da remoto)\b/.test(t) ? 'remote' : /\b(in presenza|in ufficio|in sede)\b/.test(t) ? 'office' : null;

  // 1. fasce orarie: "9-15", "09.00-15.00", "8:30 alle 17:30", "9-9.30" (finestra), "pausa 13-14"
  const ranges: { a: string; b: string; lunch: boolean }[] = [];
  t = t.replace(/(\d[:.]\d{2})\/(\d)/g, '$1 / $2'); // "9-9.30/18-18.30"
  t = t.replace(/(\d{1,2}(?:\s*-\s*\d{1,2}){2,})/g, (s) => s.replace(/-/g, ' , ')); // "5-12-13-19" è un elenco di giorni
  t = t.replace(/(pausa|pranzo)?\s*(?:dalle\s+)?\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|alle|a)\s*(\d{1,2})(?:[:.](\d{2}))?\b(?![/.]\d)/g, (s, lunch, h1, m1, h2, m2) => {
    const a = Number(h1) * 60 + Number(m1 ?? 0), b = Number(h2) * 60 + Number(m2 ?? 0);
    const timeLike = !!(m1 || m2) || /turno|ore|orario|pausa|pranzo|dalle/.test(s) || /\bturno\b|\bore\b/.test(t);
    if (Number(h1) < 6 || Number(h2) > 22 || b <= a || !timeLike) return s;
    ranges.push({ a: hm(Math.floor(a / 60), a % 60), b: hm(Math.floor(b / 60), b % 60), lunch: !!lunch });
    return ' § ';
  });

  // 2. orari singoli: "entro le 18", "alle 10", "dopo le 9.30", "ore 8"
  const singles: { kind: 'by' | 'after' | 'at'; t: string }[] = [];
  t = t.replace(/\b(entro le|entro|fino alle|prima delle|uscire alle|esco alle|dopo le|non prima delle|dalle|alle|ore)\s+(\d{1,2})(?:[:.](\d{2}))?\b(?![/]\d)/g, (s, w, h, mi) => {
    if (Number(h) < 6 || Number(h) > 22) return s;
    const kind = /entro|fino|prima|uscire|esco/.test(w) ? 'by' : /dopo|non prima|dalle/.test(w) ? 'after' : 'at';
    singles.push({ kind, t: hm(Number(h), Number(mi ?? 0)) });
    return ' § ';
  });

  // 3. date: "18/12", "1/1/2027", "26/12/2026", "16 dicembre", "mercoledi 16", "il 15", "no 8", elenchi "5 , 12 , 13"
  const days: { day: string; outside: boolean; pos: number }[] = [];
  const add = (d: number, mo: number, yy: number, pos: number) => {
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return;
    days.push({ day: `${yy}-${pad(mo)}-${pad(d)}`, outside: mo !== m || yy !== y, pos });
  };
  t = t.replace(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/g, (s, d, mo, yy, pos: number) => {
    let year = yy ? Number(yy) : y;
    if (year < 100) year += 2000;
    if (!yy && Number(mo) < m - 6) year = y + 1; // a dicembre "3/1" è gennaio prossimo
    add(Number(d), Number(mo), year, pos);
    return ' # ';
  });
  t = t.replace(/\b(\d{1,2})\s+(genn|febb|marz|apri|magg|giug|lugl|agos|sett|otto|nove|dice)[a-z]*\b/g, (s, d, mo, pos: number) => {
    add(Number(d), MONTHS.indexOf(mo) + 1, y, pos);
    return ' # ';
  });
  t = t.replace(/\b(\d{1,2})\b(?!\s*(?:ore|h\b|giorn|settiman|mesi))/g, (s, d, pos: number) => {
    add(Number(d), m, y, pos);
    return ' # ';
  });
  let weekday: number | null = null;
  for (const [re, n] of WD) if (re.test(t)) weekday = n;
  const daysList = Array.from(new Map(days.map((d) => [d.day, d])).values());

  const base = { day: null, weekday: null, time_a: null, time_b: null, place: null } as ParsedPref;
  const out: ParsedPref[] = [];
  const forDays = (p: Partial<ParsedPref>, list = daysList) =>
    list.forEach((d) => out.push({ ...base, ...p, day: d.day, outside: d.outside || undefined }));

  const neg = /\b(no|non|niente|senza|evitare|evitate)\b/;
  const workRanges = ranges.filter((r) => !r.lunch && toM(r.b) - toM(r.a) > 60);
  const windows = ranges.filter((r) => !r.lunch && toM(r.b) - toM(r.a) <= 60).sort((x, y) => toM(x.a) - toM(y.a));
  const lunch = ranges.find((r) => r.lunch);

  // alternative: "riposo il 5 se non avrò riposo il 15"
  let altDay: string | null = null;
  const se = t.indexOf(' se non ');
  if (se >= 0 && daysList.length >= 2) {
    const after = daysList.filter((d) => d.pos > se);
    const before = daysList.filter((d) => d.pos < se);
    if (after.length && before.length) {
      altDay = after[0]!.day;
      daysList.splice(daysList.indexOf(after[0]!), 1);
    }
  }

  if (/\b(we|weekend|fine settimana|week end)\b.*\bliber/.test(t) || /\bliber.*\b(we|weekend|fine settimana)\b/.test(t)) {
    // weekend liberi, salvo i giorni in cui si dice disponibile
    out.push({ ...base, kind: 'no_weekend' });
    const byDay = singles.find((s) => s.kind === 'by');
    forDays({ kind: 'weekend_ok' });
    // "il 19 entro le 18": l'orario vale per l'ultimo giorno citato prima dell'orario
    if (byDay && daysList.length) out.push({ ...base, kind: 'end_by', day: daysList[daysList.length - 1]!.day, time_a: byDay.t });
    return out;
  }
  if (/se devo fare il sabato|se (faccio|devo fare) (un |il )?sabato|sabato intero/.test(t) && daysList.length) {
    forDays({ kind: 'sat_pick' });
    return out;
  }
  if (windows.length || (lunch && !workRanges.length)) {
    // "9-9.30/18-18.30 con pausa 13-14": entra tra le 9 e le 9:30, pranzo fisso
    if (windows[0]) out.push({ ...base, kind: 'start_window', weekday: daysList.length ? null : weekday, time_a: windows[0].a, time_b: windows[0].b });
    if (lunch) out.push({ ...base, kind: 'lunch_at', time_a: lunch.a, time_b: lunch.b });
    if (out.length) return out;
  }
  if (/(chiusur|chiudere|turno serale|sera\b)/.test(t)) {
    if (neg.test(t) || /pilates|corso|impegn/.test(t)) {
      if (daysList.length) forDays({ kind: 'no_close' });
      else out.push({ ...base, kind: 'no_close', weekday });
    } else if (daysList.length) forDays({ kind: 'want_close' });
    else out.push({ ...base, kind: 'want_close', weekday });
    return out;
  }
  if (/(apertur|aprire)/.test(t) && neg.test(t)) {
    if (daysList.length) forDays({ kind: 'no_open' });
    else out.push({ ...base, kind: 'no_open', weekday });
    return out;
  }
  if (workRanges.length) {
    if (daysList.length) {
      // un orario per ogni giorno, nell'ordine; se sono di meno vale l'ultimo
      daysList.forEach((d, i) => {
        const r = workRanges[Math.min(i, workRanges.length - 1)]!;
        out.push({ ...base, kind: 'shift', day: d.day, time_a: r.a, time_b: r.b, place, outside: d.outside || undefined });
      });
    } else if (weekday) {
      out.push({ ...base, kind: 'shift', weekday, time_a: workRanges[0]!.a, time_b: workRanges[0]!.b, place });
    } else {
      // solo orari: i turni che farebbe nel mese, una settimana per tipo
      workRanges.forEach((r) => out.push({ ...base, kind: 'week_shift', time_a: r.a, time_b: r.b }));
    }
    return out;
  }
  if (/mattin/.test(t)) {
    if (daysList.length) forDays({ kind: 'morning', place });
    else out.push({ ...base, kind: 'morning', weekday, place });
    return out;
  }
  if (!daysList.length && /\b(no|niente|senza)\s+(il\s+|i\s+)?(weekend|we|sabat|domenic)/.test(t)) {
    out.push({ ...base, kind: 'no_weekend' });
    return out;
  }
  if (/(riposo|libero|libera|non lavorare|non posso|non lavoro|giorno off|\boff\b|ferie|permesso|\bno\b)/.test(t) && (daysList.length || weekday)) {
    if (daysList.length) forDays({ kind: 'off', alt_day: altDay });
    else out.push({ ...base, kind: 'off', weekday });
    return out;
  }
  const by = singles.find((s) => s.kind === 'by');
  const after = singles.find((s) => s.kind === 'after') ?? (/(entrare|entrata|iniziare|inizio)/.test(t) ? singles.find((s) => s.kind === 'at') : undefined);
  if (by || (singles.length && /(uscire|esco|uscita|finire|staccare)/.test(t))) {
    const tt = by?.t ?? singles[singles.length - 1]!.t;
    if (daysList.length) forDays({ kind: 'end_by', time_a: tt });
    else out.push({ ...base, kind: 'end_by', weekday, time_a: tt });
    return out;
  }
  if (after) {
    if (daysList.length) forDays({ kind: 'start_after', time_a: after.t });
    else out.push({ ...base, kind: 'start_after', weekday, time_a: after.t });
    return out;
  }
  if (place && (daysList.length || weekday)) {
    if (daysList.length) forDays({ kind: 'place', place });
    else out.push({ ...base, kind: 'place', weekday, place });
    return out;
  }
  // solo date senza altro: di solito sono giorni di riposo chiesti
  if (daysList.length && t.replace(/[#§,\s]|\b(e|il|i|giorni?|del|please|grazie)\b/g, '').length < 4) {
    forDays({ kind: 'off' });
    return out;
  }
  return [{ ...base, kind: 'note' }];
}
