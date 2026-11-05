'use client';
import { useMemo, useState } from 'react';
import { fmtDay } from '@/lib/time';
import { parsePref, type Absence, type PrefKind } from '@/lib/generator';
import { matchPerson } from '@/lib/import/match';
import { useAction, showToast } from '@/components/ui';
import { deletePref, importPrefs, savePref, type PrefInput } from './actions';
import type { GPerson, GPref } from './GeneratorView';

const KIND_LABEL: Record<PrefKind, string> = {
  off: 'Riposo', start_after: 'Entrare non prima delle', end_by: 'Uscire entro le', no_close: 'Niente chiusure', no_open: 'Niente aperture',
  shift: 'Turno preciso', no_weekend: 'Niente weekend', note: 'Solo nota (non vincola)',
};
const WD = ['', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];

export default function PrefsPanel({ month, people, prefs, absences }: { month: string; people: GPerson[]; prefs: GPref[]; absences: Absence[] }) {
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const [newP, setNewP] = useState({ person_id: people[0]?.id ?? '', text: '' });
  const { run, busy } = useAction();
  const [file, setFile] = useState<{ person_id: string; name: string; text: string }[] | null>(null);
  const sorted = [...prefs].sort((a, b) => Number(a.reviewed) - Number(b.reviewed) || (nameOf.get(a.person_id) ?? '').localeCompare(nameOf.get(b.person_id) ?? ''));

  async function onFile(f: File) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: false, defval: null }) as (string | null)[][];
    const lite = people.map((p) => ({ id: p.id, full_name: p.name, email: null, aliases: [] as string[] }));
    const out: { person_id: string; name: string; text: string }[] = [];
    let unknown = 0;
    for (const r of rows.slice(1)) {
      const name = String(r?.[0] ?? '').trim();
      if (!name) continue;
      const m = matchPerson(name, null, lite as never);
      const pid = m.person?.id;
      if (!pid) { unknown++; continue; }
      r.slice(1).forEach((c) => { if (c && String(c).trim()) out.push({ person_id: pid, name, text: String(c).trim() }); });
    }
    setFile(out);
    if (unknown) showToast(`${unknown} nomi non riconosciuti: controlla la prima colonna`, true);
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <b>Preferenze di {fmtDay(`${month}-15`, 'MMMM yyyy')}</b>
          <span className="small muted">Gli operatori le scrivono dal loro calendario (max 3). Qui controlli il vincolo che ne ho ricavato.</span>
        </div>
        <div className="card-body">
          <div className="row">
            <label className="field"><span>Persona</span>
              <select className="select" value={newP.person_id} onChange={(e) => setNewP({ ...newP, person_id: e.target.value })}>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="field" style={{ flex: '1 1 320px' }}><span>Preferenza come l’ha scritta</span>
              <input className="input" value={newP.text} placeholder="Es. riposo il 12 · il martedì entro alle 10 · niente chiusure" onChange={(e) => setNewP({ ...newP, text: e.target.value })} />
            </label>
            <button className="btn" disabled={busy || !newP.text.trim()} onClick={() => run(() => savePref({ month, person_id: newP.person_id, text: newP.text, ...parsePref(newP.text, month), reviewed: false }), () => setNewP({ ...newP, text: '' }))}>Aggiungi</button>
            <label className="btn" style={{ cursor: 'pointer' }}>
              Importa da Excel
              <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
          </div>
          {file && (
            <div className="alert alert-info">
              {file.length} preferenze lette dal file (prima colonna il nome, nelle altre le preferenze).
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn btn-sm btn-primary" disabled={busy || !file.length} onClick={() => run(() => importPrefs(month, file), () => setFile(null))}>Importa</button>
                <button className="btn btn-sm" onClick={() => setFile(null)}>Annulla</button>
              </div>
            </div>
          )}
        </div>
        {sorted.length === 0 ? (
          <div className="empty">Nessuna preferenza per questo mese.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Persona</th><th>Scritto</th><th>Vincolo</th><th>Quando</th><th>Orario</th><th>Visto</th><th /></tr></thead>
              <tbody>
                {sorted.map((p) => <PrefRow key={p.id + p.reviewed} p={p} name={nameOf.get(p.person_id) ?? '?'} month={month} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head"><b>Ferie, malattie e permessi del mese</b><span className="small muted">Si inseriscono da Timeline (clic destro) o arrivano dalle richieste approvate</span></div>
        {absences.length === 0 ? (
          <div className="empty">Nessuna assenza nel mese.</div>
        ) : (
          <div className="card-body gn-abs">
            {Array.from(new Set(absences.map((a) => a.person_id))).map((pid) => {
              const list = absences.filter((a) => a.person_id === pid).sort((a, b) => a.day.localeCompare(b.day));
              return (
                <div key={pid}>
                  <b>{nameOf.get(pid) ?? '?'}</b>{' '}
                  <span className="small">{list.map((a) => `${fmtDay(a.day, 'd')} ${a.name}${a.full ? '' : ' (a ore)'}`).join(', ')}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <style dangerouslySetInnerHTML={{ __html: `.gn-abs{display:grid;gap:4px;font-size:13px}` }} />
    </>
  );
}

function PrefRow({ p, name, month }: { p: GPref; name: string; month: string }) {
  const [x, setX] = useState<PrefInput>({ id: p.id, month, person_id: p.person_id, text: p.text, kind: p.kind, day: p.day, weekday: p.weekday, time_a: p.time_a?.slice(0, 5) ?? null, time_b: p.time_b?.slice(0, 5) ?? null, reviewed: p.reviewed });
  const { run, busy } = useAction();
  const needsTime = x.kind === 'start_after' || x.kind === 'end_by' || x.kind === 'shift';
  const needsWhen = x.kind !== 'no_close' && x.kind !== 'no_open' && x.kind !== 'no_weekend' && x.kind !== 'note';
  return (
    <tr style={!p.reviewed ? { background: '#fffbea' } : undefined}>
      <td style={{ whiteSpace: 'nowrap' }}><b>{name}</b>{p.source === 'operator' && <div className="small muted">dall’operatore</div>}</td>
      <td style={{ maxWidth: 260 }}>“{p.text}”</td>
      <td>
        <select className="select" value={x.kind} onChange={(e) => setX({ ...x, kind: e.target.value as PrefKind })}>
          {(Object.keys(KIND_LABEL) as PrefKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </td>
      <td>
        {needsWhen || x.kind === 'no_close' || x.kind === 'no_open' ? (
          <div className="row" style={{ gap: 4 }}>
            <input className="input" type="date" value={x.day ?? ''} min={`${month}-01`} onChange={(e) => setX({ ...x, day: e.target.value || null, weekday: e.target.value ? null : x.weekday })} style={{ width: 150 }} />
            <select className="select" value={x.weekday ?? ''} onChange={(e) => setX({ ...x, weekday: e.target.value ? Number(e.target.value) : null, day: e.target.value ? null : x.day })}>
              <option value="">{x.day ? '—' : x.kind === 'no_close' || x.kind === 'no_open' ? 'tutto il mese' : 'ogni…'}</option>
              {WD.slice(1).map((w, i) => <option key={w} value={i + 1}>ogni {w}</option>)}
            </select>
          </div>
        ) : <span className="muted small">tutto il mese</span>}
      </td>
      <td>
        {needsTime && (
          <div className="row" style={{ gap: 4 }}>
            <input className="input" type="time" step={900} value={x.time_a ?? ''} onChange={(e) => setX({ ...x, time_a: e.target.value || null })} style={{ width: 110 }} />
            {x.kind === 'shift' && <input className="input" type="time" step={900} value={x.time_b ?? ''} onChange={(e) => setX({ ...x, time_b: e.target.value || null })} style={{ width: 110 }} />}
          </div>
        )}
      </td>
      <td style={{ textAlign: 'center' }}>{p.reviewed ? '✓' : ''}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(() => savePref({ ...x, reviewed: true }))}>{p.reviewed ? 'Salva' : 'Conferma'}</button>{' '}
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => window.confirm('Eliminare la preferenza?') && run(() => deletePref(p.id))}>Elimina</button>
      </td>
    </tr>
  );
}
