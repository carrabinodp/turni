/**
 * Interpretazione di fogli Excel/CSV con turni.
 * Funzioni pure (niente React, niente Supabase) così sono testabili.
 *
 * Due formati riconosciuti:
 *  - GRIGLIA: una riga per persona, una colonna per giorno; nelle celle
 *    "08:00-16:00", "8-12 / 13-17", "Tel 8-12, Chat 13-17", "Ferie", "R"…
 *  - ELENCO: una riga per blocco, con colonne tipo Nome, Data, Inizio, Fine,
 *    Attività (anche l'export di Assembled: Agent name, Event type, Start time…).
 */
import { addDays, localToUtc } from '@/lib/time';
import { normName } from '@/lib/names';

export type Cell = string | number | boolean | null | undefined;
export type Rows = Cell[][];

export interface ParsedItem {
  key: string;            // chiave persona nel file (email o nome normalizzato)
  name: string;           // nome come scritto nel file
  email: string | null;
  s: number;              // ms UTC
  e: number;
  activity: string | null; // etichetta come scritta nel file (null = attività predefinita)
  allDay: boolean;        // assenza di giornata intera senza orari
  note: string | null;
  fill: string | null;    // colore di sfondo della cella (es. 'FF0000'), se presente
  row: number;            // riga Excel (1-based)
  col: number | null;     // colonna (0-based) per la griglia
}

export interface ParseIssue {
  row: number;
  col: number | null;
  text: string;
  message: string;
}

export interface ParseResult {
  items: ParsedItem[];
  issues: ParseIssue[];
  restCells: number;
}

export interface GridMapping {
  format: 'grid';
  headerRow: number;              // indice 0-based
  nameCols: number[];             // 1 o 2 colonne (es. Cognome + Nome)
  emailCol: number | null;
  dateCols: { col: number; date: string }[];
}

export interface ListMapping {
  format: 'list';
  headerRow: number;
  name: number[];                 // colonne che compongono il nome
  email: number | null;
  date: number | null;
  start: number | null;
  end: number | null;
  shift: number | null;           // colonna con "08:00-16:00" in un'unica cella
  activity: number | null;
  note: number | null;
}

/** Griglia trasposta: giorni sulle righe, persone sulle colonne */
export interface GridColsMapping {
  format: 'gridCols';
  headerRow: number;
  dateCol: number;
  personCols: { col: number; name: string }[];
}

export type Mapping = GridMapping | ListMapping | GridColsMapping;

/** Colori di sfondo delle celle, stessa forma di Rows ('RRGGBB' o null) */
export type Fills = (string | null)[][];

export interface ParseOptions {
  tz: string;
  /** anno da usare quando le date non lo indicano */
  year: number;
  /** lunedì da usare se le colonne hanno solo i giorni della settimana */
  weekStart?: string;
}

/* ------------------------------------------------------------------ */
/* Utilità                                                             */
/* ------------------------------------------------------------------ */
export function plain(s: Cell): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function validYmd(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function serialToDate(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

const MONTHS: Record<string, number> = {
  gen: 1, gennaio: 1, jan: 1, january: 1,
  feb: 2, febbraio: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  apr: 4, aprile: 4, april: 4,
  mag: 5, maggio: 5, may: 5,
  giu: 6, giugno: 6, jun: 6, june: 6,
  lug: 7, luglio: 7, jul: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  set: 9, sett: 9, settembre: 9, sep: 9, sept: 9, september: 9,
  ott: 10, ottobre: 10, oct: 10, october: 10,
  nov: 11, novembre: 11, november: 11,
  dic: 12, dicembre: 12, dec: 12, december: 12,
};

const WEEKDAYS: [RegExp, number][] = [
  [/^(lun|lunedi|lu|mon|monday)\b/, 0],
  [/^(mar|martedi|ma|tue|tues|tuesday)\b/, 1],
  [/^(mer|mercoledi|me|wed|wednesday)\b/, 2],
  [/^(gio|giovedi|gi|thu|thur|thurs|thursday)\b/, 3],
  [/^(ven|venerdi|ve|fri|friday)\b/, 4],
  [/^(sab|sabato|sa|sat|saturday)\b/, 5],
  [/^(dom|domenica|do|sun|sunday)\b/, 6],
];

export function weekdayIndex(v: Cell): number | null {
  const t = plain(v).replace(/[.,]/g, '');
  if (!t || /\d/.test(t)) return null;
  for (const [re, i] of WEEKDAYS) if (re.test(t)) return i;
  return null;
}

/** Riconosce una data in una cella di intestazione o di colonna "Data". */
export function parseDate(v: Cell, year: number): string | null {
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return serialToDate(v);
    return null;
  }
  const t = plain(v);
  if (!t) return null;
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYmd(y, mo, d) ? iso(y, mo, d) : null;
  }
  m = t.match(/(?:^|[^\d])(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?(?!\d)/);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : year;
    if (y < 100) y += 2000;
    return validYmd(y, mo, d) ? iso(y, mo, d) : null;
  }
  m = t.match(/(\d{1,2})\s*([a-z]{3,10})\.?(?:\s+(\d{4}))?/);
  if (m && MONTHS[m[2]!]) {
    const d = Number(m[1]), mo = MONTHS[m[2]!]!;
    const y = m[3] ? Number(m[3]) : year;
    return validYmd(y, mo, d) ? iso(y, mo, d) : null;
  }
  return null;
}

