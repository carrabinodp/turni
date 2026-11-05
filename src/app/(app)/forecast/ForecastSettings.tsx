'use client';
import { useState } from 'react';
import { useAction } from '@/components/ui';
import { requiredAgents, type ForecastPolicy } from '@/lib/forecast';
import { saveForecastSettings } from './actions';

export default function ForecastSettings({ policy, activities, phoneIds }: { policy: ForecastPolicy; activities: { id: string; name: string; color: string }[]; phoneIds: string[] }) {
  const [p, setP] = useState<ForecastPolicy>(policy);
  const [ids, setIds] = useState<Set<string>>(new Set(phoneIds));
  const { run, busy } = useAction();
  const num = (k: keyof ForecastPolicy) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setP({ ...p, [k]: Number(e.target.value) });
  // esempio concreto per capire l'effetto delle impostazioni
  const ex = requiredAgents(40, 180, p);

  return (
    <section className="card">
      <div className="card-head"><b>Impostazioni del forecast</b></div>
      <div className="card-body">
        <div className="row">
          <label className="field">
            <span>Obiettivo di servizio (%)</span>
            <input className="input" type="number" min={50} max={99} value={p.sl_target} onChange={num('sl_target')} style={{ width: 120 }} />
          </label>
          <label className="field">
            <span>Risposta entro</span>
            <select className="select" value={p.sl_seconds} onChange={num('sl_seconds')}>
              {[10, 20, 30, 60, 120].map((s) => <option key={s} value={s}>{s} secondi</option>)}
            </select>
          </label>
          <label className="field">
            <span>Occupazione massima (%)</span>
            <input className="input" type="number" min={50} max={100} value={p.max_occupancy} onChange={num('max_occupancy')} style={{ width: 120 }} />
          </label>
          <label className="field">
            <span>Settimane di storico</span>
            <input className="input" type="number" min={3} max={26} value={p.history_weeks} onChange={num('history_weeks')} style={{ width: 120 }} />
          </label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Esempio: con 40 chiamate in mezz’ora da 3 minuti servono <b>{ex} persone al telefono</b> per rispondere al {p.sl_target}% entro {p.sl_seconds} secondi senza tenerle occupate più del {p.max_occupancy}% del tempo.
        </p>

        <div className="field">
          <span>Attività in cui si risponde al telefono</span>
          <div className="row" style={{ gap: '6px 16px' }}>
            {activities.map((a) => (
              <label key={a.id} className="check">
                <input
                  type="checkbox"
                  checked={ids.has(a.id)}
                  onChange={(e) => {
                    const n = new Set(ids);
                    if (e.target.checked) n.add(a.id);
                    else n.delete(a.id);
                    setIds(n);
                  }}
                />
                <i style={{ width: 10, height: 10, borderRadius: 2, background: a.color, display: 'inline-block' }} /> {a.name}
              </label>
            ))}
          </div>
          <small className="muted">Le persone pianificate su queste attività contano come “al telefono”; pause, assenze e altre attività no.</small>
        </div>

        <div>
          <button className="btn btn-primary" disabled={busy} onClick={() => run(() => saveForecastSettings(p, Array.from(ids)))}>Salva</button>
        </div>
      </div>
    </section>
  );
}
