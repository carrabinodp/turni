'use client';
import { useState } from 'react';
import { useAction } from '@/components/ui';
import { slotMinimaFor, type GenConfig } from '@/lib/generator';
import { saveGenConfig } from './actions';
import type { GActivity, GDayType, GPerson } from './GeneratorView';

export default function RulesForm({ config, people, activities, dayTypes, officeDaysPerWeek, forecastTargets }: { config: GenConfig; people: GPerson[]; activities: GActivity[]; dayTypes: GDayType[]; officeDaysPerWeek: number; forecastTargets: Record<string, number[]> | null }) {
  const [c, setC] = useState<GenConfig>({ ...config, weekRoles: undefined });
  const { run, busy } = useAction();
  const W = c.weekday, S = c.saturday, D = c.sunday;
  const setW = (k: keyof GenConfig['weekday'], v: string | number) => setC({ ...c, weekday: { ...W, [k]: v } });
  const setS = (k: keyof GenConfig['saturday'], v: string | number | boolean) => setC({ ...c, saturday: { ...S, [k]: v } });
  const setD = (k: keyof GenConfig['sunday'], v: string | number | boolean) => setC({ ...c, sunday: { ...D, [k]: v } });
  const num = (v: number, set: (n: number) => void, w = 70, min = 0, max = 40) => <input className="input" type="number" min={min} max={max} value={v} onChange={(e) => set(Number(e.target.value))} style={{ width: w }} />;
  const time = (v: string, set: (t: string) => void) => <input className="input" type="time" step={900} value={v} onChange={(e) => set(e.target.value)} style={{ width: 110 }} />;
  const work = activities.filter((a) => a.kind === 'work');
  const actSel = (v: string | null, set: (id: string | null) => void) => (
    <select className="select" value={v ?? ''} onChange={(e) => set(e.target.value || null)}>
      <option value="">— scegli —</option>
      {work.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
  const inPool = (id: string) => c.rec.pool.find((r) => r.person_id === id);

  return (
    <>
      <section className="card">
        <div className="card-head"><b>Lunedì–venerdì</b></div>
        <div className="card-body gn-form">
          <label className="field"><span>Apertura</span>{time(W.open, (t) => setW('open', t))}</label>
          <label className="field"><span>Chiusura</span>{time(W.close, (t) => setW('close', t))}</label>
          <label className="field"><span>Operativi che aprono</span>{num(W.openOps, (n) => setW('openOps', n))}</label>
          <label className="field"><span>Operativi che chiudono</span>{num(W.closeOps, (n) => setW('closeOps', n))}</label>
          <label className="field"><span>Chiusure max a settimana a testa</span>{num(W.maxClosePerWeek, (n) => setW('maxClosePerWeek', n), 70, 0, 5)}</label>
          <label className="field"><span>In ufficio all’apertura</span>{num(W.officeAtOpen, (n) => setW('officeAtOpen', n))}</label>
          <label className="field"><span>In ufficio alla chiusura</span>{num(W.officeAtClose, (n) => setW('officeAtClose', n))}</label>
          <label className="field"><span>Massimo in ufficio al giorno</span>{num(W.maxOffice ?? 12, (n) => setW('maxOffice', n), 70, 1, 60)}</label>
          <div className="field"><span>Giorni in ufficio a settimana</span><div className="small" style={{ paddingTop: 8 }}><b>{officeDaysPerWeek}</b> · si cambia in Configura → Impostazioni</div></div>
        </div>
        <SlotRules c={c} setC={setC} forecastTargets={forecastTargets} />
        <p className="small muted" style={{ margin: 0, padding: '0 16px 12px' }}>
          “Aprono” e “chiudono” sono gli operativi che entrano alle {W.open} e escono alle {W.close}. La tabella è il minimo di operativi presenti in ogni mezz’ora: il generatore la rispetta e segnala dove non ci riesce.
          Chi non serve a coprire i minimi entra alle 9, l’ora con più chiamate. REC, Reclami e affiancamento non contano tra gli operativi.
        </p>
      </section>

      <ForecastCheck c={c} forecastTargets={forecastTargets} />

      <section className="card">
        <div className="card-head"><b>Weekend e festivi</b></div>
        <div className="card-body gn-form">
          <label className="check"><input type="checkbox" checked={S.enabled} onChange={(e) => setS('enabled', e.target.checked)} /> Sabato aperto</label>
          <label className="field"><span>Sabato dalle</span>{time(S.open, (t) => setS('open', t))}</label>
          <label className="field"><span>alle</span>{time(S.close, (t) => setS('close', t))}</label>
          <label className="field"><span>Persone (min)</span>{num(S.people, (n) => setS('people', n))}</label>
          <label className="field"><span>Persone (max)</span>{num(S.maxPeople, (n) => setS('maxPeople', n))}</label>
          <label className="field"><span>Almeno alle 10</span>{num(S.at1000, (n) => setS('at1000', n))}</label>
          <label className="field"><span>Almeno 14–18</span>{num(S.afternoon, (n) => setS('afternoon', n))}</label>
          <label className="field"><span>Fino alla chiusura (min–max)</span><span className="row" style={{ gap: 4 }}>{num(S.closeMin, (n) => setS('closeMin', n), 60)}{num(S.closeMax, (n) => setS('closeMax', n), 60)}</span></label>
          <label className="field"><span>Sabati max al mese a testa</span>{num(c.maxSaturdaysPerMonth, (n) => setC({ ...c, maxSaturdaysPerMonth: n }), 70, 0, 5)}</label>
          <label className="check"><input type="checkbox" checked={D.enabled} onChange={(e) => setD('enabled', e.target.checked)} /> Domenica e festivi aperti</label>
          <label className="field"><span>Persone</span>{num(D.people, (n) => setD('people', n))}</label>
          <label className="field"><span>Dalle</span>{time(D.start, (t) => setD('start', t))}</label>
          <label className="field"><span>Alle</span>{time(D.end, (t) => setD('end', t))}</label>
        </div>
        <p className="small muted" style={{ margin: 0, padding: '0 16px 12px' }}>Chi lavora sabato o domenica riposa un giorno in settimana. Sabato, domenica e festivi sono sempre in smart. I festivi infrasettimanali seguono le regole della domenica.</p>
      </section>

      <section className="card">
        <div className="card-head"><b>REC</b><span className="small muted">Una persona al giorno, non operativa; ruota ogni settimana</span></div>
        <div className="card-body">
          <div className="gn-pool">
            {people.map((p) => {
              const r = inPool(p.id);
              return (
                <div key={p.id} className={`gn-pp${r ? ' on' : ''}`}>
                  <label className="check">
                    <input type="checkbox" checked={!!r} onChange={(e) => setC({ ...c, rec: { ...c.rec, pool: e.target.checked ? [...c.rec.pool, { person_id: p.id, start: '08:30', end: '17:30' }] : c.rec.pool.filter((x) => x.person_id !== p.id) } })} />
                    {p.name}
                  </label>
                  {r && (
                    <span className="row" style={{ gap: 4 }}>
                      {time(r.start, (t) => setC({ ...c, rec: { ...c.rec, pool: c.rec.pool.map((x) => (x.person_id === p.id ? { ...x, start: t } : x)) } }))}
                      {time(r.end, (t) => setC({ ...c, rec: { ...c.rec, pool: c.rec.pool.map((x) => (x.person_id === p.id ? { ...x, end: t } : x)) } }))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="field">
            <span>Affiancamento: quando fa REC… allora fa REC anche…</span>
            {c.rec.companions.map((x, i) => (
              <div key={i} className="row" style={{ alignItems: 'center' }}>
                <select className="select" value={x.when} onChange={(e) => setC({ ...c, rec: { ...c.rec, companions: c.rec.companions.map((y, j) => (j === i ? { ...y, when: e.target.value } : y)) } })}>
                  {c.rec.pool.map((r) => <option key={r.person_id} value={r.person_id}>{people.find((p) => p.id === r.person_id)?.name}</option>)}
                </select>
                <span>→</span>
                <select className="select" value={x.person_id} onChange={(e) => setC({ ...c, rec: { ...c.rec, companions: c.rec.companions.map((y, j) => (j === i ? { ...y, person_id: e.target.value } : y)) } })}>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {time(x.start, (t) => setC({ ...c, rec: { ...c.rec, companions: c.rec.companions.map((y, j) => (j === i ? { ...y, start: t } : y)) } }))}
                {time(x.end, (t) => setC({ ...c, rec: { ...c.rec, companions: c.rec.companions.map((y, j) => (j === i ? { ...y, end: t } : y)) } }))}
                <button className="btn btn-sm btn-ghost" onClick={() => setC({ ...c, rec: { ...c.rec, companions: c.rec.companions.filter((_, j) => j !== i) } })}>Togli</button>
              </div>
            ))}
            <div>
              <button className="btn btn-sm" disabled={!c.rec.pool.length} onClick={() => setC({ ...c, rec: { ...c.rec, companions: [...c.rec.companions, { when: c.rec.pool[c.rec.pool.length - 1]!.person_id, person_id: people[0]?.id ?? '', start: '14:30', end: '18:30' }] } })}>Aggiungi affiancamento</button>
            </div>
          </div>
          <label className="field" style={{ maxWidth: 320 }}><span>Attività REC</span>{actSel(c.activities.rec, (id) => setC({ ...c, activities: { ...c.activities, rec: id } }))}</label>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><b>Reclami</b><span className="small muted">Una persona a settimana, non operativa: apre o chiude in ufficio</span></div>
        <div className="card-body">
          <div className="gn-pool">
            {people.map((p) => (
              <label key={p.id} className={`gn-pp check${c.reclami.pool.includes(p.id) ? ' on' : ''}`}>
                <input type="checkbox" checked={c.reclami.pool.includes(p.id)} onChange={(e) => setC({ ...c, reclami: { pool: e.target.checked ? [...c.reclami.pool, p.id] : c.reclami.pool.filter((x) => x !== p.id) } })} />
                {p.name}
              </label>
            ))}
          </div>
          <label className="field" style={{ maxWidth: 320 }}><span>Attività Reclami</span>{actSel(c.activities.reclami, (id) => setC({ ...c, activities: { ...c.activities, reclami: id } }))}</label>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><b>Attività e giornate</b></div>
        <div className="card-body gn-form">
          <label className="field"><span>Attività degli operativi</span>{actSel(c.activities.phone, (id) => setC({ ...c, activities: { ...c.activities, phone: id } }))}</label>
          <label className="field"><span>Giornata in ufficio</span>
            <select className="select" value={c.dayTypes.office ?? ''} onChange={(e) => setC({ ...c, dayTypes: { ...c.dayTypes, office: e.target.value || null } })}>
              <option value="">Automatica</option>{dayTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Giornata in smart</span>
            <select className="select" value={c.dayTypes.remote ?? ''} onChange={(e) => setC({ ...c, dayTypes: { ...c.dayTypes, remote: e.target.value || null } })}>
              <option value="">Automatica</option>{dayTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        </div>
        <p className="small muted" style={{ margin: 0, padding: '0 16px 12px' }}>Pause e pranzo si aggiungono con le regole di Configura (15 minuti ogni 2 ore sfalsati, pranzo nei turni da 8 ore).</p>
      </section>

      <div><button className="btn btn-primary" disabled={busy} onClick={() => run(() => saveGenConfig(c))}>Salva regole</button></div>
    </>
  );
}

const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven']; // sabato e domenica hanno le loro regole
const hh = (i: number) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
const range = (c: GenConfig) => {
  const a = Number(c.weekday.open.slice(0, 2)) * 2 + (c.weekday.open.slice(3) === '30' ? 1 : 0);
  const b = Number(c.weekday.close.slice(0, 2)) * 2 + (c.weekday.close.slice(3) === '30' ? 1 : 0);
  return Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
};

/** regola: operativi minimi per mezz'ora, per giorno */
function SlotRules({ c, setC, forecastTargets }: { c: GenConfig; setC: (c: GenConfig) => void; forecastTargets: Record<string, number[]> | null }) {
  const slots = range(c);
  const rows = Object.fromEntries([1, 2, 3, 4, 5].map((wd) => [String(wd), slotMinimaFor(c, wd)]));
  const set = (wd: number, i: number, v: number | null) => {
    const next = { ...rows, [String(wd)]: rows[String(wd)]!.map((x, j) => (j === i ? v : x)) };
    setC({ ...c, slotMin: next });
  };
  const copyMon = () => setC({ ...c, slotMin: { ...rows, ...Object.fromEntries([2, 3, 4, 5].map((wd) => [String(wd), [...rows['1']!]])) } });
  const fromForecast = () => {
    if (!forecastTargets) return;
    setC({ ...c, slotMin: Object.fromEntries([1, 2, 3, 4, 5].map((wd) => [String(wd), Array.from({ length: 48 }, (_, i) => (slots.includes(i) ? Math.max(rows[String(wd)]![i] ?? 0, forecastTargets[String(wd)]?.[Math.floor(i / 2)] ?? 0) || null : null))])) });
  };
  return (
    <div style={{ padding: '0 16px 8px' }}>
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 6px' }}>
        <b className="small">Operativi minimi per fascia oraria (regola)</b>
        <div className="row">
          <button className="btn btn-sm" onClick={copyMon}>Copia il lunedì su mar–ven</button>
          <button className="btn btn-sm" disabled={!forecastTargets} title={forecastTargets ? 'Alza i minimi dove il forecast chiede più persone' : 'Carica le chiamate in Forecast per usarlo'} onClick={fromForecast}>Alza ai valori del forecast</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="tg">
          <thead><tr><th />{slots.map((i) => <th key={i} className={i % 2 ? 'half' : ''}>{i % 2 ? ':30' : hh(i).slice(0, 2)}</th>)}</tr></thead>
          <tbody>
            {DAYS.map((d, k) => (
              <tr key={d}>
                <th>{d}</th>
                {slots.map((i) => (
                  <td key={i}>
                    <input type="number" min={0} max={60} value={rows[String(k + 1)]![i] ?? ''} aria-label={`${d} ${hh(i)}`}
                      onChange={(e) => set(k + 1, i, e.target.value === '' ? null : Number(e.target.value))} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `.tg{border-collapse:collapse;font-size:12px}.tg th{font-weight:500;color:var(--muted);padding:3px 2px;white-space:nowrap;text-align:center}.tg th.half{font-size:10px;color:#a3a9b5}.tg td{padding:1px}.tg input{width:36px;height:28px;border:1px solid var(--line);border-radius:4px;text-align:center;font:inherit;padding:0}.tg td.ok{background:var(--ok-soft);color:var(--ok)}.tg td.bad{background:var(--bad-soft);color:var(--bad);font-weight:600}.tg td.cmp{min-width:46px;text-align:center;padding:5px 2px;border:1px solid #fff}` }} />
    </div>
  );
}

/** confronto: minimi delle regole contro persone necessarie secondo il forecast (solo lettura) */
function ForecastCheck({ c, forecastTargets }: { c: GenConfig; forecastTargets: Record<string, number[]> | null }) {
  const hours = Array.from(new Set(range(c).map((i) => Math.floor(i / 2))));
  return (
    <section className="card">
      <div className="card-head"><b>Confronto con il forecast</b><span className="small muted">Solo da guardare: minimo delle regole / persone necessarie secondo il forecast del mese</span></div>
      {!forecastTargets ? (
        <div className="empty">Carica le chiamate in Forecast per vedere il confronto.</div>
      ) : (
        <div className="table-wrap" style={{ padding: '8px 16px' }}>
          <table className="tg">
            <thead><tr><th />{hours.map((h) => <th key={h}>{h}–{h + 1}</th>)}</tr></thead>
            <tbody>
              {DAYS.map((d, k) => {
                const mins = slotMinimaFor(c, k + 1);
                return (
                  <tr key={d}>
                    <th>{d}</th>
                    {hours.map((h) => {
                      const m = Math.max(mins[h * 2] ?? 0, mins[h * 2 + 1] ?? 0);
                      const f = forecastTargets[String(k + 1)]?.[h] ?? 0;
                      const cls = !f && !m ? '' : m >= f ? 'ok' : 'bad';
                      return <td key={h} className={`cmp ${cls}`} title={`Regola ${m || '—'} · forecast ${f}`}>{m || '—'} / {f}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted" style={{ margin: '8px 0 0' }}>Rosso: la regola chiede meno persone di quelle che servono secondo le chiamate previste. Il generatore usa solo le regole; il resto delle persone entra alle 9.</p>
        </div>
      )}
    </section>
  );
}
