'use client';
import { useState } from 'react';
import { useAction } from '@/components/ui';
import type { GenConfig } from '@/lib/generator';
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
          <label className="field"><span>Operativi dopo le 18</span>{num(W.after1800, (n) => setW('after1800', n))}</label>
          <label className="field"><span>Operativi dopo le 18:30 (fino alle 19)</span>{num(W.after1830, (n) => setW('after1830', n))}</label>
          <label className="field"><span>Chiusure max a settimana a testa</span>{num(W.maxClosePerWeek, (n) => setW('maxClosePerWeek', n), 70, 0, 5)}</label>
          <label className="field"><span>In ufficio all’apertura</span>{num(W.officeAtOpen, (n) => setW('officeAtOpen', n))}</label>
          <label className="field"><span>In ufficio alla chiusura</span>{num(W.officeAtClose, (n) => setW('officeAtClose', n))}</label>
          <label className="field"><span>Massimo in ufficio al giorno</span>{num(W.maxOffice ?? 12, (n) => setW('maxOffice', n), 70, 1, 60)}</label>
          <div className="field"><span>Giorni in ufficio a settimana</span><div className="small" style={{ paddingTop: 8 }}><b>{officeDaysPerWeek}</b> · si cambia in Configura → Impostazioni</div></div>
        </div>
        <p className="small muted" style={{ margin: 0, padding: '0 16px 12px' }}>Tutti gli altri entrano alle 9, l’ora con più chiamate, oppure dove mancano persone secondo la tabella qui sotto. REC, Reclami e affiancamento non contano tra gli operativi.</p>
      </section>

      <Targets c={c} setC={setC} forecastTargets={forecastTargets} />

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
const HOURS = Array.from({ length: 13 }, (_, i) => 8 + i); // 8 … 20

/** operativi desiderati per fascia oraria (ora piena), per giorno della settimana */
function Targets({ c, setC, forecastTargets }: { c: GenConfig; setC: (c: GenConfig) => void; forecastTargets: Record<string, number[]> | null }) {
  const t = c.targets ?? {};
  const get = (wd: number, h: number) => t[String(wd)]?.[h] ?? null;
  const set = (wd: number, h: number, v: number | null) => {
    const row = [...(t[String(wd)] ?? new Array(24).fill(null))];
    row[h] = v;
    setC({ ...c, targets: { ...t, [String(wd)]: row } });
  };
  const copyMon = () => setC({ ...c, targets: { ...t, ...Object.fromEntries([2, 3, 4, 5].map((wd) => [String(wd), [...(t['1'] ?? new Array(24).fill(null))]])) } });
  const fromForecast = () => {
    if (!forecastTargets) return;
    const next: Record<string, (number | null)[]> = {};
    for (let wd = 1; wd <= 5; wd++) {
      const f = forecastTargets[String(wd)];
      next[String(wd)] = Array.from({ length: 24 }, (_, h) => (f && f[h]! > 0 && HOURS.includes(h) ? f[h]! : null));
    }
    setC({ ...c, targets: next });
  };
  return (
    <section className="card">
      <div className="card-head">
        <b>Operativi desiderati per fascia oraria</b>
        <div className="row">
          <button className="btn btn-sm" onClick={copyMon}>Copia il lunedì su mar–ven</button>
          <button className="btn btn-sm" disabled={!forecastTargets} title={forecastTargets ? 'Persone necessarie al telefono secondo il forecast del mese' : 'Carica le chiamate in Forecast per usarlo'} onClick={fromForecast}>Usa il forecast</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setC({ ...c, targets: {} })}>Svuota</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="tg">
          <thead><tr><th />{HOURS.map((h) => <th key={h}>{h}–{h + 1}</th>)}</tr></thead>
          <tbody>
            {DAYS.map((d, i) => (
              <tr key={d}>
                <th>{d}</th>
                {HOURS.map((h) => (
                  <td key={h}>
                    <input
                      type="number" min={0} max={60} value={get(i + 1, h) ?? ''} aria-label={`${d} ${h}`}
                      placeholder={forecastTargets?.[String(i + 1)]?.[h] ? String(forecastTargets[String(i + 1)]![h]) : ''}
                      onChange={(e) => set(i + 1, h, e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ margin: 0, padding: '8px 16px 12px' }}>
        Quante persone operative vorresti in ogni ora (REC e Reclami esclusi). Vuoto = nessuna preferenza. Il generatore mette prima aperture, chiusure e sera, poi distribuisce gli altri dove mancano più persone
        e segnala le ore che restano sotto. In grigio i numeri del forecast, se ci sono le chiamate caricate.
      </p>
      <style dangerouslySetInnerHTML={{ __html: `.tg{border-collapse:collapse;margin:8px 12px;font-size:12.5px}.tg th{font-weight:500;color:var(--muted);padding:4px 6px;white-space:nowrap}.tg td{padding:2px}.tg input{width:46px;height:28px;border:1px solid var(--line);border-radius:4px;text-align:center;font:inherit}.tg input::placeholder{color:#b8bdc7}` }} />
    </section>
  );
}
