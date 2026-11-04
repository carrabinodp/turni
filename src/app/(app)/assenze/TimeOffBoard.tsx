'use client';
import { useMemo, useState } from 'react';
import { useAction } from '@/components/ui';
import { addDays, fmt, fmtDay, todayIn, weekStart } from '@/lib/time';
import { STATUS_LABEL, type RequestStatus } from '@/lib/types';
import { IcLeft, IcRight } from '@/components/icons';
import { decide } from '../richieste/actions';

export interface TimeOffCard {
  id: string;
  person: string;
  email: string | null;
  type: string;
  color: string;
  activity_id: string | null;
  from: string;
  to: string;
  timeFrom: string | null;
  timeTo: string | null;
  hours: number;
  status: RequestStatus;
  byManager: boolean;
  created_at: string;
  note: string | null;
  decisionNote: string | null;
  overlap: string[]; // altre persone assenti negli stessi giorni
}

type StatusFilter = 'pending_manager' | 'approved' | 'approved_auto' | 'approved_manual' | 'rejected' | 'cancelled' | 'all';
const STATUS_OPTS: [StatusFilter, string][] = [
  ['pending_manager', 'In attesa'],
  ['approved', 'Approvate'],
  ['approved_manual', '· approvate da un manager'],
  ['approved_auto', '· inserite direttamente'],
  ['rejected', 'Rifiutate'],
  ['cancelled', 'Annullate'],
  ['all', 'Tutte'],
];

function ago(iso: string, now: number) {
  const d = Math.round((now - Date.parse(iso)) / 86400000);
  if (d < 1) return 'oggi';
  if (d === 1) return 'ieri';
  if (d < 30) return `${d} giorni fa`;
  const m = Math.round(d / 30);
  return m === 1 ? '1 mese fa' : `${m} mesi fa`;
}

