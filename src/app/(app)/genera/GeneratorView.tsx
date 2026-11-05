'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addDays, fmtDay, localToUtc } from '@/lib/time';
import { planBreaks, withDefaults, type BreakPolicy } from '@/lib/breaks';
import {
  generate, hhmm, isoWeekday, toMin,
  type Absence, type FixedDay, type GenConfig, type GenPerson, type GenResult, type History, type Pref,
} from '@/lib/generator';
import { showToast } from '@/components/ui';
import { IcLeft, IcRight } from '@/components/icons';
import { saveDraftWeek } from './actions';
import RulesForm from './RulesForm';
import PeopleForm from './PeopleForm';
import PrefsPanel from './PrefsPanel';

export interface GPerson { id: string; name: string; email?: string | null; role: string; team: string | null; shift_hours: number | null; days_per_week: number | null; gen_exclude: boolean; can_weekend: boolean }
export interface GActivity { id: string; name: string; kind: string; color: string }
export interface GDayType { id: string; name: string; color: string; place: 'office' | 'remote' | null }
export type GPref = Pref & { source: string; reviewed: boolean; month: string };

type Tab = 'genera' | 'regole' | 'persone' | 'preferenze';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y!, mo! - 1 + n, 1)).toISOString().slice(0, 7);
};

