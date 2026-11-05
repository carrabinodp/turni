'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addDays, fmtDay, minutesLabel } from '@/lib/time';
import { slotLabel, type IntervalAgg } from '@/lib/calls';
import {
  analyze, bestMethod, byDay, forecastDays, requiredAgents, slAnswered, slotAht,
  type DayData, type ForecastPolicy,
} from '@/lib/forecast';
import { IcLeft, IcRight } from '@/components/icons';
import UploadCalls from './UploadCalls';
import ForecastSettings from './ForecastSettings';

type Tab = 'prev' | 'storico' | 'carica' | 'imp';
type Heat = 'offered' | 'lost' | 'sl' | 'cov';
export interface Upload { id: string; file_name: string | null; from_day: string; to_day: string; calls: number; queues: string[]; uploaded_at: string }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const WD = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const pct = (x: number | null | undefined, d = 0) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(d).replace('.', ',')}%`);
const n1 = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1).replace('.', ','));
const secs = (s: number | null) => (s === null ? '—' : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.round(s)} s`);

export default function ForecastView(props: {
  tz: string;
  today: string;
  intervals: IntervalAgg[];
  uploads: Upload[];
  activities: { id: string; name: string; color: string }[];
  phoneIds: string[];
  policy: ForecastPolicy;
  week: string;
  from: string;
  to: string;
  histStaff: Record<string, number[]>;
  fcStaff: Record<string, number[]>;
  initialTab: string | null;
}) {
  const { policy, week } = props;
  const router = useRouter();
  const hasData = props.intervals.length > 0;
  const [tab, setTab] = useState<Tab>((['prev', 'storico', 'carica', 'imp'] as Tab[]).includes(props.initialTab as Tab) ? (props.initialTab as Tab) : hasData ? 'prev' : 'carica');
  const queues = useMemo(() => Array.from(new Set(props.intervals.map((r) => r.queue))).filter(Boolean).sort(), [props.intervals]);
  const [queue, setQueue] = useState('');
  const hist = useMemo(() => byDay(props.intervals, queue || null), [props.intervals, queue]);
  const dataRange = hasData ? { from: props.intervals[0]!.day, to: props.intervals[props.intervals.length - 1]!.day } : null;

  const go = (q: Record<string, string>) => {
    const p = new URLSearchParams({ w: week, from: props.from, to: props.to, tab, ...q });
    router.push(`/forecast?${p.toString()}`);
  };

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div className="page-head">
        <div>
          <h1>Forecast e coperture</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Chiamate per fascia oraria, dove il team è andato in difficoltà e quante persone servono al telefono nelle prossime settimane.
          </p>
        </div>
        {queues.length > 0 && (
          <select className="select" value={queue} onChange={(e) => setQueue(e.target.value)} aria-label="Coda">
            <option value="">Tutte le code</option>
            {queues.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        )}
      </div>

      <div className="tabs" role="tablist">
        {([['prev', 'Previsione'], ['storico', 'Storico e coperture'], ['carica', 'Carica chiamate'], ['imp', 'Impostazioni']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'prev' && (hasData ? <Forecast {...props} hist={hist} go={go} /> : <NoData onUpload={() => setTab('carica')} />)}
      {tab === 'storico' && (hasData ? <History {...props} hist={hist} go={go} dataRange={dataRange!} /> : <NoData onUpload={() => setTab('carica')} />)}
      {tab === 'carica' && <UploadCalls tz={props.tz} uploads={props.uploads} dataRange={dataRange} />}
      {tab === 'imp' && <ForecastSettings policy={policy} activities={props.activities} phoneIds={props.phoneIds} />}

      <p className="small muted" style={{ margin: 0 }}>
        Qui ci sono solo totali di squadra per mezz’ora: il file viene letto nel browser e al server arrivano numero di chiamate, risposte, perse e tempi medi.
        Nomi degli operatori e numeri di telefono non vengono letti né salvati.
      </p>

      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </div>
  );
}

function NoData({ onUpload }: { onUpload: () => void }) {
  return (
    <section className="card">
      <div className="empty">
        Non ci sono ancora chiamate caricate. Carica l’elenco delle chiamate degli ultimi mesi (almeno 3 settimane, meglio 8 o più) per vedere previsioni e coperture.
        <div style={{ marginTop: 10 }}><button className="btn btn-primary" onClick={onUpload}>Carica chiamate</button></div>
      </div>
    </section>
  );
}

/* =============================== PREVISIONE =============================== */
function Forecast(props: {
  tz: string;
  today: string;
  policy: ForecastPolicy;
  week: string;
  fcStaff: Record<string, number[]>;
  hist: Map<string, DayData>;
  phoneIds: string[];
  go: (q: Record<string, string>) => void;
}) {
  const { policy, week, hist } = props;
  const acc = useMemo(() => bestMethod(hist, policy), [hist, policy]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const fc = useMemo(() => {
    const f = forecastDays(hist, days, policy, acc.method);
    return days.map((d) => {
      const x = f.find((y) => y.day === d) ?? null;
      const req = x ? x.calls.map((c, s) => requiredAgents(c, x.aht[s]!, policy)) : new Array(48).fill(0);
      const staff = props.fcStaff[d] ?? new Array(48).fill(0);
      const actual = hist.get(d) ?? null;
      const short = req.reduce((t, r, s) => t + (staff[s]! < r ? 1 : 0), 0);
      const shortHours = req.reduce((t, r, s) => t + Math.max(0, r - staff[s]!) / 2, 0);
      return {
        day: d, f: x, req, staff, actual,
        reqHours: req.reduce((a, b) => a + b, 0) / 2,
        staffHours: staff.reduce((a, b) => a + b, 0) / 2,
        short, shortHours,
      };
    });
  }, [hist, days, policy, acc.method, props.fcStaff]);
  const firstWithF = fc.find((d) => d.f && d.day >= props.today) ?? fc.find((d) => d.f);
  const [sel, setSel] = useState<string | null>(null);
  const cur = fc.find((d) => d.day === (sel ?? firstWithF?.day)) ?? fc[0]!;
  const [busy, setBusy] = useState(false);

  const quality = acc.dailyError === null ? null : acc.dailyError < 0.08 ? ['Ottima', 'pill-ok'] : acc.dailyError < 0.15 ? ['Buona', 'pill-info'] : ['Da migliorare', 'pill-warn'];
  const noPhone = props.phoneIds.length === 0;

  async function exportXlsx() {
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const sum = [['Giorno', 'Data', 'Chiamate previste', 'Ore necessarie al telefono', 'Ore pianificate al telefono', 'Ore mancanti', 'Mezz’ore scoperte', 'Festivo', 'Settimane di storico usate']];
      const det = [['Data', 'Giorno', 'Fascia', 'Chiamate previste', 'Durata media (s)', 'Persone necessarie', 'Persone pianificate', 'Differenza']];
      for (const d of fc) {
        sum.push([fmtDay(d.day, 'EEEE'), d.day, d.f ? Math.round(d.f.total) : '', d.reqHours, d.staffHours, d.shortHours, d.short, d.f?.holiday ?? '', d.f?.basis ?? 0] as never);
        if (!d.f) continue;
        for (let s = 0; s < 48; s++) {
          if (d.f.calls[s]! < 0.05 && !d.staff[s]) continue;
          det.push([d.day, fmtDay(d.day, 'EEE'), slotLabel(s), Math.round(d.f.calls[s]! * 10) / 10, Math.round(d.f.aht[s]!), d.req[s]!, d.staff[s]!, d.staff[s]! - d.req[s]!] as never);
        }
      }
      const notes = [
        ['Come è fatta la previsione'],
        ['Volume del giorno', `Media pesata degli ultimi ${policy.history_weeks} stessi giorni della settimana (il più recente pesa di più)${acc.method === 'trend' ? ', corretta per la tendenza delle ultime 4 settimane' : ''}. Festivi esclusi dallo storico; un festivo è previsto come una domenica.`],
        ['Distribuzione', 'Quota media di ogni mezz’ora negli stessi giorni della settimana.'],
        ['Persone necessarie', `Erlang C: ${policy.sl_target}% delle chiamate risposte entro ${policy.sl_seconds} secondi, occupazione massima ${policy.max_occupancy}%. Sono persone effettivamente al telefono (pause e altre attività già escluse dai pianificati).`],
        ['Precisione', acc.dailyError === null ? 'Storico insufficiente per misurarla.' : `Provata sulle ultime 4 settimane prevedendo ogni settimana solo con i dati precedenti: errore medio ${pct(acc.dailyError, 1)} sul totale del giorno, ${pct(acc.intervalError, 1)} sulla singola mezz’ora (${acc.days} giorni).`],
      ];
      const wb = XLSX.utils.book_new();
      const w1 = XLSX.utils.aoa_to_sheet(sum);
      w1['!cols'] = sum[0]!.map((h) => ({ wch: Math.max(10, String(h).length + 2) }));
      const w2 = XLSX.utils.aoa_to_sheet(det);
      w2['!cols'] = det[0]!.map((h) => ({ wch: Math.max(10, String(h).length + 2) }));
      const w3 = XLSX.utils.aoa_to_sheet(notes);
      w3['!cols'] = [{ wch: 20 }, { wch: 120 }];
      XLSX.utils.book_append_sheet(wb, w1, 'Riepilogo');
      XLSX.utils.book_append_sheet(wb, w2, 'Per mezz’ora');
      XLSX.utils.book_append_sheet(wb, w3, 'Metodo');
      XLSX.writeFile(wb, `Forecast settimana ${week}.xlsx`);
    } finally {
      setBusy(false);
    }
  }

  // fasce da mostrare: dalla prima all'ultima con chiamate o persone
  const active = (d: (typeof fc)[number]) => {
    const on = Array.from({ length: 48 }, (_, s) => (d.f?.calls[s] ?? 0) >= 0.3 || d.staff[s]! > 0 || (d.actual?.slots[s]?.offered ?? 0) > 0);
    const a = on.indexOf(true), b = on.lastIndexOf(true);
    return a < 0 ? [] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  };
  const slots = active(cur);

  return (
    <>
      <div className="row" style={{ alignItems: 'center' }}>
        <div className="tl-date">
          <button aria-label="Settimana precedente" onClick={() => props.go({ w: addDays(week, -7) })}><IcLeft width={16} /></button>
          <input type="date" value={week} onChange={(e) => e.target.value && props.go({ w: e.target.value })} aria-label="Settimana" />
          <button aria-label="Settimana successiva" onClick={() => props.go({ w: addDays(week, 7) })}><IcRight width={16} /></button>
        </div>
        <b>Settimana dal {fmtDay(week, 'd MMMM')}</b>
        <span style={{ marginLeft: 'auto' }} />
        <button className="btn btn-primary" disabled={busy} onClick={exportXlsx}>{busy ? 'Preparo il file…' : 'Esporta in Excel'}</button>
      </div>

      <section className="card fc-acc">
        <div>
          <span className="small muted">Affidabilità della previsione</span>
          {quality ? (
            <div><span className={`pill ${quality[1]}`}>{quality[0]}</span> <b>errore medio {pct(acc.dailyError, 1)}</b> sul totale del giorno · {pct(acc.intervalError, 0)} sulla singola mezz’ora</div>
          ) : (
            <div className="muted">Servono almeno 3 settimane di storico per misurarla.</div>
          )}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Verificata “alla cieca”: per ognuna delle ultime 4 settimane la previsione è stata rifatta usando solo i dati precedenti e confrontata con le chiamate vere
          ({acc.days} giorni). Metodo scelto: {acc.method === 'trend' ? 'media pesata con tendenza' : 'media pesata degli stessi giorni'}.
          Persone necessarie per avere {policy.sl_target}% di risposte entro {policy.sl_seconds} s.
        </p>
      </section>

      {noPhone && (
        <div className="pill pill-warn" style={{ height: 'auto', padding: '6px 10px', whiteSpace: 'normal' }}>
          Nessuna attività è indicata come “al telefono”: i pianificati risultano zero. Sceglila in Impostazioni.
        </div>
      )}

      <section className="card">
        <div className="table-wrap">
          <table className="table fc-days">
            <thead>
              <tr>
                <th>Giorno</th>
                <th className="num">Chiamate previste</th>
                <th className="num">Ricevute</th>
                <th className="num">Ore necessarie</th>
                <th className="num">Ore pianificate</th>
                <th className="num">Ore mancanti</th>
                <th>Mezz’ore scoperte</th>
              </tr>
            </thead>
            <tbody>
              {fc.map((d) => (
                <tr key={d.day} className={d.day === cur.day ? 'sel' : ''} onClick={() => setSel(d.day)}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <b>{cap(fmtDay(d.day, 'EEE d MMM'))}</b>
                    {d.f?.holiday && <span className="pill pill-warn" style={{ marginLeft: 6 }}>{d.f.holiday}</span>}
                    {d.day === props.today && <span className="pill pill-info" style={{ marginLeft: 6 }}>oggi</span>}
                  </td>
                  <td className="num">{d.f ? Math.round(d.f.total) : <span className="muted" title="Servono almeno 2 settimane di storico per questo giorno">—</span>}</td>
                  <td className="num">{d.actual ? d.actual.offered : <span className="muted">—</span>}</td>
                  <td className="num">{d.f ? minutesLabel(Math.round(d.reqHours * 60)) : '—'}</td>
                  <td className="num">{minutesLabel(Math.round(d.staffHours * 60)) || '0'}</td>
                  <td className="num">{d.shortHours > 0 ? <b className="bad">{minutesLabel(Math.round(d.shortHours * 60))}</b> : <span className="ok">—</span>}</td>
                  <td><Strip req={d.req} staff={d.staff} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <b>{cap(fmtDay(cur.day, 'EEEE d MMMM'))} · per mezz’ora</b>
          <span className="small muted">
            <i className="lg lg-req" /> necessari <i className="lg lg-staff" /> pianificati al telefono
            {cur.actual && <> <i className="lg lg-act" /> chiamate ricevute</>}
          </span>
        </div>
        {!cur.f ? (
          <div className="empty">Storico insufficiente per prevedere questo giorno.</div>
        ) : (
          <>
            <Chart slots={slots} req={cur.req} staff={cur.staff} />
            <div className="table-wrap">
              <table className="table fc-grid">
                <thead>
                  <tr><th />{slots.map((s) => <th key={s}>{slotLabel(s)}</th>)}</tr>
                </thead>
                <tbody>
                  <tr><th>Chiamate previste</th>{slots.map((s) => <td key={s}>{n1(cur.f!.calls[s]!)}</td>)}</tr>
                  {cur.actual && <tr><th>Ricevute</th>{slots.map((s) => <td key={s}>{cur.actual!.slots[s]!.offered || ''}</td>)}</tr>}
                  <tr><th>Durata media</th>{slots.map((s) => <td key={s} className="muted">{cur.f!.calls[s]! >= 0.3 ? secs(cur.f!.aht[s]!) : ''}</td>)}</tr>
                  <tr><th>Necessari</th>{slots.map((s) => <td key={s}><b>{cur.req[s] || ''}</b></td>)}</tr>
                  <tr><th>Pianificati</th>{slots.map((s) => <td key={s}>{cur.staff[s] || ''}</td>)}</tr>
                  <tr>
                    <th>Differenza</th>
                    {slots.map((s) => {
                      const v = cur.staff[s]! - cur.req[s]!;
                      return <td key={s} className={v < 0 ? 'cov-bad' : v > 1 ? 'cov-over' : 'cov-ok'}>{v > 0 ? `+${v}` : v || '='}</td>;
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}

/** striscia della giornata: rosso dove mancano persone */
function Strip({ req, staff }: { req: number[]; staff: number[] }) {
  const on = req.map((r, s) => r > 0 || staff[s]! > 0);
  const a = Math.max(0, Math.min(on.indexOf(true), 14));
  const b = Math.max(on.lastIndexOf(true), 42);
  if (on.indexOf(true) < 0) return <span className="muted">—</span>;
  return (
    <span className="strip" aria-hidden="true">
      {Array.from({ length: b - a + 1 }, (_, i) => a + i).map((s) => {
        const r = req[s]!, st = staff[s]!;
        const c = !r && !st ? 'off' : st < r ? (r - st >= 2 ? 'bad2' : 'bad') : st - r > 1 ? 'over' : 'ok';
        return <i key={s} className={c} title={`${slotLabel(s)} necessari ${r}, pianificati ${st}`} />;
      })}
    </span>
  );
}

function Chart({ slots, req, staff }: { slots: number[]; req: number[]; staff: number[] }) {
  if (!slots.length) return null;
  const W = 22, H = 120, pad = 18;
  const max = Math.max(1, ...slots.map((s) => Math.max(req[s]!, staff[s]!)));
  const y = (v: number) => pad + (H - pad) * (1 - v / max);
  const step = slots.map((s, i) => `${i === 0 ? 'M' : 'L'}${i * W},${y(staff[s]!)} L${(i + 1) * W},${y(staff[s]!)}`).join(' ');
  return (
    <svg className="fc-chart" viewBox={`0 0 ${slots.length * W} ${H + 16}`} preserveAspectRatio="none" role="img" aria-label="Necessari e pianificati per mezz’ora">
      {[0.5, 1].map((f) => <line key={f} x1={0} x2={slots.length * W} y1={y(max * f)} y2={y(max * f)} className="grid" />)}
      {slots.map((s, i) => (
        <rect key={s} x={i * W + 3} width={W - 6} y={y(req[s]!)} height={H - y(req[s]!)} className={staff[s]! < req[s]! ? 'bar bar-bad' : 'bar'} rx={2} />
      ))}
      <path d={step} className="staff" />
    </svg>
  );
}

/* =============================== STORICO =============================== */
function History(props: {
  policy: ForecastPolicy;
  from: string;
  to: string;
  histStaff: Record<string, number[]>;
  hist: Map<string, DayData>;
  dataRange: { from: string; to: string };
  go: (q: Record<string, string>) => void;
}) {
  const { policy, from, to } = props;
  const [heat, setHeat] = useState<Heat>('lost');
  const ranged = useMemo(() => new Map(Array.from(props.hist).filter(([d]) => d >= from && d <= to)), [props.hist, from, to]);
  const staff = useMemo(() => new Map(Object.entries(props.histStaff)), [props.histStaff]);
  const an = useMemo(() => analyze(ranged, staff, policy), [ranged, staff, policy]);
  const hasStaff = an.daily.some((d) => d.staffHours > 0);

  // come avete retto: livello di servizio quando eravate sotto il necessario o no
  const held = useMemo(() => {
    const b = { under: { ok: 0, base: 0, lost: 0, n: 0 }, fine: { ok: 0, base: 0, lost: 0, n: 0 } };
    ranged.forEach((d) => {
      const st = staff.get(d.day);
      if (!st) return;
      d.slots.forEach((s, i) => {
        if (!s.offered) return;
        const r = requiredAgents(s.offered, slotAht(s), policy);
        const k = st[i]! < r ? b.under : b.fine;
        k.ok += slAnswered(s, policy.sl_seconds);
        k.base += s.offered - s.short_abandoned;
        k.lost += s.abandoned - s.short_abandoned;
        k.n++;
      });
    });
    return b;
  }, [ranged, staff, policy]);

  const cells = an.cells;
  const minS = Math.min(...cells.map((c) => c.slot), 47), maxS = Math.max(...cells.map((c) => c.slot), 0);
  const slots = Array.from({ length: Math.max(0, maxS - minS + 1) }, (_, i) => minS + i);
  const cell = new Map(cells.map((c) => [`${c.weekday}|${c.slot}`, c]));
  const maxOff = Math.max(1, ...cells.map((c) => c.offered));
  const maxLost = Math.max(0.1, ...cells.map((c) => c.abandoned));
  const target = policy.sl_target / 100;
  const color = (c: (typeof cells)[number] | undefined): [string, string] => {
    if (!c) return ['', ''];
    if (heat === 'offered') return [`rgba(49,87,213,${0.08 + 0.8 * (c.offered / maxOff)})`, n1(c.offered)];
    if (heat === 'lost') return c.abandoned < 0.05 ? ['#f6f7f9', ''] : [`rgba(194,53,47,${0.1 + 0.8 * (c.abandoned / maxLost)})`, n1(c.abandoned)];
    if (heat === 'sl') {
      if (c.sl === null) return ['#f6f7f9', ''];
      const g = c.sl >= target ? '#cfeedd' : c.sl >= target - 0.1 ? '#fde7c4' : c.sl >= target - 0.25 ? '#f9c2bf' : '#ef8f8a';
      return [g, `${Math.round(c.sl * 100)}`];
    }
    const v = c.staff - c.required;
    const g = v <= -2 ? '#ef8f8a' : v < -0.25 ? '#f9c2bf' : v > 2 ? '#d6e2fb' : '#cfeedd';
    return [g, v > 0.25 ? `+${n1(v)}` : v < -0.25 ? `−${n1(-v)}` : '='];
  };

  const worst = cells
    .filter((c) => c.abandoned >= 0.3)
    .sort((a, b) => b.abandoned - a.abandoned)
    .slice(0, 8);
  const lost = an.kpi.abandoned - an.kpi.shortAbandoned;

  return (
    <>
      <div className="row" style={{ alignItems: 'center' }}>
        <label className="field"><span>Dal</span><input className="input" type="date" value={from} min={props.dataRange.from} max={to} onChange={(e) => e.target.value && props.go({ from: e.target.value })} /></label>
        <label className="field"><span>Al</span><input className="input" type="date" value={to} min={from} onChange={(e) => e.target.value && props.go({ to: e.target.value })} /></label>
        <div className="seg" style={{ alignSelf: 'flex-end' }}>
          {[7, 28, 91].map((n) => (
            <button key={n} onClick={() => props.go({ from: addDays(props.dataRange.to, -(n - 1)), to: props.dataRange.to })} aria-pressed={from === addDays(props.dataRange.to, -(n - 1)) && to === props.dataRange.to}>
              {n === 7 ? 'Ultima settimana' : n === 28 ? 'Ultime 4 settimane' : 'Ultimi 3 mesi'}
            </button>
          ))}
        </div>
        <span className="small muted" style={{ marginLeft: 'auto' }}>Dati disponibili dal {fmtDay(props.dataRange.from, 'd MMM yyyy')} al {fmtDay(props.dataRange.to, 'd MMM yyyy')}</span>
      </div>

      <div className="kpis">
        <Kpi label="Chiamate ricevute" value={an.kpi.offered.toLocaleString('it-IT')} sub={`${an.kpi.days} giorni · ${n1(an.kpi.offered / Math.max(1, an.kpi.days))} al giorno`} />
        <Kpi label="Risposte" value={pct(an.kpi.answered / Math.max(1, an.kpi.offered))} sub={`${an.kpi.answered.toLocaleString('it-IT')} chiamate`} />
        <Kpi label="Perse" value={lost.toLocaleString('it-IT')} sub={`${pct(lost / Math.max(1, an.kpi.offered - an.kpi.shortAbandoned), 1)} · senza ${an.kpi.shortAbandoned} riattaccate entro 5 s`} tone={lost / Math.max(1, an.kpi.offered) > 0.08 ? 'bad' : undefined} />
        <Kpi label={`Livello di servizio (${policy.sl_seconds} s)`} value={pct(an.kpi.sl)} sub={`obiettivo ${policy.sl_target}%`} tone={an.kpi.sl !== null && an.kpi.sl < target ? 'bad' : 'ok'} />
        <Kpi label="Attesa media" value={secs(an.kpi.asa)} sub="delle chiamate risposte" />
        <Kpi label="Durata media" value={secs(an.kpi.aht)} sub="conversazione + post-chiamata" />
      </div>

      {hasStaff && held.under.n > 0 && (
        <section className="card fc-held">
          <div>
            <span className="small muted">Quando eravate sotto il necessario</span>
            <b className="bad">{pct(held.under.base ? held.under.ok / held.under.base : null)}</b>
            <span className="small">risposte entro {policy.sl_seconds} s · {held.under.lost} perse in {held.under.n} mezz’ore</span>
          </div>
          <div>
            <span className="small muted">Quando eravate coperti</span>
            <b className="ok">{pct(held.fine.base ? held.fine.ok / held.fine.base : null)}</b>
            <span className="small">risposte entro {policy.sl_seconds} s · {held.fine.lost} perse in {held.fine.n} mezz’ore</span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Confronta i turni pianificati con le persone che sarebbero servite per le chiamate arrivate davvero. Se la differenza è netta, il calcolo delle persone necessarie è affidabile per il vostro team.
          </p>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <b>Giorno della settimana × fascia oraria</b>
          <div className="seg">
            {([['lost', 'Perse'], ['sl', 'Livello di servizio'], ['offered', 'Chiamate'], ['cov', 'Copertura']] as [Heat, string][]).map(([k, l]) => (
              <button key={k} aria-pressed={heat === k} onClick={() => setHeat(k)} disabled={k === 'cov' && !hasStaff} title={k === 'cov' && !hasStaff ? 'Nessun turno al telefono nel periodo' : undefined}>{l}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table className="heat">
            <thead><tr><th />{slots.map((s) => <th key={s}>{s % 2 === 0 ? slotLabel(s).slice(0, 2) : ''}</th>)}</tr></thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
                <tr key={wd}>
                  <th>{WD[wd - 1]}</th>
                  {slots.map((s) => {
                    const c = cell.get(`${wd}|${s}`);
                    const [bg, txt] = color(c);
                    return (
                      <td key={s} style={{ background: bg }} title={c ? `${WD[wd - 1]} ${slotLabel(s)} · media ${n1(c.offered)} chiamate, ${n1(c.abandoned)} perse, servizio ${pct(c.sl)}${hasStaff ? `, pianificati ${n1(c.staff)} su ${n1(c.required)} necessari` : ''} (${c.days} giorni)` : undefined}>
                        {txt}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ margin: 0, padding: '8px 16px 12px' }}>
          {heat === 'lost' && 'Chiamate perse in media in quella mezz’ora (riattaccate incluse).'}
          {heat === 'sl' && `Percentuale di chiamate risposte entro ${policy.sl_seconds} secondi: verde sopra l’obiettivo del ${policy.sl_target}%.`}
          {heat === 'offered' && 'Chiamate ricevute in media in quella mezz’ora.'}
          {heat === 'cov' && 'Persone pianificate al telefono meno persone necessarie per le chiamate arrivate: rosso = mancavano persone, blu = più del necessario.'}
        </p>
      </section>

      <div className="fc-two">
        <section className="card">
          <div className="card-head"><b>Dove avete perso più chiamate</b></div>
          {worst.length === 0 ? (
            <div className="empty">Nessuna fascia con perdite rilevanti nel periodo.</div>
          ) : (
            <table className="table">
              <thead><tr><th>Fascia</th><th className="num">Chiamate</th><th className="num">Perse</th><th className="num">Servizio</th>{hasStaff && <th className="num">Pianificati / necessari</th>}</tr></thead>
              <tbody>
                {worst.map((c) => (
                  <tr key={`${c.weekday}|${c.slot}`}>
                    <td><b>{WD[c.weekday - 1]}</b> {slotLabel(c.slot)}–{slotLabel(c.slot + 1)}</td>
                    <td className="num">{n1(c.offered)}</td>
                    <td className="num bad">{n1(c.abandoned)}</td>
                    <td className="num">{pct(c.sl)}</td>
                    {hasStaff && <td className="num">{n1(c.staff)} / {n1(c.required)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small muted" style={{ margin: 0, padding: '8px 16px 12px' }}>Valori medi per giorno nel periodo scelto.</p>
        </section>

        <section className="card">
          <div className="card-head"><b>Giorno per giorno</b></div>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="table">
              <thead><tr><th>Giorno</th><th className="num">Chiamate</th><th className="num">Perse</th><th className="num">Servizio</th>{hasStaff && <th className="num">Ore al telefono</th>}{hasStaff && <th className="num">Necessarie</th>}</tr></thead>
              <tbody>
                {an.daily.slice().reverse().map((d) => (
                  <tr key={d.day}>
                    <td style={{ whiteSpace: 'nowrap' }}>{cap(fmtDay(d.day, 'EEE d MMM'))}</td>
                    <td className="num">{d.offered}</td>
                    <td className="num">{d.abandoned || '—'}</td>
                    <td className={`num ${d.sl !== null && d.sl < target ? 'bad' : ''}`}>{pct(d.sl)}</td>
                    {hasStaff && <td className="num">{n1(d.staffHours)}</td>}
                    {hasStaff && <td className={`num ${d.staffHours < d.requiredHours ? 'bad' : ''}`}>{n1(d.requiredHours)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <b className={tone ?? ''}>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

const CSS = `
  .tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);flex-wrap:wrap}
  .tabs button{border:0;background:none;font:inherit;padding:8px 14px;cursor:pointer;color:var(--ink-2);border-bottom:2px solid transparent;margin-bottom:-1px}
  .tabs button[aria-pressed="true"]{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
  .bad{color:var(--bad)} .ok{color:var(--ok)}
  .fc-acc{display:grid;grid-template-columns:minmax(260px,auto) 1fr;gap:6px 24px;padding:12px 16px;align-items:center}
  .fc-acc > div{display:grid;gap:4px}
  @media (max-width:800px){.fc-acc{grid-template-columns:1fr}}
  .fc-days td.num,.fc-days th.num,.table td.num,.table th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .fc-days tbody tr{cursor:pointer}
  .fc-days tbody tr:hover td{background:var(--hover)}
  .fc-days tr.sel td{background:var(--accent-soft)}
  .strip{display:inline-flex;gap:1px;vertical-align:middle}
  .strip i{width:5px;height:16px;border-radius:1px;background:#e6e8ec}
  .strip i.ok{background:#8fd3ae} .strip i.over{background:#a9bff2} .strip i.bad{background:#f3a19c} .strip i.bad2{background:var(--bad)} .strip i.off{background:#f1f2f4}
  .fc-chart{display:block;width:100%;height:150px;padding:8px 16px 0}
  .fc-chart .bar{fill:#cfd9f6} .fc-chart .bar-bad{fill:#f3a19c}
  .fc-chart .staff{fill:none;stroke:var(--accent);stroke-width:2.5;vector-effect:non-scaling-stroke}
  .fc-chart .grid{stroke:var(--line);stroke-dasharray:3 3;vector-effect:non-scaling-stroke}
  .fc-chart .lbl{font-size:10px;fill:var(--muted)}
  .lg{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;vertical-align:-1px}
  .lg-req{background:#cfd9f6} .lg-staff{background:var(--accent);height:3px;vertical-align:2px} .lg-act{background:var(--ink-2)}
  .fc-grid{font-size:12.5px}
  .fc-grid th,.fc-grid td{padding:5px 6px;text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums}
  .fc-grid tbody th{text-align:left;position:sticky;left:0;background:#fbfbfc;font-weight:500;color:var(--ink-2);padding-left:16px}
  .fc-grid td.cov-bad{background:var(--bad-soft);color:var(--bad);font-weight:600}
  .fc-grid td.cov-ok{color:var(--ok)}
  .fc-grid td.cov-over{background:#eef3fd;color:var(--accent)}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
  .kpi{border:1px solid var(--line);border-radius:8px;padding:10px 14px;display:grid;gap:2px;background:#fff}
  .kpi span{font-size:12.5px;color:var(--muted)}
  .kpi b{font-size:22px;font-variant-numeric:tabular-nums}
  .kpi small{color:var(--muted);font-size:12px}
  .fc-held{display:grid;grid-template-columns:auto auto 1fr;gap:8px 28px;padding:12px 16px;align-items:center}
  .fc-held > div{display:grid;gap:2px}
  .fc-held b{font-size:20px}
  @media (max-width:800px){.fc-held{grid-template-columns:1fr}}
  table.heat{border-collapse:separate;border-spacing:2px;font-size:11px;margin:10px 12px 4px}
  .heat th{font-weight:500;color:var(--muted);padding:0 4px;text-align:left}
  .heat thead th{text-align:left;font-size:10.5px}
  .heat td{width:30px;min-width:30px;height:26px;text-align:center;border-radius:3px;font-variant-numeric:tabular-nums;color:var(--ink);background:#fafafb}
  .fc-two{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
  @media (max-width:1000px){.fc-two{grid-template-columns:1fr}}
`;