/** Orario in minuti dalla mezzanotte; eventuale data inclusa. */
export function parseTime(v: Cell, year: number): { date: string | null; min: number; abs?: number } | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (v < 0) return null;
    const whole = Math.floor(v);
    const min = Math.round((v - whole) * 1440);
    if (whole === 0) return { date: null, min };
    if (whole > 20000 && whole < 80000) return { date: serialToDate(whole), min: min % 1440 };
    if (v <= 24 && Number.isInteger(v)) return { date: null, min: v * 60 }; // "8" come numero
    return null;
  }
  const raw = String(v).trim();
  // ISO con fuso: istante assoluto
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) && /(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const abs = Date.parse(raw);
    if (!Number.isNaN(abs)) return { date: null, min: 0, abs };
  }
  const t = plain(raw);
  const ampm = /\b(am|pm)\b/.exec(t)?.[1] ?? null;
  let date: string | null = null;
  let rest = t;
  const isoD = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoD) {
    date = iso(Number(isoD[1]), Number(isoD[2]), Number(isoD[3]));
    rest = t.slice((isoD.index ?? 0) + isoD[0].length);
  } else {
    const dm = t.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
    if (dm) {
      let a = Number(dm[1]), b = Number(dm[2]);
      let y = Number(dm[3]);
      if (y < 100) y += 2000;
      if (ampm) [a, b] = [b, a]; // formato USA m/d/y
      if (validYmd(y, b, a)) date = iso(y, b, a);
      rest = t.slice((dm.index ?? 0) + dm[0].length);
    }
  }
  const tm = rest.match(/(\d{1,2})(?:[:.h](\d{2}))?(?::\d{2})?/);
  if (!tm) return date ? { date, min: 0 } : null;
  let h = Number(tm[1]);
  const mi = tm[2] ? Number(tm[2]) : 0;
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 24 || mi > 59) return null;
  return { date, min: h * 60 + mi };
}

/* ------------------------------------------------------------------ */
/* Celle di turno: "08:00-16:00", "Tel 8-12 / Chat 13-17", "Ferie"…   */
/* ------------------------------------------------------------------ */
const REST = new Set(['', 'r', 'rip', 'riposo', 'riposo settimanale', 'rs', 'off', 'libero', 'l', '-', '--', '—', '–', 'x', '/', 'n/a', 'na', 'smonto', 'day off', 'rest']);

const RANGE_RE =
  /(\d{1,2})(?:[:.,h](\d{2}))?\s*(?:-+|–|—|\/|>|alle|a|to)\s*(\d{1,2})(?:[:.,h](\d{2}))?(?!\d)/g;

export interface CellSegment {
  start: number; // minuti
  end: number;   // minuti (può superare 1440 se attraversa la mezzanotte)
  label: string | null;
}

export type CellParse =
  | { kind: 'rest' }
  | { kind: 'allDay'; label: string }
  | { kind: 'segments'; segments: CellSegment[] }
  | { kind: 'error'; message: string };

