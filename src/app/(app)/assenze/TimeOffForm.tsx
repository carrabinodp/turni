'use client';
import { useState } from 'react';
import { useAction } from '@/components/ui';
import type { Activity } from '@/lib/types';
import { createTimeOff } from '../richieste/actions';

export default function TimeOffForm({ activities, today }: { activities: Activity[]; today: string }) {
  const [act, setAct] = useState(activities[0]?.id ?? '');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [hours, setHours] = useState(false);
  const [tFrom, setTFrom] = useState('09:00');
  const [tTo, setTTo] = useState('13:00');
  const [note, setNote] = useState('');
  const { run, busy } = useAction();

  if (!activities.length) return <div className="muted">Nessun tipo di assenza richiedibile: un manager può abilitarli in Configura.</div>;

  return (
    <form
      style={{ display: 'grid', gap: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createTimeOff(from, hours ? from : to, hours ? tFrom : null, hours ? tTo : null, act, note), () => setNote(''));
      }}
    >
      <label className="field">
        <span>Tipo</span>
        <select id="to-act" className="select" value={act} onChange={(e) => setAct(e.target.value)}>
          {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label className="check"><input id="to-hours" type="checkbox" checked={hours} onChange={(e) => setHours(e.target.checked)} /> Solo alcune ore</label>
      <div className="row">
        <label className="field"><span>{hours ? 'Giorno' : 'Dal'}</span><input id="to-from" className="input" type="date" min={today} value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} required /></label>
        {hours ? (
          <>
            <label className="field"><span>Dalle</span><input id="to-tfrom" className="input" type="time" value={tFrom} onChange={(e) => setTFrom(e.target.value)} required /></label>
            <label className="field"><span>Alle</span><input id="to-tto" className="input" type="time" value={tTo} onChange={(e) => setTTo(e.target.value)} required /></label>
          </>
        ) : (
          <label className="field"><span>Al</span><input id="to-to" className="input" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} required /></label>
        )}
      </div>
      <label className="field"><span>Nota (facoltativa)</span><input id="to-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div><button className="btn btn-primary" disabled={busy}>Invia richiesta</button></div>
      <p className="small muted" style={{ margin: 0 }}>Quando un manager approva, i turni di quei giorni vengono sostituiti dall’assenza.</p>
    </form>
  );
}
