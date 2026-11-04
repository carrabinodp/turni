'use client';
import { useState } from 'react';
import { useAction } from '@/components/ui';
import { KIND_LABEL, type Activity, type ActivityKind, type Settings } from '@/lib/types';
import { saveActivity, saveSettings, type ActivityInput } from './actions';

const toInput = (a: Activity): ActivityInput => ({
  id: a.id, name: a.name, color: a.color, kind: a.kind, aliases: a.aliases.join(', '),
  requestable: a.requestable, archived: a.archived, sort_order: a.sort_order,
});

export default function ConfigForms({ activities, settings, isAdmin }: { activities: Activity[]; settings: Settings; isAdmin: boolean }) {
  const maxOrder = Math.max(0, ...activities.map((a) => a.sort_order));
  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Attività</h2>
          <span className="small muted">I nomi alternativi servono all’import Excel per riconoscere le etichette (es. “Tel”, “Phone”)</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Colore</th><th>Nome</th><th>Tipo</th><th>Nomi alternativi</th><th>Richiedibile</th><th>Ordine</th><th>Archiviata</th><th /></tr></thead>
            <tbody>
              {activities.map((a) => <ActivityRow key={a.id} initial={toInput(a)} />)}
              <ActivityRow key={`new-${activities.length}`} initial={{ name: '', color: '#5d7686', kind: 'work', aliases: '', requestable: false, archived: false, sort_order: maxOrder + 10 }} />
            </tbody>
          </table>
        </div>
      </section>
      <SettingsForm settings={settings} isAdmin={isAdmin} />
    </>
  );
}

function ActivityRow({ initial }: { initial: ActivityInput }) {
  const [a, setA] = useState(initial);
  const { run, busy } = useAction();
  const dirty = JSON.stringify(a) !== JSON.stringify(initial);
  const isNew = !initial.id;
  const k = initial.id ?? 'new';
  return (
    <tr style={a.archived ? { opacity: 0.55 } : undefined}>
      <td><input id={`a-color-${k}`} type="color" value={a.color} onChange={(e) => setA({ ...a, color: e.target.value })} style={{ width: 36, height: 30, border: 0, background: 'none', padding: 0 }} aria-label="Colore" /></td>
      <td><input id={`a-name-${k}`} className="input" value={a.name} placeholder={isNew ? 'Nuova attività…' : ''} onChange={(e) => setA({ ...a, name: e.target.value })} style={{ minWidth: 130 }} /></td>
      <td>
        <select id={`a-kind-${k}`} className="select" value={a.kind} onChange={(e) => setA({ ...a, kind: e.target.value as ActivityKind })}>
          {(Object.keys(KIND_LABEL) as ActivityKind[]).map((x) => <option key={x} value={x}>{KIND_LABEL[x]}</option>)}
        </select>
      </td>
      <td><input id={`a-alias-${k}`} className="input" value={a.aliases} placeholder="tel, phone" onChange={(e) => setA({ ...a, aliases: e.target.value })} style={{ minWidth: 150 }} /></td>
      <td style={{ textAlign: 'center' }}>
        <input id={`a-req-${k}`} type="checkbox" disabled={a.kind !== 'absence'} checked={a.kind === 'absence' && a.requestable} onChange={(e) => setA({ ...a, requestable: e.target.checked })} title="I dipendenti possono chiederla in Ferie e permessi" />
      </td>
      <td><input id={`a-order-${k}`} className="input" type="number" value={a.sort_order} onChange={(e) => setA({ ...a, sort_order: Number(e.target.value) })} style={{ width: 70 }} /></td>
      <td style={{ textAlign: 'center' }}>{!isNew && <input id={`a-arch-${k}`} type="checkbox" checked={a.archived} onChange={(e) => setA({ ...a, archived: e.target.checked })} />}</td>
      <td>
        <button className={`btn btn-sm${dirty ? ' btn-primary' : ''}`} disabled={!dirty || busy || !a.name.trim()} onClick={() => run(() => saveActivity(a), () => isNew && setA(initial))}>
          {isNew ? 'Aggiungi' : 'Salva'}
        </button>
      </td>
    </tr>
  );
}

function SettingsForm({ settings, isAdmin }: { settings: Settings; isAdmin: boolean }) {
  const [s, setS] = useState({
    org_name: settings.org_name,
    allowed_domains: settings.allowed_domains.join(', '),
    admin_emails: settings.admin_emails.join(', '),
    min_rest_hours: Number(settings.min_rest_hours),
    split_gap_hours: Number(settings.split_gap_hours),
    snap_minutes: settings.snap_minutes,
    timezone: settings.timezone,
  });
  const { run, busy } = useAction();
  return (
    <section className="card">
      <div className="card-head"><h2>Impostazioni</h2>{!isAdmin && <span className="small muted">Solo l’amministratore può modificarle</span>}</div>
      <form className="card-body" onSubmit={(e) => { e.preventDefault(); run(() => saveSettings(s)); }}>
        <fieldset disabled={!isAdmin || busy} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          <div className="row">
            <label className="field" style={{ flex: '1 1 200px' }}><span>Nome mostrato in alto</span><input id="s-org" className="input" value={s.org_name} onChange={(e) => setS({ ...s, org_name: e.target.value })} /></label>
            <label className="field" style={{ flex: '1 1 260px' }}><span>Domini email autorizzati</span><input id="s-dom" className="input" value={s.allowed_domains} placeholder="azienda.it" onChange={(e) => setS({ ...s, allowed_domains: e.target.value })} /></label>
            <label className="field" style={{ flex: '1 1 260px' }}><span>Email amministratori</span><input id="s-adm" className="input" value={s.admin_emails} onChange={(e) => setS({ ...s, admin_emails: e.target.value })} /></label>
          </div>
          <div className="row">
            <label className="field"><span>Riposo minimo tra turni (ore)</span><input id="s-rest" className="input" type="number" step="0.5" min={0} max={24} value={s.min_rest_hours} onChange={(e) => setS({ ...s, min_rest_hours: Number(e.target.value) })} style={{ width: 120 }} /></label>
            <label className="field"><span>Pausa oltre cui il turno è “spezzato” (ore)</span><input id="s-gap" className="input" type="number" step="0.5" min={0} max={12} value={s.split_gap_hours} onChange={(e) => setS({ ...s, split_gap_hours: Number(e.target.value) })} style={{ width: 120 }} /></label>
            <label className="field"><span>Aggancio in timeline</span>
              <select id="s-snap" className="select" value={s.snap_minutes} onChange={(e) => setS({ ...s, snap_minutes: Number(e.target.value) })}>
                {[1, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
            <label className="field"><span>Fuso orario</span><input id="s-tz" className="input" value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} style={{ width: 170 }} /></label>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Il riposo minimo (11 ore per il D.Lgs. 66/2003) blocca gli scambi che lo violano. Due blocchi separati da meno della pausa indicata contano come un unico turno spezzato.
          </p>
          {isAdmin && <div><button className="btn btn-primary">Salva impostazioni</button></div>}
        </fieldset>
      </form>
    </section>
  );
}