export default function TimeOffBoard({ cards, tz, types }: { cards: TimeOffCard[]; tz: string; types: { id: string; name: string }[] }) {
  const today = todayIn(tz);
  const [status, setStatus] = useState<StatusFilter>('pending_manager');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 91));
  const [sort, setSort] = useState<'first' | 'created'>('first');
  const [view, setView] = useState<'cards' | 'list' | 'calendar'>('cards');
  const [month, setMonth] = useState(today.slice(0, 8) + '01');
  const { run, busy } = useAction();
  const [now] = useState(() => Date.now());

  const list = useMemo(() => {
    const l = cards.filter((c) => {
      const st =
        status === 'all' ||
        (status === 'approved' && c.status === 'approved') ||
        (status === 'approved_auto' && c.status === 'approved' && c.byManager) ||
        (status === 'approved_manual' && c.status === 'approved' && !c.byManager) ||
        c.status === status;
      return st && (!type || c.activity_id === type) && (!q || c.person.toLowerCase().includes(q.toLowerCase())) && c.to >= from && c.from <= to;
    });
    return l.sort((a, b) => (sort === 'first' ? a.from.localeCompare(b.from) : b.created_at.localeCompare(a.created_at)));
  }, [cards, status, type, q, from, to, sort]);

  const shift = (n: number) => {
    setFrom(addDays(from, n));
    setTo(addDays(to, n));
  };

  const Actions = ({ c }: { c: TimeOffCard }) =>
    c.status === 'pending_manager' ? (
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => run(() => decide(c.id, false, ''))}>Rifiuta</button>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(() => decide(c.id, true, ''))}>Approva</button>
      </div>
    ) : (
      <span className={`pill ${c.status === 'approved' ? 'pill-ok' : c.status === 'rejected' ? 'pill-bad' : ''}`}>
        {c.status === 'approved' && c.byManager ? 'Inserita dal manager' : STATUS_LABEL[c.status]}
      </span>
    );

  const dates = (c: TimeOffCard) =>
    c.from === c.to ? fmtDay(c.from, 'EEE d MMM yyyy') : `${fmtDay(c.from, 'EEE d MMM yyyy')} – ${fmtDay(c.to, 'EEE d MMM yyyy')}`;

  // calendario mensile
  const monthDays = useMemo(() => {
    const start = weekStart(month);
    const next = addDays(month, 32).slice(0, 8) + '01';
    const end = addDays(weekStart(addDays(next, -1)), 7);
    const out: string[] = [];
    for (let d = start; d < end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);

  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <input id="to-q" className="input" placeholder="Cerca persone…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 200 }} />
        <select id="to-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Stato">
          {STATUS_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select id="to-type" className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
          <option value="">Tutti i tipi</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {view !== 'calendar' && (
          <div className="tl-date">
            <button aria-label="Periodo precedente" onClick={() => shift(-30)}><IcLeft width={16} /></button>
            <input id="to-from" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Dal" />
            <span className="tl-sep">→</span>
            <input id="to-to" type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Al" />
            <button aria-label="Periodo successivo" onClick={() => shift(30)}><IcRight width={16} /></button>
          </div>
        )}
        <select id="to-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value as 'first' | 'created')} aria-label="Ordina">
          <option value="first">Ordina: prima assenza</option>
          <option value="created">Ordina: richiesta più recente</option>
        </select>
      </div>

      <div className="tabs">
        {(['cards', 'list', 'calendar'] as const).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'cards' ? 'Schede' : v === 'list' ? 'Elenco' : 'Calendario'}</button>
        ))}
        <span className="muted small" style={{ marginLeft: 'auto' }}>{view === 'calendar' ? '' : `${list.length} richieste`}</span>
      </div>

      {view === 'cards' &&
        (list.length === 0 ? (
          <div className="card empty">Nessuna richiesta con questi filtri.</div>
        ) : (
          <div className="to-cards">
            {list.map((c) => (
              <article key={c.id} className="card to-card">
                <div className="to-h">
                  <div style={{ minWidth: 0 }}>
                    <b>{c.person}</b>
                    <div className="small muted">{c.email}</div>
                  </div>
                  <span className={`pill ${c.status === 'pending_manager' ? 'pill-info' : c.status === 'approved' ? 'pill-ok' : c.status === 'rejected' ? 'pill-bad' : ''}`}>
                    {c.status === 'pending_manager' ? 'In attesa' : STATUS_LABEL[c.status]}
                  </span>
                </div>
                <div className="to-body">
                  <span><span className="swatch" style={{ background: c.color }} /> <b>{c.type}</b></span>
                  <span>📅 {dates(c)}{c.timeFrom ? `, ${c.timeFrom.slice(0, 5)}–${c.timeTo?.slice(0, 5)}` : ''}</span>
                  <span>⏳ {c.hours} ore</span>
                  <span className="muted">Richiesta {ago(c.created_at, now)}</span>
                  <span>💬 {c.note ?? '—'}</span>
                </div>
                <div className="to-policy">
                  <span className="label">Controlli</span>
                  {c.overlap.length ? (
                    <span className="small" style={{ color: 'var(--warn)' }}>Assenti negli stessi giorni: {c.overlap.join(', ')}</span>
                  ) : (
                    <span className="small" style={{ color: 'var(--ok)' }}>✓ Nessun altro assente negli stessi giorni</span>
                  )}
                  {c.decisionNote && <span className="small muted">Manager: {c.decisionNote}</span>}
                </div>
                <div className="to-foot"><Actions c={c} /></div>
              </article>
            ))}
          </div>
        ))}

      {view === 'list' && (
        <div className="card">
          {list.length === 0 ? (
            <div className="empty">Nessuna richiesta con questi filtri.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Persona</th><th>Tipo</th><th>Date</th><th>Ore</th><th>Richiesta</th><th>Controlli</th><th /></tr></thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id}>
                      <td>{c.person}<div className="small muted">{c.email}</div></td>
                      <td><span className="swatch" style={{ background: c.color, marginRight: 6 }} />{c.type}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{dates(c)}{c.timeFrom ? `, ${c.timeFrom.slice(0, 5)}–${c.timeTo?.slice(0, 5)}` : ''}</td>
                      <td className="tabnum">{c.hours}</td>
                      <td className="small muted">{fmt(c.created_at, tz, 'd MMM yyyy')}</td>
                      <td className="small">{c.overlap.length ? <span style={{ color: 'var(--warn)' }}>{c.overlap.length} altri assenti</span> : <span style={{ color: 'var(--ok)' }}>OK</span>}</td>
                      <td><Actions c={c} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {view === 'calendar' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <div className="tl-date">
              <button aria-label="Mese precedente" onClick={() => setMonth(addDays(month, -1).slice(0, 8) + '01')}><IcLeft width={16} /></button>
              <button onClick={() => setMonth(today.slice(0, 8) + '01')}>Oggi</button>
              <button aria-label="Mese successivo" onClick={() => setMonth(addDays(month, 32).slice(0, 8) + '01')}><IcRight width={16} /></button>
            </div>
            <b style={{ textTransform: 'capitalize' }}>{fmtDay(month.slice(0, 8) + '15', 'MMMM yyyy')}</b>
            <span className="small muted">Approvate a tinta piena, in attesa tratteggiate</span>
          </div>
          <div className="card to-month">
            {['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'].map((d) => <div key={d} className="month-h">{d}</div>)}
            {monthDays.map((d) => {
              const items = cards.filter(
                (c) => c.from <= d && c.to >= d && (c.status === 'approved' || c.status === 'pending_manager') && (!type || c.activity_id === type) && (!q || c.person.toLowerCase().includes(q.toLowerCase())),
              );
              return (
                <div key={d} className={`to-day${d.slice(0, 7) === month.slice(0, 7) ? '' : ' out'}${d === today ? ' today' : ''}`}>
                  <span className="month-d">{Number(d.slice(8))}</span>
                  {items.slice(0, 4).map((c) => (
                    <span
                      key={c.id}
                      className="to-chip"
                      title={`${c.person} · ${c.type} · ${STATUS_LABEL[c.status]}`}
                      style={c.status === 'approved' ? { background: c.color } : { border: `1.5px dashed ${c.color}`, background: '#fff' }}
                    >
                      {c.person.split(' ').slice(-1)[0]}
                    </span>
                  ))}
                  {items.length > 4 && <span className="small muted">+{items.length - 4}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);align-items:flex-end}
        .tabs button{border:0;background:none;font:inherit;padding:8px 14px;cursor:pointer;color:var(--ink-2);border-bottom:2px solid transparent;margin-bottom:-1px}
        .tabs button[aria-pressed="true"]{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
        .to-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
        .to-card{display:flex;flex-direction:column}
        .to-h{display:flex;justify-content:space-between;gap:8px;padding:14px 16px 10px}
        .to-body{display:grid;gap:8px;padding:6px 16px 12px;font-size:13.5px}
        .to-policy{display:grid;gap:4px;padding:10px 16px;border-top:1px solid var(--line-2)}
        .to-foot{margin-top:auto;padding:12px 16px;border-top:1px solid var(--line);display:flex;justify-content:flex-end}
        .to-month{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));overflow:hidden}
        .month-h{padding:8px;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;border-bottom:1px solid var(--line);text-align:center}
        .to-day{min-height:96px;border-right:1px solid var(--line-2);border-bottom:1px solid var(--line-2);padding:6px;display:flex;flex-direction:column;gap:3px;min-width:0}
        .to-day.out{opacity:.45}
        .to-day.today .month-d{background:var(--accent);color:#fff}
        .month-d{font-weight:600;font-size:12.5px;border-radius:99px;min-width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;align-self:flex-start}
        .to-chip{font-size:11.5px;padding:1px 6px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#1d2433}
      ` }} />
    </section>
  );
}
