'use client';
import { useMemo, useState } from 'react';
import { fmtDay } from '@/lib/time';
import { parsePrefs, type ParsedPref, type PrefKind } from '@/lib/prefParse';
import type { Absence } from '@/lib/generator';
import { useAction } from '@/components/ui';
import { deletePref, importPrefs, savePref, type PrefInput } from './actions';
import type { GPerson, GPref } from './GeneratorView';

export const KIND_LABEL: Record<PrefKind, string> = {
  off: 'Riposo', morning: 'Turno di mattina (8–9)', start_after: 'Entrare non prima delle', start_window: 'Entrare tra le … e le …', end_by: 'Uscire entro le',
  shift: 'Turno preciso', week_shift: 'Turno della settimana (a rotazione)', want_close: 'Vuole la chiusura', no_close: 'Niente chiusure', no_open: 'Niente aperture',
  no_weekend: 'Niente weekend', weekend_ok: 'Weekend: disponibile solo se serve', sat_pick: 'Se fa il sabato, questo', place: 'Ufficio o smart', lunch_at: 'Pranzo fisso', note: 'Solo nota (non vincola)',
};
const WD = ['', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').trim();

/** riconosce la persona dall'email (anche se non è quella di accesso) o dal nome */
function findPerson(people: GPerson[], email: string, name: string): GPerson | null {
  const e = email.trim().toLowerCase();
  if (e) {
    const exact = people.find((p) => p.email?.toLowerCase() === e);
    if (exact) return exact;
    const local = e.split('@')[0]!.replace(/[^a-z]/g, '');
    const hits = people.filter((p) => {
      const parts = norm(p.name).split(' ').filter((x) => x.length >= 3);
      return parts.some((sur) => local.includes(sur) || (local.length >= 5 && (sur.startsWith(local) || sur.startsWith(local.slice(1)))));
    });
    if (hits.length === 1) return hits[0]!;
  }
  if (name.trim()) {
    const n = norm(name);
    const hits = people.filter((p) => norm(p.name) === n || norm(p.name).split(' ').some((x) => x.length >= 3 && n.split(' ').includes(x)));
    if (hits.length === 1) return hits[0]!;
  }
  return null;
}

export function describe(p: Pick<ParsedPref, 'kind' | 'day' | 'weekday' | 'time_a' | 'time_b'> & { place?: ParsedPref['place'] }, outside = false): string {
  const when = p.day ? fmtDay(p.day, 'EEE d MMM') : p.weekday ? `ogni ${WD[p.weekday]}` : '';
  const t = (x: string | null) => x?.slice(0, 5) ?? '';
  const pl = p.place === 'remote' ? ' in smart' : p.place === 'office' ? ' in ufficio' : '';
  const what: Record<PrefKind, string> = {
    off: 'riposo', morning: 'mattina', start_after: `entra dalle ${t(p.time_a)}`, start_window: `entra tra ${t(p.time_a)} e ${t(p.time_b)}`, end_by: `esce entro le ${t(p.time_a)}`,
    shift: `turno ${t(p.time_a)}–${t(p.time_b)}`, week_shift: `una settimana ${t(p.time_a)}–${t(p.time_b)}`, want_close: 'chiusura', no_close: 'niente chiusure', no_open: 'niente aperture',
    no_weekend: 'weekend liberi', weekend_ok: 'disponibile nel weekend se serve', sat_pick: 'sabato scelto', place: '', lunch_at: `pranzo ${t(p.time_a)}–${t(p.time_b)}`, note: 'nota',
  };
  return `${outside ? '⚠ fuori mese: ' : ''}${when ? when + ' · ' : ''}${what[p.kind]}${pl}`.replace(/ · $/, '');
}

export default function PrefsPanel({ month, people, prefs, absences }: { month: string; people: GPerson[]; prefs: GPref[]; absences: Absence[] }) {
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const [newP, setNewP] = useState({ person_id: people[0]?.id ?? '', text: '' });
  const { run, busy } = useAction();
  const [file, setFile] = useState<{ key: string; who: string; person_id: string; text: string }[] | null>(null);
  const sorted = [...prefs].sort((a, b) => (nameOf.get(a.person_id) ?? '').localeCompare(nameOf.get(b.person_id) ?? '') || a.text.localeCompare(b.text));
  const byId = new Map(prefs.map((p) => [p.id, p]));

  async function onFile(f: File) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: false, defval: null }) as (string | null)[][];
    const head = (rows[0] ?? []).map((h) => norm(String(h ?? '')));
    const emailCol = head.findIndex((h) => h.includes('mail'));
    const nameCol = head.findIndex((h) => /(nome|operatore|cognome|persona)/.test(h));
    const skip = new Set([emailCol, nameCol, ...head.map((h, i) => (/(cronolog|timestamp|^data|ora invio)/.test(h) ? i : -1))]);
    const textCols = head.map((_, i) => i).filter((i) => !skip.has(i));
    const out: { key: string; who: string; person_id: string; text: string }[] = [];
    rows.slice(1).forEach((r, ri) => {
      const email = emailCol >= 0 ? String(r?.[emailCol] ?? '') : '';
      const name = nameCol >= 0 ? String(r?.[nameCol] ?? '') : emailCol < 0 ? String(r?.[0] ?? '') : '';
      if (!email && !name) return;
      const p = findPerson(people, email, name);
      textCols.forEach((c) => {
        const v = String(r?.[c] ?? '').trim();
        if (v && !(emailCol < 0 && nameCol < 0 && c === 0)) out.push({ key: `${ri}-${c}`, who: email || name, person_id: p?.id ?? '', text: v });
      });
    });
    setFile(out);
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <b>Preferenze di {fmtDay(`${month}-15`, 'MMMM yyyy')}</b>
          <span className="small muted">Le scrivono gli operatori dal loro calendario o dal modulo Google. Qui controlli cosa ho capito.</span>
        </div>
        <div className="card-body">
          <div className="row">
            <label className="field"><span>Persona</span>
              <select className="select" value={newP.person_id} onChange={(e) => setNewP({ ...newP, person_id: e.target.value })}>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="field" style={{ flex: '1 1 320px' }}><span>Preferenza come l’ha scritta</span>
              <input className="input" value={newP.text} placeholder="Es. riposo il 12 · 18/12 mattina · il mercoledì niente chiusura" onChange={(e) => setNewP({ ...newP, text: e.target.value })} />
            </label>
            <button className="btn" disabled={busy || !newP.text.trim()} onClick={() => run(() => importPrefs(month, [newP]), () => setNewP({ ...newP, text: '' }))}>Aggiungi</button>
            <label className="btn" style={{ cursor: 'pointer' }}>
              Importa risposte (Excel / modulo Google)
              <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
          </div>
          {newP.text.trim() && <div className="small muted">Capisco: {parsePrefs(newP.text, month).map((p) => describe(p, !!p.outside)).join(' · ')}</div>}
        </div>

        {file && (
          <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
            <b>Anteprima del file: {file.length} preferenze</b>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Chi</th><th>Persona</th><th>Scritto</th><th>Cosa capisco</th></tr></thead>
                <tbody>
                  {file.map((r) => (
                    <tr key={r.key} style={!r.person_id ? { background: 'var(--bad-soft)' } : undefined}>
                      <td className="small muted">{r.who}</td>
                      <td>
                        <select className="select" value={r.person_id} onChange={(e) => setFile(file.map((x) => (x.who === r.who ? { ...x, person_id: e.target.value } : x)))}>
                          <option value="">— non riconosciuta —</option>
                          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      <td style={{ maxWidth: 320 }}>“{r.text}”</td>
                      <td className="small">
                        {parsePrefs(r.text, month).map((p, i) => (
                          <div key={i} style={p.outside || p.kind === 'note' ? { color: 'var(--warn)' } : undefined}>
                            {describe(p, !!p.outside)}{p.alt_day ? ` (solo se non si può il ${fmtDay(p.alt_day, 'd')})` : ''}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <button className="btn btn-primary" disabled={busy || !file.some((r) => r.person_id)} onClick={() => run(() => importPrefs(month, file.filter((r) => r.person_id)), () => setFile(null))}>
                Importa {file.filter((r) => r.person_id).length} preferenze
              </button>
              <button className="btn" onClick={() => setFile(null)}>Annulla</button>
              {file.some((r) => !r.person_id) && <span className="small" style={{ color: 'var(--bad)' }}>Le righe in rosso non hanno una persona: sceglila o non verranno importate.</span>}
            </div>
          </div>
        )}

        {sorted.length === 0 ? (
          <div className="empty">Nessuna preferenza per questo mese.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Persona</th><th>Scritto</th><th>Vincolo</th><th>Quando</th><th>Orario / dove</th><th>Visto</th><th /></tr></thead>
              <tbody>
                {sorted.map((p) => <PrefRow key={p.id + p.reviewed + p.kind} p={p} name={nameOf.get(p.person_id) ?? '?'} month={month} alt={p.alt_for ? byId.get(p.alt_for) ?? null : null} />)}
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

function PrefRow({ p, name, month, alt }: { p: GPref; name: string; month: string; alt: GPref | null }) {
  const [x, setX] = useState<PrefInput>({ id: p.id, month, person_id: p.person_id, text: p.text, kind: p.kind, day: p.day, weekday: p.weekday, time_a: p.time_a?.slice(0, 5) ?? null, time_b: p.time_b?.slice(0, 5) ?? null, place: p.place ?? null, reviewed: p.reviewed });
  const { run, busy } = useAction();
  const twoTimes = x.kind === 'shift' || x.kind === 'week_shift' || x.kind === 'start_window' || x.kind === 'lunch_at';
  const oneTime = x.kind === 'start_after' || x.kind === 'end_by';
  const hasPlace = x.kind === 'shift' || x.kind === 'place' || x.kind === 'morning';
  const monthWide = ['no_weekend', 'note', 'week_shift', 'lunch_at'].includes(x.kind);
  const outside = !!p.day && !p.day.startsWith(month);
  return (
    <tr style={!p.reviewed ? { background: '#fffbea' } : undefined}>
      <td style={{ whiteSpace: 'nowrap' }}><b>{name}</b>{p.source === 'operator' && <div className="small muted">dall’operatore</div>}</td>
      <td style={{ maxWidth: 260 }}>
        “{p.text}”
        {alt && <div className="small" style={{ color: 'var(--warn)' }}>Alternativa: vale solo se togli “{describe(alt)}”</div>}
        {outside && <div className="small" style={{ color: 'var(--warn)' }}>Data fuori dal mese ({fmtDay(p.day!, 'd MMM yyyy')})</div>}
      </td>
      <td>
        <select className="select" value={x.kind} onChange={(e) => setX({ ...x, kind: e.target.value as PrefKind })}>
          {(Object.keys(KIND_LABEL) as PrefKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </td>
      <td>
        {!monthWide ? (
          <div className="row" style={{ gap: 4 }}>
            <input className="input" type="date" value={x.day ?? ''} onChange={(e) => setX({ ...x, day: e.target.value || null, weekday: e.target.value ? null : x.weekday })} style={{ width: 150 }} />
            <select className="select" value={x.weekday ?? ''} onChange={(e) => setX({ ...x, weekday: e.target.value ? Number(e.target.value) : null, day: e.target.value ? null : x.day })}>
              <option value="">{x.day ? '—' : 'tutto il mese'}</option>
              {WD.slice(1).map((w, i) => <option key={w} value={i + 1}>ogni {w}</option>)}
            </select>
          </div>
        ) : <span className="muted small">tutto il mese</span>}
      </td>
      <td>
        <div className="row" style={{ gap: 4 }}>
          {(oneTime || twoTimes) && <input className="input" type="time" step={900} value={x.time_a ?? ''} onChange={(e) => setX({ ...x, time_a: e.target.value || null })} style={{ width: 110 }} />}
          {twoTimes && <input className="input" type="time" step={900} value={x.time_b ?? ''} onChange={(e) => setX({ ...x, time_b: e.target.value || null })} style={{ width: 110 }} />}
          {hasPlace && (
            <select className="select" value={x.place ?? ''} onChange={(e) => setX({ ...x, place: (e.target.value || null) as PrefInput['place'] })}>
              <option value="">dove capita</option><option value="office">in ufficio</option><option value="remote">in smart</option>
            </select>
          )}
        </div>
      </td>
      <td style={{ textAlign: 'center' }}>{p.reviewed ? '✓' : ''}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(() => savePref({ ...x, reviewed: true }))}>{p.reviewed ? 'Salva' : 'Conferma'}</button>{' '}
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => window.confirm('Eliminare il vincolo?') && run(() => deletePref(p.id))}>Elimina</button>
      </td>
    </tr>
  );
}
