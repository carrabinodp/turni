'use client';
import { useEffect, useMemo, useState } from 'react';
import { addDays, fmtDay, fmtTime, weekStart } from '@/lib/time';
import { useAction } from '@/components/ui';
import { IcClose, IcLeft, IcRight } from '@/components/icons';
import { createSwap, swapCandidatesAction, type SwapBlock, type SwapCandidate, type SwapSearch } from '../richieste/actions';

const PAGE = 8;

function textOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.62 ? '#1d2433' : '#ffffff';
}

/** minuti dalla mezzanotte locale */
const mod = (iso: string, tz: string) => {
  const [h, m] = fmtTime(iso, tz).split(':').map(Number);
  return h! * 60 + m!;
};

function MiniTimeline({ blocks, tz, h0, h1, ticks }: { blocks: SwapBlock[]; tz: string; h0: number; h1: number; ticks?: boolean }) {
  const span = (h1 - h0) * 60;
  const pos = (iso: string) => ((Math.min(Math.max(mod(iso, tz), h0 * 60), h1 * 60) - h0 * 60) / span) * 100;
  const sorted = [...blocks].sort((a, b) => (a.kind === 'work' ? 0 : 1) - (b.kind === 'work' ? 0 : 1));
  return (
    <div className="mt">
      {ticks && (
        <div className="mt-ticks">
          {Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i)
            .filter((h) => (h1 - h0 > 12 ? h % 2 === 0 : true))
            .map((h) => (
              <span key={h} style={{ left: `${((h - h0) / (h1 - h0)) * 100}%` }}>{String(h).padStart(2, '0')}</span>
            ))}
        </div>
      )}
      <div className="mt-bar">
        {sorted.map((b, i) => {
          const l = pos(b.s);
          const w = Math.max(0.6, pos(b.e) - l);
          return (
            <span key={i} title={`${b.name} ${fmtTime(b.s, tz)}–${fmtTime(b.e, tz)}`} style={{ left: `${l}%`, width: `${w}%`, background: b.color, color: textOn(b.color) }}>
              {w > 14 ? b.name : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function SwapPanel(props: {
  tz: string;
  today: string;
  initialDay: string;
  myDays: string[]; // giorni con un mio turno scambiabile
  reviewers: { id: string; name: string }[];
  onClose: () => void;
  /** solo per l'anteprima senza database */
  search?: (day: string, from: string, to: string) => Promise<SwapSearch>;
}) {
  const { tz, today } = props;
  const [day, setDay] = useState(props.initialDay);
  const [from, setFrom] = useState(weekStart(props.initialDay) < today ? today : weekStart(props.initialDay));
  const [to, setTo] = useState(addDays(weekStart(props.initialDay), 6));
  const [agent, setAgent] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [note, setNote] = useState('');
  const [res, setRes] = useState<SwapSearch | null>(null);
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const { run, busy } = useAction();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setPick(null);
    setPage(0);
    (props.search ?? swapCandidatesAction)(day, from, to)
      .then((r) => alive && setRes(r))
      .catch(() => alive && setRes({ ok: false, error: 'Non riesco a caricare i turni, riprova' }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [day, from, to]);

  const all = res?.ok ? res.candidates : [];
  const agents = useMemo(() => Array.from(new Map(all.map((c) => [c.person_id, c.full_name])).entries()).sort((a, b) => a[1].localeCompare(b[1])), [all]);
  const list = all.filter((c) => !agent || c.person_id === agent);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const shown = list.slice(page * PAGE, page * PAGE + PAGE);
  const key = (c: SwapCandidate) => `${c.person_id}|${c.day}`;
  const chosen = all.find((c) => key(c) === pick) ?? null;

  // finestra oraria comune per le mini-timeline
  const [h0, h1] = useMemo(() => {
    const all2 = [...(res?.ok ? res.mine.blocks : []), ...shown.flatMap((c) => c.blocks)];
    if (!all2.length) return [8, 20];
    let lo = 24 * 60, hi = 0;
    for (const b of all2) {
      lo = Math.min(lo, mod(b.s, tz));
      hi = Math.max(hi, mod(b.e, tz) || 24 * 60);
    }
    return [Math.max(0, Math.floor(lo / 60)), Math.min(24, Math.ceil(hi / 60))];
  }, [res, shown, tz]);

  const idx = props.myDays.indexOf(day);
  const stepDay = (n: number) => {
    const next = props.myDays[idx + n];
    if (next) setDay(next);
  };

  const mine = res?.ok ? res.mine : null;

  return (
    <div className="sp-back" onClick={props.onClose}>
      <aside className="sp" role="dialog" aria-label="Richiesta di scambio di turno" onClick={(e) => e.stopPropagation()}>
        <div className="sp-h">
          <h2>Richiesta di scambio di turno</h2>
          <button className="btn btn-icon btn-ghost btn-sm" aria-label="Chiudi" onClick={props.onClose}><IcClose /></button>
        </div>

        <div className="sp-body">
          <label className="field">
            <span>Chi deve approvare (facoltativo)</span>
            <select id="sp-rev" className="select" value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
              <option value="">Qualsiasi manager</option>
              {props.reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <span className="small muted">Se lo scegli, la notifica arriva solo a lui.</span>
          </label>

          <div className="field">
            <span>Il tuo turno da scambiare</span>
            <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
              <select id="sp-day" className="select" style={{ flex: 1 }} value={day} onChange={(e) => setDay(e.target.value)}>
                {!props.myDays.includes(day) && <option value={day}>{fmtDay(day, 'EEE d MMM yyyy')}</option>}
                {props.myDays.map((d) => <option key={d} value={d}>{fmtDay(d, 'EEE d MMM yyyy')}</option>)}
              </select>
              <button className="btn btn-icon btn-sm" aria-label="Turno precedente" disabled={idx <= 0} onClick={() => stepDay(-1)}><IcLeft /></button>
              <button className="btn btn-icon btn-sm" aria-label="Turno successivo" disabled={idx < 0 || idx >= props.myDays.length - 1} onClick={() => stepDay(1)}><IcRight /></button>
            </div>
            {mine && mine.blocks.length > 0 && (
              <div className="sp-mine">
                <MiniTimeline blocks={mine.blocks} tz={tz} h0={h0} h1={h1} ticks />
                {mine.day_type && <span className="pill" style={{ background: mine.day_color ?? undefined, color: '#1d2433', justifySelf: 'start' }}>{mine.day_type}</span>}
              </div>
            )}
          </div>

          <div className="field">
            <span>Giorni in cui cercare</span>
            <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
              <input id="sp-from" className="input" type="date" min={today} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
              <span className="muted">→</span>
              <input id="sp-to" className="input" type="date" min={from} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
            </div>
            <span className="small muted">Stesso giorno: scambi l’orario. Giorno diverso: scambi anche il riposo (es. lavori il suo giorno e riposi il tuo).</span>
          </div>

          <label className="field">
            <span>Filtra per collega</span>
            <select id="sp-agent" className="select" value={agent} onChange={(e) => { setAgent(e.target.value); setPage(0); }}>
              <option value="">Tutti ({all.length} turni compatibili)</option>
              {agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>

          <div className="sp-list" aria-busy={loading}>
            {loading && <div className="empty">Cerco i turni compatibili…</div>}
            {!loading && res && !res.ok && <div className="alert alert-bad">{res.error}</div>}
            {!loading && res?.ok && list.length === 0 && (
              <div className="empty">Nessun turno compatibile in questi giorni. Prova ad allargare l’intervallo.</div>
            )}
            {!loading &&
              shown.map((c) => {
                const k = key(c);
                const typeChange = mine?.day_type !== c.day_type && (mine?.day_type || c.day_type);
                return (
                  <label key={k} className={`sp-c${pick === k ? ' on' : ''}`}>
                    <input type="radio" name="sp-pick" checked={pick === k} onChange={() => setPick(k)} />
                    <div style={{ minWidth: 0, flex: 1, display: 'grid', gap: 5 }}>
                      <div className="sp-c-h">
                        <b>{c.full_name}</b>
                        <span className="muted">{fmtDay(c.day, 'EEE d MMM')}</span>
                        <span className="tabnum">{fmtTime(c.starts_at, tz)}–{fmtTime(c.ends_at, tz)}</span>
                        {c.day_type && <span className="pill" style={{ background: c.day_color ?? undefined, color: '#1d2433' }}>{c.day_type}</span>}
                      </div>
                      <MiniTimeline blocks={c.blocks} tz={tz} h0={h0} h1={h1} />
                      {c.mode === 'rest_swap' ? (
                        <span className="small sp-rest">
                          Scambio di riposo: lavori tu {fmtDay(c.day, 'EEE d')} e riposi {fmtDay(day, 'EEE d')}; {c.full_name.split(' ')[0]} fa il contrario.
                        </span>
                      ) : null}
                      {typeChange && (
                        <span className="small muted">
                          Prenderesti anche la giornata {c.day_type ? `in ${c.day_type}` : 'senza tipo'}
                          {mine?.day_type ? `, e il collega la tua in ${mine.day_type}` : ''}.
                        </span>
                      )}
                      {c.issues.length > 0 && <span className="small sp-warn">⚠ {c.issues.join(' · ')}</span>}
                    </div>
                  </label>
                );
              })}
          </div>

          {pages > 1 && (
            <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}><IcLeft /></button>
              <span className="small muted">Pagina {page + 1} di {pages} · {list.length} turni</span>
              <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><IcRight /></button>
            </div>
          )}

          <label className="field">
            <span>Messaggio (facoltativo)</span>
            <input id="sp-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Es. ho una visita al mattino" />
          </label>
        </div>

        <div className="sp-foot">
          <span className="small muted">Il collega deve accettare, poi approva un manager.</span>
          <button
            className="btn btn-primary"
            disabled={!chosen || busy}
            onClick={() => chosen && run(() => createSwap(day, chosen.person_id, chosen.day, note, reviewer || null), props.onClose)}
          >
            Richiedi scambio
          </button>
        </div>
      </aside>

      <style dangerouslySetInnerHTML={{ __html: `
        .sp-back{position:fixed;inset:0;background:rgb(16 24 40 / .25);z-index:60;display:flex;justify-content:flex-end}
        .sp{background:#fff;width:min(560px,100%);height:100%;display:flex;flex-direction:column;box-shadow:-12px 0 40px rgb(16 24 40 / .18)}
        .sp-h{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--line)}
        .sp-body{flex:1;overflow:auto;padding:16px 18px;display:grid;gap:14px;align-content:start}
        .sp-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 18px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line)}
        .sp-mine{display:grid;gap:6px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fafbfc}
        .sp-list{display:grid;gap:8px}
        .sp-c{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:8px;cursor:pointer}
        .sp-c:hover{background:var(--hover)}
        .sp-c.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent);background:var(--accent-soft)}
        .sp-c input{margin-top:3px}
        .sp-c-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .sp-rest{color:#22409f}
        .sp-warn{color:var(--warn)}
        .mt{display:grid;gap:2px}
        .mt-ticks{position:relative;height:14px;font-size:10px;color:var(--muted)}
        .mt-ticks span{position:absolute;transform:translateX(-50%)}
        .mt-ticks span:first-child{transform:none}
        .mt-bar{position:relative;height:20px;border-radius:4px;background:repeating-linear-gradient(135deg,#fff 0 5px,#f3f4f6 5px 6px);border:1px solid var(--line-2);overflow:hidden}
        .mt-bar span{position:absolute;top:0;bottom:0;font-size:10.5px;font-weight:600;display:flex;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap;border-right:1px solid rgb(255 255 255 / .4)}
      ` }} />
    </div>
  );
}
