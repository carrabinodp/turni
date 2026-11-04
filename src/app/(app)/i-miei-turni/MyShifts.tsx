'use client';
import Link from 'next/link';
import { useState } from 'react';
import { addDays, fmtDay, fmtTime, minutesLabel } from '@/lib/time';
import { useAction } from '@/components/ui';
import { IcLeft, IcRight, IcClose } from '@/components/icons';
import { createGive, createSwap } from '../richieste/actions';

export interface DayCard {
  day: string;
  text: string | null;
  absence: string | null;
  blocks: { activity_id: string; s: number; e: number; color: string; name: string }[];
  hasShift: boolean;
  pending: boolean;
  canAct: boolean;
}
export interface Colleague {
  id: string;
  name: string;
  shifts: { day: string; text: string }[];
  busyDays: string[];
}

export default function MyShifts(props: {
  week: string;
  today: string;
  tz: string;
  days: DayCard[];
  weekPublished: boolean;
  colleagues: Colleague[];
  totalMinutes: number;
}) {
  const { week, today, tz, days } = props;
  const [dialog, setDialog] = useState<{ mode: 'swap' | 'give'; day: string } | null>(null);

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <h1>I miei turni</h1>
        <div className="row" style={{ alignItems: 'center' }}>
          <Link className="btn btn-icon btn-sm" aria-label="Settimana precedente" href={`/i-miei-turni?w=${addDays(week, -7)}`}><IcLeft /></Link>
          <span style={{ fontWeight: 500, minWidth: 150, textAlign: 'center' }}>{fmtDay(week, 'd MMM')} – {fmtDay(addDays(week, 6), 'd MMM')}</span>
          <Link className="btn btn-icon btn-sm" aria-label="Settimana successiva" href={`/i-miei-turni?w=${addDays(week, 7)}`}><IcRight /></Link>
        </div>
      </div>

      {!props.weekPublished ? (
        <div className="alert alert-info">I turni di questa settimana non sono ancora stati pubblicati.</div>
      ) : (
        <div className="muted">Questa settimana: <b className="tabnum" style={{ color: 'var(--ink)' }}>{minutesLabel(props.totalMinutes)}</b> di attività</div>
      )}

      <div className="card">
        {days.map((d) => {
          const first = d.blocks.length ? Math.min(...d.blocks.map((b) => b.s)) : 0;
          const last = d.blocks.length ? Math.max(...d.blocks.map((b) => b.e)) : 0;
          const span = Math.max(1, last - first);
          return (
            <div key={d.day} className={`day${d.day === today ? ' today' : ''}`}>
              <div className="day-h">
                <div>
                  <b style={{ textTransform: 'capitalize' }}>{fmtDay(d.day, 'EEEE d MMM')}</b>
                  {d.day === today && <span className="pill pill-info" style={{ marginLeft: 8 }}>Oggi</span>}
                </div>
                <div className="tabnum" style={{ fontWeight: 600 }}>
                  {d.absence && !d.hasShift ? <span className="pill">{d.absence}</span> : d.text ?? <span className="muted" style={{ fontWeight: 400 }}>Riposo</span>}
                </div>
              </div>
              {d.blocks.length > 0 && d.hasShift && (
                <div className="mini" aria-label="Attività del giorno">
                  {[...d.blocks].sort((a, b) => b.e - b.s - (a.e - a.s)).map((b, i) => (
                    <span
                      key={i}
                      title={`${b.name} ${fmtTime(b.s, tz)}–${fmtTime(b.e, tz)}`}
                      style={{ left: `${((b.s - first) / span) * 100}%`, width: `${((b.e - b.s) / span) * 100}%`, background: b.color }}
                    />
                  ))}
                </div>
              )}
              {d.hasShift && d.blocks.length > 1 && (
                <div className="small muted">
                  {[...d.blocks].sort((a, b) => a.s - b.s).map((b) => `${b.name} ${fmtTime(b.s, tz)}–${fmtTime(b.e, tz)}`).join(' · ')}
                </div>
              )}
              {d.hasShift && d.canAct && (
                <div className="row">
                  {d.pending ? (
                    <span className="pill pill-warn">Richiesta in corso</span>
                  ) : (
                    <>
                      <button className="btn btn-sm" onClick={() => setDialog({ mode: 'swap', day: d.day })}>Scambia</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setDialog({ mode: 'give', day: d.day })}>Cedi</button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {dialog && (
        <SwapDialog
          mode={dialog.mode}
          day={dialog.day}
          myText={days.find((d) => d.day === dialog.day)?.text ?? ''}
          colleagues={props.colleagues}
          onClose={() => setDialog(null)}
        />
      )}

      <style>{`
        .day{padding:14px 16px;border-bottom:1px solid var(--line-2);display:grid;gap:8px}
        .day:last-child{border-bottom:0}
        .day.today{background:#fbfcff}
        .day-h{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
        .mini{position:relative;height:16px;border-radius:4px;background:var(--hover);overflow:hidden}
        .mini span{position:absolute;top:0;bottom:0}
        .dlg-back{position:fixed;inset:0;background:rgb(16 24 40 / .35);z-index:60;display:grid;place-items:center;padding:16px}
        .dlg{background:#fff;border-radius:12px;width:100%;max-width:480px;max-height:calc(100% - 32px);overflow:auto;padding:18px;display:grid;gap:14px}
        .opts{display:grid;gap:6px;max-height:260px;overflow:auto}
        .opt{display:flex;justify-content:space-between;gap:10px;padding:9px 11px;border:1px solid var(--line);border-radius:8px;cursor:pointer;background:#fff;font:inherit;text-align:left}
        .opt[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft)}
      `}</style>
    </div>
  );
}

function SwapDialog(props: {
  mode: 'swap' | 'give';
  day: string;
  myText: string;
  colleagues: Colleague[];
  onClose: () => void;
}) {
  const { mode, day } = props;
  const [target, setTarget] = useState<string>('');
  const [dayB, setDayB] = useState<string>('');
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  const col = props.colleagues.find((c) => c.id === target);
  const options = col?.shifts ?? [];
  const freeForGive = props.colleagues.filter((c) => !c.busyDays.includes(day));

  async function submit() {
    const r = await run(
      () => (mode === 'swap' ? createSwap(day, target, dayB, note) : createGive(day, target || null, note)),
      props.onClose,
    );
    return r;
  }

  return (
    <div className="dlg-back" onClick={props.onClose}>
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 id="dlg-title">{mode === 'swap' ? 'Scambia turno' : 'Cedi turno'}</h2>
          <button className="btn btn-icon btn-ghost btn-sm" aria-label="Chiudi" onClick={props.onClose}><IcClose /></button>
        </div>
        <div className="alert alert-info">Il tuo turno: <b style={{ textTransform: 'capitalize' }}>{fmtDay(day, 'EEEE d MMM')}</b>, {props.myText}</div>

        {mode === 'swap' ? (
          <>
            <label className="field">
              <span>Con chi</span>
              <select id="sw-target" className="select" value={target} onChange={(e) => { setTarget(e.target.value); setDayB(''); }}>
                <option value="">Scegli un collega</option>
                {props.colleagues.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {col && (
              <div className="field">
                <span>In cambio del suo turno</span>
                {options.length ? (
                  <div className="opts">
                    {options.map((s) => (
                      <button key={s.day} className="opt" aria-pressed={dayB === s.day} onClick={() => setDayB(s.day)}>
                        <span style={{ textTransform: 'capitalize' }}>{fmtDay(s.day, 'EEEE d MMM')}</span>
                        <b className="tabnum">{s.text}</b>
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="muted small">{col.name} non ha turni pubblicati nei prossimi giorni.</span>
                )}
              </div>
            )}
          </>
        ) : (
          <label className="field">
            <span>A chi</span>
            <select id="gv-target" className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Chiunque: metti in bacheca</option>
              {freeForGive.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="small muted">In bacheca lo vedono tutti; il primo che lo prende passa all’approvazione del manager.</span>
          </label>
        )}

        <label className="field">
          <span>Messaggio (facoltativo)</span>
          <input id="sw-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Es. ho una visita al mattino" />
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          Il sistema controlla subito il riposo minimo tra i turni. Dopo l’ok del collega serve l’approvazione di un manager.
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={props.onClose}>Annulla</button>
          <button className="btn btn-primary" disabled={busy || (mode === 'swap' && (!target || !dayB))} onClick={submit}>
            {mode === 'swap' ? 'Invia richiesta' : target ? 'Invia richiesta' : 'Metti in bacheca'}
          </button>
        </div>
      </div>
    </div>
  );
}
