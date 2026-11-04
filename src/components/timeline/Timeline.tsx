'use client';
import './timeline.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Activity, ActivityKind, DayMark, DayType, EventRow, Person } from '@/lib/types';
import { autoBreaks, DEFAULT_RULES, type BreakRule } from '@/lib/breaks';
import { AbsenceDialog, SwapDialog, type AbsenceInput, type SwapInput } from './ManagerDialogs';
import {
  addDays, dayStart, diffDays, fmt, fmtDay, fmtTime, localDate, localToUtc, minutesLabel, todayIn, weekStart,
} from '@/lib/time';
import { IcLeft, IcRight, IcPlus, IcMinus, IcSearch, IcMore, IcUndo, IcRedo, IcClose, IcChart } from '@/components/icons';

/* ------------------------------------------------------------------ */
/* Tipi e costanti                                                     */
/* ------------------------------------------------------------------ */
export interface Ev {
  id: string;
  person_id: string;
  activity_id: string;
  s: number; // ms UTC
  e: number;
  note: string | null;
  version: string | null; // updated_at dal server (null = nuovo)
}

export interface SavePayload {
  upserts: { id: string; person_id: string; activity_id: string; starts_at: string; ends_at: string; note: string | null; version?: string }[];
  deletes: { id: string; version?: string }[];
  marks: { person_id: string; day: string; day_type_id: string | null }[];
  weeks: string[];
}

export type View = 'day' | 'week' | 'custom';

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export interface TimelineProps {
  view: View;
  date: string; // giorno selezionato (YYYY-MM-DD); nel periodo personalizzato è l'inizio
  to?: string; // fine del periodo personalizzato (inclusa)
  tz: string;
  people: Pick<Person, 'id' | 'full_name' | 'contract' | 'user_id'>[];
  activities: Activity[];
  events: EventRow[];
  dayTypes?: DayType[];
  marks?: DayMark[];
  publishedWeeks: string[];
  breakRules?: BreakRule[];
  breakActivityId?: string | null;
  canEdit: boolean;
  meId: string;
  snapMinutes: number;
  serverKey: string;
  onSave?: (p: SavePayload) => Promise<ActionResult>;
  onPublish?: (week: string, publish: boolean) => Promise<ActionResult>;
  onCopyWeek?: (src: string, dst: string) => Promise<ActionResult>;
  onTimeOff?: (p: AbsenceInput) => Promise<ActionResult>;
  onSwap?: (p: SwapInput) => Promise<ActionResult>;
  /** solo anteprima: niente navigazione */
  navigate?: (date: string, view: View, to?: string) => void;
}

type MarkMap = Record<string, string>; // `${person}|${giorno}` → tipo giornata
const markKey = (p: string, d: string) => `${p}|${d}`;
const toMarkMap = (m: DayMark[] = []): MarkMap => Object.fromEntries(m.map((x) => [markKey(x.person_id, x.day), x.day_type_id]));

const NAME_W_WIDE = 236;
const NAME_W_NARROW = 128;
const ROW_H = 46;
const HEAD_H = 34;
const METRIC_H = 34;
const ZOOM: Record<View, number[]> = {
  day: [0.75, 1.05, 1.45, 2, 2.8],
  week: [0.5, 0.75, 1, 1.5, 2.5, 4], // moltiplicatori di "adatta allo schermo"
  custom: [0.5, 0.75, 1, 1.5, 2.5, 4],
};
/** minuti dalla mezzanotte locale */
const minuteOfDay = (ms: number, tz: string) => {
  const [h, m] = fmtTime(ms, tz).split(':').map(Number);
  return h! * 60 + m!;
};
const MAX_CUSTOM_DAYS = 62;
const KIND_ORDER: Record<ActivityKind, number> = { work: 0, break: 1, absence: 2 };
const MIN = 60000;

function toEv(r: EventRow): Ev {
  return {
    id: r.id, person_id: r.person_id, activity_id: r.activity_id,
    s: Date.parse(r.starts_at), e: Date.parse(r.ends_at), note: r.note, version: r.updated_at,
  };
}

function textOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return l > 0.62 ? '#1d2433' : '#ffffff';
}

function uuid() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
}

type Drag =
  | { mode: 'move' | 'l' | 'r'; ids: string[]; x0: number; y0: number; row0: string; moved: boolean; clickId: string }
  | { mode: 'create'; person: string; t0: number; x0: number; y0: number; moved: boolean };

