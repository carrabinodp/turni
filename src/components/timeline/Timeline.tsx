'use client';
import './timeline.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Activity, ActivityKind, EventRow, Person } from '@/lib/types';
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
  weeks: string[];
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export interface TimelineProps {
  view: 'day' | 'week';
  date: string; // giorno selezionato (YYYY-MM-DD)
  tz: string;
  people: Pick<Person, 'id' | 'full_name' | 'contract' | 'user_id'>[];
  activities: Activity[];
  events: EventRow[];
  weekPublished: boolean;
  canEdit: boolean;
  meId: string;
  snapMinutes: number;
  serverKey: string;
  onSave?: (p: SavePayload) => Promise<ActionResult>;
  onPublish?: (week: string, publish: boolean) => Promise<ActionResult>;
  onCopyWeek?: (src: string, dst: string) => Promise<ActionResult>;
  /** solo anteprima: niente navigazione */
  navigate?: (date: string, view: 'day' | 'week') => void;
}

const NAME_W_WIDE = 236;
const NAME_W_NARROW = 128;
const ROW_H = 46;
const HEAD_H = 34;
const METRIC_H = 34;
const ZOOM: Record<'day' | 'week', number[]> = { day: [0.75, 1.05, 1.45, 2, 2.8], week: [0.09, 0.13, 0.19, 0.27] };
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
  const rangeDate = view === 'day' ? date : weekStart(date);
  const days = view === 'day' ? 1 : 7;
  const startMs = useMemo(() => dayStart(rangeDate, tz), [rangeDate, tz]);
  const endMs = useMemo(() => dayStart(addDays(rangeDate, days), tz), [rangeDate, days, tz]);
  const totalMin = (endMs - startMs) / MIN;

  const [zoomIdx, setZoomIdx] = useState(view === 'day' ? 1 : 1);
  useEffect(() => setZoomIdx(1), [view]);
  const ppm = ZOOM[view][Math.min(zoomIdx, ZOOM[view].length - 1)]!;
  const trackW = Math.round(totalMin * ppm);
  const x = useCallback((ms: number) => ((ms - startMs) / MIN) * ppm, [startMs, ppm]);

  const actById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const usable = useMemo(() => activities.filter((a) => !a.archived), [activities]);

  /* ---- stato eventi con annulla/ripeti ---- */
  const [evs, setEvs] = useState<Ev[]>(() => props.events.map(toEv));
  const evsRef = useRef(evs);
  evsRef.current = evs;
  const original = useRef(new Map(props.events.map((r) => [r.id, toEv(r)])));
  const past = useRef<Ev[][]>([]);
  const future = useRef<Ev[][]>([]);
  const [, force] = useState(0);

  useEffect(() => {
    // nuovi dati dal server (cambio data, salvataggio, ricarica)
    const list = props.events.map(toEv);
    setEvs(list);
    original.current = new Map(list.map((e) => [e.id, e]));
    past.current = [];
    future.current = [];
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.serverKey]);

  const commit = useCallback((next: Ev[]) => {
    past.current.push(evsRef.current);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    setEvs(next);
  }, []);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(evsRef.current);
    setEvs(prev);
  }, []);
  const redo = useCallback(() => {
    const nxt = future.current.pop();
    if (!nxt) return;
    past.current.push(evsRef.current);
    setEvs(nxt);
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
    return { upserts, deletes, count: upserts.length + deletes.length };
  }, [evs]);
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
  const slotMin = view === 'day' ? 30 : 120;
  const metrics = useMemo(() => {
    const slots: number[] = [];
    for (let t = startMs; t < endMs; t += slotMin * MIN) slots.push(t);
    const workActs = usable.filter((a) => a.kind === 'work');
    const per = new Map<string, number[]>(workActs.map((a) => [a.id, slots.map(() => 0)]));
    const total = slots.map(() => 0);
    byPerson.forEach((list) => {
      slots.forEach((t, i) => {
        const mid = t + (slotMin * MIN) / 2;
        let workAct: Ev | null = null;
        let blocked = false;
        for (const e of list) {
          if (e.s <= mid && e.e > mid) {
            const k = actById.get(e.activity_id)?.kind;
            if (k === 'work') {
              if (!workAct || e.e - e.s < workAct.e - workAct.s) workAct = e;
            } else blocked = true;
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
  }, [byPerson, startMs, endMs, slotMin, usable, actById]);

  /* ---- scroll iniziale ---- */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (view === 'week') {
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
    return startMs + ((clientX - g.left - NAME_W) / ppm) * MIN;
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
    const dMs = ((e.clientX - d.x0) / ppm) * MIN;
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
  const go = (d: string, v: 'day' | 'week' = view) => {
    if (dirty && !window.confirm('Hai modifiche non salvate. Vuoi uscire senza salvarle?')) return;
    if (props.navigate) return props.navigate(d, v);
    router.push(`/timeline?d=${d}&v=${v}`);
  };
  const step = view === 'day' ? 1 : 7;
  const today = todayIn(tz);
  const week = weekStart(date);

  /* ---- salvataggio ---- */
  async function save() {
    if (!props.onSave || !dirty) return;
    setBusy(true);
    const weeks = new Set<string>();
    const add = (ms: number) => weeks.add(weekStart(localDate(ms, tz)));
    diff.upserts.forEach((e) => add(e.s));
    diff.deletes.forEach((e) => add(e.s));
    const res = await props.onSave({
      upserts: diff.upserts.map((e) => ({
        id: e.id, person_id: e.person_id, activity_id: e.activity_id,
        starts_at: new Date(e.s).toISOString(), ends_at: new Date(e.e).toISOString(), note: e.note,
        ...(original.current.get(e.id)?.version ? { version: original.current.get(e.id)!.version! } : {}),
      })),
      deletes: diff.deletes.map((e) => ({ id: e.id, ...(e.version ? { version: e.version } : {}) })),
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
    const res = await props.onPublish(week, p);
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

  /* ---- menu riga ---- */
  const rangeLabel = view === 'day' ? 'giornata' : 'settimana';
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
    const step = view === 'day' ? 60 : 360;
    for (let d = 0; d < days; d++) {
      const ds = dayStart(addDays(rangeDate, d), tz);
      const de = dayStart(addDays(rangeDate, d + 1), tz);
      for (let t = ds; t < de; t += step * MIN) {
        const h = fmtTime(t, tz);
        marks.push({ ms: t, label: h.slice(0, 2), sub: view === 'day' ? ':00' : '' });
      }
    }
    return marks;
  }, [view, days, rangeDate, tz]);

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
    return `repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${hour * 24}px), repeating-linear-gradient(to right, var(--line-2) 0 1px, transparent 1px ${hour * 6}px)`;
  }, [ppm, view]);

  const selEvents = shown.filter((e) => selected.has(e.id));
  const draftLabel = props.weekPublished ? 'Pubblicata' : 'Bozza';

  /* ------------------------------------------------------------------ */
  return (
    <div className="tl-wrap" onClick={() => menu && setMenu(null)}>
      <div className="tl-top">
        <div className="tl-title">
          <h1>Timeline</h1>
          <div className="tl-bar">
            {canEdit && (
              <>
                <span className={`pill ${props.weekPublished ? 'pill-ok' : 'pill-warn'}`} title="Stato della settimana">
                  Settimana {fmtDay(week, 'd MMM')}: {draftLabel}
                </span>
                {props.weekPublished ? (
                  <button className="btn btn-sm" disabled={busy} onClick={() => publish(false)}>Ritira</button>
                ) : (
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => publish(true)}>Pubblica settimana</button>
                )}
                <button className="btn btn-sm" disabled={busy} onClick={copyPrevWeek}>Copia settimana precedente</button>
              </>
            )}
          </div>
        </div>

        <div className="tl-bar">
          <div className="seg" role="group" aria-label="Vista">
            <button aria-pressed={view === 'day'} onClick={() => go(date, 'day')}>Giorno</button>
            <button aria-pressed={view === 'week'} onClick={() => go(date, 'week')}>Settimana</button>
          </div>
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
          <span className="muted" style={{ fontWeight: 500 }}>
            {view === 'day' ? fmtDay(date, 'EEEE d MMMM yyyy') : `${fmtDay(rangeDate, 'd MMM')} – ${fmtDay(addDays(rangeDate, 6), 'd MMM yyyy')}`}
          </span>
          <span className="spacer" />
          <button className={`btn btn-sm${showMetrics ? '' : ' btn-ghost'}`} onClick={() => setShowMetrics((s) => !s)} aria-pressed={showMetrics}>
            <IcChart /> Metriche
          </button>
          <button className="btn btn-icon btn-sm" aria-label="Riduci" disabled={zoomIdx === 0} onClick={() => setZoomIdx((z) => Math.max(0, z - 1))}><IcMinus /></button>
          <button className="btn btn-icon btn-sm" aria-label="Ingrandisci" disabled={zoomIdx >= ZOOM[view].length - 1} onClick={() => setZoomIdx((z) => Math.min(ZOOM[view].length - 1, z + 1))}><IcPlus /></button>
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

      {!canEdit && !props.weekPublished && (
        <div className="tl-banner alert alert-info">I turni di questa settimana non sono ancora stati pubblicati.</div>
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
        >
          {/* testata */}
          <div className="tl-head">
            {view === 'week' && (
              <div className="tl-row tl-days" style={{ height: HEAD_H }}>
                <div className="tl-name" style={{ width: NAME_W }}>Settimana</div>
                <div className="tl-track" style={{ width: trackW }}>
                  {dayMarks.map((d) => (
                    <span key={d.d} className={d.d === today ? 'today' : ''} style={{ left: x(d.s), width: x(d.e) - x(d.s) }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontWeight: 600, color: 'inherit' }}
                        onClick={() => go(d.d, 'day')}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {fmtDay(d.d, 'EEE d/M')}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="tl-row tl-hours" style={{ height: HEAD_H }}>
              <div className="tl-name" style={{ width: NAME_W }}>
                {view === 'day' ? fmtDay(date, 'EEE d/M') : 'Ora'} <span className="muted small" style={{ fontWeight: 400 }}>{tz.split('/')[1]}</span>
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
                <MetricRow nameW={NAME_W} label="In servizio" values={metrics.total} max={metrics.max} slots={metrics.slots} slotMin={slotMin} x={x} total />
                {view === 'day' && metrics.actRows.map(({ a, values }) => (
                  <MetricRow nameW={NAME_W} key={a.id} label={a.name} color={a.color} values={values} max={metrics.max} slots={metrics.slots} slotMin={slotMin} x={x} />
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
                          {canEdit && <span className="h l" data-h="l" />}
                          {width > (view === 'week' && a?.kind !== 'absence' ? 140 : 44) && <span className="lbl">{a?.name}</span>}
                          {canEdit && <span className="h r" data-h="r" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {now !== null && now > startMs && now < endMs && <div className="tl-now" style={{ left: NAME_W + x(now) }} />}
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

      {canEdit && selEvents.length > 0 && !preview && (
        <Inspector
          events={selEvents}
          people={people}
          activities={usable}
          tz={tz}
          onClose={() => setSelected(new Set())}
          onChange={(fn) => updateSel(fn)}
          onDelete={() => removeIds(new Set(selected))}
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
        {canEdit && <span className="kbd-help">Trascina per creare · Canc elimina · Ctrl+C/V · Ctrl+Z</span>}
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
      <div className="tl-track" style={{ width: x(slots[slots.length - 1]! + slotMin * MIN) }}>
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
}) {
  const { events, tz } = props;
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
        </>
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