export default function GeneratorView(props: {
  month: string;
  tz: string;
  today: string;
  config: GenConfig;
  officeDaysPerWeek: number;
  breakPolicy: Partial<BreakPolicy> | null;
  breakActivityId: string | null;
  lunchActivityId: string | null;
  snapMinutes: number;
  people: GPerson[];
  suggest: Record<string, { shiftHours: number; daysPerWeek: number; samples: number }>;
  activities: GActivity[];
  dayTypes: GDayType[];
  prefs: GPref[];
  absences: Absence[];
  fixed: FixedDay[];
  history: History;
  holidays: string[];
  publishedWeeks: string[];
  existingInMonth: number;
}) {
  const { month, tz } = props;
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('genera');
  const [variant, setVariant] = useState(0);
  const [weekRoles, setWeekRoles] = useState<GenConfig['weekRoles']>({});
  const [result, setResult] = useState<GenResult | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);

  // persone che entrano nel generatore: profilo salvato o, in mancanza, quello dello storico
  const genPeople: GenPerson[] = useMemo(
    () =>
      props.people
        .filter((p) => !p.gen_exclude)
        .map((p) => {
          const s = props.suggest[p.id];
          const r = props.config.personRules?.[p.id] ?? {};
          return { id: p.id, name: p.name, shiftHours: p.shift_hours ?? s?.shiftHours ?? 9, daysPerWeek: p.days_per_week ?? s?.daysPerWeek ?? 5, canWeekend: p.can_weekend, ...r };
        }),
    [props.people, props.suggest, props.config.personRules],
  );
  const missingProfile = props.people.filter((p) => !p.gen_exclude && (p.shift_hours === null || p.days_per_week === null));
  const nameOf = useMemo(() => new Map(props.people.map((p) => [p.id, p.name])), [props.people]);
  const phone = props.config.activities.phone ?? props.activities.find((a) => a.kind === 'work' && /tel|phone/i.test(a.name))?.id ?? null;
  const recAct = props.config.activities.rec ?? props.activities.find((a) => /^rec\b|rec$/i.test(a.name))?.id ?? null;
  const reclAct = props.config.activities.reclami ?? props.activities.find((a) => /reclam/i.test(a.name))?.id ?? null;
  const officeType = props.config.dayTypes.office ?? props.dayTypes.find((d) => d.place === 'office')?.id ?? null;
  const remoteType = props.config.dayTypes.remote ?? props.dayTypes.find((d) => d.place === 'remote')?.id ?? null;
  const toReview = props.prefs.filter((p) => !p.reviewed).length;

  function run(v = variant) {
    const cfg: GenConfig = { ...props.config, officeDaysPerWeek: props.officeDaysPerWeek, weekRoles };
    const r = generate({
      month, people: genPeople, config: cfg, prefs: props.prefs, absences: props.absences, fixed: props.fixed,
      history: props.history, holidays: new Set(props.holidays), variant: v,
    });
    setResult(r);
  }

  async function save() {
    if (!result) return;
    const missing = [!phone && 'attività operativa (es. Telefono)', props.config.rec.pool.length && !recAct && 'attività REC', props.config.reclami.pool.length && !reclAct && 'attività Reclami'].filter(Boolean);
    if (missing.length) return showToast(`Scegli in Regole: ${missing.join(', ')}`, true);
    const weeks = Object.keys(result.roles);
    const pubBlocked = weeks.filter((w) => props.publishedWeeks.includes(w));
    if (pubBlocked.length) return showToast(`Settimane già pubblicate: ${pubBlocked.map((w) => fmtDay(w, 'd MMM')).join(', ')}. Ritirale dalla timeline o scegli un altro mese.`, true);
    if (!window.confirm(`Salvo la bozza di ${fmtDay(`${month}-15`, 'MMMM')} nelle settimane non pubblicate.${props.existingInMonth ? ` I ${props.existingInMonth} turni già presenti nel mese verranno sostituiti (ferie e permessi restano).` : ''} Poi la controlli in timeline e la pubblichi.`)) return;

    const policy = withDefaults(props.breakPolicy);
    const iso = (d: string, m: number) => new Date(localToUtc(m >= 1440 ? addDays(d, 1) : d, hhmm(m % 1440), tz)).toISOString();
    const first = `${month}-01`;
    const last = addDays(addDays(first, 32).slice(0, 8) + '01', -1);
    const persons = genPeople.map((p) => p.id);
    const order = props.people.map((p) => p.id);
    let total = 0;
    try {
      for (const w of weeks) {
        const from = w < first ? first : w;
        const to = addDays(w, 6) > last ? last : addDays(w, 6);
        setSaving(`Salvo la settimana del ${fmtDay(w, 'd MMM')}…`);
        const sh = result.shifts.filter((s) => s.day >= from && s.day <= to);
        const rows: { person_id: string; activity_id: string; starts_at: string; ends_at: string }[] = [];
        const blocks: { person_id: string; s: number; e: number; kind: 'work' }[] = [];
        for (const s of sh) {
          const act = s.role === 'rec' ? recAct : s.role === 'reclami' ? reclAct : phone;
          rows.push({ person_id: s.person_id, activity_id: act!, starts_at: iso(s.day, s.start), ends_at: iso(s.day, s.end) });
          if (s.sub && recAct) rows.push({ person_id: s.person_id, activity_id: recAct, starts_at: iso(s.day, s.sub[0]), ends_at: iso(s.day, s.sub[1]) });
          blocks.push({ person_id: s.person_id, s: Date.parse(iso(s.day, s.start)), e: Date.parse(iso(s.day, s.end)), kind: 'work' });
        }
        // pause e pranzo con le regole della timeline; chi ha il pranzo a orario fisso lo tiene lì
        const fixedLunch = sh.filter((s) => s.lunch !== undefined).map((s) => ({ person_id: s.person_id, s: Date.parse(iso(s.day, s.lunch!)), e: Date.parse(iso(s.day, s.lunch! + 60)) }));
        if (props.breakActivityId) {
          for (const fl of fixedLunch) rows.push({ person_id: fl.person_id, activity_id: props.lunchActivityId ?? props.breakActivityId, starts_at: new Date(fl.s).toISOString(), ends_at: new Date(fl.e).toISOString() });
          const planned = planBreaks(blocks, policy, order, props.snapMinutes).filter((b) => {
            const fl = fixedLunch.find((x) => x.person_id === b.person_id && Math.abs(x.s - b.s) < 12 * 3600000);
            return !fl || (b.type !== 'lunch' && (b.e <= fl.s || b.s >= fl.e));
          });
          for (const b of planned) {
            const act = b.type === 'lunch' ? props.lunchActivityId ?? props.breakActivityId : props.breakActivityId;
            rows.push({ person_id: b.person_id, activity_id: act, starts_at: new Date(b.s).toISOString(), ends_at: new Date(b.e).toISOString() });
          }
        }
        const marks = sh
          .map((s) => ({ person_id: s.person_id, day: s.day, day_type_id: (isoWeekday(s.day) <= 5 && s.office ? officeType : remoteType) ?? '' }))
          .filter((m) => m.day_type_id);
        const r = await saveDraftWeek({ from_date: from, to_date: to, persons, rows, marks });
        if (!r.ok) throw new Error(r.error);
        total += rows.length;
      }
      showToast(`Bozza salvata: ${total} blocchi. Controllala in timeline e pubblicala.`);
      router.push(`/timeline?v=custom&d=${first}&to=${last}`);
    } catch (e) {
      showToast((e as Error).message, true);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <div className="page-head">
        <div>
          <h1>Genera turni</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Bozza automatica del mese con le vostre regole, ferie e preferenze. La controlli, la ritocchi in timeline e la pubblichi.</p>
        </div>
        <div className="tl-date">
          <button aria-label="Mese precedente" onClick={() => { setResult(null); router.push(`/genera?m=${shiftMonth(month, -1)}`); }}><IcLeft width={16} /></button>
          <input type="month" value={month} onChange={(e) => e.target.value && router.push(`/genera?m=${e.target.value}`)} aria-label="Mese" />
          <button aria-label="Mese successivo" onClick={() => { setResult(null); router.push(`/genera?m=${shiftMonth(month, 1)}`); }}><IcRight width={16} /></button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {([['genera', 'Bozza del mese'], ['preferenze', `Preferenze e assenze${toReview ? ` (${toReview} da vedere)` : ''}`], ['persone', `Persone${missingProfile.length ? ` (${missingProfile.length} da completare)` : ''}`], ['regole', 'Regole']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'regole' && <RulesForm config={props.config} people={props.people} activities={props.activities} dayTypes={props.dayTypes} officeDaysPerWeek={props.officeDaysPerWeek} />}
      {tab === 'persone' && <PeopleForm people={props.people} suggest={props.suggest} config={props.config} />}
      {tab === 'preferenze' && <PrefsPanel month={month} people={props.people} prefs={props.prefs} absences={props.absences} />}

      {tab === 'genera' && (
        <>
          {(props.publishedWeeks.length > 0 || props.existingInMonth > 0 || missingProfile.length > 0 || toReview > 0) && (
            <div className="gn-notes">
              {props.publishedWeeks.length > 0 && <div className="alert alert-warn">Settimane già pubblicate in questo mese: {props.publishedWeeks.map((w) => fmtDay(w, 'd MMM')).join(', ')}. Non verranno sovrascritte.</div>}
              {props.existingInMonth > 0 && <div className="alert alert-info">Nel mese ci sono già {props.existingInMonth} turni (es. importati): salvando la bozza vengono sostituiti, ferie e permessi restano.</div>}
              {missingProfile.length > 0 && <div className="alert alert-info">{missingProfile.length} persone senza durata del turno o giorni a settimana: uso lo storico. Controlla in <button className="linklike" onClick={() => setTab('persone')}>Persone</button>.</div>}
              {toReview > 0 && <div className="alert alert-info">{toReview} preferenze da controllare: il testo è stato tradotto in automatico in un vincolo. <button className="linklike" onClick={() => setTab('preferenze')}>Controllale</button>.</div>}
            </div>
          )}

          <div className="row" style={{ alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={() => run()}>{result ? 'Rigenera' : 'Genera bozza'}</button>
            {result && <button className="btn" onClick={() => { setVariant(variant + 1); run(variant + 1); }}>Prova un’altra variante</button>}
            {result && (
              <span className="small muted">
                {result.issues.filter((i) => i.level === 'bad').length} problemi · {result.issues.filter((i) => i.level === 'warn').length} avvisi · variante {variant + 1}
              </span>
            )}
            <span style={{ marginLeft: 'auto' }} />
            {result && <button className="btn btn-primary" disabled={!!saving} onClick={save}>{saving ?? 'Salva bozza in timeline'}</button>}
          </div>

          {result && <Roles result={result} people={props.people} config={props.config} weekRoles={weekRoles ?? {}} onChange={(w, k, v) => setWeekRoles({ ...(weekRoles ?? {}), [w]: { ...(weekRoles?.[w] ?? {}), [k]: v } })} nameOf={nameOf} />}

          {result && result.issues.length > 0 && (
            <section className="card">
              <div className="card-head">
                <b>Da sistemare</b>
                <label className="check small"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> mostra solo i giorni con problemi</label>
              </div>
              <ul className="gn-issues">
                {result.issues.map((i, k) => (
                  <li key={k} className={i.level}>
                    {i.day && <b>{cap(fmtDay(i.day, 'EEE d'))}</b>} {i.text}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result ? (
            <Grid result={result} people={genPeople} absences={props.absences} holidays={props.holidays} config={props.config} onlyIssues={onlyIssues} />
          ) : (
            <section className="card"><div className="empty">Controlla regole, persone e preferenze, poi premi “Genera bozza”. Niente viene salvato finché non premi “Salva bozza in timeline”.</div></section>
          )}
        </>
      )}

      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </div>
  );
}

function Roles({ result, people, config, weekRoles, onChange, nameOf }: {
  result: GenResult; people: GPerson[]; config: GenConfig; weekRoles: NonNullable<GenConfig['weekRoles']>;
  onChange: (w: string, k: 'rec' | 'reclami', v: string | null) => void; nameOf: Map<string, string>;
}) {
  if (!config.rec.pool.length && !config.reclami.pool.length) return null;
  const opts = (ids: string[]) => ids.filter((id) => nameOf.has(id));
  return (
    <section className="card">
      <div className="card-head"><b>REC e Reclami per settimana</b><span className="small muted">Scelti a rotazione; puoi cambiarli e rigenerare.</span></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Settimana</th>{config.rec.pool.length > 0 && <th>REC</th>}{config.reclami.pool.length > 0 && <th>Reclami</th>}</tr></thead>
          <tbody>
            {Object.entries(result.roles).map(([w, r]) => (
              <tr key={w}>
                <td>dal {fmtDay(w, 'd MMM')}</td>
                {config.rec.pool.length > 0 && (
                  <td>
                    <select className="select" value={weekRoles[w]?.rec === undefined ? '' : weekRoles[w]!.rec ?? '-'} onChange={(e) => onChange(w, 'rec', e.target.value === '' ? (undefined as never) : e.target.value === '-' ? null : e.target.value)}>
                      <option value="">Automatico ({r.rec ? nameOf.get(r.rec) : 'nessuno'})</option>
                      {opts(config.rec.pool.map((x) => x.person_id)).map((id) => <option key={id} value={id}>{nameOf.get(id)}</option>)}
                      <option value="-">Nessuno</option>
                    </select>
                  </td>
                )}
                {config.reclami.pool.length > 0 && (
                  <td>
                    <select className="select" value={weekRoles[w]?.reclami === undefined ? '' : weekRoles[w]!.reclami ?? '-'} onChange={(e) => onChange(w, 'reclami', e.target.value === '' ? (undefined as never) : e.target.value === '-' ? null : e.target.value)}>
                      <option value="">Automatico ({r.reclami ? nameOf.get(r.reclami) : 'nessuno'})</option>
                      {opts(config.reclami.pool).map((id) => <option key={id} value={id}>{nameOf.get(id)}</option>)}
                      <option value="-">Nessuno</option>
                    </select>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Grid({ result, people, absences, holidays, config, onlyIssues }: { result: GenResult; people: GenPerson[]; absences: Absence[]; holidays: string[]; config: GenConfig; onlyIssues: boolean }) {
  const issueDays = new Set(result.issues.map((i) => i.day).filter(Boolean) as string[]);
  const days = onlyIssues ? result.days.filter((d) => issueDays.has(d)) : result.days;
  const byKey = new Map(result.shifts.map((s) => [`${s.person_id}|${s.day}`, s]));
  const absKey = new Map(absences.map((a) => [`${a.person_id}|${a.day}`, a]));
  const open = toMin(config.weekday.open), close = toMin(config.weekday.close);
  const short = (m: number) => (m % 60 ? hhmm(m) : String(m / 60).padStart(2, '0'));

  const rows: [string, (d: string) => string | number, (d: string, v: number) => boolean][] = [
    ['Aprono (operativi)', (d) => (isoWeekday(d) <= 5 ? result.shifts.filter((s) => s.day === d && s.role === 'op' && s.start <= open).length : ''), (d, v) => isoWeekday(d) <= 5 && v < config.weekday.openOps],
    ['Chiudono (operativi)', (d) => (isoWeekday(d) <= 5 ? result.shifts.filter((s) => s.day === d && s.role === 'op' && s.end >= close).length : ''), (d, v) => isoWeekday(d) <= 5 && v !== config.weekday.closeOps],
    ['Alle 9', (d) => result.shifts.filter((s) => s.day === d && s.role === 'op' && s.start <= 540 && s.end > 540).length, () => false],
    ['Dopo le 18', (d) => (isoWeekday(d) <= 5 ? result.shifts.filter((s) => s.day === d && s.role === 'op' && s.end > 1080).length : ''), (d, v) => isoWeekday(d) <= 5 && v < config.weekday.after1800],
    ['Dopo le 18:30', (d) => (isoWeekday(d) <= 5 ? result.shifts.filter((s) => s.day === d && s.role === 'op' && s.end > 1110).length : ''), (d, v) => isoWeekday(d) <= 5 && v < config.weekday.after1830],
    ['In ufficio apertura', (d) => (isoWeekday(d) <= 5 ? result.shifts.filter((s) => s.day === d && s.start <= open && s.office).length : ''), (d, v) => isoWeekday(d) <= 5 && v < config.weekday.officeAtOpen],
    ['In ufficio chiusura', (d) => (isoWeekday(d) <= 5 ? result.shifts.filter((s) => s.day === d && s.end >= close && s.office).length : ''), (d, v) => isoWeekday(d) <= 5 && v < config.weekday.officeAtClose],
    ['Totale persone', (d) => result.shifts.filter((s) => s.day === d).length, () => false],
  ];

  return (
    <section className="card">
      <div className="card-head">
        <b>Bozza</b>
        <span className="small muted">
          <i className="lg op" /> operativo <i className="lg rec" /> REC <i className="lg recl" /> Reclami <i className="lg comp" /> affiancamento REC · <b>U</b> ufficio · bordo rosso = chiusura
        </span>
      </div>
      <div className="table-wrap gn-wrap">
        <table className="gn">
          <thead>
            <tr>
              <th className="nm">Persona</th>
              {days.map((d) => (
                <th key={d} className={`${isoWeekday(d) >= 6 ? 'we' : ''}${holidays.includes(d) ? ' hol' : ''}${isoWeekday(d) === 1 ? ' mon' : ''}`}>
                  {fmtDay(d, 'EEEEEE')}<br />{Number(d.slice(8))}
                </th>
              ))}
              <th>Giorni</th><th>Ore</th><th>Chius.</th><th>Sab.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, val, bad]) => (
              <tr key={label} className="cov">
                <th className="nm">{label}</th>
                {days.map((d) => {
                  const v = val(d);
                  return <td key={d} className={`${typeof v === 'number' && bad(d, v) ? 'bad' : ''}${isoWeekday(d) === 1 ? ' mon' : ''}`}>{v}</td>;
                })}
                <td colSpan={4} />
              </tr>
            ))}
            {people.map((p) => {
              const mine = result.shifts.filter((s) => s.person_id === p.id);
              const hours = mine.reduce((t, s) => t + (s.end - s.start) / 60 - (s.end - s.start >= 480 ? 1 : 0), 0);
              return (
                <tr key={p.id}>
                  <th className="nm" title={`${p.shiftHours} h × ${p.daysPerWeek} giorni`}>{p.name}</th>
                  {days.map((d) => {
                    const s = byKey.get(`${p.id}|${d}`);
                    const a = absKey.get(`${p.id}|${d}`);
                    const cls = isoWeekday(d) === 1 ? ' mon' : '';
                    if (s) {
                      return (
                        <td key={d} className={`sh ${s.role}${s.end >= close && isoWeekday(d) <= 5 ? ' cl' : ''}${cls}`} title={`${hhmm(s.start)}–${hhmm(s.end)}${s.sub ? ` (REC ${hhmm(s.sub[0])}–${hhmm(s.sub[1])})` : ''}${s.office ? ' · ufficio' : ' · smart'}`}>
                          {short(s.start)}–{short(s.end)}{s.office && <sup>U</sup>}
                        </td>
                      );
                    }
                    if (a) return <td key={d} className={`abs${cls}`} title={a.name}>{a.full ? a.name.slice(0, 3) : '·'}</td>;
                    return <td key={d} className={`rest${cls}`} />;
                  })}
                  <td className="num">{mine.length}</td>
                  <td className="num">{Math.round(hours)}</td>
                  <td className="num">{mine.filter((s) => s.role === 'op' && s.end >= close && isoWeekday(s.day) <= 5).length}</td>
                  <td className="num">{mine.filter((s) => isoWeekday(s.day) === 6).length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const CSS = `
  .tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);flex-wrap:wrap}
  .tabs button{border:0;background:none;font:inherit;padding:8px 14px;cursor:pointer;color:var(--ink-2);border-bottom:2px solid transparent;margin-bottom:-1px}
  .tabs button[aria-pressed="true"]{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
  .gn-notes{display:grid;gap:8px}
  .card-body.gn-form{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:flex-end}
  .gn-form .field{min-width:0}
  .gn-pool{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px}
  .gn-pp{display:flex;justify-content:space-between;align-items:center;gap:6px;border:1px solid var(--line-2);border-radius:6px;padding:5px 8px;font-size:13px;flex-wrap:wrap}
  .gn-pp.on{border-color:var(--accent);background:var(--accent-soft)}
  .linklike{border:0;background:none;padding:0;font:inherit;color:var(--accent);cursor:pointer;text-decoration:underline}
  .gn-issues{margin:0;padding:10px 16px 12px 32px;display:grid;gap:3px;max-height:220px;overflow:auto;font-size:13px}
  .gn-issues li.bad{color:var(--bad)} .gn-issues li.warn{color:var(--warn)}
  .gn-wrap{max-height:calc(100vh - 260px);overflow:auto}
  table.gn{border-collapse:separate;border-spacing:0;font-size:11.5px;font-variant-numeric:tabular-nums}
  .gn th,.gn td{border-bottom:1px solid var(--line-2);border-right:1px solid var(--line-2);padding:4px 3px;text-align:center;white-space:nowrap;min-width:52px}
  .gn thead th{position:sticky;top:0;background:#fbfbfc;z-index:2;font-weight:500;color:var(--muted);text-transform:capitalize}
  .gn th.nm{position:sticky;left:0;background:#fff;z-index:1;text-align:left;min-width:150px;max-width:180px;overflow:hidden;text-overflow:ellipsis;font-weight:500;padding-left:12px}
  .gn thead th.nm{z-index:3;background:#fbfbfc}
  .gn th.we,.gn th.hol{color:var(--accent)}
  .gn .mon{border-left:2px solid var(--line)}
  .gn tr.cov td{background:#fafbfc;font-weight:600;color:var(--ink-2)}
  .gn tr.cov td.bad{background:var(--bad-soft);color:var(--bad)}
  .gn tr.cov:last-of-type td{border-bottom:2px solid var(--line)}
  .gn td.sh{color:#1d2433}
  .gn td.op{background:#eef2fb}
  .gn td.rec{background:#e6dcf7}
  .gn td.reclami{background:#fbdce6}
  .gn td.companion{background:#efe7fb}
  .gn td.cl{box-shadow:inset 0 0 0 2px #e5484d}
  .gn td.abs{background:#f2f0f7;color:var(--muted)}
  .gn td.rest{background:#fff}
  .gn sup{font-size:9px;color:var(--accent);margin-left:1px;font-weight:700}
  .gn td.num{font-weight:600}
  .lg{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;vertical-align:-1px}
  .lg.op{background:#eef2fb;border:1px solid #cfd9f6} .lg.rec{background:#e6dcf7} .lg.recl{background:#fbdce6} .lg.comp{background:#efe7fb;border:1px solid #d9c9f3}
`;
