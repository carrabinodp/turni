'use client';
import { useState } from 'react';
import { useAction } from '@/components/ui';
import { ROLE_LABEL, type Person, type Role } from '@/lib/types';
import { addPerson, mergePerson, updatePerson } from './actions';

export default function TeamTable({ people, meId, isAdmin }: { people: Person[]; meId: string; isAdmin: boolean }) {
  const { run, busy } = useAction();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contract, setContract] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const registered = people.filter((p) => p.user_id && p.active);
  const list = people.filter((p) => showInactive || p.active);

  return (
    <>
      <section className="card">
        <div className="card-head"><h2>Aggiungi a mano</h2><span className="small muted">Facoltativo: chi si registra viene creato in automatico</span></div>
        <form
          className="card-body"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addPerson(name, email, contract), () => { setName(''); setEmail(''); setContract(''); });
          }}
        >
          <div className="row">
            <label className="field" style={{ flex: '1 1 200px' }}><span>Nome e cognome</span><input id="t-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label className="field" style={{ flex: '1 1 220px' }}><span>Email aziendale (facoltativa)</span><input id="t-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field" style={{ flex: '0 1 150px' }}><span>Contratto</span><input id="t-contract" className="input" placeholder="full time" value={contract} onChange={(e) => setContract(e.target.value)} /></label>
            <button className="btn btn-primary" disabled={busy}>Aggiungi</button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Persone</h2>
          <label className="check small"><input id="t-inactive" type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostra disattivati</label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nome</th><th>Email</th><th>Stato</th><th>Ruolo</th><th>Contratto</th><th /></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} style={p.active ? undefined : { opacity: 0.55 }}>
                  <td>
                    <EditableText id={`n-${p.id}`} value={p.full_name} onSave={(v) => run(() => updatePerson(p.id, { full_name: v }))} />
                    {p.aliases.length > 0 && <div className="small muted">Riconosciuto anche come: {p.aliases.join(', ')}</div>}
                  </td>
                  <td className="small">{p.email ?? <span className="muted">—</span>}</td>
                  <td>
                    {!p.active ? <span className="pill">Disattivato</span> : p.user_id ? <span className="pill pill-ok">Registrato</span> : <span className="pill pill-warn">Da registrare</span>}
                  </td>
                  <td>
                    {isAdmin && p.id !== meId ? (
                      <select id={`r-${p.id}`} className="select" value={p.role} disabled={busy} onChange={(e) => run(() => updatePerson(p.id, { role: e.target.value as Role }))}>
                        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : (
                      ROLE_LABEL[p.role]
                    )}
                  </td>
                  <td><EditableText id={`c-${p.id}`} value={p.contract ?? ''} placeholder="—" onSave={(v) => run(() => updatePerson(p.id, { contract: v || null }))} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!p.user_id && p.active && registered.length > 0 && (
                      <select
                        id={`m-${p.id}`}
                        className="select"
                        style={{ width: 150 }}
                        value=""
                        disabled={busy}
                        onChange={(e) => e.target.value && window.confirm(`Unire “${p.full_name}” a ${people.find((x) => x.id === e.target.value)?.full_name}? I turni verranno spostati.`) && run(() => mergePerson(p.id, e.target.value))}
                      >
                        <option value="">Unisci a…</option>
                        {registered.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                      </select>
                    )}{' '}
                    {p.id !== meId && (
                      p.active ? (
                        <button className="btn btn-sm btn-ghost btn-danger" disabled={busy} onClick={() => window.confirm(`Disattivare ${p.full_name}? Non potrà più accedere; lo storico resta.`) && run(() => updatePerson(p.id, { active: false }))}>Disattiva</button>
                      ) : (
                        <button className="btn btn-sm" disabled={busy} onClick={() => run(() => updatePerson(p.id, { active: true }))}>Riattiva</button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function EditableText(props: { id: string; value: string; placeholder?: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(props.value);
  return (
    <input
      id={props.id}
      className="input"
      style={{ border: '1px solid transparent', background: 'transparent', padding: '0 6px', marginLeft: -6, width: '100%', minWidth: 120 }}
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