function cleanLabel(s: string): string | null {
  const t = s.replace(/\b(dalle|dal|ore|from|h)\b/gi, ' ').replace(/[;|+\n\r\t,()[\]{}:]+/g, ' ').replace(/^\s*(e|and|\/|-)\s+/i, '').replace(/\s+(e|and|\/|-)\s*$/i, '').replace(/^[\s/–—-]+|[\s/–—-]+$/g, '').trim();
  return t ? t : null;
}

export function parseShiftCell(v: Cell): CellParse {
  if (v === null || v === undefined) return { kind: 'rest' };
  if (typeof v === 'number') return { kind: 'error', message: 'Numero senza orario: scrivi ad esempio 08:00-16:00' };
  const text = String(v)
    .replace(/\u00a0/g, ' ')
    .trim()
    // refuso frequente: "09:30:18:30" al posto di "09:30-18:30"
    .replace(/(^|\s)(\d{1,2}[:.]\d{2})[:.](\d{1,2}[:.]\d{2})(?=\s|$)/g, '$1$2-$3');
  if (REST.has(plain(text))) return { kind: 'rest' };

  const matches: { m: RegExpExecArray; s: number; e: number }[] = [];
  RANGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RANGE_RE.exec(text))) {
    const h1 = Number(m[1]), m1 = m[2] ? Number(m[2]) : 0;
    const h2 = Number(m[3]), m2 = m[4] ? Number(m[4]) : 0;
    if (h1 > 24 || h2 > 24 || m1 > 59 || m2 > 59) continue;
    // "1/2" o "3-4" senza minuti e senza contesto orario plausibile: probabile data
    const s = h1 * 60 + m1;
    let e = h2 * 60 + m2;
    if (e <= s) e += 1440;
    matches.push({ m, s, e });
  }

  if (!matches.length) {
    if (/\d/.test(text)) return { kind: 'error', message: 'Orario non riconosciuto: scrivi ad esempio 08:00-16:00' };
    const label = cleanLabel(text);
    return label ? { kind: 'allDay', label } : { kind: 'rest' };
  }

  const befores = matches.map((x, i) =>
    cleanLabel(text.slice(i === 0 ? 0 : matches[i - 1]!.m.index + matches[i - 1]!.m[0].length, x.m.index)),
  );
  const last = matches[matches.length - 1]!;
  const trailing = cleanLabel(text.slice(last.m.index + last.m[0].length));

  let labels: (string | null)[];
  if (befores[0] === null && trailing && befores.slice(1).some(Boolean)) {
    // stile "8-12 Tel / 13-17 Chat": l'etichetta segue l'orario
    labels = matches.map((x, i) =>
      cleanLabel(text.slice(x.m.index + x.m[0].length, i + 1 < matches.length ? matches[i + 1]!.m.index : undefined)),
    );
  } else if (befores.every((b) => b === null)) {
    labels = matches.map(() => trailing);
  } else {
    labels = befores.map((b) => b ?? trailing);
  }

  return {
    kind: 'segments',
    segments: matches.map((x, i) => ({ start: x.s, end: x.e, label: labels[i] ?? null })),
  };
}

/* ------------------------------------------------------------------ */
/* Riconoscimento automatico del formato                               */
/* ------------------------------------------------------------------ */
const SYN = {
  name: ['nome e cognome', 'nome cognome', 'cognome e nome', 'cognome nome', 'nominativo', 'dipendente', 'operatore', 'operatrice', 'agente', 'agent', 'agent name', 'persona', 'risorsa', 'collaboratore', 'employee', 'name', 'full name', 'staff'],
  first: ['nome', 'first name', 'firstname', 'given name'],
  last: ['cognome', 'last name', 'lastname', 'surname', 'family name'],
  email: ['email', 'e-mail', 'mail', 'agent email', 'email address', 'indirizzo email'],
  date: ['data', 'date', 'giorno', 'day', 'data turno'],
  start: ['inizio', 'start', 'start time', 'starts at', 'dalle', 'ora inizio', 'orario inizio', 'entrata', 'ingresso', 'da', 'from', 'start date'],
  end: ['fine', 'end', 'end time', 'ends at', 'alle', 'ora fine', 'orario fine', 'uscita', 'a', 'to', 'end date'],
  shift: ['turno', 'orario', 'shift', 'orari', 'fascia', 'fascia oraria'],
  activity: ['attivita', 'activity', 'event type', 'tipo', 'tipo evento', 'evento', 'event', 'mansione', 'canale', 'channel', 'type', 'skill', 'queue', 'coda'],
  note: ['note', 'nota', 'notes', 'commento', 'comment', 'commenti'],
};

