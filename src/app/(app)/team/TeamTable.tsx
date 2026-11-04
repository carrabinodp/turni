'use client';
import { useMemo, useState } from 'react';
import { useAction } from '@/components/ui';
import { ROLE_LABEL, type Person, type Role } from '@/lib/types';
import { addPerson, bulkUpdate, mergePerson, updatePerson } from './actions';

const BASE_CHANNELS = ['Chat', 'Phone', 'SMS', 'Email'];

export default function TeamTable({ people, meId, isAdmin }: { people: Person[]; meId: string; isAdmin: boolean }) {
  const { run, busy } = useAction();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'active' | 'pending' | 'inactive' | 'all'>('active');
  const [channel, setChannel] = useState('');
  const [team, setTeam] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [onlySel, setOnlySel] = useState(false);
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState('');

  const channels = useMemo(() => Array.from(new Set([...BASE_CHANNELS, ...people.flatMap((p) => p.channels ?? [])])), [people]);
  const teams = useMemo(() => Array.from(new Set(people.map((p) => p.team).filter(Boolean) as string[])).sort(), [people]);
  const registered = people.filter((p) => p.user_id && p.active);

  const list = people.filter(
    (p) =>
      (status === 'all' || (status === 'active' && p.active) || (status === 'inactive' && !p.active) || (status === 'pending' && p.active && !p.user_id)) &&
      (!q || p.full_name.toLowerCase().includes(q.toLowerCase()) || (p.email ?? '').includes(q.toLowerCase())) &&
      (!channel || (p.channels ?? []).includes(channel)) &&
      (!team || p.team === team) &&
      (!onlySel || sel.has(p.id)),
  );
  const allSel = list.length > 0 && list.every((p) => sel.has(p.id));
  const ids = Array.from(sel);

  function applyBulk(v: string) {
    setBulk('');
    if (!v) return;
    const [kind, arg] = v.split(':') as [string, string | undefined];
    if (kind === 'team') {
      const t = window.prompt('Nome del team (vuoto per toglierlo):', teams[0] ?? 'full time');
      if (t === null) return;
      return run(() => bulkUpdate(ids, { team: t.trim() || null }));
    }
    if (kind === 'add') return run(() => bulkUpdate(ids, { addChannel: arg! }));
    if (kind === 'remove') return run(() => bulkUpdate(ids, { removeChannel: arg! }));
    if (kind === 'deactivate' && window.confirm(`Disattivare ${ids.length} persone? Non potranno più accedere.`)) return run(() => bulkUpdate(ids, { active: false }), () => setSel(new Set()));
    if (kind === 'activate') return run(() => bulkUpdate(ids, { active: true }));
  }

  return (
    <>
      <div className="row" style={{ alignItems: 'center' }}>
        <select id="pp-channel" className="select" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Canale">
          <option value="">Tutti i canali</option>
          {channels.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select id="pp-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Stato">
          <option value="active">Stato: attivi</option>
          <option value="pending">Da registrare</option>
          <option value="inactive">Disattivati</option>
          <option value="all">Tutti</option>
        </select>
        <select id="pp-team" className="select" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
          <option value="">Tutti i team</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn" onClick={() => setAdding((a) => !a)}>{adding ? 'Chiudi' : '+ Aggiungi persona'}</button>
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <input id="pp-q" className="input" placeholder="Cerca per nome o email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
        <label className="check small muted"><input id="pp-only" type="checkbox" checked={onlySel} onChange={(e) => setOnlySel(e.target.checked)} /> Solo selezionate ({sel.size})</label>
        <span style={{ flex: 1 }} />
        <select id="pp-bulk" className="select" value={bulk} disabled={!sel.size || busy} onChange={(e) => applyBulk(e.target.value)} aria-label="Azioni in blocco">
          <option value="">Azioni in blocco{sel.size ? ` (${sel.size})` : ''}</option>
          <option value="team">Assegna team…</option>
          <optgroup label="Aggiungi canale">{channels.map((c) => <option key={c} value={`add:${c}`}>+ {c}</option>)}</optgroup>
          <optgroup label="Togli canale">{channels.map((c) => <option key={c} value={`remove:${c}`}>− {c}</option>)}</optgroup>
          <option value="activate">Riattiva</option>
          <option value="deactivate">Disattiva</option>
        </select>
      </div>

      {adding && <AddPerson teams={teams} channels={channels} onDone={() => setAdding(false)} />}

      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" aria-label="Seleziona tutte" checked={allSel} onChange={(e) => setSel(e.target.checked ? new Set([...sel, ...list.map((p) => p.id)]) : new Set([...sel].filter((id) => !list.some((p) => p.id === id))))} />
                </th>
                <th>Nome</th>
                <th>Ruolo</th>
                <th>Canali</th>
                <th>Team</th>
                <th>Contratto</th>
                <th>Stato</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} style={p.active ? undefined : { opacity: 0.55 }}>
                  <td><input type="checkbox" aria-label={`Seleziona ${p.full_name}`} checked={sel.has(p.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} /></td>
                  <td style={{ minWidth: 200 }}>
                    <EditableText id={`n-${p.id}`} value={p.full_name} onSave={(v) => run(() => updatePerson(p.id, { full_name: v }))} />
                    <div className="small muted" style={{ paddingLeft: 0 }}>{p.email ?? 'email non ancora nota'}</div>
                    {p.aliases.length > 0 && <div className="small muted">Riconosciuto anche come: {p.aliases.join(', ')}</div>}
                  </td>
                  <td>
                    {isAdmin && p.id !== meId ? (
                      <select id={`r-${p.id}`} className="select" value={p.role} disabled={busy} onChange={(e) => run(() => updatePerson(p.id, { role: e.target.value as Role }))}>
                        {(['agent', 'team_lead', 'manager', 'admin'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : (
                      ROLE_LABEL[p.role]
                    )}
                  </td>
                  <td style={{ minWidth: 170 }}>
                    <div className="chip-edit">
                      {channels.map((c) => {
                        const on = (p.channels ?? []).includes(c);
                        return (
                          <button
                            key={c}
                            className={`chip-t${on ? ' on' : ''}`}
                            disabled={busy}
                            aria-pressed={on}
                            onClick={() => run(() => updatePerson(p.id, { channels: on ? p.channels.filter((x) => x !== c) : [...(p.channels ?? []), c] }))}
                          >
                            {c}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td><EditableText id={`t-${p.id}`} value={p.team ?? ''} placeholder="—" list="teams-list" onSave={(v) => run(() => updatePerson(p.id, { team: v || null }))} /></td>
                  <td><EditableText id={`c-${p.id}`} value={p.contract ?? ''} placeholder="—" onSave={(v) => run(() => updatePerson(p.id, { contract: v || null }))} /></td>
                  <td>{!p.active ? <span className="pill">Disattivato</span> : p.user_id ? <span className="pill pill-ok">Registrato</span> : <span className="pill pill-warn">Da registrare</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!p.user_id && p.active && registered.length > 0 && (
                      <select
                        id={`m-${p.id}`}
                        className="select"
                        style={{ width: 130 }}
                        value=""
                        disabled={busy}
                        onChange={(e) => e.target.value && window.confirm(`Unire “${p.full_name}” a ${people.find((x) => x.id === e.target.value)?.full_name}? I turni verranno spostati.`) && run(() => mergePerson(p.id, e.target.value))}
                      >
                        <option value="">Unisci a…</option>
                        {registered.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                      </select>
                    )}{' '}
                    {p.id !== meId &&
                      (p.active ? (
                        <button className="btn btn-sm btn-ghost btn-danger" disabled={busy} onClick={() => window.confirm(`Disattivare ${p.full_name}? Non potrà più accedere; lo storico resta.`) && run(() => updatePerson(p.id, { active: false }))}>Disattiva</button>
                      ) : (
                        <button className="btn btn-sm" disabled={busy} onClick={() => run(() => updatePerson(p.id, { active: true }))}>Riattiva</button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="small muted" style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', textAlign: 'right' }}>{list.length} di {people.length} persone</div>
      </section>
      <datalist id="teams-list">{teams.map((t) => <option key={t} value={t} />)}</datalist>
      <style dangerouslySetInnerHTML={{ __html: `
        .chip-edit{display:flex;flex-wrap:wrap;gap:4px}
        .chip-t{border:1px solid var(--line);background:#fff;color:var(--muted);border-radius:99px;font:inherit;font-size:12px;padding:1px 8px;cursor:pointer}
        .chip-t.on{background:var(--accent-soft);border-color:#c7d4fb;color:var(--accent);font-weight:500}
      ` }} />
    </>
  );
}

function AddPerson({ teams, channels, onDone }: { teams: string[]; channels: string[]; onDone: () => void }) {
  const { run, busy } = useAction();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contract, setContract] = useState('full time');
  const [team, setTeam] = useState(teams[0] ?? '');
  const [ch, setCh] = useState<string[]>([]);
  return (
    <form
      className="card card-body"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addPerson(name, email, contract, team, ch), onDone);
      }}
    >
      <div className="row">
        <label className="field" style={{ flex: '1 1 200px' }}><span>Nome e cognome</span><input id="ap-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="field" style={{ flex: '1 1 220px' }}><span>Email aziendale</span><input id="ap-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Team</span><input id="ap-team" className="input" list="teams-list" value={team} onChange={(e) => setTeam(e.target.value)} /></label>
        <label className="field"><span>Contratto</span><input id="ap-contract" className="input" value={contract} onChange={(e) => setContract(e.target.value)} /></label>
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <span className="small muted">Canali:</span>
        {channels.map((c) => (
          <label key={c} className="check small"><input type="checkbox" checked={ch.includes(c)} onChange={(e) => setCh(e.target.checked ? [...ch, c] : ch.filter((x) => x !== c))} /> {c}</label>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" disabled={busy}>Aggiungi</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Non è obbligatorio: chi entra con l’email aziendale viene creato da solo. Aggiungerla prima serve a preparargli i turni.</p>
    </form>
  );
}

function EditableText(props: { id: string; value: string; placeholder?: string; list?: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(props.value);
  return (
    <input
      id={props.id}
      className="input"
      list={props.list}
      style={{ border: '1px solid transparent', background: 'transparent', padding: '0 6px', marginLeft: -6, width: '100%', minWidth: 100 }}
      value={v}
      placeholder={props.placeholder}
      onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--line)')}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = 'transparent';
        if (v.trim() !== props.value) props.onSave(v.trim());
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      onChange={(e) => setV(e.target.value)}
    />
  );
}
