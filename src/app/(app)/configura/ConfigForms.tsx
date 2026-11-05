'use client';
import { useState } from 'react';
import { useAction } from '@/components/ui';
import { KIND_LABEL, type Activity, type ActivityKind, type DayType, type Settings } from '@/lib/types';
import { policyLabel, withDefaults } from '@/lib/breaks';
import { saveActivity, saveBreakPolicy, saveDayType, saveSettings, type ActivityInput, type BreakPolicyInput, type DayTypeInput } from './actions';

const toInput = (a: Activity): ActivityInput => ({
  id: a.id, name: a.name, color: a.color, kind: a.kind, aliases: a.aliases.join(', '),
  requestable: a.requestable, archived: a.archived, sort_order: a.sort_order,
});

export default function ConfigForms({ activities, dayTypes, settings, isAdmin }: { activities: Activity[]; dayTypes: DayType[]; settings: Settings; isAdmin: boolean }) {
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
      <section className="card">
        <div className="card-head">
          <h2>Tipi di giornata</h2>
          <span className="small muted">Colorano lo sfondo della giornata (es. ufficio o smart working). Si assegnano col clic destro in timeline o dai colori dell’Excel.</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Colore</th><th>Nome</th><th>Nomi alternativi (per l’import)</th><th>Ordine</th><th>Archiviato</th><th /></tr></thead>
            <tbody>
              {dayTypes.map((d) => <DayTypeRow key={d.id} initial={{ id: d.id, name: d.name, color: d.color, aliases: d.aliases.join(', '), archived: d.archived, sort_order: d.sort_order }} />)}
              <DayTypeRow key={`new-${dayTypes.length}`} initial={{ name: '', color: '#ffe0b2', aliases: '', archived: false, sort_order: Math.max(0, ...dayTypes.map((d) => d.sort_order)) + 10 }} />
            </tbody>
          </table>
        </div>
      </section>
      <BreakRulesForm settings={settings} activities={activities} isAdmin={isAdmin} />
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

function DayTypeRow({ initial }: { initial: DayTypeInput }) {
  const [d, setD] = useState(initial);
  const { run, busy } = useAction();
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const isNew = !initial.id;
  const k = initial.id ?? 'new';
  return (
    <tr style={d.archived ? { opacity: 0.55 } : undefined}>
      <td><input id={`d-color-${k}`} type="color" value={d.color} onChange={(e) => setD({ ...d, color: e.target.value })} style={{ width: 36, height: 30, border: 0, background: 'none', padding: 0 }} aria-label="Colore" /></td>
      <td><input id={`d-name-${k}`} className="input" value={d.name} placeholder={isNew ? 'Nuovo tipo…' : ''} onChange={(e) => setD({ ...d, name: e.target.value })} style={{ minWidth: 140 }} /></td>
      <td><input id={`d-alias-${k}`} className="input" value={d.aliases} placeholder="smart, sw" onChange={(e) => setD({ ...d, aliases: e.target.value })} style={{ minWidth: 150 }} /></td>
      <td><input id={`d-order-${k}`} className="input" type="number" value={d.sort_order} onChange={(e) => setD({ ...d, sort_order: Number(e.target.value) })} style={{ width: 70 }} /></td>
      <td style={{ textAlign: 'center' }}>{!isNew && <input id={`d-arch-${k}`} type="checkbox" checked={d.archived} onChange={(e) => setD({ ...d, archived: e.target.checked })} />}</td>
      <td>
        <button className={`btn btn-sm${dirty ? ' btn-primary' : ''}`} disabled={!dirty || busy || !d.name.trim()} onClick={() => run(() => saveDayType(d), () => isNew && setD(initial))}>
          {isNew ? 'Aggiungi' : 'Salva'}
        </button>
      </td>
    </tr>
  );
}

function BreakRulesForm({ settings, activities, isAdmin }: { settings: Settings; activities: Activity[]; isAdmin: boolean }) {
  const [p, setP] = useState<BreakPolicyInput>(withDefaults(settings.break_policy));
  const breaks = activities.filter((a) => a.kind === 'break' && !a.archived);
  const [act, setAct] = useState(settings.break_activity_id ?? breaks[0]?.id ?? '');
  const [lunch, setLunch] = useState(settings.lunch_activity_id ?? breaks.find((a) => /pranzo/i.test(a.name))?.id ?? '');
  const { run, busy } = useAction();
  const num = (k: keyof BreakPolicyInput, step = 1, w = 74) => (
    <input id={`bp-${k}`} className="input" type="number" min={0} step={step} value={p[k]} style={{ width: w }} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} />
  );
  return (
    <section className="card">
      <div className="card-head">
        <h2>Pause automatiche</h2>
        <span className="small muted">{policyLabel(withDefaults(p))}</span>
      </div>
      <form className="card-body" onSubmit={(e) => { e.preventDefault(); run(() => saveBreakPolicy(p, act || null, lunch || null)); }}>
        <fieldset disabled={!isAdmin || busy} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <b style={{ width: 120 }}>Pausa breve</b>
            {num('break_minutes')}<span>min ogni</span>{num('interval_minutes', 5)}<span>min di lavoro continuativo</span>
          </div>
          <div className="row" style={{ alignItems: 'center' }}>
            <b style={{ width: 120 }}>Sfalsamento</b>
            {num('stagger_minutes')}<span>min tra un operatore e l’altro, su</span>{num('stagger_slots')}<span>posizioni (poi si ricomincia)</span>
          </div>
          <div className="row" style={{ alignItems: 'center' }}>
            <b style={{ width: 120 }}>Pranzo</b>
            {num('lunch_minutes', 5)}<span>min dopo</span>{num('lunch_after_hours', 0.5)}<span>ore dall’inizio, nei turni di almeno</span>{num('lunch_min_shift_hours', 0.5)}<span>ore</span>
          </div>
          <div className="row" style={{ alignItems: 'center' }}>
            <b style={{ width: 120 }}>Margine</b>
            <span>nessuna pausa negli ultimi</span>{num('min_tail_minutes', 5)}<span>min del turno</span>
          </div>
          <div className="row">
            <label className="field">
              <span>Attività per le pause</span>
              <select id="bp-act" className="select" value={act} onChange={(e) => setAct(e.target.value)}>
                {!breaks.length && <option value="">Crea prima un’attività di tipo Pausa</option>}
                {breaks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Attività per il pranzo</span>
              <select id="bp-lunch" className="select" value={lunch} onChange={(e) => setLunch(e.target.value)}>
                <option value="">Come le pause</option>
                {breaks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Lo sfalsamento anticipa la prima pausa di ogni tratto (mai oltre l’intervallo), così chi inizia alla stessa ora non va in pausa insieme.
            Le pause si inseriscono all’import e col pulsante “Pause automatiche” in timeline, che ricalcola quelle del periodo visibile.
          </p>
          {isAdmin && <div><button className="btn btn-primary">Salva regole</button></div>}
        </fieldset>
      </form>
    </section>
  );
}
