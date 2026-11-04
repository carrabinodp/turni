'use client';
import { useMemo, useState } from 'react';
import { useAction } from '@/components/ui';
import { fmt } from '@/lib/time';
import { KIND_REQ_LABEL, STATUS_LABEL, type RequestKind, type RequestStatus } from '@/lib/types';
import { decide, decideMany } from './actions';

export interface ReqRow {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  by: string;
  created_at: string;
  dates: string; // testo "giorni interessati"
  firstDay: string;
  description: string;
  note: string | null;
  issues: string[];
  decidedBy: string | null;
  decisionNote: string | null;
}

const PILL: Record<RequestStatus, string> = {
  pending_peer: 'pill pill-warn', open: 'pill pill-info', pending_manager: 'pill pill-warn',
  approved: 'pill pill-ok', rejected: 'pill pill-bad', cancelled: 'pill',
};

export default function RequestsTable({ rows, tz }: { rows: ReqRow[]; tz: string }) {
  const [kind, setKind] = useState<'' | RequestKind>('');
  const [status, setStatus] = useState<'pending' | 'all' | RequestStatus>('pending');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const { run, busy } = useAction();

  const list = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!kind || r.kind === kind) &&
          (status === 'all' ? true : status === 'pending' ? ['pending_manager', 'pending_peer', 'open'].includes(r.status) : r.status === status) &&
          (!q || r.by.toLowerCase().includes(q.toLowerCase()) || r.description.toLowerCase().includes(q.toLowerCase())) &&
          (!from || r.created_at.slice(0, 10) >= from) &&
          (!to || r.created_at.slice(0, 10) <= to),
      ),
    [rows, kind, status, q, from, to],
  );
  const selectable = list.filter((r) => r.status === 'pending_manager');
  const allSel = selectable.length > 0 && selectable.every((r) => sel.has(r.id));
  const chosen = Array.from(sel).filter((id) => selectable.some((r) => r.id === id));

  return (
    <section className="card">
      <div className="card-head" style={{ display: 'grid', gap: 10, justifyContent: 'stretch' }}>
        <div className="row" style={{ alignItems: 'center' }}>
          <select id="rq-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as RequestKind | '')} aria-label="Tipo">
            <option value="">Tutti i tipi</option>
            {(Object.keys(KIND_REQ_LABEL) as RequestKind[]).filter((k) => k !== 'time_off').map((k) => <option key={k} value={k}>{KIND_REQ_LABEL[k]}</option>)}
          </select>
          <select id="rq-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Stato">
            <option value="pending">Stato: in sospeso</option>
            <option value="all">Tutti gli stati</option>
            {(Object.keys(STATUS_LABEL) as RequestStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </select>
          <label className="row" style={{ alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
            <span className="small muted">Inviate dal</span>
            <input id="rq-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="small muted">al</span>
            <input id="rq-to" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <input id="rq-q" className="input" placeholder="Cerca persone…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 200 }} />
        </div>
        {chosen.length > 0 && (
          <div className="row bulk" style={{ alignItems: 'center' }}>
            <b>{chosen.length} selezionate</b>
            <input id="rq-note" className="input" placeholder="Nota (facoltativa)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(() => decideMany(chosen, true, note), () => setSel(new Set()))}>Approva selezionate</button>
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => run(() => decideMany(chosen, false, note), () => setSel(new Set()))}>Rifiuta selezionate</button>
          </div>
        )}
      </div>
      {list.length === 0 ? (
        <div className="empty" style={{ textAlign: 'center', padding: 40 }}>
          <b>Nessuna richiesta trovata</b>
          <div className="small">Non ci sono richieste che corrispondono ai filtri.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    aria-label="Seleziona tutte"
                    checked={allSel}
                    disabled={!selectable.length}
                    onChange={(e) => setSel(e.target.checked ? new Set(selectable.map((r) => r.id)) : new Set())}
                  />
                </th>
                <th>Richiesta</th>
                <th>Inviata da</th>
                <th>Giorni interessati</th>
                <th>Modifiche richieste</th>
                <th>Stato</th>
                <th>Regole violate</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.status === 'pending_manager' && (
                      <input
                        type="checkbox"
                        aria-label="Seleziona"
                        checked={sel.has(r.id)}
                        onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })}
                      />
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{KIND_REQ_LABEL[r.kind]}</td>
                  <td>
                    {r.by}
                    <div className="small muted">{fmt(r.created_at, tz, "d MMM 'alle' HH:mm")}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.dates}</td>
                  <td style={{ minWidth: 240 }}>
                    {r.description}
                    {r.note && r.kind !== 'change' && <div className="small muted">“{r.note}”</div>}
                    {r.decisionNote && <div className="small muted">Manager: {r.decisionNote}</div>}
                  </td>
                  <td>
                    <span className={PILL[r.status]}>{STATUS_LABEL[r.status]}</span>
                    {r.decidedBy && <div className="small muted">{r.decidedBy}</div>}
                  </td>
                  <td style={{ minWidth: 160 }}>
                    {r.status !== 'pending_manager' ? (
                      <span className="muted">—</span>
                    ) : r.issues.length ? (
                      <span className="small" style={{ color: 'var(--bad)', whiteSpace: 'pre-line' }}>{r.issues.join('\n')}</span>
                    ) : (
                      <span className="small" style={{ color: 'var(--ok)' }}>Nessuna</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.status === 'pending_manager' && (
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => run(() => decide(r.id, false, ''))}>Rifiuta</button>
                        <button className="btn btn-sm btn-primary" disabled={busy || r.issues.length > 0} title={r.issues.length ? 'Non approvabile: viola le regole' : undefined} onClick={() => run(() => decide(r.id, true, ''))}>
                          Approva
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="small muted" style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', textAlign: 'right' }}>
        {list.length} di {rows.length} richieste
      </div>
    </section>
  );
}
