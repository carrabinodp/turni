'use client';
import { Fragment, useState } from 'react';
import { useAction } from '@/components/ui';
import type { GenConfig, PersonRule } from '@/lib/generator';
import { saveGenConfig, saveProfiles } from './actions';
import type { GPerson } from './GeneratorView';

const WD = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

/** riassunto leggibile delle regole particolari */
export function ruleSummary(r: PersonRule | undefined, canWeekend: boolean): string[] {
  const out: string[] = [];
  if (!r) return canWeekend ? out : ['niente weekend'];
  if (r.fixed) out.push(`fisso ${r.fixed.days.map((d) => WD[d - 1]).join('-')} ${r.fixed.start}–${r.fixed.end}`);
  if (r.officeDays !== null && r.officeDays !== undefined) out.push(r.officeDays >= 5 ? 'mai in smart' : `${r.officeDays} gg in ufficio`);
  if (r.maxStart) out.push(`entra entro le ${r.maxStart}`);
  if (r.otherSite) out.push('altra sede');
  if (r.weekendWeek) out.push(`con weekend: ${r.weekendWeek.days} giorni (${r.weekendWeek.longDays} lungo, altri da ${r.weekendWeek.shortHours} h)`);
  if (!canWeekend) out.push('niente weekend');
  return out;
}

