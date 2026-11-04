'use client';
import { useState } from 'react';
import type { Activity, Person } from '@/lib/types';
import { fmtDay } from '@/lib/time';
import { IcClose } from '@/components/icons';

export interface AbsenceInput {
  person_id: string;
  from: string;
  to: string;
  activity_id: string;
  time_from: string | null;
  time_to: string | null;
  note: string;
}

export interface SwapInput {
  person_a: string;
  day_a: string;
  person_b: string;
  day_b: string;
  note: string;
  force: boolean;
}

type Res = { ok: true; message?: string } | { ok: false; error: string };

function Shell(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="dlg-back" onClick={props.onClose} onPointerDown={(e) => e.stopPropagation()}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>{props.title}</h2>
          <button className="btn btn-icon btn-ghost btn-sm" aria-label="Chiudi" onClick={props.onClose}><IcClose /></button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function AbsenceDialog(props: {
  person: Pick<Person, 'id' | 'full_name'>;
  day: string;
  absences: Activity[];
  onClose: () => void;
  onSubmit: (p: AbsenceInput) => Promise<Res>;
}) {
  const [act, setAct] = useState(props.absences[0]?.id ?? '');
  const [from, setFrom] = useState(props.day);
  const [to, setTo] = useState(props.day);
  const [hours, setHours] = useState(false);
  const [tFrom, setTFrom] = useState('09:00');
  const [tTo, setTTo] = useState('11:00');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await props.onSubmit({
      person_id: props.person.id, from, to: hours ? from : to, activity_id: act,
      time_from: hours ? tFrom : null, time_to: hours ? tTo : null, note,
    });
    setBusy(false);
    if (!r.ok) setErr(r.error);
  }

  return (
    <Shell title={`Assenza di ${props.person.full_name}`} onClose={props.onClose}>
      {!props.absences.length ? (
        <div className="alert alert-warn">Non ci sono tipi di assenza: creali in Configura → Attività (tipo “Assenza”).</div>
      ) : (
        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <label className="field">
            <span>Tipo</span>
            <select id="abs-act" className="select" value={act} onChange={(e) => setAct(e.target.value)}>
              {props.absences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="check"><input id="abs-hours" type="checkbox" checked={hours} onChange={(e) => setHours(e.target.checked)} /> Solo alcune ore (permesso)</label>
          <div className="row">
            <label className="field"><span>{hours ? 'Giorno' : 'Dal'}</span><input id="abs-from" className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} required /></label>
            {hours ? (
              <>
                <label className="field"><span>Dalle</span><input id="abs-tfrom" className="input" type="time" value={tFrom} onChange={(e) => setTFrom(e.target.value)} required /></label>
                <label className="field"><span>Alle</span><input id="abs-tto" className="input" type="time" value={tTo} onChange={(e) => setTTo(e.target.value)} required /></label>
              </>
            ) : (
              <label className="field"><span>Al</span><input id="abs-to" className="input" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} required /></label>
            )}
          </div>
          <label className="field"><span>Nota (facoltativa)</span><input id="abs-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <p className="small muted" style={{ margin: 0 }}>
            {hours
              ? 'Il permesso viene inserito sopra il turno, che resta com’è.'
              : 'Nei giorni scelti il turno viene sostituito dall’assenza, nella stessa fascia oraria.'}{' '}
            {props.person.full_name.split(' ')[0]} riceve una notifica.
          </p>
          {err && <div className="alert alert-bad">{err}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={props.onClose}>Annulla</button>
            <button className="btn btn-primary" disabled={busy || !act}>{busy ? 'Inserimento…' : 'Inserisci'}</button>
          </div>
        </form>
      )}
    </Shell>
  );
}

export function SwapDialog(props: {
  person: Pick<Person, 'id' | 'full_name'>;
  day: string;
  people: Pick<Person, 'id' | 'full_name'>[];
  /** orario del turno di una persona in un giorno, se noto */
  describe: (personId: string, day: string) => string | null;
  onClose: () => void;
  onSubmit: (p: SwapInput) => Promise<Res>;
}) {
  const [target, setTarget] = useState('');
  const [dayB, setDayB] = useState(props.day);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mine = props.describe(props.person.id, props.day);
  const theirs = target ? props.describe(target, dayB) : null;
  const canForce = !!err && /riposo/i.test(err);

  async function submit(force: boolean) {
    setBusy(true);
    setErr(null);
    const r = await props.onSubmit({ person_a: props.person.id, day_a: props.day, person_b: target, day_b: dayB, note, force });
    setBusy(false);
    if (!r.ok) setErr(r.error);
  }

  const others = props.people.filter((p) => p.id !== props.person.id);
  return (
    <Shell title="Scambia o sposta il turno" onClose={props.onClose}>
      <div className="alert alert-info">
        <b>{props.person.full_name}</b>, {fmtDay(props.day, 'EEEE d MMM')}{mine ? `: ${mine}` : ''}
      </div>
      <label className="field">
        <span>Con chi</span>
        <select id="sw-b" className="select" value={target} onChange={(e) => { setTarget(e.target.value); setErr(null); }}>
          <option value="">Scegli un collega</option>
          {others.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Giorno del collega</span>
        <input id="sw-dayb" className="input" type="date" value={dayB} onChange={(e) => { setDayB(e.target.value); setErr(null); }} />
        {target && (
          <span className="small muted">
            {theirs === 'nessun turno'
              ? dayB === props.day
                ? 'Il collega non lavora quel giorno: il turno viene spostato a lui.'
                : 'Il collega non lavora quel giorno: per spostargli il turno scegli lo stesso giorno.'
              : theirs
                ? `Turno del collega: ${theirs}. I due turni vengono scambiati.`
                : 'Il turno del collega verrà controllato alla conferma.'}
          </span>
        )}
      </label>
      <label className="field"><span>Nota (facoltativa)</span><input id="sw-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <p className="small muted" style={{ margin: 0 }}>Viene applicato subito, senza passare dalle richieste. Le due persone ricevono una notifica.</p>
      {err && <div className="alert alert-bad">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={props.onClose}>Annulla</button>
        {canForce && (
          <button className="btn btn-danger" disabled={busy} onClick={() => submit(true)} title="Applica anche se non rispetta il riposo minimo">
            Applica comunque
          </button>
        )}
        <button className="btn btn-primary" disabled={busy || !target} onClick={() => submit(false)}>{busy ? 'Applico…' : 'Conferma'}</button>
      </div>
    </Shell>
  );
}