/* ------------------------------------------------------------------ */
export default function Timeline(props: TimelineProps) {
  const { view, date, tz, people, activities, canEdit, meId, snapMinutes } = props;
  const router = useRouter();
  const [narrow, setNarrow] = useState(false);
  const [showMetrics, setShowMetrics] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 700px)');
    setNarrow(mq.matches);
    if (mq.matches) setShowMetrics(false);
    const h = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  const NAME_W = narrow ? NAME_W_NARROW : NAME_W_WIDE;

  /* ---- intervallo visibile ---- */
  const rangeDate = view === 'week' ? weekStart(date) : date;
  const days = view === 'day' ? 1 : view === 'week' ? 7 : Math.min(MAX_CUSTOM_DAYS, Math.max(1, diffDays(date, props.to ?? date) + 1));
  const rangeEnd = addDays(rangeDate, days - 1);
  const startMs = useMemo(() => dayStart(rangeDate, tz), [rangeDate, tz]);
  const endMs = useMemo(() => dayStart(addDays(rangeDate, days), tz), [rangeDate, days, tz]);
  const totalMin = (endMs - startMs) / MIN;

  // settimana e periodo: si mostrano solo le ore lavorate (es. 07–21), adattate allo schermo
  const compact = view !== 'day';
  const win = useMemo(() => {
    if (!compact) return { h0: 0, h1: 24 };
    let lo = 7 * 60, hi = 21 * 60;
    for (const r of props.events) {
      const s0 = Date.parse(r.starts_at), e0 = Date.parse(r.ends_at);
      if (e0 <= startMs || s0 >= endMs) continue;
      if (localDate(s0, tz) !== localDate(e0 - 1, tz)) return { h0: 0, h1: 24 }; // turno notturno
      lo = Math.min(lo, minuteOfDay(s0, tz));
      hi = Math.max(hi, minuteOfDay(e0 - 1, tz) + 1);
    }
    return { h0: Math.max(0, Math.floor(lo / 60)), h1: Math.min(24, Math.ceil(hi / 60)) };
  }, [compact, props.events, startMs, endMs, tz]);
  const winMin = (win.h1 - win.h0) * 60;
  const dayStarts = useMemo(() => Array.from({ length: days + 1 }, (_, i) => dayStart(addDays(rangeDate, i), tz)), [days, rangeDate, tz]);

  const [zoomIdx, setZoomIdx] = useState(compact ? 2 : 1);
  useEffect(() => setZoomIdx(view === 'day' ? 1 : 2), [view]);
  const [vw, setVw] = useState(1200);
  const ppm = compact
    ? Math.max(0.006, (vw - NAME_W - 4) / (days * winMin)) * ZOOM[view][Math.min(zoomIdx, ZOOM[view].length - 1)]!
    : ZOOM.day[Math.min(zoomIdx, ZOOM.day.length - 1)]!;
  const dayW = winMin * ppm;
  const trackW = Math.round(compact ? days * dayW : totalMin * ppm);
  const x = useCallback(
    (ms: number) => {
      if (!compact) return ((ms - startMs) / MIN) * ppm;
      if (ms <= startMs) return 0;
      if (ms >= endMs) return days * dayW;
      let i = days - 1;
      while (i > 0 && ms < dayStarts[i]!) i--;
      const f = Math.min(1, Math.max(0, ((ms - dayStarts[i]!) / MIN - win.h0 * 60) / winMin));
      return (i + f) * dayW;
    },
    [compact, startMs, endMs, ppm, days, dayW, dayStarts, win.h0, winMin],
  );
  /** posizione orizzontale (px dentro la traccia) → istante */
  const msAt = useCallback(
    (px: number) => {
      if (!compact) return startMs + (px / ppm) * MIN;
      const i = Math.min(days - 1, Math.max(0, Math.floor(px / dayW)));
      const f = Math.min(1, Math.max(0, (px - i * dayW) / dayW));
      return dayStarts[i]! + (win.h0 * 60 + f * winMin) * MIN;
    },
    [compact, startMs, ppm, days, dayW, dayStarts, win.h0, winMin],
  );

  const actById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const usable = useMemo(() => activities.filter((a) => !a.archived), [activities]);
  const dayTypes = useMemo(() => (props.dayTypes ?? []).filter((d) => !d.archived), [props.dayTypes]);
  const dtById = useMemo(() => new Map((props.dayTypes ?? []).map((d) => [d.id, d])), [props.dayTypes]);
  const breakAct = props.breakActivityId ?? usable.find((a) => a.kind === 'break')?.id ?? null;

  /* ---- stato eventi con annulla/ripeti ---- */
  const [evs, setEvs] = useState<Ev[]>(() => props.events.map(toEv));
  const evsRef = useRef(evs);
  evsRef.current = evs;
  const original = useRef(new Map(props.events.map((r) => [r.id, toEv(r)])));
  const [marks, setMarks] = useState<MarkMap>(() => toMarkMap(props.marks));
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const originalMarks = useRef<MarkMap>(toMarkMap(props.marks));
  type Snap = { evs: Ev[]; marks: MarkMap };
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const [, force] = useState(0);

  useEffect(() => {
    // nuovi dati dal server (cambio data, salvataggio, ricarica)
    const list = props.events.map(toEv);
    setEvs(list);
    original.current = new Map(list.map((e) => [e.id, e]));
    const m = toMarkMap(props.marks);
    setMarks(m);
    originalMarks.current = m;
    past.current = [];
    future.current = [];
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.serverKey]);

  const commit = useCallback((next: Ev[], nextMarks?: MarkMap) => {
    past.current.push({ evs: evsRef.current, marks: marksRef.current });
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    setEvs(next);
    if (nextMarks) setMarks(nextMarks);
  }, []);
  const commitMarks = useCallback((nextMarks: MarkMap) => commit(evsRef.current, nextMarks), [commit]);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push({ evs: evsRef.current, marks: marksRef.current });
    setEvs(prev.evs);
    setMarks(prev.marks);
  }, []);
  const redo = useCallback(() => {
    const nxt = future.current.pop();
    if (!nxt) return;
    past.current.push({ evs: evsRef.current, marks: marksRef.current });
    setEvs(nxt.evs);
    setMarks(nxt.marks);
  }, []);

  /* ---- differenze rispetto al server ---- */
  const diff = useMemo(() => {
    const cur = new Map(evs.map((e) => [e.id, e]));
    const upserts: Ev[] = [];
    const deletes: Ev[] = [];
    for (const e of evs) {
      const o = original.current.get(e.id);
      if (!o || o.person_id !== e.person_id || o.activity_id !== e.activity_id || o.s !== e.s || o.e !== e.e || (o.note ?? '') !== (e.note ?? '')) {
        upserts.push(e);
      }
    }
    original.current.forEach((o, id) => {
      if (!cur.has(id)) deletes.push(o);
    });
    const markChanges: SavePayload['marks'] = [];
    const keys = new Set([...Object.keys(marks), ...Object.keys(originalMarks.current)]);
    keys.forEach((k) => {
      if ((marks[k] ?? null) !== (originalMarks.current[k] ?? null)) {
        const [person_id, day] = k.split('|') as [string, string];
        markChanges.push({ person_id, day, day_type_id: marks[k] ?? null });
      }
    });
    return { upserts, deletes, markChanges, count: upserts.length + deletes.length + markChanges.length };
  }, [evs, marks]);
  const dirty = diff.count > 0;

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  /* ---- UI state ---- */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [brush, setBrush] = useState<string>(() => usable.find((a) => a.kind === 'work')?.id ?? usable[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'start' | 'name'>('start');
  const [onlyWorking, setOnlyWorking] = useState(false);
  const [snapOn, setSnapOn] = useState(true);
  const [preview, setPreview] = useState<Map<string, Ev> | null>(null);
  const [menu, setMenu] = useState<{ person: string; x: number; y: number } | null>(null);
  const [dayMenu, setDayMenu] = useState<{ person: string; day: string; t: number; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'absence' | 'swap'; person: string; day: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; bad?: boolean } | null>(null);
  const clipboard = useRef<Ev[]>([]);
  const hover = useRef<{ person: string | null; t: number | null }>({ person: null, t: null });
  const drag = useRef<Drag | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const say = useCallback((msg: string, bad = false) => {
    setToast({ msg, bad });
    window.setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), bad ? 6000 : 2800);
  }, []);

  /* ---- eventi visibili (con anteprima trascinamento) ---- */
  const shown = useMemo(() => {
    if (!preview) return evs;
    const out = evs.map((e) => preview.get(e.id) ?? e);
    preview.forEach((p, id) => {
      if (!evs.some((e) => e.id === id)) out.push(p);
    });
    return out;
  }, [evs, preview]);

  const byPerson = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of shown) {
      if (e.e <= startMs || e.s >= endMs) continue;
      if (!m.has(e.person_id)) m.set(e.person_id, []);
      m.get(e.person_id)!.push(e);
    }
    m.forEach((list) =>
      list.sort((a, b) => {
        const ka = KIND_ORDER[actById.get(a.activity_id)?.kind ?? 'work'];
        const kb = KIND_ORDER[actById.get(b.activity_id)?.kind ?? 'work'];
        return ka - kb || b.e - b.s - (a.e - a.s);
      }),
    );
    return m;
  }, [shown, startMs, endMs, actById]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = people.filter((p) => !q || p.full_name.toLowerCase().includes(q));
    if (onlyWorking) list = list.filter((p) => byPerson.has(p.id));
    const first = (id: string) => {
      const l = byPerson.get(id);
      return l?.length ? Math.min(...l.map((e) => e.s)) : Infinity;
    };
    list = [...list].sort((a, b) =>
      sort === 'start' ? first(a.id) - first(b.id) || a.full_name.localeCompare(b.full_name) : a.full_name.localeCompare(b.full_name),
    );
    if (!canEdit) {
      const i = list.findIndex((p) => p.id === meId);
      if (i > 0) list.unshift(list.splice(i, 1)[0]!);
    }
    return list;
  }, [people, search, onlyWorking, byPerson, sort, canEdit, meId]);

  /* ---- metriche: persone in servizio per fascia ---- */
  const hourPx = 60 * ppm;
  const slotMin = view === 'day' ? 30 : hourPx * 2 >= 22 ? 120 : hourPx * 4 >= 22 ? 240 : winMin;
  const metrics = useMemo(() => {
    const slots: number[] = [];
    if (!compact) for (let t = startMs; t < endMs; t += slotMin * MIN) slots.push(t);
    else
      for (let i = 0; i < days; i++)
        for (let m = win.h0 * 60; m < win.h1 * 60; m += slotMin) slots.push(dayStarts[i]! + m * MIN);
    const workActs = usable.filter((a) => a.kind === 'work');
    const per = new Map<string, number[]>(workActs.map((a) => [a.id, slots.map(() => 0)]));
    const total = slots.map(() => 0);
    byPerson.forEach((list) => {
      slots.forEach((t, i) => {
        const mid = t + (slotMin * MIN) / 2;
        const whole = slotMin >= 240; // fasce lunghe: conta chi lavora in quella fascia
        let workAct: Ev | null = null;
        let blocked = false;
        for (const e of list) {
          const hit = whole ? e.s < t + slotMin * MIN && e.e > t : e.s <= mid && e.e > mid;
          if (hit) {
            const k = actById.get(e.activity_id)?.kind;
            if (k === 'work') {
              if (!workAct || e.e - e.s < workAct.e - workAct.s) workAct = e;
            } else if (k === 'absence' || !whole) blocked = true;
          }
        }
        if (workAct && !blocked) {
          total[i]!++;
          const arr = per.get(workAct.activity_id);
          if (arr) arr[i]!++;
        }
      });
    });
    const max = Math.max(1, ...total);
    const actRows = workActs.filter((a) => per.get(a.id)!.some((n) => n > 0)).map((a) => ({ a, values: per.get(a.id)! }));
    return { slots, total, max, actRows };
  }, [byPerson, startMs, endMs, slotMin, usable, actById, compact, days, win.h0, win.h1, dayStarts]);

  /* ---- scroll iniziale ---- */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setVw(el.clientWidth);
    const ro = new ResizeObserver(() => setVw(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (view !== 'day') {
      el.scrollLeft = 0;
      return;
    }
    const first = props.events.length ? Math.min(...props.events.map((r) => Date.parse(r.starts_at))) : null;
    const target = first && first > startMs ? first - 60 * MIN : localToUtc(rangeDate, '07:00', tz);
    el.scrollLeft = Math.max(0, x(target) - 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeDate, view, props.serverKey]);

  /* ---- ora attuale ---- */
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(t);
  }, []);

  /* ---- utilità posizione ---- */
  const snap = canEdit && snapOn ? snapMinutes : 1;
  const snapMs = (ms: number) => Math.round(ms / (snap * MIN)) * snap * MIN;
  const msAtClientX = (clientX: number) => {
    const g = gridRef.current!.getBoundingClientRect();
    return msAt(clientX - g.left - NAME_W);
  };
  const personAt = (clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    return (el?.closest('[data-person]') as HTMLElement | null)?.dataset.person ?? null;
  };

  /* ---- trascinamento ---- */
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    setMenu(null);
    const t = e.target as HTMLElement;
    const evEl = t.closest('[data-ev]') as HTMLElement | null;
    if (!canEdit) return;
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;

    if (evEl) {
      const id = evEl.dataset.ev!;
      if (multi) {
        setSelected((s) => {
          const n = new Set(s);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        });
        return;
      }
      const sel = selected.has(id) ? selected : new Set([id]);
      if (!selected.has(id)) setSelected(sel);
      const handle = t.dataset.h as 'l' | 'r' | undefined;
      const ev = evsRef.current.find((x) => x.id === id)!;
      drag.current = {
        mode: handle ?? 'move',
        ids: handle ? [id] : Array.from(sel),
        x0: e.clientX, y0: e.clientY, row0: ev.person_id, moved: false, clickId: id,
      };
    } else {
      const track = t.closest('[data-person]') as HTMLElement | null;
      if (!track || t.closest('.tl-name')) return;
      drag.current = { mode: 'create', person: track.dataset.person!, t0: snapMs(msAtClientX(e.clientX)), x0: e.clientX, y0: e.clientY, moved: false };
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) {
      const track = (e.target as HTMLElement).closest('[data-person]') as HTMLElement | null;
      hover.current = { person: track?.dataset.person ?? null, t: track ? msAtClientX(e.clientX) : null };
      return;
    }
    if (!d.moved && Math.abs(e.clientX - d.x0) < 4 && Math.abs(e.clientY - d.y0) < 4) return;
    d.moved = true;
    const snapNow = canEdit && snapOn && !e.altKey ? snapMinutes : 1;
    const snapD = (ms: number) => Math.round(ms / (snapNow * MIN)) * snapNow * MIN;
    const dMs = msAtClientX(e.clientX) - msAtClientX(d.x0);
    const p = new Map<string, Ev>();

    if (d.mode === 'create') {
      const t1 = snapD(msAtClientX(e.clientX));
      const s = Math.min(d.t0, t1), en = Math.max(d.t0, t1);
      if (en - s >= snapNow * MIN) {
        p.set('__new__', { id: '__new__', person_id: d.person, activity_id: brush, s, e: en, note: null, version: null });
      }
    } else {
      const delta = snapD(dMs);
      const rowNow = d.mode === 'move' ? personAt(e.clientX, e.clientY) : null;
      const sameRow = d.ids.every((id) => evsRef.current.find((x) => x.id === id)?.person_id === d.row0);
      for (const id of d.ids) {
        const o = evsRef.current.find((x) => x.id === id);
        if (!o) continue;
        if (d.mode === 'move') {
          p.set(id, { ...o, s: o.s + delta, e: o.e + delta, person_id: rowNow && sameRow ? rowNow : o.person_id });
        } else if (d.mode === 'l') {
          const s = Math.min(snapD(o.s + dMs), o.e - snapNow * MIN);
          p.set(id, { ...o, s });
        } else {
          const en = Math.max(snapD(o.e + dMs), o.s + snapNow * MIN);
          p.set(id, { ...o, e: en });
        }
      }
    }
    setPreview(p);
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      if (d.mode === 'create') setSelected(new Set());
      else if (d.mode === 'move') setSelected(new Set([d.clickId]));
      setPreview(null);
      return;
    }
    const p = preview;
    setPreview(null);
    if (!p || !p.size) return;
    if (d.mode === 'create') {
      const n = p.get('__new__')!;
      if (!brush) return say('Scegli prima un’attività da disegnare', true);
      const created = { ...n, id: uuid() };
      commit([...evsRef.current, created]);
      setSelected(new Set([created.id]));
    } else {
      const changed = evsRef.current.map((x) => p.get(x.id) ?? x);
      if (changed.some((x, i) => x !== evsRef.current[i])) commit(changed);
    }
  }

  function onContextMenu(e: React.MouseEvent) {
    if (!canEdit) return;
    const t = e.target as HTMLElement;
    const track = t.closest('[data-person]') as HTMLElement | null;
    if (!track || t.closest('.tl-name')) return;
    e.preventDefault();
    const ms = msAtClientX(e.clientX);
    const w = (e.currentTarget.closest('.tl-wrap') as HTMLElement).getBoundingClientRect();
    const evId = (t.closest('[data-ev]') as HTMLElement | null)?.dataset.ev;
    if (evId && !selected.has(evId)) setSelected(new Set([evId]));
    setMenu(null);
    setDayMenu({
      person: track.dataset.person!,
      day: localDate(ms, tz),
      t: ms,
      x: Math.min(e.clientX - w.left, w.width - 250),
      y: Math.min(e.clientY - w.top, w.height - 480),
    });
  }

  /* ---- operazioni ---- */
  const removeIds = useCallback((ids: Set<string>) => {
    if (!ids.size) return;
    commit(evsRef.current.filter((e) => !ids.has(e.id)));
    setSelected(new Set());
  }, [commit]);

  const updateSel = useCallback((patch: (e: Ev) => Ev) => {
    commit(evsRef.current.map((e) => (selected.has(e.id) ? patch(e) : e)));
  }, [commit, selected]);

  /** sposta un blocco mantenendo l'ora locale (corretto col cambio d'ora) */
  const shiftDays = useCallback((e: Ev, n: number): Ev => {
    const s = localToUtc(addDays(localDate(e.s, tz), n), fmtTime(e.s, tz), tz);
    return { ...e, s, e: s + (e.e - e.s) };
  }, [tz]);

  const paste = useCallback((targetPerson: string | null, targetTime: number | null) => {
    const clip = clipboard.current;
    if (!clip.length) return say('Niente da incollare: copia prima dei blocchi (Ctrl+C)', true);
    const srcDay = localDate(Math.min(...clip.map((c) => c.s)), tz);
    const dstDay = targetTime ? localDate(targetTime, tz) : view === 'day' ? date : srcDay;
    const n = diffDays(srcDay, dstDay);
    const singlePerson = new Set(clip.map((c) => c.person_id)).size === 1;
    const created = clip.map((c) => ({
      ...shiftDays(c, n),
      id: uuid(),
      version: null,
      person_id: singlePerson && targetPerson ? targetPerson : c.person_id,
    }));
    commit([...evsRef.current, ...created]);
    setSelected(new Set(created.map((c) => c.id)));
    say(`Incollati ${created.length} blocchi`);
  }, [commit, date, say, shiftDays, tz, view]);

  /** giornate (persona+giorno) coinvolte dalla selezione, oppure quella cliccata */
  const targetDays = (person: string, day: string) => {
    const set = new Set<string>([markKey(person, day)]);
    evsRef.current.filter((e) => selected.has(e.id)).forEach((e) => set.add(markKey(e.person_id, localDate(e.s, tz))));
    return Array.from(set);
  };

  const setDayType = (keys: string[], typeId: string | null) => {
    const next = { ...marksRef.current };
    keys.forEach((k) => {
      if (typeId) next[k] = typeId;
      else delete next[k];
    });
    commitMarks(next);
    const dt = typeId ? dtById.get(typeId)?.name : null;
    say(dt ? `${keys.length > 1 ? `${keys.length} giornate` : 'Giornata'}: ${dt}` : 'Tipo giornata tolto');
  };

  const blocksFor = (list: Ev[]) =>
    list.map((e) => ({ person_id: e.person_id, s: e.s, e: e.e, kind: actById.get(e.activity_id)?.kind ?? ('work' as const) }));

  const addAutoBreaks = (filter: (e: Ev) => boolean, label: string) => {
    if (!breakAct) return say('Manca un’attività di tipo pausa: creala in Configura', true);
    const scope = evsRef.current.filter(filter);
    const created = autoBreaks(blocksFor(scope), props.breakRules?.length ? props.breakRules : DEFAULT_RULES, Math.min(snapMinutes, 5)).map(
      (b) => ({ id: uuid(), person_id: b.person_id, activity_id: breakAct, s: b.s, e: b.e, note: null, version: null }),
    );
    if (!created.length) return say(`Nessuna pausa da aggiungere ${label}: ci sono già o i turni sono brevi`);
    commit([...evsRef.current, ...created]);
    say(`Aggiunte ${created.length} pause ${label}. Puoi spostarle e poi salvare.`);
  };

  const addBreakAt = (person: string, t: number, minutes = 15) => {
    if (!breakAct) return say('Manca un’attività di tipo pausa: creala in Configura', true);
    const s = Math.round(t / (5 * MIN)) * 5 * MIN;
    const created = { id: uuid(), person_id: person, activity_id: breakAct, s, e: s + minutes * MIN, note: null, version: null };
    commit([...evsRef.current, created]);
    setSelected(new Set([created.id]));
  };

  const dayRange = (day: string) => [dayStart(day, tz), dayStart(addDays(day, 1), tz)] as const;

  /* ---- tastiera ---- */
  useEffect(() => {
    if (!canEdit) return;
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'c') {
        if (!selected.size) return;
        clipboard.current = evsRef.current.filter((x) => selected.has(x.id));
        say(`Copiati ${clipboard.current.length} blocchi. Passa sopra una riga e premi Ctrl+V`);
      } else if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        paste(hover.current.person, hover.current.t);
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(evsRef.current.filter((x) => x.e > startMs && x.s < endMs).map((x) => x.id)));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.size) {
          e.preventDefault();
          removeIds(selected);
        }
      } else if (e.key === 'Escape') {
        setSelected(new Set());
        setMenu(null);
        setDayMenu(null);
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selected.size) {
        e.preventDefault();
        const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 60 : snapMinutes) * MIN;
        updateSel((x) => ({ ...x, s: x.s + d, e: x.e + d }));
      } else if (/^[1-9]$/.test(e.key) && !mod) {
        const a = usable[Number(e.key) - 1];
        if (!a) return;
        if (selected.size) updateSel((x) => ({ ...x, activity_id: a.id }));
        else setBrush(a.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, selected, undo, redo, paste, removeIds, updateSel, usable, snapMinutes, say, startMs, endMs]);

  /* ---- navigazione ---- */
  const go = (d: string, v: View = view, to?: string) => {
    if (dirty && !window.confirm('Hai modifiche non salvate. Vuoi uscire senza salvarle?')) return;
    let end = to;
    if (v === 'custom' && !end) {
      // periodo predefinito: il mese che contiene il giorno
      const first = d.slice(0, 8) + '01';
      const nextMonth = addDays(first, 32).slice(0, 8) + '01';
      if (view !== 'custom') {
        d = first;
        end = addDays(nextMonth, -1);
      } else end = addDays(d, days - 1);
    }
    if (end && diffDays(d, end) >= MAX_CUSTOM_DAYS) end = addDays(d, MAX_CUSTOM_DAYS - 1);
    if (end && end < d) end = d;
    if (props.navigate) return props.navigate(d, v, end);
    router.push(`/timeline?d=${d}&v=${v}${v === 'custom' && end ? `&to=${end}` : ''}`);
  };
  const step = view === 'day' ? 1 : view === 'week' ? 7 : days;
  const today = todayIn(tz);
  const week = weekStart(date);
  const published = new Set(props.publishedWeeks);
  const weeksInRange = useMemo(() => {
    const out: string[] = [];
    for (let w = weekStart(rangeDate); w <= rangeEnd; w = addDays(w, 7)) out.push(w);
    return out;
  }, [rangeDate, rangeEnd]);
  const unpublished = weeksInRange.filter((w) => !published.has(w));

  /* ---- salvataggio ---- */
  async function save() {
    if (!props.onSave || !dirty) return;
    setBusy(true);
    const weeks = new Set<string>();
    const add = (ms: number) => weeks.add(weekStart(localDate(ms, tz)));
    diff.upserts.forEach((e) => add(e.s));
    diff.deletes.forEach((e) => add(e.s));
    diff.markChanges.forEach((m) => weeks.add(weekStart(m.day)));
    const res = await props.onSave({
      upserts: diff.upserts.map((e) => ({
        id: e.id, person_id: e.person_id, activity_id: e.activity_id,
        starts_at: new Date(e.s).toISOString(), ends_at: new Date(e.e).toISOString(), note: e.note,
        ...(original.current.get(e.id)?.version ? { version: original.current.get(e.id)!.version! } : {}),
      })),
      deletes: diff.deletes.map((e) => ({ id: e.id, ...(e.version ? { version: e.version } : {}) })),
      marks: diff.markChanges,
      weeks: Array.from(weeks),
    });
    setBusy(false);
    if (res.ok) {
      say(res.message ?? 'Modifiche salvate');
      router.refresh();
    } else say(res.error, true);
  }

  async function publish(p: boolean) {
    if (!props.onPublish) return;
    if (dirty) return say('Salva prima le modifiche', true);
    setBusy(true);
    const targets = view === 'custom' ? (p ? unpublished : weeksInRange.filter((w) => published.has(w))) : [week];
    let res: ActionResult = { ok: true };
    for (const w of targets) {
      res = await props.onPublish(w, p);
      if (!res.ok) break;
    }
    if (res.ok && targets.length > 1) res = { ok: true, message: p ? `${targets.length} settimane pubblicate` : `${targets.length} settimane tornate in bozza` };
    setBusy(false);
    if (res.ok) {
      say(res.message ?? (p ? 'Settimana pubblicata' : 'Pubblicazione ritirata'));
      router.refresh();
    } else say(res.error, true);
  }

  async function copyPrevWeek() {
    if (!props.onCopyWeek) return;
    if (dirty) return say('Salva prima le modifiche', true);
    if (!window.confirm(`Copio i turni della settimana del ${fmtDay(addDays(week, -7), 'd MMM')} su questa settimana. I turni già presenti in questa settimana verranno sostituiti. Procedo?`)) return;
    setBusy(true);
    const res = await props.onCopyWeek(addDays(week, -7), week);
    setBusy(false);
    if (res.ok) {
      say(res.message ?? 'Settimana copiata');
      router.refresh();
    } else say(res.error, true);
  }

  async function runManager(fn: () => Promise<ActionResult>) {
    if (dirty) {
      say('Salva prima le modifiche in corso', true);
      return { ok: false as const, error: 'Salva prima le modifiche in corso' };
    }
    const res = await fn();
    if (res.ok) {
      say(res.message ?? 'Fatto');
      setDialog(null);
      router.refresh();
    }
    return res;
  }

  /* ---- menu riga ---- */
  const rangeLabel = view === 'day' ? 'giornata' : view === 'week' ? 'settimana' : 'periodo';
  function rowAction(kind: 'copy' | 'paste' | 'clear', person: string) {
    setMenu(null);
    const inRange = evsRef.current.filter((e) => e.person_id === person && e.e > startMs && e.s < endMs);
    if (kind === 'copy') {
      clipboard.current = inRange;
      say(inRange.length ? `Copiata la ${rangeLabel} (${inRange.length} blocchi)` : 'Nessun blocco da copiare');
    } else if (kind === 'paste') {
      const clip = clipboard.current;
      if (!clip.length) return say('Niente da incollare', true);
      const t = view === 'day' ? startMs + 12 * 60 * MIN : Math.min(...clip.map((c) => c.s));
      paste(person, view === 'day' ? t : null);
    } else {
      removeIds(new Set(inRange.map((e) => e.id)));
    }
  }

  /* ---- render helpers ---- */
  const hourMarks = useMemo(() => {
    const marks: { ms: number; label: string; sub: string }[] = [];
    if (!compact) {
      for (let t = startMs; t < endMs; t += 60 * MIN) marks.push({ ms: t, label: fmtTime(t, tz).slice(0, 2), sub: ':00' });
      return marks;
    }
    const stepH = hourPx * 2 >= 26 ? 2 : hourPx * 3 >= 26 ? 3 : hourPx * 6 >= 26 ? 6 : 0;
    if (!stepH) return marks;
    for (let d = 0; d < days; d++) {
      for (let h = Math.ceil(win.h0 / stepH) * stepH; h < win.h1; h += stepH) {
        marks.push({ ms: dayStarts[d]! + h * 60 * MIN, label: String(h).padStart(2, '0'), sub: '' });
      }
    }
    return marks;
  }, [compact, startMs, endMs, tz, hourPx, days, win.h0, win.h1, dayStarts]);

  const dayMarks = useMemo(
    () => Array.from({ length: days }, (_, i) => {
      const d = addDays(rangeDate, i);
      return { d, s: dayStart(d, tz), e: dayStart(addDays(d, 1), tz) };
    }),
    [days, rangeDate, tz],
  );

  const gridBg = useMemo(() => {
    const hour = 60 * ppm;
    if (view === 'day') {
      return `repeating-linear-gradient(to right, var(--line-2) 0 1px, transparent 1px ${hour / 2}px), repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${hour}px)`;
    }
    const days = `repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${dayW}px)`;
    if (hour < 8) return days;
    return `${days}, repeating-linear-gradient(to right, var(--line-2) 0 1px, transparent 1px ${hour}px)`;
  }, [ppm, view, dayW]);

  const selEvents = shown.filter((e) => selected.has(e.id));
  const weekPublished = published.has(week);
  const dayLabel = (px: number, d: string) =>
    fmtDay(d, px >= 74 ? 'EEE d/M' : px >= 40 ? 'd/M' : 'd');

  /* ------------------------------------------------------------------ */
  return (
    <div className="tl-wrap" onClick={() => { if (menu) setMenu(null); if (dayMenu) setDayMenu(null); }}>
      <div className="tl-top">
        <div className="tl-title">
          <h1>Timeline</h1>
          <div className="tl-bar">
            {canEdit && view !== 'custom' && (
              <>
                <span className={`pill ${weekPublished ? 'pill-ok' : 'pill-warn'}`} title="Stato della settimana">
                  Settimana {fmtDay(week, 'd MMM')}: {weekPublished ? 'Pubblicata' : 'Bozza'}
                </span>
                {weekPublished ? (
                  <button className="btn btn-sm" disabled={busy} onClick={() => publish(false)}>Ritira</button>
                ) : (
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => publish(true)}>Pubblica settimana</button>
                )}
                <button className="btn btn-sm" disabled={busy} onClick={copyPrevWeek}>Copia settimana precedente</button>
              </>
            )}
            {canEdit && view === 'custom' && (
              <>
                <span className={`pill ${unpublished.length ? 'pill-warn' : 'pill-ok'}`}>
                  Pubblicate {weeksInRange.length - unpublished.length} di {weeksInRange.length} settimane
                </span>
                {unpublished.length > 0 && (
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => publish(true)}>Pubblica il periodo</button>
                )}
              </>
            )}
            {canEdit && (
              <button className="btn btn-sm" disabled={busy} onClick={() => addAutoBreaks((e) => e.e > startMs && e.s < endMs, 'nel periodo visibile')} title="Aggiunge le pause previste dalle regole a tutti i turni visibili">
                Pause automatiche
              </button>
            )}
          </div>
        </div>

        <div className="tl-bar">
          <div className="seg" role="group" aria-label="Vista">
            <button aria-pressed={view === 'day'} onClick={() => go(date, 'day')}>Giorno</button>
            <button aria-pressed={view === 'week'} onClick={() => go(date, 'week')}>Settimana</button>
            <button aria-pressed={view === 'custom'} onClick={() => go(date, 'custom')}>Periodo</button>
          </div>
          {view === 'custom' ? (
            <div className="tl-date">
              <button aria-label="Periodo precedente" onClick={() => go(addDays(date, -step), 'custom', addDays(rangeEnd, -step))}><IcLeft width={16} /></button>
              <input id="tl-from" type="date" value={date} aria-label="Dal" onChange={(e) => e.target.value && go(e.target.value, 'custom', rangeEnd < e.target.value ? e.target.value : rangeEnd)} />
              <span className="tl-sep">→</span>
              <input id="tl-to" type="date" value={rangeEnd} min={date} aria-label="Al" onChange={(e) => e.target.value && go(date, 'custom', e.target.value)} />
              <button aria-label="Periodo successivo" onClick={() => go(addDays(date, step), 'custom', addDays(rangeEnd, step))}><IcRight width={16} /></button>
            </div>
          ) : (
            <div className="tl-date">
              <button aria-label="Precedente" onClick={() => go(addDays(date, -step))}><IcLeft width={16} /></button>
              <input
                id="tl-date"
                type="date"
                value={date}
                onChange={(e) => e.target.value && go(e.target.value)}
                aria-label="Data"
              />
              <button onClick={() => go(today)} disabled={date === today}>Oggi</button>
              <button aria-label="Successivo" onClick={() => go(addDays(date, step))}><IcRight width={16} /></button>
            </div>
          )}
          {view === 'custom' && (
            <div className="seg" role="group" aria-label="Periodi rapidi">
              <button onClick={() => go(weekStart(today), 'custom', addDays(weekStart(today), 13))}>2 settimane</button>
              <button onClick={() => { const f = today.slice(0, 8) + '01'; go(f, 'custom', addDays(addDays(f, 32).slice(0, 8) + '01', -1)); }}>Questo mese</button>
              <button onClick={() => { const f = addDays(today.slice(0, 8) + '01', 32).slice(0, 8) + '01'; go(f, 'custom', addDays(addDays(f, 32).slice(0, 8) + '01', -1)); }}>Mese prossimo</button>
            </div>
          )}
          <span className="muted" style={{ fontWeight: 500 }}>
            {view === 'day'
              ? fmtDay(date, 'EEEE d MMMM yyyy')
              : `${fmtDay(rangeDate, 'd MMM')} – ${fmtDay(rangeEnd, 'd MMM yyyy')}${view === 'custom' ? ` · ${days} giorni` : ''}`}
          </span>
          <span className="spacer" />
          <button className={`btn btn-sm${showMetrics ? '' : ' btn-ghost'}`} onClick={() => setShowMetrics((s) => !s)} aria-pressed={showMetrics}>
            <IcChart /> Metriche
          </button>
          <button className="btn btn-icon btn-sm" aria-label="Riduci" disabled={zoomIdx === 0} onClick={() => setZoomIdx((z) => Math.max(0, z - 1))}><IcMinus /></button>
          <button className="btn btn-icon btn-sm" aria-label="Ingrandisci" disabled={zoomIdx >= ZOOM[view].length - 1} onClick={() => setZoomIdx((z) => Math.min(ZOOM[view].length - 1, z + 1))}><IcPlus /></button>
          {dayTypes.length > 0 && (
            <div className="legend-days" aria-label="Tipi di giornata">
              {dayTypes.map((d) => (
                <span key={d.id}><i style={{ background: d.color }} />{d.name}</span>
              ))}
            </div>
          )}
        </div>

        <div className="tl-bar">
          <label className="tl-search">
            <IcSearch />
            <input id="tl-search" className="input" placeholder="Cerca persone…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select id="tl-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value as 'start' | 'name')} aria-label="Ordina">
            <option value="start">Ordina per inizio turno</option>
            <option value="name">Ordina per nome</option>
          </select>
          <label className="check small">
            <input id="tl-only" type="checkbox" checked={onlyWorking} onChange={(e) => setOnlyWorking(e.target.checked)} /> Solo chi lavora
          </label>
          {canEdit && (
            <>
              <span className="spacer" />
              <div className="brushes" aria-label="Attività da disegnare">
                <span className="small muted">Disegna:</span>
                {usable.map((a, i) => (
                  <button key={a.id} className="brush" aria-pressed={brush === a.id} onClick={() => setBrush(a.id)} title={`Tasto ${i + 1}`}>
                    <span className="swatch" style={{ background: a.color }} />
                    {a.name}
                    {i < 9 && <kbd>{i + 1}</kbd>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {!canEdit && unpublished.length > 0 && (
        <div className="tl-banner alert alert-info">
          {view === 'custom' && unpublished.length < weeksInRange.length
            ? `Alcune settimane del periodo non sono ancora pubblicate (${unpublished.map((w) => fmtDay(w, 'd MMM')).join(', ')}).`
            : 'I turni di questa settimana non sono ancora stati pubblicati.'}
        </div>
      )}

      <div className="tl-scroll" ref={scrollRef}>
        <div
          ref={gridRef}
          className={`tl-grid${canEdit ? ' editable' : ''}`}
          style={{ width: NAME_W + trackW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drag.current = null;
            setPreview(null);
          }}
          onContextMenu={onContextMenu}
        >
          {/* testata */}
          <div className="tl-head">
            {view !== 'day' && (
              <div className="tl-row tl-days" style={{ height: HEAD_H }}>
                <div className="tl-name" style={{ width: NAME_W }}>{view === 'week' ? 'Settimana' : 'Giorno'}</div>
                <div className="tl-track" style={{ width: trackW }}>
                  {dayMarks.map((d) => {
                    const w = x(d.e) - x(d.s);
                    const dow = new Date(d.d + 'T12:00:00Z').getUTCDay();
                    return (
                      <span key={d.d} className={`${d.d === today ? 'today' : ''}${dow === 0 || dow === 6 ? ' weekend' : ''}${dow === 1 ? ' monday' : ''}`} style={{ left: x(d.s), width: w }}>
                        <button
                          className="day-btn"
                          title={`Apri ${fmtDay(d.d, 'EEEE d MMMM')}`}
                          onClick={() => go(d.d, 'day')}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          {dayLabel(w, d.d)}
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="tl-row tl-hours" style={{ height: HEAD_H }}>
              <div className="tl-name" style={{ width: NAME_W }}>
                {view === 'day' ? fmtDay(date, 'EEE d/M') : `Ore ${String(win.h0).padStart(2, '0')}–${String(win.h1).padStart(2, '0')}`}{' '}
                <span className="muted small" style={{ fontWeight: 400 }}>{tz.split('/')[1]}</span>
              </div>
              <div className="tl-track" style={{ width: trackW }}>
                {hourMarks.map((m) => (
                  <span key={m.ms} style={{ left: x(m.ms) }}>
                    {m.label}
                    <small>{m.sub}</small>
                  </span>
                ))}
              </div>
            </div>
            {showMetrics && (
              <>
                <MetricRow nameW={NAME_W} trackW={trackW} label="In servizio" values={metrics.total} max={metrics.max} slots={metrics.slots} slotMin={slotMin} x={x} total />
                {view === 'day' && metrics.actRows.map(({ a, values }) => (
                  <MetricRow nameW={NAME_W} trackW={trackW} key={a.id} label={a.name} color={a.color} values={values} max={metrics.max} slots={metrics.slots} slotMin={slotMin} x={x} />
                ))}
              </>
            )}
          </div>

          {/* righe */}
          <div className="tl-body" style={{ position: 'relative' }}>
            {rows.length === 0 && (
              <div className="empty" style={{ position: 'sticky', left: 0, width: 'min(100vw, 520px)' }}>
                {people.length === 0
                  ? 'Nessuna persona nel team. Importa un Excel o aspetta che i colleghi si registrino.'
                  : 'Nessuna persona corrisponde ai filtri.'}
              </div>
            )}
            {rows.map((p) => {
              const list = byPerson.get(p.id) ?? [];
              const worked = unionMinutes(
                list.filter((e) => actById.get(e.activity_id)?.kind === 'work').map((e) => [Math.max(e.s, startMs), Math.min(e.e, endMs)]),
              );
              return (
                <div key={p.id} className={`tl-row${p.id === meId ? ' me' : ''}`} style={{ height: ROW_H }}>
                  <div className="tl-name" style={{ width: NAME_W }}>
                    <span className="nm" title={p.full_name}>
                      {p.full_name}
                      {p.contract && <small>({p.contract})</small>}
                      {!p.user_id && <span className="pending" title="Non ancora registrato"> · da registrare</span>}
                    </span>
                    {worked > 0 && <span className="small muted tabnum" title="Ore di attività">{minutesLabel(worked)}</span>}
                    {canEdit && (
                      <button
                        className="btn btn-icon btn-ghost btn-sm"
                        aria-label={`Azioni per ${p.full_name}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const w = (e.currentTarget.closest('.tl-wrap') as HTMLElement).getBoundingClientRect();
                          setMenu({ person: p.id, x: r.left - w.left, y: r.bottom - w.top + 4 });
                        }}
                      >
                        <IcMore />
                      </button>
                    )}
                  </div>
                  <div
                    className={`tl-track${list.length ? '' : ' off'}`}
                    data-person={p.id}
                    style={{ width: trackW, backgroundImage: list.length ? gridBg : `${gridBg}, repeating-linear-gradient(135deg, transparent 0 6px, #f3f4f6 6px 7px)` }}
                  >
                    {dayMarks.map((d) => {
                      const id = marks[markKey(p.id, d.d)];
                      const dt = id ? dtById.get(id) : null;
                      if (!dt) return null;
                      const w = x(d.e) - x(d.s);
                      return (
                        <div key={d.d} className="daymark" style={{ left: x(d.s), width: w, background: `${dt.color}55`, borderTopColor: dt.color }} title={`${dt.name} · ${fmtDay(d.d, 'EEE d MMM')}`}>
                          {view === 'day' && <span>{dt.name}</span>}
                        </div>
                      );
                    })}
                    {list.map((ev) => {
                      const a = actById.get(ev.activity_id);
                      const color = a?.color ?? '#999999';
                      const left = x(Math.max(ev.s, startMs));
                      const width = Math.max(3, x(Math.min(ev.e, endMs)) - left);
                      const isSel = selected.has(ev.id);
                      const isGhost = preview?.has(ev.id);
                      const label = `${a?.name ?? 'Attività'} · ${fmtTime(ev.s, tz)}–${fmtTime(ev.e, tz)}${ev.note ? `\n${ev.note}` : ''}`;
                      return (
                        <div
                          key={ev.id}
                          data-ev={ev.id === '__new__' ? undefined : ev.id}
                          className={`ev ${a?.kind ?? ''}${isSel ? ' sel' : ''}${isGhost ? ' ghost' : ''}`}
                          style={{ left, width, background: color, color: textOn(color) }}
                          title={label}
                        >
                          {canEdit && width >= 24 && <span className="h l" data-h="l" />}
                          {width > (view !== 'day' && a?.kind !== 'absence' ? 140 : 44) && <span className="lbl">{a?.name}</span>}
                          {canEdit && width >= 24 && <span className="h r" data-h="r" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {now !== null && now > startMs && now < endMs && (!compact || (minuteOfDay(now, tz) >= win.h0 * 60 && minuteOfDay(now, tz) < win.h1 * 60)) && <div className="tl-now" style={{ left: NAME_W + x(now) }} />}
          </div>
        </div>
      </div>

      {menu && (
        <div className="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => rowAction('copy', menu.person)}>Copia {rangeLabel}</button>
          <button onClick={() => rowAction('paste', menu.person)}>Incolla qui</button>
          <hr />
          <button className="danger" onClick={() => rowAction('clear', menu.person)}>Svuota {rangeLabel}</button>
        </div>
      )}

      {dayMenu && (() => {
        const keys = targetDays(dayMenu.person, dayMenu.day);
        const cur = marks[markKey(dayMenu.person, dayMenu.day)] ?? null;
        const pname = people.find((x) => x.id === dayMenu.person)?.full_name ?? '';
        const [ds, de] = dayRange(dayMenu.day);
        const dayEvs = evsRef.current.filter((e) => e.person_id === dayMenu.person && e.s < de && e.e > ds);
        const close = () => setDayMenu(null);
        return (
          <div className="menu day-menu" style={{ left: Math.max(8, dayMenu.x), top: Math.max(8, dayMenu.y) }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            <div className="menu-h">
              <b>{pname}</b>
              <span className="muted small">{fmtDay(dayMenu.day, 'EEEE d MMM')}{keys.length > 1 ? ` · ${keys.length} giornate selezionate` : ''}</span>
            </div>
            {dayTypes.length > 0 && (
              <>
                <div className="menu-label">Tipo di giornata</div>
                {dayTypes.map((d) => (
                  <button key={d.id} onClick={() => { setDayType(keys, d.id); close(); }}>
                    <span className="swatch" style={{ background: d.color }} />
                    <span style={{ flex: 1 }}>{d.name}</span>
                    {cur === d.id && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
                {cur && <button onClick={() => { setDayType(keys, null); close(); }} className="muted">Nessun tipo</button>}
                <hr />
              </>
            )}
            <button onClick={() => { addBreakAt(dayMenu.person, dayMenu.t); close(); }}>Aggiungi pausa qui ({fmtTime(Math.round(dayMenu.t / (5 * MIN)) * 5 * MIN, tz)})</button>
            <button disabled={!dayEvs.length} onClick={() => { addAutoBreaks((e) => e.person_id === dayMenu.person && e.s < de && e.e > ds, 'in questa giornata'); close(); }}>Pause automatiche su questa giornata</button>
            <hr />
            {props.onTimeOff && <button onClick={() => { setDialog({ kind: 'absence', person: dayMenu.person, day: dayMenu.day }); close(); }}>Inserisci ferie, permesso o malattia…</button>}
            {props.onSwap && <button disabled={!dayEvs.length} onClick={() => { setDialog({ kind: 'swap', person: dayMenu.person, day: dayMenu.day }); close(); }}>Scambia o sposta il turno…</button>}
            <hr />
            <button disabled={!dayEvs.length} onClick={() => { clipboard.current = dayEvs; say(`Copiata la giornata (${dayEvs.length} blocchi)`); close(); }}>Copia giornata</button>
            <button onClick={() => { paste(dayMenu.person, ds + 12 * 60 * MIN); close(); }}>Incolla qui</button>
            <button className="danger" disabled={!dayEvs.length} onClick={() => { removeIds(new Set(dayEvs.map((e) => e.id))); close(); }}>Svuota giornata</button>
          </div>
        );
      })()}

      {dialog?.kind === 'absence' && props.onTimeOff && (
        <AbsenceDialog
          person={people.find((x) => x.id === dialog.person)!}
          day={dialog.day}
          absences={usable.filter((a) => a.kind === 'absence')}
          onClose={() => setDialog(null)}
          onSubmit={(p) => runManager(() => props.onTimeOff!(p))}
        />
      )}
      {dialog?.kind === 'swap' && props.onSwap && (
        <SwapDialog
          person={people.find((x) => x.id === dialog.person)!}
          day={dialog.day}
          people={people}
          describe={(pid, d) => {
            const [ds, de] = dayRange(d);
            const l = evsRef.current.filter((e) => e.person_id === pid && e.s < de && e.e > ds && actById.get(e.activity_id)?.kind !== 'absence');
            if (!l.length) return d >= rangeDate && d <= rangeEnd ? 'nessun turno' : null;
            return `${fmtTime(Math.min(...l.map((e) => e.s)), tz)}–${fmtTime(Math.max(...l.map((e) => e.e)), tz)}`;
          }}
          onClose={() => setDialog(null)}
          onSubmit={(p) => runManager(() => props.onSwap!(p))}
        />
      )}

      {canEdit && selEvents.length > 0 && !preview && (
        <Inspector
          events={selEvents}
          people={people}
          activities={usable}
          tz={tz}
          onClose={() => setSelected(new Set())}
          onChange={(fn) => updateSel(fn)}
          onDelete={() => removeIds(new Set(selected))}
          dayTypes={dayTypes}
          dayType={(() => {
            const ks = new Set(selEvents.map((e) => marks[markKey(e.person_id, localDate(e.s, tz))] ?? ''));
            return ks.size === 1 ? Array.from(ks)[0]! : 'mixed';
          })()}
          onDayType={(id) => setDayType(Array.from(new Set(selEvents.map((e) => markKey(e.person_id, localDate(e.s, tz))))), id)}
          canBreak={!!breakAct}
          onAddBreak={(t, minutes) => addBreakAt(selEvents[0]!.person_id, t, minutes)}
          onDuplicate={(days) => {
            const created = selEvents.map((e) => ({ ...shiftDays(e, days), id: uuid(), version: null }));
            commit([...evsRef.current, ...created]);
            setSelected(new Set(created.map((c) => c.id)));
            say(days ? `Duplicati su ${fmtDay(localDate(created[0]!.s, tz), 'EEE d MMM')}` : 'Duplicati');
          }}
        />
      )}

      <div className="tl-foot">
        <span className="muted small">{rows.length} di {people.length} persone</span>
        {canEdit && <span className="kbd-help">Trascina per creare · Clic destro sulla giornata per assenze, scambi, pause · Ctrl+Z</span>}
        <span className="spacer" />
        {canEdit && (
          <>
            <button className="btn btn-icon btn-sm" aria-label="Annulla" title="Annulla (Ctrl+Z)" disabled={!past.current.length} onClick={() => { undo(); force((n) => n + 1); }}><IcUndo /></button>
            <button className="btn btn-icon btn-sm" aria-label="Ripeti" title="Ripeti (Ctrl+Shift+Z)" disabled={!future.current.length} onClick={() => { redo(); force((n) => n + 1); }}><IcRedo /></button>
            <label className="check small" title="Aggancia a intervalli di tempo">
              <input id="tl-snap" type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} /> Aggancia {snapMinutes} min
            </label>
            <span className={`state${dirty ? ' dirty' : ''}`}>
              {dirty ? `${diff.count} modifiche non salvate` : 'Nessuna modifica da salvare'}
            </span>
            {dirty && (
              <button className="btn btn-sm" disabled={busy} onClick={() => { commit(Array.from(original.current.values())); setSelected(new Set()); }}>
                Scarta
              </button>
            )}
            <button className="btn btn-sm btn-primary" disabled={!dirty || busy} onClick={save}>
              {busy ? 'Salvataggio…' : 'Salva modifiche'}
            </button>
          </>
        )}
      </div>

      {toast && <div className={`toast${toast.bad ? ' bad' : ''}`} role="status">{toast.msg}</div>}
    </div>
  );
}

/** minuti coperti da un insieme di intervalli, senza contare due volte le sovrapposizioni */
function unionMinutes(ranges: number[][]): number {
  const r = ranges.filter((x) => x[1]! > x[0]!).sort((a, b) => a[0]! - b[0]!);
  let total = 0, cs = -1, ce = -1;
  for (const [s, e] of r) {
    if (s! > ce) {
      if (ce > cs) total += ce - cs;
      cs = s!;
      ce = e!;
    } else ce = Math.max(ce, e!);
  }
  if (ce > cs) total += ce - cs;
  return total / MIN;
}

/* ------------------------------------------------------------------ */
function MetricRow(props: {
  nameW: number;
  trackW: number;
  label: string; color?: string; values: number[]; max: number; slots: number[]; slotMin: number;
  x: (ms: number) => number; total?: boolean;
}) {
  const { values, max, slots, slotMin, x } = props;
  return (
    <div className={`tl-row tl-metric${props.total ? ' total' : ''}`} style={{ height: METRIC_H }}>
      <div className="tl-name" style={{ width: props.nameW }}>
        {props.color && <span className="swatch" style={{ background: props.color }} />}
        <span className="nm">{props.label}</span>
      </div>
      <div className="tl-track" style={{ width: props.trackW }}>
        {slots.map((t, i) => {
          const v = values[i]!;
          const r = v / max;
          const cls = !v ? 'z' : props.total ? (r > 0.75 ? 'h3' : r > 0.4 ? 'h2' : 'h1') : '';
          const w = x(t + slotMin * MIN) - x(t);
          return (
            <span key={t} className={`tabnum ${cls}`} style={{ left: x(t), width: w }}>
              {w >= 18 ? v : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Inspector(props: {
  events: Ev[];
  people: Pick<Person, 'id' | 'full_name'>[];
  activities: Activity[];
  tz: string;
  onClose: () => void;
  onChange: (fn: (e: Ev) => Ev) => void;
  onDelete: () => void;
  onDuplicate: (days: number) => void;
  dayTypes: DayType[];
  dayType: string; // '' = nessuno, 'mixed' = diversi
  onDayType: (id: string | null) => void;
  canBreak: boolean;
  onAddBreak: (t: number, minutes: number) => void;
}) {
  const { events, tz } = props;
  const [brTime, setBrTime] = useState('');
  const [brMin, setBrMin] = useState(15);
  const one = events.length === 1 ? events[0]! : null;
  const sameAct = events.every((e) => e.activity_id === events[0]!.activity_id) ? events[0]!.activity_id : '';
  const day = one ? localDate(one.s, tz) : '';

  function setTimes(field: 'start' | 'end' | 'day', value: string) {
    if (!one || !value) return;
    props.onChange((e) => {
      const d = field === 'day' ? value : localDate(e.s, tz);
      const st = field === 'start' ? value : fmtTime(e.s, tz);
      const en = field === 'end' ? value : fmtTime(e.e, tz);
      const s = localToUtc(d, st, tz);
      let end = localToUtc(d, en, tz);
      if (end <= s) end = localToUtc(addDays(d, 1), en, tz);
      return { ...e, s, e: end };
    });
  }

  return (
    <div className="inspector" onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3>{one ? 'Blocco selezionato' : `${events.length} blocchi selezionati`}</h3>
        <button className="btn btn-icon btn-ghost btn-sm" aria-label="Chiudi" onClick={props.onClose}><IcClose /></button>
      </div>
      <label className="field">
        <span>Attività</span>
        <select
          id="insp-activity"
          className="select"
          value={sameAct}
          onChange={(e) => e.target.value && props.onChange((x) => ({ ...x, activity_id: e.target.value }))}
        >
          {!sameAct && <option value="">Diverse</option>}
          {props.activities.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>
      {one && (
        <>
          <label className="field">
            <span>Persona</span>
            <select id="insp-person" className="select" value={one.person_id} onChange={(e) => props.onChange((x) => ({ ...x, person_id: e.target.value }))}>
              {props.people.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Giorno</span>
            <input id="insp-day" className="input" type="date" value={day} onChange={(e) => setTimes('day', e.target.value)} />
          </label>
          <div className="row">
            <label className="field">
              <span>Dalle</span>
              <input id="insp-start" className="input" type="time" step={300} value={fmtTime(one.s, tz)} onChange={(e) => setTimes('start', e.target.value)} />
            </label>
            <label className="field">
              <span>Alle</span>
              <input id="insp-end" className="input" type="time" step={300} value={fmtTime(one.e, tz)} onChange={(e) => setTimes('end', e.target.value)} />
            </label>
          </div>
          <span className="small muted">Durata {minutesLabel((one.e - one.s) / MIN)}{localDate(one.e - 1, tz) !== day ? ` · termina ${fmt(one.e, tz, 'EEE d')}` : ''}</span>
          <label className="field">
            <span>Nota</span>
            <input id="insp-note" className="input" value={one.note ?? ''} placeholder="Facoltativa" onChange={(e) => props.onChange((x) => ({ ...x, note: e.target.value || null }))} />
          </label>
          {props.canBreak && one.e - one.s >= 60 * MIN && (
            <div className="field">
              <span>Aggiungi una pausa dentro questo blocco</span>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input
                  id="insp-br-time"
                  className="input"
                  type="time"
                  step={300}
                  style={{ flex: 1 }}
                  value={brTime || fmtTime(one.s + Math.min(120 * MIN, (one.e - one.s) / 2), tz)}
                  onChange={(e) => setBrTime(e.target.value)}
                />
                <select id="insp-br-min" className="select" value={brMin} onChange={(e) => setBrMin(Number(e.target.value))} aria-label="Durata">
                  {[5, 10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    const t = brTime || fmtTime(one.s + Math.min(120 * MIN, (one.e - one.s) / 2), tz);
                    let ms = localToUtc(day, t, tz);
                    if (ms < one.s) ms = localToUtc(addDays(day, 1), t, tz);
                    props.onAddBreak(ms, brMin);
                    setBrTime('');
                  }}
                >
                  + Pausa
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {props.dayTypes.length > 0 && (
        <label className="field">
          <span>Tipo di giornata</span>
          <select id="insp-daytype" className="select" value={props.dayType} onChange={(e) => e.target.value !== 'mixed' && props.onDayType(e.target.value || null)}>
            {props.dayType === 'mixed' && <option value="mixed">Diversi</option>}
            <option value="">Nessuno</option>
            {props.dayTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      )}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <button className="btn btn-sm" onClick={() => props.onDuplicate(1)} title="Copia sul giorno successivo">Duplica su domani</button>
        </div>
        <button className="btn btn-sm btn-danger" onClick={props.onDelete}>Elimina</button>
      </div>
    </div>
  );
}
