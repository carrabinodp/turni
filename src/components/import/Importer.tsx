'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Activity, ActivityKind } from '@/lib/types';
import { KIND_LABEL } from '@/lib/types';
import {
  columnLabels, detect, detectGrid, detectList, parse, plain,
  type GridMapping, type ListMapping, type Mapping, type ParsedItem, type Rows,
} from '@/lib/import/parse';
import { matchActivity, matchPerson, type PersonLite } from '@/lib/import/match';
import { addDays, fmtDay, fmtTime, localDate, todayIn, weekStart } from '@/lib/time';

export interface ImportPayload {
  replace: boolean;
  publish: boolean;
  from_date: string;
  to_date: string;
  file_name: string;
  people_create: { key: string; full_name: string }[];
  people_alias: { person_id: string; alias: string }[];
  activity_create: { key: string; name: string; kind: ActivityKind; color: string }[];
  activity_alias: { activity_id: string; alias: string }[];
  rows: { person_id?: string; person_key?: string; activity_id?: string; activity_key?: string; starts_at: string; ends_at: string; note?: string | null }[];
}

export type ImportResult =
  | { ok: true; inserted: number; deleted: number; people_created: number; published: string[] }
  | { ok: false; error: string };

const NEW_COLORS = ['#2e6e9e', '#7b5ea7', '#3a8a6e', '#b5642a', '#a33a5a', '#5d7686', '#8a7a2e'];
const STATUS_TXT = { email: 'Email', name: 'Nome', alias: 'Già collegato', fuzzy: 'Da confermare', none: 'Nuova' } as const;

type PersonChoice = { kind: 'existing'; id: string } | { kind: 'new' } | { kind: 'skip' };
type ActChoice = { kind: 'existing'; id: string } | { kind: 'new'; actKind: ActivityKind } | { kind: 'skip' };

