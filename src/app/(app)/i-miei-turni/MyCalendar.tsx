'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { addDays, dayStart, fmtDay, fmtTime, localDate, minutesLabel } from '@/lib/time';
import { useAction } from '@/components/ui';
import { IcClose, IcLeft, IcRight } from '@/components/icons';
import { ROLE_LABEL, type Activity, type Role } from '@/lib/types';
import TimeOffForm from '../assenze/TimeOffForm';
import { createChange } from '../richieste/actions';
import { SwapDialog, type Colleague } from './MyShifts';
import SwapPanel from './SwapPanel';

export interface CalEvent {
  id: string;
  s: number;
  e: number;
  name: string;
  color: string;
  kind: 'work' | 'break' | 'absence';
  note: string | null;
}

type View = 'day' | 'week' | 'month';
const MIN = 60000;
const HOUR_PX = 56;

function textOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.62 ? '#1d2433' : '#ffffff';
}

export default function MyCalendar(props: {
  me: { name: string; email: string | null; channels: string[]; team: string | null; contract: string | null; role: Role };
  view: View;
  date: string;
  from: string;
  to: string;
  today: string;
  tz: string;
  events: CalEvent[];
  marks: Record<string, { name: string; color: string }>;
  days: Record<string, { text: string; canAct: boolean; pending: boolean }>;
  unpublishedWeeks: string[];
  colleagues: Colleague[];
  absences: Activity[];
  calendarConnected: boolean;
  swapDays: string[];
  reviewers: { id: string; name: string }[];
  swapSearch?: Parameters<typeof SwapPanel>[0]['search'];
}) {
  const { view, date, tz, today } = props;
  const router = useRouter();
  const [dialog, setDialog] = useState<null | { kind: 'swap' | 'give' | 'change' | 'timeoff'; day?: string }>(null);
  const [dayMenu, setDayMenu] = useState<string | null>(null);

  const go = (d: string, v: View = view) => router.push(`/i-miei-turni?v=${v}&d=${d}`);
  const step = (dir: number) => {
    if (view === 'day') return go(addDays(date, dir));
    if (view === 'week') return go(addDays(date, 7 * dir));
    const first = date.slice(0, 8) + '01';
    go(dir > 0 ? addDays(first, 32).slice(0, 8) + '01' : addDays(first, -1).slice(0, 8) + '01');
  };

  const dayList = useMemo(() => {
    const out: string[] = [];
    for (let d = props.from; d < props.to; d = addDays(d, 1)) out.push(d);
    return out;
  }, [props.from, props.to]);

  // ore mostrate: dalle prime alle ultime attività (minimo 08–18)
  const [h0, h1] = useMemo(() => {
    let lo = 8, hi = 18;
    for (const e of props.events) {
      if (localDate(e.s, tz) !== localDate(e.e - 1, tz)) return [0, 24];
      lo = Math.min(lo, Number(fmtTime(e.s, tz).slice(0, 2)));
      const end = fmtTime(e.e, tz);
      hi = Math.max(hi, Number(end.slice(0, 2)) + (end.endsWith(':00') ? 0 : 1));
    }
    return [Math.max(0, lo - 1), Math.min(24, hi + 1)];
  }, [props.events, tz]);

  const title =
    view === 'day'
      ? fmtDay(date, 'EEEE d MMMM yyyy')
      : view === 'week'
        ? `${fmtDay(props.from, 'd MMM')} – ${fmtDay(addDays(props.to, -1), 'd MMM yyyy')}`
        : fmtDay(date.slice(0, 8) + '15', 'MMMM yyyy');

  const workMin = props.events
    .filter((e) => e.kind === 'work' && (view !== 'month' || localDate(e.s, tz).slice(0, 7) === date.slice(0, 7)))
    .reduce((s, e) => s + (e.e - e.s) / MIN, 0);

  const chips = [...props.me.channels, props.me.team, props.me.contract && props.me.contract !== props.me.team ? props.me.contract : null].filter(Boolean) as string[];

  return (
    <div className="page cal-page">
      <div className="cal-head">
        <div style={{ minWidth: 0 }}>
          <h1>Programma per {props.me.name}</h1>
          <div className="small muted">{props.me.email}</div>
          <div className="chips">
            {chips.map((c) => <span key={c} className="pill">{c}</span>)}
            <span className="pill pill-info">{ROLE_LABEL[props.me.role]}</span>
          </div>
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          <button className="btn" onClick={() => setDialog({ kind: 'timeoff' })}>Tempo libero</button>
          <button className="btn" onClick={() => setDialog({ kind: 'swap' })} disabled={!props.swapDays.length} title={props.swapDays.length ? undefined : 'Nessun turno pubblicato da scambiare'}>
            Richiesta di scambio di turno
          </button>
          <Link className="btn" href="/impostazioni#calendario">
            {props.calendarConnected ? '✓ Google Calendar' : 'Visualizza in Google Calendar'}
          </Link>
        </div>
      </div>

      <div className="cal-bar">
        <div className="seg" role="group" aria-label="Vista">
          <button aria-pressed={view === 'day'} onClick={() => go(date, 'day')}>Giorno</button>
          <button aria-pressed={view === 'week'} onClick={() => go(date, 'week')}>Settimana</button>
          <button aria-pressed={view === 'month'} onClick={() => go(date, 'month')}>Mese</button>
        </div>
        <div className="tl-date">
          <button aria-label="Precedente" onClick={() => step(-1)}><IcLeft width={16} /></button>
          <button onClick={() => go(today)} disabled={date === today}>Oggi</button>
          <button aria-label="Successivo" onClick={() => step(1)}><IcRight width={16} /></button>
        </div>
        <b style={{ textTransform: 'capitalize' }}>{title}</b>
        <span className="muted small" style={{ marginLeft: 'auto' }}>{minutesLabel(workMin)} di attività</span>
      </div>

      {props.unpublishedWeeks.length > 0 && (
        <div className="alert alert-info">
          {props.unpublishedWeeks.length === 1 && view !== 'month'
            ? 'I turni di questa settimana non sono ancora stati pubblicati.'
            : `Settimane non ancora pubblicate: ${props.unpublishedWeeks.map((w) => fmtDay(w, 'd MMM')).join(', ')}.`}
        </div>
      )}

      {view === 'month' ? (
        <div className="card month">
          {['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'].map((d) => <div key={d} className="month-h">{d}</div>)}
          {dayList.map((d) => {
            const inMonth = d.slice(0, 7) === date.slice(0, 7);
            const evs = props.events.filter((e) => localDate(e.s, tz) === d);
            const abs = evs.find((e) => e.kind === 'absence');
            const info = props.days[d];
            const mk = props.marks[d];
            return (
              <button
                key={d}
                className={`month-cell${inMonth ? '' : ' out'}${d === today ? ' today' : ''}`}
                style={mk ? { background: `${mk.color}66` } : undefined}
                onClick={() => setDayMenu(d)}
              >
                <span className="month-d">{Number(d.slice(8))}</span>
                {info && <b className="tabnum">{info.text}</b>}
                {abs && !info && <span className="pill" style={{ background: abs.color, color: textOn(abs.color) }}>{abs.name}</span>}
                {mk && <span className="small">{mk.name}</span>}
                {info?.pending && <span className="small" style={{ color: 'var(--warn)' }}>richiesta in corso</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="card cal-grid-wrap">
          <div className="cal-grid" style={{ gridTemplateColumns: `52px repeat(${dayList.length}, minmax(${view === 'day' ? 240 : 110}px, 1fr))` }}>
            <div className="cal-corner" />
            {dayList.map((d) => {
              const mk = props.marks[d];
              return (
                <button key={d} className={`cal-dh${d === today ? ' today' : ''}`} onClick={() => setDayMenu(d)} style={mk ? { boxShadow: `inset 0 -4px 0 ${mk.color}` } : undefined}>
                  <span style={{ textTransform: 'capitalize' }}>{fmtDay(d, view === 'day' ? 'EEEE d MMMM' : 'EEE d/M')}</span>
                  {mk && <small>{mk.name}</small>}
                </button>
              );
            })}
            <div className="cal-hours" style={{ height: (h1 - h0) * HOUR_PX }}>
              {Array.from({ length: h1 - h0 }, (_, i) => (
                <span key={i} style={{ top: i * HOUR_PX }}>{String(h0 + i).padStart(2, '0')}:00</span>
              ))}
            </div>
            {dayList.map((d) => {
              const ds = dayStart(d, tz);
              const evs = props.events
                .filter((e) => e.e > ds + h0 * 3600000 && e.s < ds + h1 * 3600000 && localDate(e.s, tz) === d)
                .sort((a, b) => (a.kind === 'work' ? 0 : 1) - (b.kind === 'work' ? 0 : 1) || b.e - b.s - (a.e - a.s));
              const mk = props.marks[d];
              return (
                <div
                  key={d}
                  className={`cal-col${d === today ? ' today' : ''}`}
                  style={{ height: (h1 - h0) * HOUR_PX, background: mk ? `${mk.color}33` : undefined }}
                  onClick={() => setDayMenu(d)}
                >
                  {evs.map((e) => {
                    const top = ((e.s - ds) / MIN / 60 - h0) * HOUR_PX;
                    const height = Math.max(14, ((e.e - e.s) / MIN / 60) * HOUR_PX - 2);
                    return (
                      <div
                        key={e.id}
                        className={`cal-ev ${e.kind}`}
                        style={{ top, height, background: e.color, color: textOn(e.color) }}
                        title={`${e.name} ${fmtTime(e.s, tz)}–${fmtTime(e.e, tz)}${e.note ? `\n${e.note}` : ''}`}
                      >
                        <span className="tabnum">{fmtTime(e.s, tz)} – {fmtTime(e.e, tz)}</span>
                        {height > 30 && <b>{e.name}</b>}
                      </div>
                    );
                  })}
                  {d === today && <NowLine tz={tz} h0={h0} h1={h1} />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="cal-foot">
        <span className="small muted">Tocca un giorno per scambiarlo, cederlo o chiedere una modifica.</span>
        <button className="btn btn-primary" onClick={() => setDialog({ kind: 'change', day: date >= today ? date : today })}>Richiesta di modifica</button>
      </div>

      {dayMenu && (
        <div className="dlg-back" onClick={() => setDayMenu(null)}>
          <div className="dlg" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Azioni sul giorno">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ textTransform: 'capitalize' }}>{fmtDay(dayMenu, 'EEEE d MMMM')}</h2>
              <button className="btn btn-icon btn-ghost btn-sm" aria-label="Chiudi" onClick={() => setDayMenu(null)}><IcClose /></button>
            </div>
            <div className="muted">
              {props.days[dayMenu]?.text ? `Turno ${props.days[dayMenu]!.text}` : 'Nessun turno'}
              {props.marks[dayMenu] ? ` · ${props.marks[dayMenu]!.name}` : ''}
            </div>
            {props.events.filter((e) => localDate(e.s, tz) === dayMenu).length > 0 && (
              <div className="small" style={{ display: 'grid', gap: 3 }}>
                {props.events
                  .filter((e) => localDate(e.s, tz) === dayMenu)
                  .sort((a, b) => a.s - b.s)
                  .map((e) => (
                    <span key={e.id}><span className="swatch" style={{ background: e.color, marginRight: 6 }} />{fmtTime(e.s, tz)}–{fmtTime(e.e, tz)} {e.name}{e.note ? ` · ${e.note}` : ''}</span>
                  ))}
              </div>
            )}
            {props.days[dayMenu]?.pending ? (
              <div className="alert alert-warn">C’è già una richiesta in corso per questo giorno.</div>
            ) : props.days[dayMenu]?.canAct ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <button className="btn" onClick={() => { setDialog({ kind: 'swap', day: dayMenu }); setDayMenu(null); }}>Scambia con un collega</button>
                <button className="btn" onClick={() => { setDialog({ kind: 'give', day: dayMenu }); setDayMenu(null); }}>Cedi il turno</button>
              </div>
            ) : null}
            {dayMenu >= today && (
              <div style={{ display: 'grid', gap: 8 }}>
                <button className="btn" onClick={() => { setDialog({ kind: 'change', day: dayMenu }); setDayMenu(null); }}>Richiesta di modifica</button>
                <button className="btn" onClick={() => { setDialog({ kind: 'timeoff', day: dayMenu }); setDayMenu(null); }}>Chiedi ferie o permesso</button>
              </div>
            )}
          </div>
        </div>
      )}

      {dialog?.kind === 'give' && dialog.day && (
        <SwapDialog
          mode="give"
          day={dialog.day}
          myText={props.days[dialog.day]?.text ?? ''}
          colleagues={props.colleagues}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'swap' && (dialog.day || props.swapDays[0]) && (
        <SwapPanel
          tz={tz}
          today={today}
          initialDay={dialog.day ?? props.swapDays.find((d) => d >= date) ?? props.swapDays[0]!}
          myDays={props.swapDays}
          reviewers={props.reviewers}
          search={props.swapSearch}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'change' && <ChangeDialog day={dialog.day ?? today} today={today} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'timeoff' && (
        <div className="dlg-back" onClick={() => setDialog(null)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Tempo libero">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Tempo libero</h2>
              <button className="btn btn-icon btn-ghost btn-sm" aria-label="Chiudi" onClick={() => setDialog(null)}><IcClose /></button>
            </div>
            <TimeOffForm activities={props.absences} today={dialog.day ?? today} />
            <Link className="small" href="/assenze">Vedi le mie richieste di assenza</Link>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .cal-page{max-width:1300px}
        .cal-head{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start}
        .chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
        .cal-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .cal-grid-wrap{overflow:auto;max-height:calc(100vh - 290px);min-height:320px}
        .cal-grid{display:grid;position:relative}
        .cal-corner,.cal-dh{position:sticky;top:0;z-index:3;background:#fff;border-bottom:1px solid var(--line)}
        .cal-dh{border:0;border-bottom:1px solid var(--line);border-left:1px solid var(--line);font:inherit;font-weight:600;padding:8px 6px;cursor:pointer;display:grid;gap:2px;text-align:center;color:var(--ink)}
        .cal-dh small{font-weight:500;color:var(--muted);font-size:11px}
        .cal-dh.today{color:var(--accent)}
        .cal-hours{position:relative;border-right:1px solid var(--line)}
        .cal-hours span{position:absolute;right:6px;transform:translateY(-6px);font-size:11px;color:var(--muted)}
        .cal-hours span:first-child{transform:none}
        .cal-col{position:relative;border-left:1px solid var(--line);cursor:pointer;background-image:repeating-linear-gradient(to bottom,var(--line-2) 0 1px,transparent 1px ${HOUR_PX}px)}
        .cal-col.today{box-shadow:inset 0 0 0 1px var(--accent-soft)}
        .cal-ev{position:absolute;left:4px;right:4px;border-radius:4px;padding:3px 7px;font-size:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:inset 0 0 0 1px rgb(0 0 0 / .06)}
        .cal-ev.break{left:4px;right:4px;flex-direction:row;gap:8px;align-items:center;padding:1px 7px;z-index:1}
        .cal-ev.absence{z-index:2}
        .cal-ev b{font-weight:600}
        .cal-now{position:absolute;left:0;right:0;height:2px;background:var(--now);z-index:4;pointer-events:none}
        .cal-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
        .month{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));overflow:hidden}
        .month-h{padding:8px;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;border-bottom:1px solid var(--line);text-align:center}
        .month-cell{min-height:92px;border:0;border-right:1px solid var(--line-2);border-bottom:1px solid var(--line-2);background:#fff;font:inherit;text-align:left;padding:6px 8px;display:flex;flex-direction:column;gap:4px;align-items:flex-start;cursor:pointer;color:var(--ink)}
        .month-cell:hover{outline:2px solid var(--accent-soft);outline-offset:-2px}
        .month-cell.out{opacity:.45}
        .month-cell.today .month-d{background:var(--accent);color:#fff}
        .month-d{font-weight:600;font-size:13px;border-radius:99px;min-width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center}
        .opts{display:grid;gap:6px;max-height:260px;overflow:auto}
        .opt{display:flex;justify-content:space-between;gap:10px;padding:9px 11px;border:1px solid var(--line);border-radius:8px;cursor:pointer;background:#fff;font:inherit;text-align:left}
        .opt[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft)}
        @media (max-width:700px){.month-cell{min-height:64px;padding:4px}.month-cell b{font-size:11px}}
      ` }} />
    </div>
  );
}

function NowLine({ tz, h0, h1 }: { tz: string; h0: number; h1: number }) {
  const [now] = useState(() => Date.now());
  const t = fmtTime(now, tz);
  const h = Number(t.slice(0, 2)) + Number(t.slice(3)) / 60;
  if (h < h0 || h > h1) return null;
  return <div className="cal-now" style={{ top: (h - h0) * HOUR_PX }} suppressHydrationWarning />;
}

function ChangeDialog({ day, today, onClose }: { day: string; today: string; onClose: () => void }) {
  const [d, setD] = useState(day);
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  return (
    <div className="dlg-back" onClick={onClose}>
      <form
        className="dlg"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createChange(d, note), onClose);
        }}
        aria-label="Richiesta di modifica"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Richiesta di modifica</h2>
          <button type="button" className="btn btn-icon btn-ghost btn-sm" aria-label="Chiudi" onClick={onClose}><IcClose /></button>
        </div>
        <label className="field"><span>Giorno</span><input id="ch-day" className="input" type="date" min={today} value={d} onChange={(e) => setD(e.target.value)} required /></label>
        <label className="field">
          <span>Cosa vorresti cambiare?</span>
          <textarea id="ch-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Es. posso entrare alle 10 invece che alle 9?" required />
        </label>
        <p className="small muted" style={{ margin: 0 }}>La richiesta arriva ai manager, che ti rispondono e sistemano il turno.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Annulla</button>
          <button className="btn btn-primary" disabled={busy || !note.trim()}>Invia</button>
        </div>
      </form>
    </div>
  );
}
