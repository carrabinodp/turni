'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Activity, Person } from '@/lib/types';
import { addDays, fmt, fmtTime, localDate, localToUtc, minutesLabel } from '@/lib/time';
import { IcClose } from '@/components/icons';

const MIN = 60000;
const DURATIONS = [15, 30, 45, 60, 120, 240, 480, 540];
const durLabel = (m: number) => (m < 60 ? `${m}m` : `${m / 60}h`);

export interface HistoryRow {
  at: string;
  actor: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface Draft {
  s: number;
  e: number;
  activity_id: string;
  note: string | null;
}

interface Common {
  x: number;
  y: number;
  tz: string;
  activities: Activity[];
  onClose: () => void;
}

/** posizione e orari condivisi tra modifica e inserimento */
function useTimes(tz: string, initial: Draft) {
  const [d, setD] = useState(initial);
  const day = localDate(d.s, tz);
  const setStart = (t: string) => {
    if (!t) return;
    const dur = d.e - d.s;
    const s = localToUtc(day, t, tz);
    setD({ ...d, s, e: s + dur });
  };
  const setEnd = (t: string) => {
    if (!t) return;
    let e = localToUtc(day, t, tz);
    if (e <= d.s) e = localToUtc(addDays(day, 1), t, tz);
    setD({ ...d, e });
  };
  const setDur = (m: number) => setD({ ...d, e: d.s + m * MIN });
  return { d, setD, setStart, setEnd, setDur };
}

function TimesFields(props: { tz: string; d: Draft; setStart: (t: string) => void; setEnd: (t: string) => void; setDur: (m: number) => void; idp: string }) {
  const { tz, d } = props;
  const dur = Math.round((d.e - d.s) / MIN);
  return (
    <>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <label className="field" style={{ flex: 1 }}>
          <span>Inizio</span>
          <input id={`${props.idp}-start`} className="input" type="time" step={300} value={fmtTime(d.s, tz)} onChange={(e) => props.setStart(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>Fine</span>
          <input id={`${props.idp}-end`} className="input" type="time" step={300} value={fmtTime(d.e, tz)} onChange={(e) => props.setEnd(e.target.value)} />
        </label>
      </div>
      <div className="field">
        <span>Durata <span className="muted">· {minutesLabel(dur)}</span></span>
        <div className="dur-grid">
          {DURATIONS.map((m) => (
            <button key={m} type="button" className="dur" aria-pressed={dur === m} onClick={() => props.setDur(m)}>
              {durLabel(m)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function ActivitySelect(props: { id: string; value: string; activities: Activity[]; onChange: (v: string) => void }) {
  const a = props.activities.find((x) => x.id === props.value);
  return (
    <label className="field">
      <span>Tipo di evento</span>
      <div className="act-select">
        <span className="swatch" style={{ background: a?.color ?? '#ccc' }} />
        <select id={props.id} className="select" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
          {props.activities.map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
      </div>
    </label>
  );
}

function place(x: number, y: number) {
  const top = Math.max(8, y);
  return { left: Math.max(8, x), top, maxHeight: `calc(100vh - ${top + 12}px)` };
}

/* ------------------------------------------------------------------ */
export function EditEventPopover(
  props: Common & {
    draft: Draft;
    personName: string;
    lastModified: { at: string; by: string | null } | null;
    onUpdate: (d: Draft) => void;
    onInsertAfter: (d: Draft) => void;
    onDelete: () => void;
    loadHistory?: () => Promise<HistoryRow[]>;
  },
) {
  const { tz } = props;
  const t = useTimes(tz, props.draft);
  const [hist, setHist] = useState<HistoryRow[] | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);
  useEffect(() => {
    t.setD(props.draft);
    setHist(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.draft.s, props.draft.e, props.draft.activity_id, props.draft.note]);
  const changed =
    t.d.s !== props.draft.s || t.d.e !== props.draft.e || t.d.activity_id !== props.draft.activity_id || (t.d.note ?? '') !== (props.draft.note ?? '');
  const actName = (id: unknown) => props.activities.find((a) => a.id === id)?.name ?? '—';

  return (
    <div className="pop" style={place(props.x, props.y)} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Modifica evento">
      <div className="pop-h">
        <div>
          <h3>Modifica evento</h3>
          <span className="small muted">{props.personName} · {fmt(t.d.s, tz, 'EEE d MMM')}</span>
        </div>
        <button className="btn btn-icon btn-ghost btn-sm" aria-label="Chiudi" onClick={props.onClose}><IcClose /></button>
      </div>
      <TimesFields tz={tz} d={t.d} setStart={t.setStart} setEnd={t.setEnd} setDur={t.setDur} idp="pe" />
      <ActivitySelect id="pe-act" value={t.d.activity_id} activities={props.activities} onChange={(v) => t.setD({ ...t.d, activity_id: v })} />
      <label className="field">
        <span>Descrizione (facoltativa)</span>
        <textarea id="pe-note" className="input" rows={2} value={t.d.note ?? ''} onChange={(e) => t.setD({ ...t.d, note: e.target.value || null })} />
      </label>
      <button className="btn btn-primary" disabled={!changed} onClick={() => props.onUpdate(t.d)}>Aggiorna evento</button>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <button className="btn" style={{ flex: 1 }} onClick={() => props.onInsertAfter(t.d)}>+ Inserisci nuovo evento</button>
        <button className="btn btn-danger-solid" onClick={props.onDelete}>Elimina</button>
      </div>
      {props.lastModified && (
        <div className="pop-foot">
          <span>
            Ultima modifica {fmt(props.lastModified.at, tz, "d/M/yyyy 'alle' HH:mm")}
            {props.lastModified.by ? ` · ${props.lastModified.by}` : ''}
          </span>
          {props.loadHistory && !hist && (
            <button
              className="linklike"
              disabled={loadingHist}
              onClick={async () => {
                setLoadingHist(true);
                setHist(await props.loadHistory!());
                setLoadingHist(false);
              }}
            >
              {loadingHist ? 'Carico…' : 'Vedi tutte le modifiche'}
            </button>
          )}
          {hist && (
            <ul className="hist">
              {hist.length === 0 && <li className="muted">Nessuna modifica registrata (blocco importato o copiato).</li>}
              {hist.map((h, i) => {
                const b = h.before, a = h.after;
                let what = h.action === 'insert' ? 'creato' : h.action === 'delete' ? 'eliminato' : 'modificato';
                if (h.action === 'update' && b && a) {
                  const parts: string[] = [];
                  if (b.starts_at !== a.starts_at || b.ends_at !== a.ends_at)
                    parts.push(`${fmtTime(String(b.starts_at), tz)}–${fmtTime(String(b.ends_at), tz)} → ${fmtTime(String(a.starts_at), tz)}–${fmtTime(String(a.ends_at), tz)}`);
                  if (b.activity_id !== a.activity_id) parts.push(`${actName(b.activity_id)} → ${actName(a.activity_id)}`);
                  if (b.person_id !== a.person_id) parts.push('spostato di persona');
                  if ((b.note ?? '') !== (a.note ?? '')) parts.push('descrizione');
                  if (parts.length) what = parts.join(', ');
                }
                return (
                  <li key={i}>
                    <span className="muted tabnum">{fmt(h.at, tz, 'd/M HH:mm')}</span> {h.actor}: {what}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function InsertEventPopover(
  props: Common & {
    draft: Draft;
    personId: string;
    people: Pick<Person, 'id' | 'full_name'>[];
    onInsert: (d: Draft, personIds: string[]) => void;
  },
) {
  const { tz } = props;
  const t = useTimes(tz, props.draft);
  const [extra, setExtra] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const common = useMemo(() => {
    const list = props.activities.filter((a) => a.kind !== 'work');
    return list.slice(0, 4);
  }, [props.activities]);
  const others = props.people.filter((p) => p.id !== props.personId && (!q || p.full_name.toLowerCase().includes(q.toLowerCase())));
  const main = props.people.find((p) => p.id === props.personId);

  return (
    <div className="pop" style={place(props.x, props.y)} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Inserisci evento">
      <div className="pop-h">
        <div>
          <h3>Inserisci un nuovo evento</h3>
          <span className="small muted">{main?.full_name}{extra.length ? ` e altri ${extra.length}` : ''} · {fmt(t.d.s, tz, 'EEE d MMM')}</span>
        </div>
        <button className="btn btn-icon btn-ghost btn-sm" aria-label="Chiudi" onClick={props.onClose}><IcClose /></button>
      </div>
      <TimesFields tz={tz} d={t.d} setStart={t.setStart} setEnd={t.setEnd} setDur={t.setDur} idp="pi" />
      <ActivitySelect id="pi-act" value={t.d.activity_id} activities={props.activities} onChange={(v) => t.setD({ ...t.d, activity_id: v })} />
      {common.length > 0 && (
        <div className="field">
          <span>Tipi più usati</span>
          <div className="common-grid">
            {common.map((a) => (
              <button key={a.id} type="button" className="dur" aria-pressed={t.d.activity_id === a.id} onClick={() => t.setD({ ...t.d, activity_id: a.id })}>
                <span className="swatch" style={{ background: a.color }} /> {a.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="field">
        <span>Descrizione (facoltativa)</span>
        <textarea id="pi-note" className="input" rows={2} value={t.d.note ?? ''} onChange={(e) => t.setD({ ...t.d, note: e.target.value || null })} />
      </label>
      <button className="btn btn-primary" onClick={() => props.onInsert(t.d, [props.personId, ...extra])}>
        Inserisci evento{extra.length ? ` per ${extra.length + 1} persone` : ''}
      </button>
      <button className="btn" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
        {picking ? 'Chiudi elenco persone' : extra.length ? `Persone aggiunte: ${extra.length}` : 'Aggiungi persone'}
      </button>
      {picking && (
        <div className="people-pick">
          <input id="pi-q" className="input" placeholder="Cerca…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="people-list">
            {others.map((p) => (
              <label key={p.id} className="check small">
                <input
                  type="checkbox"
                  checked={extra.includes(p.id)}
                  onChange={(e) => setExtra((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))}
                />
                {p.full_name}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