export default function Importer(props: {
  people: PersonLite[];
  activities: Activity[];
  tz: string;
  onImport: (p: ImportPayload) => Promise<ImportResult>;
}) {
  const { tz } = props;
  const today = todayIn(tz);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<{ name: string; rows: Rows }[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [wkStart, setWkStart] = useState(addDays(weekStart(today), 7));
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [personChoice, setPersonChoice] = useState<Record<string, PersonChoice>>({});
  const [actChoice, setActChoice] = useState<Record<string, ActChoice>>({});
  const [defaultAct, setDefaultAct] = useState(props.activities.find((a) => a.kind === 'work' && !a.archived)?.id ?? '');
  const [replace, setReplace] = useState(true);
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<(ImportResult & { ok: true }) | null>(null);
  const [drag, setDrag] = useState(false);

  const rows = sheets[sheetIdx]?.rows ?? [];
  const opts = useMemo(() => ({ tz, year, weekStart: wkStart }), [tz, year, wkStart]);

  async function readFile(f: File) {
    setError(null);
    setDone(null);
    setFileName(f.name);
    try {
      const XLSX = await import('xlsx');
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: false });
      const list = wb.SheetNames.map((name) => ({
        name,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, raw: true, defval: null, blankrows: true }) as Rows,
      })).filter((s) => s.rows.length > 0);
      if (!list.length) throw new Error('Il file è vuoto');
      // foglio con il formato riconoscibile, altrimenti il primo
      const best = Math.max(0, list.findIndex((s) => detect(s.rows, opts)));
      setSheets(list);
      selectSheet(list, best);
    } catch (e) {
      setSheets([]);
      setError(e instanceof Error ? `Non riesco a leggere il file: ${e.message}` : 'Non riesco a leggere il file');
    }
  }

  function selectSheet(list: { rows: Rows }[], i: number) {
    setSheetIdx(i);
    setMapping(detect(list[i]!.rows, opts));
    setPersonChoice({});
    setActChoice({});
  }

  /* ---- interpretazione ---- */
  const parsed = useMemo(() => (mapping ? parse(rows, mapping, opts) : null), [rows, mapping, opts]);

  const persons = useMemo(() => {
    if (!parsed) return [];
    const m = new Map<string, { key: string; name: string; email: string | null; count: number }>();
    for (const it of parsed.items) {
      const cur = m.get(it.key) ?? { key: it.key, name: it.name, email: it.email, count: 0 };
      cur.count++;
      m.set(it.key, cur);
    }
    return Array.from(m.values()).map((p) => ({ ...p, match: matchPerson(p.name, p.email, props.people) }));
  }, [parsed, props.people]);

  const labels = useMemo(() => {
    if (!parsed) return [];
    const m = new Map<string, { label: string; count: number; allDay: number }>();
    for (const it of parsed.items) {
      const k = it.activity ? plain(it.activity) : '';
      const cur = m.get(k) ?? { label: it.activity ?? '', count: 0, allDay: 0 };
      cur.count++;
      if (it.allDay) cur.allDay++;
      m.set(k, cur);
    }
    return Array.from(m.entries())
      .filter(([k]) => k)
      .map(([k, v]) => ({ key: k, ...v, match: matchActivity(v.label, props.activities) }));
  }, [parsed, props.activities]);
  const unlabeled = parsed?.items.filter((i) => !i.activity).length ?? 0;

  const personOf = (p: (typeof persons)[number]): PersonChoice =>
    personChoice[p.key] ?? (p.match.person ? { kind: 'existing', id: p.match.person.id } : { kind: 'new' });
  const actOf = (l: (typeof labels)[number]): ActChoice =>
    actChoice[l.key] ?? (l.match ? { kind: 'existing', id: l.match.id } : { kind: 'new', actKind: l.allDay === l.count ? 'absence' : 'work' });

  const range = useMemo(() => {
    if (!parsed?.items.length) return null;
    const ds = parsed.items.map((i) => localDate(i.s, tz)).sort();
    return { from: ds[0]!, to: ds[ds.length - 1]! };
  }, [parsed, tz]);

  /* ---- import ---- */
  async function runImport() {
    if (!parsed || !range) return;
    setBusy(true);
    setError(null);
    const pay: ImportPayload = {
      replace, publish, from_date: range.from, to_date: range.to, file_name: fileName,
      people_create: [], people_alias: [], activity_create: [], activity_alias: [], rows: [],
    };
    const pMap = new Map<string, { person_id?: string; person_key?: string } | null>();
    for (const p of persons) {
      const c = personOf(p);
      if (c.kind === 'skip') pMap.set(p.key, null);
      else if (c.kind === 'new') {
        pay.people_create.push({ key: p.key, full_name: p.name });
        pMap.set(p.key, { person_key: p.key });
      } else {
        pMap.set(p.key, { person_id: c.id });
        const target = props.people.find((x) => x.id === c.id);
        if (target && p.match.status !== 'email' && p.match.status !== 'name' && p.match.status !== 'alias') {
          pay.people_alias.push({ person_id: c.id, alias: p.name });
        }
      }
    }
    const aMap = new Map<string, { activity_id?: string; activity_key?: string } | null>();
    labels.forEach((l, i) => {
      const c = actOf(l);
      if (c.kind === 'skip') aMap.set(l.key, null);
      else if (c.kind === 'new') {
        pay.activity_create.push({ key: l.key, name: l.label, kind: c.actKind, color: NEW_COLORS[i % NEW_COLORS.length]! });
        aMap.set(l.key, { activity_key: l.key });
      } else {
        aMap.set(l.key, { activity_id: c.id });
        const a = props.activities.find((x) => x.id === c.id);
        if (a && plain(a.name) !== l.key && !a.aliases.some((x) => plain(x) === l.key)) {
          pay.activity_alias.push({ activity_id: c.id, alias: l.label });
        }
      }
    });
    if (!defaultAct && unlabeled) {
      setBusy(false);
      return setError('Scegli l’attività per i turni senza etichetta');
    }
    for (const it of parsed.items) {
      const p = pMap.get(it.key);
      const a = it.activity ? aMap.get(plain(it.activity)) : { activity_id: defaultAct };
      if (!p || !a) continue;
      pay.rows.push({ ...p, ...a, starts_at: new Date(it.s).toISOString(), ends_at: new Date(it.e).toISOString(), note: it.note });
    }
    if (!pay.rows.length) {
      setBusy(false);
      return setError('Nessuna riga da importare con le scelte attuali');
    }
    const res = await props.onImport(pay);
    setBusy(false);
    if (res.ok) setDone(res);
    else setError(res.error);
  }

  /* ---- render ---- */
  if (done && range) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="alert alert-ok">
            Import completato: {done.inserted} blocchi inseriti{done.deleted ? `, ${done.deleted} sostituiti` : ''}
            {done.people_created ? `, ${done.people_created} nuove persone in attesa di registrazione` : ''}.
            {done.published.length ? ` Settimane pubblicate: ${done.published.map((w) => fmtDay(w, 'd MMM')).join(', ')}.` : ' Le settimane restano in bozza finché non le pubblichi.'}
          </div>
          <div className="row">
            <Link className="btn btn-primary" href={`/timeline?d=${range.from}&v=week`}>Apri nella timeline</Link>
            <button className="btn" onClick={() => { setDone(null); setSheets([]); setFileName(''); setMapping(null); }}>Importa un altro file</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* 1. file */}
      <div className="card">
        <div className="card-head"><h2>1. Scegli il file</h2>{fileName && <span className="muted small">{fileName}</span>}</div>
        <div className="card-body">
          <label
            className="drop"
            data-drag={drag || undefined}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) readFile(f);
            }}
          >
            <input id="imp-file" type="file" accept=".xlsx,.xls,.xlsm,.csv,.ods" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
            <b>Trascina qui il file Excel</b>
            <span className="muted small">oppure clicca per sceglierlo · .xlsx, .xls, .csv</span>
          </label>
          <details className="small muted">
            <summary>Che formati riconosce?</summary>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
              <li><b>Griglia</b>: una riga per persona, una colonna per giorno (es. “Lun 10/11”). Nelle celle: <code>08:00-16:00</code>, <code>8-12 / 13-17</code>, <code>Tel 8-12, Chat 13-17</code>, <code>Ferie</code>, <code>R</code> per riposo.</li>
              <li><b>Elenco</b>: una riga per blocco con colonne come Nome, Data, Inizio, Fine, Attività. Va bene anche l’export CSV di Assembled.</li>
              <li>Le persone vengono collegate per email o per nome e cognome, in qualsiasi ordine. Chi non è ancora registrato viene creato e si collega da solo al primo accesso.</li>
            </ul>
          </details>
          {error && !sheets.length && <div className="alert alert-bad">{error}</div>}
        </div>
      </div>

      {sheets.length > 0 && (
        <MappingCard
          rows={rows}
          sheets={sheets.map((s) => s.name)}
          sheetIdx={sheetIdx}
          onSheet={(i) => selectSheet(sheets, i)}
          mapping={mapping}
          setMapping={setMapping}
          year={year}
          setYear={setYear}
          wkStart={wkStart}
          setWkStart={setWkStart}
          opts={opts}
        />
      )}

      {parsed && mapping && (
        <>
          <div className="card">
            <div className="card-head">
              <h2>3. Controlla</h2>
              <span className="muted small">
                {parsed.items.length} blocchi · {persons.length} persone
                {range ? ` · dal ${fmtDay(range.from, 'EEE d MMM')} al ${fmtDay(range.to, 'EEE d MMM yyyy')}` : ''}
                {parsed.restCells ? ` · ${parsed.restCells} celle di riposo` : ''}
              </span>
            </div>
            <div className="card-body">
              {parsed.issues.length > 0 && (
                <details className="alert alert-warn" open={parsed.issues.length <= 5}>
                  <summary>{parsed.issues.length} celle non riconosciute (verranno saltate)</summary>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {parsed.issues.slice(0, 50).map((i, k) => (
                      <li key={k}>Riga {i.row}{i.col !== null ? `, colonna ${columnLabels(rows, 0)[i.col]?.split(' ')[0]}` : ''}: “{i.text}” · {i.message}</li>
                    ))}
                  </ul>
                </details>
              )}
              {!parsed.items.length && <div className="alert alert-bad">Non ho trovato turni con questa configurazione: controlla le colonne al punto 2.</div>}

              {persons.length > 0 && (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Nel file</th><th>Blocchi</th><th>Collega a</th><th>Stato</th></tr></thead>
                    <tbody>
                      {persons.map((p) => {
                        const c = personOf(p);
                        const val = c.kind === 'existing' ? c.id : c.kind;
                        const pill = c.kind === 'skip' ? 'pill' : c.kind === 'new' ? 'pill pill-info' : p.match.status === 'fuzzy' && !personChoice[p.key] ? 'pill pill-warn' : 'pill pill-ok';
                        const txt = c.kind === 'skip' ? 'Ignorata' : c.kind === 'new' ? 'Nuova persona' : personChoice[p.key] ? 'Scelta manuale' : STATUS_TXT[p.match.status];
                        return (
                          <tr key={p.key}>
                            <td><b>{p.name}</b>{p.email && <div className="small muted">{p.email}</div>}</td>
                            <td className="tabnum">{p.count}</td>
                            <td>
                              <select
                                id={`imp-p-${p.key}`}
                                className="select"
                                style={{ width: '100%', maxWidth: 280 }}
                                value={val}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setPersonChoice((s) => ({ ...s, [p.key]: v === 'new' ? { kind: 'new' } : v === 'skip' ? { kind: 'skip' } : { kind: 'existing', id: v } }));
                                }}
                              >
                                <option value="new">+ Crea “{p.name}”</option>
                                <option value="skip">Non importare</option>
                                {p.match.candidates.length > 0 && (
                                  <optgroup label="Suggeriti">
                                    {p.match.candidates.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
                                  </optgroup>
                                )}
                                <optgroup label="Tutto il team">
                                  {props.people.map((x) => (
                                    <option key={x.id} value={x.id}>{x.full_name}{x.user_id ? '' : ' (da registrare)'}</option>
                                  ))}
                                </optgroup>
                              </select>
                            </td>
                            <td><span className={pill}>{txt}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {(labels.length > 0 || unlabeled > 0) && (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Attività nel file</th><th>Blocchi</th><th>Diventa</th></tr></thead>
                    <tbody>
                      {unlabeled > 0 && (
                        <tr>
                          <td><i className="muted">Orari senza attività</i></td>
                          <td className="tabnum">{unlabeled}</td>
                          <td>
                            <select id="imp-default-act" className="select" value={defaultAct} onChange={(e) => setDefaultAct(e.target.value)}>
                              {props.activities.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                          </td>
                        </tr>
                      )}
                      {labels.map((l) => {
                        const c = actOf(l);
                        const val = c.kind === 'existing' ? c.id : c.kind === 'new' ? `new:${c.actKind}` : 'skip';
                        return (
                          <tr key={l.key}>
                            <td><b>{l.label}</b>{l.allDay ? <span className="small muted"> · giornata intera</span> : null}</td>
                            <td className="tabnum">{l.count}</td>
                            <td>
                              <select
                                id={`imp-a-${l.key}`}
                                className="select"
                                value={val}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setActChoice((s) => ({
                                    ...s,
                                    [l.key]: v === 'skip' ? { kind: 'skip' } : v.startsWith('new:') ? { kind: 'new', actKind: v.slice(4) as ActivityKind } : { kind: 'existing', id: v },
                                  }));
                                }}
                              >
                                {(['work', 'break', 'absence'] as ActivityKind[]).map((k) => (
                                  <option key={k} value={`new:${k}`}>+ Nuova attività “{l.label}” ({KIND_LABEL[k].toLowerCase()})</option>
                                ))}
                                <option value="skip">Non importare</option>
                                <optgroup label="Attività esistenti">
                                  {props.activities.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </optgroup>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {parsed.items.length > 0 && <Sample items={parsed.items} tz={tz} />}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>4. Importa</h2></div>
            <div className="card-body">
              <label className="check">
                <input id="imp-replace" type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                Sostituisci i turni già presenti di queste persone {range ? `dal ${fmtDay(range.from, 'd MMM')} al ${fmtDay(range.to, 'd MMM')}` : ''}
              </label>
              <label className="check">
                <input id="imp-publish" type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
                Pubblica subito le settimane e avvisa il team
              </label>
              {error && <div className="alert alert-bad">{error}</div>}
              <div className="row">
                <button className="btn btn-primary" disabled={busy || !parsed.items.length} onClick={runImport}>
                  {busy ? 'Import in corso…' : `Importa ${parsed.items.length} blocchi`}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        .drop{display:grid;justify-items:center;gap:4px;padding:26px 16px;border:1.5px dashed var(--line);border-radius:10px;cursor:pointer;text-align:center;background:#fbfbfc}
        .drop[data-drag],.drop:hover{border-color:var(--accent);background:var(--accent-soft)}
        .drop input{position:absolute;width:1px;height:1px;opacity:0}
        .drop:focus-within{outline:2px solid var(--accent)}
        details summary{cursor:pointer}
        code{background:var(--hover);padding:1px 5px;border-radius:4px;font-size:12.5px}
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function MappingCard(props: {
  rows: Rows;
  sheets: string[];
  sheetIdx: number;
  onSheet: (i: number) => void;
  mapping: Mapping | null;
  setMapping: (m: Mapping | null) => void;
  year: number;
  setYear: (y: number) => void;
  wkStart: string;
  setWkStart: (d: string) => void;
  opts: { tz: string; year: number; weekStart: string };
}) {
  const { rows, mapping, setMapping } = props;
  const headerRow = mapping?.headerRow ?? 0;
  const cols = columnLabels(rows, headerRow);
  const colOpt = (
    <>
      <option value="">—</option>
      {cols.map((c, i) => <option key={i} value={i}>{c}</option>)}
    </>
  );
  const setList = (patch: Partial<ListMapping>) => mapping?.format === 'list' && setMapping({ ...mapping, ...patch });
  const setGrid = (patch: Partial<GridMapping>) => mapping?.format === 'grid' && setMapping({ ...mapping, ...patch });
  const num = (v: string) => (v === '' ? null : Number(v));

  function switchFormat(f: 'grid' | 'list') {
    const m = f === 'grid' ? detectGrid(rows, props.opts) : detectList(rows);
    if (m) return setMapping(m);
    setMapping(
      f === 'grid'
        ? { format: 'grid', headerRow, nameCols: [0], emailCol: null, dateCols: [] }
        : { format: 'list', headerRow, name: [0], email: null, date: null, start: null, end: null, shift: null, activity: null, note: null },
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>2. Come è fatto il file</h2>
        {mapping ? (
          <span className="pill pill-ok">Riconosciuto: {mapping.format === 'grid' ? 'griglia persone × giorni' : 'elenco di blocchi'}</span>
        ) : (
          <span className="pill pill-warn">Formato non riconosciuto: indica le colonne</span>
        )}
      </div>
      <div className="card-body">
        <div className="row">
          {props.sheets.length > 1 && (
            <label className="field">
              <span>Foglio</span>
              <select id="imp-sheet" className="select" value={props.sheetIdx} onChange={(e) => props.onSheet(Number(e.target.value))}>
                {props.sheets.map((s, i) => <option key={i} value={i}>{s}</option>)}
              </select>
            </label>
          )}
          <label className="field">
            <span>Formato</span>
            <select id="imp-format" className="select" value={mapping?.format ?? ''} onChange={(e) => switchFormat(e.target.value as 'grid' | 'list')}>
              {!mapping && <option value="">Scegli…</option>}
              <option value="grid">Griglia (persone × giorni)</option>
              <option value="list">Elenco (una riga per blocco)</option>
            </select>
          </label>
          <label className="field">
            <span>Riga intestazioni</span>
            <input
              id="imp-header"
              className="input"
              type="number"
              min={1}
              style={{ width: 90 }}
              value={headerRow + 1}
              onChange={(e) => {
                const r = Math.max(0, Number(e.target.value) - 1);
                if (!mapping) return;
                setMapping({ ...mapping, headerRow: r });
              }}
            />
          </label>
          <label className="field">
            <span>Anno (se le date non lo indicano)</span>
            <input id="imp-year" className="input" type="number" style={{ width: 100 }} value={props.year} onChange={(e) => props.setYear(Number(e.target.value))} />
          </label>
        </div>

        {mapping?.format === 'grid' && (
          <>
            <div className="row">
              <label className="field">
                <span>Colonna nome</span>
                <select id="imp-g-name1" className="select" value={mapping.nameCols[0] ?? ''} onChange={(e) => setGrid({ nameCols: [num(e.target.value), mapping.nameCols[1] ?? null].filter((x): x is number => x !== null) })}>{colOpt}</select>
              </label>
              <label className="field">
                <span>Seconda colonna nome (facoltativa)</span>
                <select id="imp-g-name2" className="select" value={mapping.nameCols[1] ?? ''} onChange={(e) => setGrid({ nameCols: [mapping.nameCols[0] ?? null, num(e.target.value)].filter((x): x is number => x !== null) })}>{colOpt}</select>
              </label>
              <label className="field">
                <span>Colonna email (facoltativa)</span>
                <select id="imp-g-email" className="select" value={mapping.emailCol ?? ''} onChange={(e) => setGrid({ emailCol: num(e.target.value) })}>{colOpt}</select>
              </label>
              <label className="field">
                <span>Settimana (se ci sono solo i nomi dei giorni)</span>
                <input id="imp-week" className="input" type="date" value={props.wkStart} onChange={(e) => e.target.value && props.setWkStart(weekStart(e.target.value))} />
              </label>
            </div>
            <div className="small muted">
              Giorni trovati: {mapping.dateCols.length ? mapping.dateCols.map((d) => `${cols[d.col]?.split(' ')[0]} = ${fmtDay(d.date, 'EEE d MMM')}`).join(' · ') : 'nessuno, controlla la riga delle intestazioni'}
            </div>
          </>
        )}

        {mapping?.format === 'list' && (
          <div className="row">
            {(
              [
                ['Nome', 'name'], ['Email', 'email'], ['Data', 'date'], ['Inizio', 'start'], ['Fine', 'end'],
                ['Orario in una cella (es. 8-16)', 'shift'], ['Attività', 'activity'], ['Note', 'note'],
              ] as const
            ).map(([label, k]) => (
              <label className="field" key={k}>
                <span>{label}</span>
                <select
                  id={`imp-l-${k}`}
                  className="select"
                  value={k === 'name' ? mapping.name[0] ?? '' : (mapping[k] ?? '')}
                  onChange={(e) => (k === 'name' ? setList({ name: e.target.value === '' ? [] : [Number(e.target.value)] }) : setList({ [k]: num(e.target.value) }))}
                >
                  {colOpt}
                </select>
              </label>
            ))}
          </div>
        )}

        <Preview rows={rows} headerRow={headerRow} />
      </div>
    </div>
  );
}

function Preview({ rows, headerRow }: { rows: Rows; headerRow: number }) {
  const slice = rows.slice(headerRow, headerRow + 6);
  const width = Math.min(12, Math.max(...slice.map((r) => r?.length ?? 0)));
  return (
    <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 6 }}>
      <table className="table small">
        <tbody>
          {slice.map((r, i) => (
            <tr key={i} style={i === 0 ? { background: '#fbfbfc', fontWeight: 600 } : undefined}>
              <td className="muted tabnum" style={{ width: 36 }}>{headerRow + i + 1}</td>
              {Array.from({ length: width }, (_, j) => (
                <td key={j} style={{ whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r?.[j] === null || r?.[j] === undefined ? '' : String(r[j])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Sample({ items, tz }: { items: ParsedItem[]; tz: string }) {
  const first = items.slice(0, 6);
  return (
    <div className="small muted">
      Esempio di come verranno letti:{' '}
      {first.map((i, k) => (
        <span key={k}>
          {k > 0 && ' · '}
          <b style={{ color: 'var(--ink)' }}>{i.name}</b> {fmtDay(localDate(i.s, tz), 'EEE d')} {i.allDay ? 'giornata intera' : `${fmtTime(i.s, tz)}–${fmtTime(i.e, tz)}`}
          {i.activity ? ` (${i.activity})` : ''}
        </span>
      ))}
    </div>
  );
}
