'use client';
import { useState } from 'react';
import { useAction } from '@/components/ui';
import { saveProfiles } from './actions';
import type { GPerson } from './GeneratorView';

export default function PeopleForm({ people, suggest }: { people: GPerson[]; suggest: Record<string, { shiftHours: number; daysPerWeek: number; samples: number }> }) {
  const [rows, setRows] = useState(people.map((p) => ({ ...p })));
  const { run, busy } = useAction();
  const set = (id: string, patch: Partial<GPerson>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const fillAll = () =>
    setRows(rows.map((r) => (suggest[r.id] ? { ...r, shift_hours: r.shift_hours ?? suggest[r.id]!.shiftHours, days_per_week: r.days_per_week ?? suggest[r.id]!.daysPerWeek } : r)));
  return (
    <section className="card">
      <div className="card-head">
        <b>Persone nel generatore</b>
        <div className="row">
          <button className="btn btn-sm" onClick={fillAll}>Completa i vuoti dallo storico</button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(() => saveProfiles(rows.map((r) => ({ id: r.id, shift_hours: r.shift_hours, days_per_week: r.days_per_week, gen_exclude: r.gen_exclude, can_weekend: r.can_weekend }))))}>Salva</button>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0, padding: '10px 16px 0' }}>
        Durata del turno con il pranzo compreso: 9 = 8 ore di lavoro + 1 di pranzo, 6 = part time da 6 ore. Lo storico è calcolato sulle ultime 9 settimane di turni.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Persona</th><th>Durata turno (ore)</th><th>Giorni a settimana</th><th>Dallo storico</th><th>Weekend</th><th>Escludi</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const s = suggest[r.id];
              return (
                <tr key={r.id} style={r.gen_exclude ? { opacity: 0.5 } : undefined}>
                  <td><b>{r.name}</b>{r.role !== 'agent' && <span className="small muted"> · {r.role === 'team_lead' ? 'team lead' : r.role}</span>}</td>
                  <td><input className="input" type="number" step={0.5} min={1} max={13} value={r.shift_hours ?? ''} placeholder={s ? String(s.shiftHours) : '9'} onChange={(e) => set(r.id, { shift_hours: e.target.value ? Number(e.target.value) : null })} style={{ width: 80 }} /></td>
                  <td><input className="input" type="number" min={1} max={7} value={r.days_per_week ?? ''} placeholder={s ? String(s.daysPerWeek) : '5'} onChange={(e) => set(r.id, { days_per_week: e.target.value ? Number(e.target.value) : null })} style={{ width: 70 }} /></td>
                  <td className="small muted">{s ? `${s.shiftHours} h × ${s.daysPerWeek} giorni (${s.samples} turni)` : 'nessun turno recente'}</td>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" checked={r.can_weekend} onChange={(e) => set(r.id, { can_weekend: e.target.checked })} aria-label="Può lavorare nel weekend" /></td>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" checked={r.gen_exclude} onChange={(e) => set(r.id, { gen_exclude: e.target.checked })} aria-label="Escludi dal generatore" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ margin: 0, padding: '8px 16px 12px' }}>Escludi chi non va in turno (maternità, responsabili che non fanno telefono). Le ferie lunghe non serve escluderle: il generatore le vede da sole.</p>
    </section>
  );
}
