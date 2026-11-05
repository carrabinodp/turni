'use client';
import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDay, fmtTime, minutesLabel } from '@/lib/time';
import { hours, type PersonSummary } from '@/lib/report';
import { IcLeft, IcRight } from '@/components/icons';

interface P { id: string; name: string; email: string | null; team: string | null; contract: string | null; active: boolean }

const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y!, mo! - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export default function ReportView(props: {
  month: string;
  tz: string;
  people: P[];
  summaries: PersonSummary[];
  activityOrder: { name: string; kind: string; color: string }[];
  dayTypeOrder: string[];
}) {
  const { month, tz } = props;
  const router = useRouter();
  const [team, setTeam] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pById = useMemo(() => new Map(props.people.map((p) => [p.id, p])), [props.people]);
  const teams = useMemo(() => Array.from(new Set(props.people.map((p) => p.team).filter(Boolean) as string[])).sort(), [props.people]);
  const rows = props.summaries.filter((s) => {
    const p = pById.get(s.person_id)!;
    return (!team || p.team === team) && (!q || p.name.toLowerCase().includes(q.toLowerCase()));
  });

  // colonne presenti nel mese
  const absTypes = props.activityOrder.filter((a) => a.kind === 'absence' && props.summaries.some((s) => s.absenceDays[a.name] || s.absenceMin[a.name])).map((a) => a.name);
  const workTypes = props.activityOrder.filter((a) => a.kind === 'work' && props.summaries.some((s) => s.activityMin[a.name])).map((a) => a.name);
  const dayTypes = props.dayTypeOrder.filter((d) => props.summaries.some((s) => s.dayTypes[d]));

  const tot = rows.reduce(
    (t, s) => ({ days: t.days + s.daysWorked, min: t.min + s.workedMin, sun: t.sun + s.sundaysWorked, hol: t.hol + s.holidaysWorked }),
    { days: 0, min: 0, sun: 0, hol: 0 },
  );
  const absCell = (s: PersonSummary, n: string) => {
    const d = s.absenceDays[n] ?? 0, m = s.absenceMin[n] ?? 0;
    if (!d && !m) return <span className="muted">—</span>;
    return <>{d ? `${d} g` : ''}{d && m ? ' · ' : ''}{m ? minutesLabel(m) : ''}</>;
  };

  async function exportXlsx() {
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const label = fmtDay(`${month}-15`, 'MMMM yyyy');
      const head = [
        'Operatore', 'Email', 'Team', 'Contratto', 'Giorni lavorati', 'Ore lavorate',
        ...dayTypes.map((d) => `Giorni ${d}`), 'Domeniche lavorate', 'Festivi lavorati',
        ...absTypes.flatMap((a) => [`${a} (giorni)`, `${a} (ore)`]),
        'Pause brevi (ore)', 'Pranzo (ore)',
        ...workTypes.map((w) => `${w} (ore)`),
      ];
      const data = rows.map((s) => {
        const p = pById.get(s.person_id)!;
        return [
          p.name, p.email ?? '', p.team ?? '', p.contract ?? '', s.daysWorked, hours(s.workedMin),
          ...dayTypes.map((d) => s.dayTypes[d] ?? 0), s.sundaysWorked, s.holidaysWorked,
          ...absTypes.flatMap((a) => [s.absenceDays[a] ?? 0, hours(s.absenceMin[a] ?? 0)]),
          hours(s.breakMin), hours(s.lunchMin),
          ...workTypes.map((w) => hours(s.activityMin[w] ?? 0)),
        ];
      });
      const ws1 = XLSX.utils.aoa_to_sheet([[`Riepilogo ${label}`], [], head, ...data]);
      ws1['!cols'] = head.map((h, i) => ({ wch: i === 0 ? 26 : i === 1 ? 28 : Math.max(10, h.length + 2) }));
      ws1['!freeze'] = { xSplit: 1, ySplit: 3 };

      const dHead = ['Operatore', 'Data', 'Giorno', 'Inizio', 'Fine', 'Ore lavorate', 'Pause brevi (min)', 'Pranzo (min)', 'Tipo giornata', 'Assenze', 'Domenica/Festivo', ...workTypes.map((w) => `${w} (ore)`)];
      const dRows: (string | number)[][] = [];
      for (const s of rows) {
        const p = pById.get(s.person_id)!;
        for (const d of s.days) {
          dRows.push([
            p.name, d.day, fmtDay(d.day, 'EEEE'),
            d.start ? fmtTime(d.start, tz) : '', d.end ? fmtTime(d.end, tz) : '',
            hours(d.workedMin), d.breakMin, d.lunchMin, d.dayType ?? '',
            d.absences.map((a) => (a.fullDay ? `${a.name} (giornata)` : `${a.name} ${minutesLabel(a.min)}`)).join(', '),
            d.holiday ?? (d.sunday ? 'Domenica' : ''),
            ...workTypes.map((w) => hours(d.activities[w] ?? 0)),
          ]);
        }
      }
      const ws2 = XLSX.utils.aoa_to_sheet([dHead, ...dRows]);
      ws2['!cols'] = dHead.map((h, i) => ({ wch: i === 0 ? 26 : i === 9 ? 30 : Math.max(10, h.length + 2) }));

      const notes = [
        ['Come sono calcolati i valori'],
        ['Ore lavorate', 'Dall’inizio alla fine delle attività lavorative, meno pranzo (pause da 30 min in su) e permessi a ore. Le pause brevi da videoterminale sono incluse.'],
        ['Giorno lavorato', 'Giorno con almeno un’attività lavorativa.'],
        ['Assenze (giorni)', 'Assenza in un giorno senza lavoro.'],
        ['Assenze (ore)', 'Assenza in un giorno in cui si lavora anche (es. permesso a ore).'],
        ['Ore per attività', 'In ogni momento conta l’attività più specifica (la più breve tra quelle sovrapposte); pause e assenze escluse.'],
        ['Festivi', 'Festività nazionali italiane (il patrono locale non è incluso).'],
      ];
      const ws3 = XLSX.utils.aoa_to_sheet(notes);
      ws3['!cols'] = [{ wch: 20 }, { wch: 110 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Riepilogo');
      XLSX.utils.book_append_sheet(wb, ws2, 'Dettaglio giornaliero');
      XLSX.utils.book_append_sheet(wb, ws3, 'Note');
      XLSX.writeFile(wb, `Riepilogo turni ${month}.xlsx`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div className="page-head">
        <div>
          <h1>Report mensile</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Giorni e ore lavorate, ufficio/smart, ferie, permessi e malattie per ogni operatore.</p>
        </div>
        <button className="btn btn-primary" disabled={busy || !rows.length} onClick={exportXlsx}>{busy ? 'Preparo il file…' : 'Esporta in Excel'}</button>
      </div>

      <div className="row" style={{ alignItems: 'center' }}>
        <div className="tl-date">
          <button aria-label="Mese precedente" onClick={() => router.push(`/report?m=${shiftMonth(month, -1)}`)}><IcLeft width={16} /></button>
          <input id="rp-month" type="month" value={month} onChange={(e) => e.target.value && router.push(`/report?m=${e.target.value}`)} aria-label="Mese" />
          <button aria-label="Mese successivo" onClick={() => router.push(`/report?m=${shiftMonth(month, 1)}`)}><IcRight width={16} /></button>
        </div>
        <b style={{ textTransform: 'capitalize' }}>{fmtDay(`${month}-15`, 'MMMM yyyy')}</b>
        <select id="rp-team" className="select" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
          <option value="">Tutti i team</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input id="rp-q" className="input" placeholder="Cerca operatore…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small" style={{ marginLeft: 'auto' }}>
          {rows.length} operatori · {tot.days} giorni · {minutesLabel(tot.min)} lavorate
        </span>
      </div>

      <section className="card">
        <div className="table-wrap">
          <table className="table rp">
            <thead>
              <tr>
                <th>Operatore</th>
                <th className="num">Giorni</th>
                <th className="num">Ore</th>
                {dayTypes.map((d) => <th key={d} className="num">{d}</th>)}
                <th className="num">Domeniche</th>
                <th className="num">Festivi</th>
                {absTypes.map((a) => <th key={a} className="num">{a}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const p = pById.get(s.person_id)!;
                const isOpen = open === s.person_id;
                return (
                  <Fragment key={s.person_id}>
                    <tr className="rp-row" onClick={() => setOpen(isOpen ? null : s.person_id)} aria-expanded={isOpen}>
                      <td>
                        <span className="chev-r" aria-hidden="true">{isOpen ? '▾' : '▸'}</span> <b>{p.name}</b>
                        <div className="small muted">{[p.team, p.contract].filter(Boolean).join(' · ')}{!p.active ? ' · disattivato' : ''}</div>
                      </td>
                      <td className="num">{s.daysWorked || <span className="muted">—</span>}</td>
                      <td className="num">{s.workedMin ? minutesLabel(s.workedMin) : <span className="muted">—</span>}</td>
                      {dayTypes.map((d) => <td key={d} className="num">{s.dayTypes[d] ?? <span className="muted">—</span>}</td>)}
                      <td className="num">{s.sundaysWorked || <span className="muted">—</span>}</td>
                      <td className="num">{s.holidaysWorked || <span className="muted">—</span>}</td>
                      {absTypes.map((a) => <td key={a} className="num">{absCell(s, a)}</td>)}
                    </tr>
                    {isOpen && (
                      <tr className="rp-detail">
                        <td colSpan={5 + dayTypes.length + absTypes.length}>
                          <div className="rp-acts">
                            {workTypes.filter((w) => s.activityMin[w]).map((w) => (
                              <span key={w}><i style={{ background: props.activityOrder.find((a) => a.name === w)?.color }} />{w} {minutesLabel(s.activityMin[w]!)}</span>
                            ))}
                            <span className="muted">Pause brevi {minutesLabel(s.breakMin)} · Pranzo {minutesLabel(s.lunchMin)}</span>
                          </div>
                          {s.days.length === 0 ? (
                            <div className="muted small">Nessun turno nel mese.</div>
                          ) : (
                            <table className="table small">
                              <thead><tr><th>Giorno</th><th>Orario</th><th className="num">Ore</th><th>Tipo</th><th>Assenze</th></tr></thead>
                              <tbody>
                                {s.days.map((d) => (
                                  <tr key={d.day} className={d.sunday || d.holiday ? 'rp-hol' : ''}>
                                    <td style={{ whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{fmtDay(d.day, 'EEE d')}{d.holiday ? ` · ${d.holiday}` : ''}</td>
                                    <td className="tabnum">{d.start ? `${fmtTime(d.start, tz)}–${fmtTime(d.end!, tz)}` : '—'}</td>
                                    <td className="num">{d.workedMin ? minutesLabel(d.workedMin) : '—'}</td>
                                    <td>{d.dayType ?? ''}</td>
                                    <td>{d.absences.map((a) => (a.fullDay ? a.name : `${a.name} ${minutesLabel(a.min)}`)).join(', ')}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && <div className="empty">Nessun operatore con questi filtri.</div>}
      </section>

      <p className="small muted" style={{ margin: 0 }}>
        Ore lavorate = dall’inizio alla fine delle attività, meno pranzo e permessi a ore (le pause brevi sono incluse). Un’assenza conta come giorno se quel giorno non si lavora, altrimenti in ore.
        Festivi nazionali italiani, patrono escluso. Nel file Excel trovi anche il dettaglio giorno per giorno e le ore per attività.
      </p>

      <style dangerouslySetInnerHTML={{ __html: `
        .rp th.num,.rp td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .rp-row{cursor:pointer}
        .rp-row:hover td{background:var(--hover)}
        .chev-r{color:var(--muted);display:inline-block;width:12px}
        .rp-detail > td{background:#fafbfc;padding:12px 16px}
        .rp-acts{display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:10px;font-size:13px}
        .rp-acts i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}
        .rp-hol td{background:#fff7ed}
        .rp-detail .table{background:#fff;border:1px solid var(--line);border-radius:6px}
      ` }} />
    </div>
  );
}