function findCol(header: string[], keys: string[], used: Set<number>): number | null {
  for (const k of keys) {
    const i = header.findIndex((h, idx) => !used.has(idx) && h === k);
    if (i >= 0) return i;
  }
  return null;
}

export function detectList(rows: Rows): ListMapping | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const header = (rows[r] ?? []).map(plain);
    const used = new Set<number>();
    const take = (keys: string[]) => {
      const c = findCol(header, keys, used);
      if (c !== null) used.add(c);
      return c;
    };
    const email = take(SYN.email);
    const nameCol = take(SYN.name);
    const last = nameCol === null ? take(SYN.last) : null;
    const first = nameCol === null ? take(SYN.first) : null;
    const date = take(SYN.date);
    const start = take(SYN.start);
    const end = take(SYN.end);
    const shift = take(SYN.shift);
    const activity = take(SYN.activity);
    const note = take(SYN.note);
    const name = nameCol !== null ? [nameCol] : [last, first].filter((x): x is number => x !== null);
    const hasPerson = name.length > 0 || email !== null;
    const hasTime = (start !== null && end !== null) || shift !== null;
    if (hasPerson && hasTime) {
      return { format: 'list', headerRow: r, name, email, date, start, end, shift, activity, note };
    }
  }
  return null;
}

export function detectGrid(rows: Rows, opts: ParseOptions): GridMapping | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r] ?? [];
    const dateCols: { col: number; date: string }[] = [];
    const weekdayCols: { col: number; idx: number }[] = [];
    row.forEach((c, i) => {
      const d = parseDate(c, opts.year);
      if (d) dateCols.push({ col: i, date: d });
      else {
        const w = weekdayIndex(c);
        if (w !== null) weekdayCols.push({ col: i, idx: w });
      }
    });
    let cols = dateCols;
    if (dateCols.length < 2 && weekdayCols.length >= 3 && opts.weekStart) {
      // solo nomi dei giorni: uso la settimana scelta
      let offset = 0;
      let prev = -1;
      cols = weekdayCols.map(({ col, idx }) => {
        if (idx <= prev) offset += 7;
        prev = idx;
        return { col, date: addDays(opts.weekStart!, idx + offset) };
      });
    }
    if (cols.length < 2) continue;

    const firstDateCol = Math.min(...cols.map((c) => c.col));
    // colonne di testo a sinistra delle date = nome (max 2) ed eventuale email
    const left = Array.from({ length: firstDateCol }, (_, i) => i);
    const body = rows.slice(r + 1, r + 40);
    const textScore = (c: number) =>
      body.filter((b) => typeof b?.[c] === 'string' && /[a-zA-Z]/.test(String(b[c])) && !String(b[c]).includes('@')).length;
    const emailCol = left.find((c) => body.some((b) => String(b?.[c] ?? '').includes('@'))) ?? null;
    const headerTxt = row.map(plain);
    const lastC = left.find((c) => SYN.last.includes(headerTxt[c]!));
    const firstC = left.find((c) => SYN.first.includes(headerTxt[c]!));
    let nameCols: number[];
    if (lastC !== undefined && firstC !== undefined) nameCols = [lastC, firstC];
    else {
      const candidates = left.filter((c) => c !== emailCol && textScore(c) > 0).sort((a, b) => textScore(b) - textScore(a));
      nameCols = candidates.slice(0, 1);
    }
    if (!nameCols.length && emailCol === null) continue;
    return { format: 'grid', headerRow: r, nameCols, emailCol, dateCols: cols };
  }
  return null;
}

/**
 * Griglia trasposta: una colonna con le date (una riga per giorno) e una colonna
 * per persona, con il nome nell'intestazione. Righe di totali e colonne di
 * statistiche (es. "Apertura", "Dopo 18:00") vengono ignorate da sole.
 */