export default function PeopleForm({ people, suggest, config }: { people: GPerson[]; suggest: Record<string, { shiftHours: number; daysPerWeek: number; samples: number }>; config: GenConfig }) {
  const [rows, setRows] = useState(people.map((p) => ({ ...p })));
  const [rules, setRules] = useState<Record<string, PersonRule>>(config.personRules ?? {});
  const [open, setOpen] = useState<string | null>(null);
  const { run, busy } = useAction();
  const set = (id: string, patch: Partial<GPerson>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const setRule = (id: string, patch: Partial<PersonRule>) => setRules({ ...rules, [id]: { ...(rules[id] ?? {}), ...patch } });
  const fillAll = () =>
    setRows(rows.map((r) => (suggest[r.id] ? { ...r, shift_hours: r.shift_hours ?? suggest[r.id]!.shiftHours, days_per_week: r.days_per_week ?? suggest[r.id]!.daysPerWeek } : r)));

  async function saveAll() {
    // tieni solo le regole compilate
    const clean: Record<string, PersonRule> = {};
    for (const [id, r] of Object.entries(rules)) {
      const x: PersonRule = {};
      if (r.officeDays !== null && r.officeDays !== undefined) x.officeDays = r.officeDays;
      if (r.maxStart) x.maxStart = r.maxStart;
      if (r.fixed && r.fixed.days.length && r.fixed.start && r.fixed.end) x.fixed = r.fixed;
      if (r.weekendWeek) x.weekendWeek = r.weekendWeek;
      if (r.otherSite) x.otherSite = true;
      if (Object.keys(x).length) clean[id] = x;
    }
    const a = await saveProfiles(rows.map((r) => ({ id: r.id, shift_hours: r.shift_hours, days_per_week: r.days_per_week, gen_exclude: r.gen_exclude, can_weekend: r.can_weekend })));
    if (!a.ok) return a;
    return saveGenConfig({ ...config, personRules: clean, weekRoles: undefined });
  }

  return (
    <section className="card">
      <div className="card-head">
        <b>Persone nel generatore</b>
        <div className="row">
          <button className="btn btn-sm" onClick={fillAll}>Completa i vuoti dallo storico</button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(saveAll)}>Salva</button>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0, padding: '10px 16px 0' }}>
        Durata del turno con il pranzo compreso: 9 = 8 ore di lavoro + 1 di pranzo, 6 = part time da 6 ore. Lo storico è calcolato sulle ultime 9 settimane.
        In “Regole” imposti i casi particolari: turno fisso, giorni in ufficio, ingresso massimo, settimana con il weekend.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Persona</th><th>Durata turno (ore)</th><th>Giorni a settimana</th><th>Dallo storico</th><th>Weekend</th><th>Escludi</th><th>Regole particolari</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const s = suggest[r.id];
              const rule = rules[r.id];
              const sum = ruleSummary(rule, r.can_weekend);
              return (
                <Fragment key={r.id}>
                  <tr style={r.gen_exclude ? { opacity: 0.5 } : undefined}>
                    <td><b>{r.name}</b>{r.role !== 'agent' && <span className="small muted"> · {r.role === 'team_lead' ? 'team lead' : r.role}</span>}</td>
                    <td><input className="input" type="number" step={0.5} min={1} max={13} value={r.shift_hours ?? ''} placeholder={s ? String(s.shiftHours) : '9'} onChange={(e) => set(r.id, { shift_hours: e.target.value ? Number(e.target.value) : null })} style={{ width: 80 }} /></td>
                    <td><input className="input" type="number" min={1} max={7} value={r.days_per_week ?? ''} placeholder={s ? String(s.daysPerWeek) : '5'} onChange={(e) => set(r.id, { days_per_week: e.target.value ? Number(e.target.value) : null })} style={{ width: 70 }} /></td>
                    <td className="small muted">{s ? `${s.shiftHours} h × ${s.daysPerWeek} giorni` : '—'}</td>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" checked={r.can_weekend} onChange={(e) => set(r.id, { can_weekend: e.target.checked })} aria-label="Può lavorare nel weekend" /></td>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" checked={r.gen_exclude} onChange={(e) => set(r.id, { gen_exclude: e.target.checked })} aria-label="Escludi dal generatore" /></td>
                    <td>
                      <button className="btn btn-sm" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>{sum.length ? sum.join(' · ') : 'Nessuna'}</button>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={7} style={{ background: '#fafbfc' }}>
                        <div className="pr-grid">
                          <label className="field"><span>Giorni in ufficio a settimana</span>
                            <select className="select" value={rule?.officeDays ?? ''} onChange={(e) => setRule(r.id, { officeDays: e.target.value === '' ? null : Number(e.target.value) })}>
                              <option value="">Regola generale</option>
                              {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                              <option value={5}>Sempre in ufficio (mai smart)</option>
                            </select>
                          </label>
                          <div className="field"><span>Sede</span>
                            <label className="check small">
                              <input type="checkbox" checked={!!rule?.otherSite} onChange={(e) => setRule(r.id, { otherSite: e.target.checked })} />
                              lavora in un’altra sede: sempre in presenza, non occupa posti qui
                            </label>
                          </div>
                          <label className="field"><span>Entra al massimo alle</span>
                            <input className="input" type="time" step={900} value={rule?.maxStart ?? ''} onChange={(e) => setRule(r.id, { maxStart: e.target.value || null })} style={{ width: 120 }} />
                          </label>
                          <div className="field"><span>Turno fisso</span>
                            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                              {WD.map((w, i) => (
                                <label key={w} className="check small">
                                  <input type="checkbox" checked={!!rule?.fixed?.days.includes(i + 1)} onChange={(e) => {
                                    const days = new Set(rule?.fixed?.days ?? []);
                                    if (e.target.checked) days.add(i + 1); else days.delete(i + 1);
                                    setRule(r.id, { fixed: days.size ? { start: rule?.fixed?.start ?? '09:00', end: rule?.fixed?.end ?? '14:00', days: Array.from(days).sort() } : null });
                                  }} />{w}
                                </label>
                              ))}
                              {rule?.fixed && (
                                <>
                                  <input className="input" type="time" step={900} value={rule.fixed.start} onChange={(e) => setRule(r.id, { fixed: { ...rule.fixed!, start: e.target.value } })} style={{ width: 110 }} />
                                  <input className="input" type="time" step={900} value={rule.fixed.end} onChange={(e) => setRule(r.id, { fixed: { ...rule.fixed!, end: e.target.value } })} style={{ width: 110 }} />
                                </>
                              )}
                            </div>
                          </div>
                          <div className="field"><span>Nella settimana in cui fa il weekend</span>
                            <label className="check small">
                              <input type="checkbox" checked={!!rule?.weekendWeek} onChange={(e) => setRule(r.id, { weekendWeek: e.target.checked ? { days: 6, longDays: 1, shortHours: 6 } : null })} />
                              settimana diversa dal solito
                            </label>
                            {rule?.weekendWeek && (
                              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                                <input className="input" type="number" min={5} max={7} value={rule.weekendWeek.days} onChange={(e) => setRule(r.id, { weekendWeek: { ...rule.weekendWeek!, days: Number(e.target.value) } })} style={{ width: 60 }} /> <span className="small">giorni, di cui</span>
                                <input className="input" type="number" min={0} max={5} value={rule.weekendWeek.longDays} onChange={(e) => setRule(r.id, { weekendWeek: { ...rule.weekendWeek!, longDays: Number(e.target.value) } })} style={{ width: 60 }} /> <span className="small">feriali con il turno normale, gli altri da</span>
                                <input className="input" type="number" min={2} max={9} step={0.5} value={rule.weekendWeek.shortHours} onChange={(e) => setRule(r.id, { weekendWeek: { ...rule.weekendWeek!, shortHours: Number(e.target.value) } })} style={{ width: 60 }} /> <span className="small">ore</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ margin: 0, padding: '8px 16px 12px' }}>Escludi chi non va in turno (maternità, responsabili che non fanno telefono). Le ferie lunghe non serve escluderle: il generatore le vede da sole. Ricordati di salvare.</p>
      <style dangerouslySetInnerHTML={{ __html: `.pr-grid{display:flex;flex-wrap:wrap;gap:14px 28px;align-items:flex-start;padding:4px 0}` }} />
    </section>
  );
}
