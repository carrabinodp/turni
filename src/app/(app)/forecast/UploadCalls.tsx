'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDay, localDate, todayIn } from '@/lib/time';
import type { Rows } from '@/lib/import/parse';
import { aggregate, detectCalls, parseCalls, type CallMapping, type ParsedCalls } from '@/lib/calls';
import { showToast, ActionButton } from '@/components/ui';
import { deleteRange, logUpload, saveIntervals } from './actions';
import type { Upload } from './ForecastView';

const FIELDS: [keyof Omit<CallMapping, 'headerRow'>, string, string][] = [
  ['datetime', 'Data e ora', 'oppure data e ora separate'],
  ['date', 'Data', ''],
  ['time', 'Ora', ''],
  ['outcome', 'Esito', 'risposta / persa'],
  ['wait', 'Tempo di attesa', 'per il livello di servizio'],
  ['talk', 'Durata conversazione', 'per le persone necessarie'],
  ['acw', 'Post-chiamata', 'facoltativo'],
  ['queue', 'Coda / servizio', 'facoltativo'],
  ['direction', 'Direzione', 'per escludere le uscenti'],
];
const CHUNK = 3000;

export default function UploadCalls({ tz, uploads, dataRange }: { tz: string; uploads: Upload[]; dataRange: { from: string; to: string } | null }) {
  const router = useRouter();
  const [file, setFile] = useState<{ name: string; rows: Rows; sheet: string } | null>(null);
  const [map, setMap] = useState<CallMapping | null>(null);
  const [byQueue, setByQueue] = useState(false);
  const [skipToday, setSkipToday] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(f: File) {
    setErr(null);
    setFile(null);
    setMap(null);
    setBusy('Leggo il file…');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', raw: false, cellDates: false });
      let best: { rows: Rows; sheet: string; map: CallMapping | null } | null = null;
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, raw: true, defval: null }) as Rows;
        const m = detectCalls(rows);
        if (m || !best) best = { rows, sheet: name, map: m };
        if (m) break;
      }
      if (!best || best.rows.length < 2) throw new Error('Il file è vuoto.');
      setFile({ name: f.name, rows: best.rows, sheet: best.sheet });
      setMap(best.map ?? { headerRow: 0, datetime: null, date: null, time: null, outcome: null, wait: null, talk: null, acw: null, queue: null, direction: null });
      if (!best.map) setErr('Non ho riconosciuto le colonne: indicale qui sotto.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'File non leggibile');
    } finally {
      setBusy(null);
    }
  }

  const header = file && map ? (file.rows[map.headerRow] ?? []).map((h, i) => String(h ?? `Colonna ${i + 1}`)) : [];
  const raw: ParsedCalls | null = file && map && (map.datetime !== null || map.date !== null) ? parseCalls(file.rows, map, tz, new Date().getFullYear()) : null;
  // la giornata di oggi non è finita: se entrasse nello storico peserebbe come un giorno quasi vuoto
  const today = todayIn(tz);
  const todayCalls = raw ? raw.calls.filter((c) => localDate(c.s, tz) >= today).length : 0;
  const parsed: ParsedCalls | null = raw && skipToday && todayCalls ? { ...raw, calls: raw.calls.filter((c) => localDate(c.s, tz) < today) } : raw;
  const agg = parsed ? aggregate(parsed.calls, tz, byQueue) : [];
  const days = Array.from(new Set(agg.map((a) => a.day))).sort();
  const range = days.length ? { from: days[0]!, to: days[days.length - 1]! } : null;
  const answered = parsed?.calls.filter((c) => c.answered).length ?? 0;
  const queues = Array.from(new Set(parsed?.calls.map((c) => c.queue).filter(Boolean) ?? []));
  const overlap = range && dataRange && range.from <= dataRange.to && range.to >= dataRange.from;

  async function upload() {
    if (!file || !range || !parsed) return;
    setErr(null);
    try {
      for (let i = 0; i < agg.length || i === 0; i += CHUNK) {
        setBusy(`Salvo… ${Math.min(100, Math.round((i / Math.max(1, agg.length)) * 100))}%`);
        const r = await saveIntervals({ from: range.from, to: range.to, rows: agg.slice(i, i + CHUNK), first: i === 0 });
        if (!r.ok) throw new Error(r.error);
      }
      const r = await logUpload({ file_name: file.name, from: range.from, to: range.to, calls: parsed.calls.length, queues: byQueue ? queues : [] });
      if (!r.ok) throw new Error(r.error);
      showToast(`${parsed.calls.length.toLocaleString('it-IT')} chiamate caricate`);
      setFile(null);
      setMap(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Caricamento non riuscito');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="card">
        <div className="card-head"><b>Carica l’elenco delle chiamate</b></div>
        <div className="card-body">
          <p className="small muted" style={{ margin: 0 }}>
            L’esportazione del centralino in Excel o CSV, una riga per chiamata. Servono almeno data e ora; con esito, tempo di attesa e durata il forecast diventa completo.
            Ricaricare lo stesso periodo sostituisce i dati di quei giorni, non li raddoppia: caricate settimane intere.
          </p>
          <label className="drop">
            <input type="file" accept=".xlsx,.xls,.csv,.txt" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} disabled={!!busy} />
            <span>{busy ?? (file ? `${file.name} · foglio “${file.sheet}” · ${file.rows.length - (map?.headerRow ?? 0) - 1} righe` : 'Scegli il file delle chiamate')}</span>
          </label>
          {err && <div className="pill pill-bad" style={{ height: 'auto', padding: '6px 10px', whiteSpace: 'normal' }}>{err}</div>}

          {file && map && (
            <>
              <div className="fc-map">
                <label className="field">
                  <span>Riga di intestazione</span>
                  <select className="select" value={map.headerRow} onChange={(e) => setMap({ ...map, headerRow: Number(e.target.value) })}>
                    {file.rows.slice(0, 15).map((r, i) => <option key={i} value={i}>{i + 1}: {(r ?? []).filter((x) => x !== null && x !== '').slice(0, 4).join(' · ').slice(0, 50)}</option>)}
                  </select>
                </label>
                {FIELDS.map(([k, label, hint]) => (
                  <label key={k} className="field">
                    <span>{label}{hint && <em className="muted"> · {hint}</em>}</span>
                    <select className="select" value={map[k] ?? ''} onChange={(e) => setMap({ ...map, [k]: e.target.value === '' ? null : Number(e.target.value) })}>
                      <option value="">—</option>
                      {header.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>

              {parsed && (
                <div className="fc-sum">
                  <div><b>{parsed.calls.length.toLocaleString('it-IT')}</b> chiamate in entrata{range && <> dal <b>{fmtDay(range.from, 'd MMM yyyy')}</b> al <b>{fmtDay(range.to, 'd MMM yyyy')}</b> ({days.length} giorni)</>}</div>
                  <div className="small muted">
                    {answered.toLocaleString('it-IT')} risposte · {(parsed.calls.length - answered).toLocaleString('it-IT')} perse
                    {parsed.outbound > 0 && <> · {parsed.outbound.toLocaleString('it-IT')} uscenti escluse</>}
                    {parsed.skipped > 0 && <> · <span className="bad">{parsed.skipped} righe senza data/ora valida</span></>}
                  </div>
                  {map.wait === null && <div className="small" style={{ color: 'var(--warn)' }}>Senza il tempo di attesa non posso calcolare il livello di servizio storico (il forecast funziona lo stesso).</div>}
                  {map.talk === null && <div className="small" style={{ color: 'var(--warn)' }}>Senza la durata uso 3 minuti a chiamata per calcolare le persone necessarie.</div>}
                  {queues.length > 1 && (
                    <label className="check small"><input type="checkbox" checked={byQueue} onChange={(e) => setByQueue(e.target.checked)} /> Tieni separate le {queues.length} code ({queues.slice(0, 4).join(', ')}{queues.length > 4 ? '…' : ''})</label>
                  )}
                  {todayCalls > 0 && (
                    <label className="check small">
                      <input type="checkbox" checked={skipToday} onChange={(e) => setSkipToday(e.target.checked)} /> Escludi oggi ({todayCalls} chiamate): la giornata non è ancora finita e falserebbe lo storico
                    </label>
                  )}
                  {days.length > 0 && days.length < 14 && (
                    <div className="small" style={{ color: 'var(--warn)' }}>
                      {days.length === 1 ? 'Un solo giorno' : `Solo ${days.length} giorni`}: va bene per vedere le fasce di quel giorno, ma per prevedere servono almeno 3 settimane (meglio 8 o più). Puoi caricare più file, uno per periodo.
                    </div>
                  )}
                  {overlap && <div className="small" style={{ color: 'var(--warn)' }}>I giorni di questo file sostituiranno quelli già caricati nello stesso periodo.</div>}
                  <div className="small muted">Al server vanno solo i totali di {agg.length.toLocaleString('it-IT')} mezz’ore: nessun nome, nessun numero di telefono.</div>
                  <div><button className="btn btn-primary" disabled={!!busy || !parsed.calls.length} onClick={upload}>{busy ?? 'Carica'}</button></div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><b>Caricamenti</b>{dataRange && <span className="small muted">Dati dal {fmtDay(dataRange.from, 'd MMM yyyy')} al {fmtDay(dataRange.to, 'd MMM yyyy')}</span>}</div>
        {uploads.length === 0 ? (
          <div className="empty">Nessun file caricato.</div>
        ) : (
          <table className="table">
            <thead><tr><th>File</th><th>Periodo</th><th className="num">Chiamate</th><th>Caricato</th><th /></tr></thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id}>
                  <td>{u.file_name ?? '—'}{u.queues.length > 0 && <div className="small muted">{u.queues.join(', ')}</div>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(u.from_day, 'd MMM')} – {fmtDay(u.to_day, 'd MMM yyyy')}</td>
                  <td className="num">{u.calls.toLocaleString('it-IT')}</td>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{new Date(u.uploaded_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td style={{ textAlign: 'right' }}>
                    <ActionButton className="btn btn-sm btn-danger" confirm={`Eliminare le chiamate dal ${u.from_day} al ${u.to_day}?`} action={() => deleteRange(u.from_day, u.to_day)}>Elimina periodo</ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <style dangerouslySetInnerHTML={{ __html: `
        .drop{display:flex;align-items:center;gap:12px;border:1.5px dashed var(--line);border-radius:8px;padding:16px;cursor:pointer;background:#fbfbfc}
        .drop:hover{border-color:var(--accent)}
        .drop input{max-width:240px}
        .fc-map{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
        .fc-map em{font-style:normal;font-weight:400}
        .fc-sum{display:grid;gap:6px;border:1px solid var(--line);border-radius:8px;padding:12px 14px;background:#fbfbfc}
      ` }} />
    </>
  );
}