export function detectGridCols(rows: Rows, opts: ParseOptions): GridColsMapping | null {
  const scan = rows.slice(0, 400);
  const width = scan.reduce((w, r) => Math.max(w, r?.length ?? 0), 0);
  let dateCol = -1;
  let best = 0;
  for (let c = 0; c < Math.min(width, 6); c++) {
    const n = scan.filter((r) => parseDate(r?.[c], opts.year)).length;
    if (n > best) {
      best = n;
      dateCol = c;
    }
  }
  if (dateCol < 0 || best < 3) return null;
  const dateRows = scan.map((r, i) => (parseDate(r?.[dateCol], opts.year) ? i : -1)).filter((i) => i >= 0);
  // intestazione: la riga sopra la prima data con più testi
  let headerRow = -1;
  for (let r = dateRows[0]! - 1; r >= 0; r--) {
    const texts = (rows[r] ?? []).filter((v) => typeof v === 'string' && v.trim()).length;
    if (texts >= 2) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) return null;
  const header = rows[headerRow] ?? [];
  const personCols: { col: number; name: string }[] = [];
  for (let c = 0; c < width; c++) {
    if (c === dateCol) continue;
    const name = String(header[c] ?? '').trim();
    if (!name || /\d/.test(name)) continue;
    const cells = dateRows.map((r) => rows[r]?.[c]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (!cells.length) continue;
    if (cells.filter((v) => weekdayIndex(v) !== null).length > cells.length / 2) continue; // colonna "Giorno"
    const kinds = cells.map((v) => parseShiftCell(v).kind);
    const segments = kinds.filter((k) => k === 'segments').length;
    const ok = kinds.filter((k) => k !== 'error').length;
    if (segments >= Math.max(1, cells.length * 0.15) && ok >= cells.length * 0.7) personCols.push({ col: c, name });
  }
  if (personCols.length < 1) return null;
  // colonne in mezzo al blocco persone senza orari (es. "MATERNITÀ" tutto il mese)
  const first = personCols[0]!.col;
  const last = personCols[personCols.length - 1]!.col;
  for (let c = first + 1; c < last; c++) {
    if (personCols.some((p) => p.col === c)) continue;
    const name = String(header[c] ?? '').trim();
    if (!name || /\d/.test(name)) continue;
    const cells = dateRows.map((r) => rows[r]?.[c]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (cells.some((v) => typeof v === 'number')) continue;
    if (cells.filter((v) => weekdayIndex(v) !== null).length > cells.length / 2) continue;
    personCols.push({ col: c, name });
  }
  personCols.sort((a, b) => a.col - b.col);
  return { format: 'gridCols', headerRow, dateCol, personCols };
}

export function parseGridCols(rows: Rows, map: GridColsMapping, opts: ParseOptions, fills?: Fills): ParseResult {
  const items: ParsedItem[] = [];
  const issues: ParseIssue[] = [];
  let restCells = 0;
  for (let r = map.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const date = parseDate(row[map.dateCol], opts.year);
    if (!date) continue; // righe vuote, totali, "settimana 1", "1° ore"…
    for (const { col, name } of map.personCols) {
      const v = row[col];
      const p = { name, email: null, key: `n:${normName(name)}` };
      const fill = fillAt(fills, r, col);
      const res = parseShiftCell(v);
      if (res.kind === 'rest') {
        restCells++;
        continue;
      }
      if (res.kind === 'error') {
        issues.push({ row: r + 1, col, text: String(v ?? ''), message: res.message });
        continue;
      }
      if (res.kind === 'allDay') {
        items.push({ ...p, s: localToUtc(date, '00:00', opts.tz), e: localToUtc(addDays(date, 1), '00:00', opts.tz), activity: res.label, allDay: true, note: null, fill, row: r + 1, col });
        continue;
      }
      for (const seg of res.segments) {
        const [s, e] = toRange(date, seg.start, seg.end, opts.tz);
        items.push({ ...p, s, e, activity: seg.label, allDay: false, note: null, fill, row: r + 1, col });
      }
    }
  }
  return { items, issues, restCells };
}

export function detect(rows: Rows, opts: ParseOptions): Mapping | null {
  return detectList(rows) ?? detectGrid(rows, opts) ?? detectGridCols(rows, opts);
}

/**
 * Legenda dei colori: celle colorate vuote con accanto un'etichetta
 * (es. ■ Ferie, ■ Rec). Cerca in tutti i fogli del file.
 */
export function detectLegend(sheets: { rows: Rows; fills: Fills }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const { rows, fills } of sheets) {
    fills.forEach((fr, r) =>
      fr?.forEach((_, c) => {
        const f = fillAt(fills, r, c);
        if (!f) return;
        const v = rows[r]?.[c];
        if (v !== null && v !== undefined && String(v).trim() !== '') return;
        const label = rows[r]?.[c + 1];
        if (typeof label !== 'string') return;
        const t = label.trim();
        if (!t || t.length > 30 || parseShiftCell(t).kind === 'segments') return;
        if (!out.has(f)) out.set(f, t);
      }),
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Interpretazione                                                     */
/* ------------------------------------------------------------------ */
function personOf(row: Cell[], nameCols: number[], emailCol: number | null) {
  const name = nameCols
    .map((c) => String(row[c] ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
  const emailRaw = emailCol !== null ? String(row[emailCol] ?? '').trim().toLowerCase() : '';
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;
  if (!name && !email) return null;
  return { name: name || email!, email, key: email ?? `n:${normName(name)}` };
}

/** colore significativo della cella (il bianco e il nero non contano) */
export function fillAt(fills: Fills | undefined, r: number, c: number): string | null {
  const f = fills?.[r]?.[c];
  if (!f) return null;
  const u = f.toUpperCase().slice(-6);
  return u === 'FFFFFF' || u === '000000' ? null : u;
}

const minToTime = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

function toRange(date: string, startMin: number, endMin: number, tz: string): [number, number] {
  const sDate = addDays(date, Math.floor(startMin / 1440));
  const eDate = addDays(date, Math.floor(endMin / 1440));
  return [localToUtc(sDate, minToTime(startMin % 1440), tz), localToUtc(eDate, minToTime(endMin % 1440), tz)];
}

export function parseGrid(rows: Rows, map: GridMapping, opts: ParseOptions, fills?: Fills): ParseResult {
  const items: ParsedItem[] = [];
  const issues: ParseIssue[] = [];
  let restCells = 0;
  for (let r = map.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const p = personOf(row, map.nameCols, map.emailCol);
    if (!p) continue;
    // righe di totali/legenda
    if (/^(totale|totali|total|legenda|note)\b/.test(plain(p.name))) continue;
    for (const { col, date } of map.dateCols) {
      const v = row[col];
      const res = parseShiftCell(v);
      if (res.kind === 'rest') {
        restCells++;
        continue;
      }
      if (res.kind === 'error') {
        issues.push({ row: r + 1, col, text: String(v ?? ''), message: res.message });
        continue;
      }
      if (res.kind === 'allDay') {
        const s = localToUtc(date, '00:00', opts.tz);
        const e = localToUtc(addDays(date, 1), '00:00', opts.tz);
        items.push({ ...p, s, e, activity: res.label, allDay: true, note: null, fill: fillAt(fills, r, col), row: r + 1, col });
        continue;
      }
      for (const seg of res.segments) {
        const [s, e] = toRange(date, seg.start, seg.end, opts.tz);
        items.push({ ...p, s, e, activity: seg.label, allDay: false, note: null, fill: fillAt(fills, r, col), row: r + 1, col });
      }
    }
  }
  return { items, issues, restCells };
}

export function parseList(rows: Rows, map: ListMapping, opts: ParseOptions, fills?: Fills): ParseResult {
  const items: ParsedItem[] = [];
  const issues: ParseIssue[] = [];
  let restCells = 0;
  for (let r = map.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => c === null || c === undefined || c === '')) continue;
    const p = personOf(row, map.name, map.email);
    if (!p) continue;
    const label = map.activity !== null ? String(row[map.activity] ?? '').trim() || null : null;
    const note = map.note !== null ? String(row[map.note] ?? '').trim() || null : null;
    const dateCell = map.date !== null ? row[map.date] : null;
    const date = dateCell !== null && dateCell !== undefined ? parseDate(dateCell, opts.year) : null;
    const issue = (message: string, text: Cell = '') => issues.push({ row: r + 1, col: null, text: String(text ?? ''), message });
    const rowFill = fillAt(fills, r, map.shift ?? map.start ?? map.activity ?? -1);

    if (map.shift !== null) {
      if (!date) {
        issue('Data mancante o non riconosciuta', dateCell);
        continue;
      }
      const res = parseShiftCell(row[map.shift]);
      if (res.kind === 'rest') {
        restCells++;
        continue;
      }
      if (res.kind === 'error') {
        issue(res.message, row[map.shift]);
        continue;
      }
      if (res.kind === 'allDay') {
        items.push({ ...p, s: localToUtc(date, '00:00', opts.tz), e: localToUtc(addDays(date, 1), '00:00', opts.tz), activity: label ?? res.label, allDay: true, note, fill: rowFill, row: r + 1, col: null });
        continue;
      }
      for (const seg of res.segments) {
        const [s, e] = toRange(date, seg.start, seg.end, opts.tz);
        items.push({ ...p, s, e, activity: seg.label ?? label, allDay: false, note, fill: rowFill, row: r + 1, col: null });
      }
      continue;
    }

    const st = map.start !== null ? parseTime(row[map.start], opts.year) : null;
    const en = map.end !== null ? parseTime(row[map.end], opts.year) : null;
    if (!st || !en) {
      // riga di assenza senza orari (es. "Ferie" con sola data)
      if (date && label && !st && !en) {
        items.push({ ...p, s: localToUtc(date, '00:00', opts.tz), e: localToUtc(addDays(date, 1), '00:00', opts.tz), activity: label, allDay: true, note, fill: rowFill, row: r + 1, col: null });
        continue;
      }
      issue('Orario di inizio o fine non riconosciuto', `${row[map.start ?? -1] ?? ''} – ${row[map.end ?? -1] ?? ''}`);
      continue;
    }
    let s: number, e: number;
    if (st.abs !== undefined && en.abs !== undefined) {
      s = st.abs;
      e = en.abs;
    } else {
      const sd = st.date ?? date;
      if (!sd) {
        issue('Data mancante o non riconosciuta', dateCell);
        continue;
      }
      const ed = en.date ?? sd;
      s = localToUtc(sd, minToTime(st.min), opts.tz);
      e = localToUtc(addDays(ed, en.min >= 1440 ? 1 : 0), minToTime(en.min % 1440), opts.tz);
      // fine prima dell'inizio senza data esplicita: turno che attraversa la mezzanotte
      if (e <= s && !en.date && st.min !== en.min) e = localToUtc(addDays(sd, 1), minToTime(en.min % 1440), opts.tz);
    }
    if (e <= s) {
      issue('La fine è prima dell’inizio', `${row[map.start!]} – ${row[map.end!]}`);
      continue;
    }
    if (e - s > 24 * 3600000) {
      issue('Blocco più lungo di 24 ore', `${row[map.start!]} – ${row[map.end!]}`);
      continue;
    }
    items.push({ ...p, s, e, activity: label, allDay: false, note, fill: rowFill, row: r + 1, col: null });
  }
  return { items, issues, restCells };
}

export function parse(rows: Rows, map: Mapping, opts: ParseOptions, fills?: Fills): ParseResult {
  if (map.format === 'grid') return parseGrid(rows, map, opts, fills);
  if (map.format === 'gridCols') return parseGridCols(rows, map, opts, fills);
  return parseList(rows, map, opts, fills);
}

/** Colonne di un foglio con un'etichetta leggibile ("C · Inizio") */
export function columnLabels(rows: Rows, headerRow: number): string[] {
  const header = rows[headerRow] ?? [];
  const width = Math.max(header.length, ...rows.slice(headerRow, headerRow + 30).map((r) => r?.length ?? 0));
  return Array.from({ length: width }, (_, i) => {
    let n = i, s = '';
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    const h = header[i];
    return h !== null && h !== undefined && String(h).trim() ? `${s} · ${String(h).trim()}` : s;
  });
}
