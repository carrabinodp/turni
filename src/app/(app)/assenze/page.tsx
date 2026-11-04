import { getSession } from '@/lib/session';
import { addDays, dayStart, fmt, fmtDay, todayIn } from '@/lib/time';
import { STATUS_LABEL, type Activity, type RequestRow } from '@/lib/types';
import TimeOffForm from './TimeOffForm';
import TimeOffBoard, { type TimeOffCard } from './TimeOffBoard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function AbsencesPage() {
  const { supabase, me, tz, isManager } = await getSession();
  const today = todayIn(tz);
  const [{ data: acts }, { data: reqs }, { data: people }] = await Promise.all([
    supabase.from('activity_types').select('*').eq('kind', 'absence').eq('archived', false).order('sort_order'),
    supabase.from('requests').select('*').eq('kind', 'time_off').eq('requester_id', me.id).order('created_at', { ascending: false }).limit(50),
    supabase.from('people').select('id, full_name'),
  ]);
  const activities = (acts ?? []) as Activity[];
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name as string]));

  let cards: TimeOffCard[] = [];
  if (isManager) {
    const since = addDays(today, -180);
    const [{ data: all }, { data: ppl }] = await Promise.all([
      supabase.from('requests').select('*').eq('kind', 'time_off').gte('to_date', since).order('from_date').limit(1000),
      supabase.from('people').select('id, full_name, email'),
    ]);
    const pm = new Map((ppl ?? []).map((p) => [p.id as string, p as { id: string; full_name: string; email: string | null }]));
    const reqs = (all ?? []) as RequestRow[];
    const weekdays = (a: string, b: string) => {
      let n = 0;
      for (let d = a; d <= b; d = addDays(d, 1)) {
        const dow = new Date(d + 'T12:00:00Z').getUTCDay();
        if (dow !== 0 && dow !== 6) n++;
      }
      return n;
    };
    cards = reqs.map((r) => {
      const act = activities.find((a) => a.id === r.activity_id);
      const hours = r.time_from && r.time_to
        ? Math.round(((Date.parse(`2000-01-01T${r.time_to}`) - Date.parse(`2000-01-01T${r.time_from}`)) / 3600000 + 24) % 24 * 10) / 10
        : weekdays(r.from_date!, r.to_date!) * 8;
      const overlap = Array.from(
        new Set(
          reqs
            .filter((o) => o.id !== r.id && o.requester_id !== r.requester_id && ['approved', 'pending_manager'].includes(o.status) && o.from_date! <= r.to_date! && o.to_date! >= r.from_date!)
            .map((o) => pm.get(o.requester_id)?.full_name ?? ''),
        ),
      ).filter(Boolean);
      return {
        id: r.id,
        person: pm.get(r.requester_id)?.full_name ?? '',
        email: pm.get(r.requester_id)?.email ?? null,
        type: act?.name ?? 'Assenza',
        color: act?.color ?? '#cccccc',
        activity_id: r.activity_id,
        from: r.from_date!,
        to: r.to_date!,
        timeFrom: r.time_from,
        timeTo: r.time_to,
        hours,
        status: r.status,
        byManager: r.decision_note === 'Inserito dal manager',
        created_at: r.created_at,
        note: r.note,
        decisionNote: r.decision_note === 'Inserito dal manager' ? null : r.decision_note,
        overlap,
      };
    });
  }

  let upcoming: { person: string; act: Activity | undefined; day: string; s: string; e: string }[] = [];
  if (isManager) {
    const { data: ev } = await supabase
      .from('events')
      .select('person_id, activity_id, starts_at, ends_at')
      .in('activity_id', activities.map((a) => a.id))
      .gte('starts_at', new Date(dayStart(today, tz)).toISOString())
      .lt('starts_at', new Date(dayStart(addDays(today, 60), tz)).toISOString())
      .order('starts_at');
    upcoming = (ev ?? []).map((e) => ({
      person: names.get(e.person_id) ?? '',
      act: activities.find((a) => a.id === e.activity_id),
      day: fmt(e.starts_at, tz, 'yyyy-MM-dd'),
      s: e.starts_at,
      e: e.ends_at,
    }));
  }

  return (
    <div className="page" style={{ maxWidth: 1300 }}>
      <h1>{isManager ? 'Richieste di assenza' : 'Ferie e permessi'}</h1>
      {isManager && <TimeOffBoard cards={cards} tz={tz} types={activities.map((a) => ({ id: a.id, name: a.name }))} />}
      {isManager && <h2 style={{ marginTop: 10 }}>Le mie richieste</h2>}
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Nuova richiesta</h2></div>
          <div className="card-body">
            <TimeOffForm activities={activities.filter((a) => a.requestable)} today={today} />
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>Le mie richieste</h2></div>
          {(reqs ?? []).length === 0 ? <div className="empty">Nessuna richiesta.</div> : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {((reqs ?? []) as RequestRow[]).map((r) => (
                    <tr key={r.id}>
                      <td>
                        <b>{activities.find((a) => a.id === r.activity_id)?.name ?? 'Assenza'}</b>{' '}
                        {r.from_date === r.to_date ? fmtDay(r.from_date!, 'EEE d MMM') : `${fmtDay(r.from_date!, 'd MMM')} – ${fmtDay(r.to_date!, 'd MMM')}`}
                        {r.time_from && ` · ${r.time_from.slice(0, 5)}–${r.time_to?.slice(0, 5)}`}
                        {r.decision_note && <div className="small muted">Manager: {r.decision_note}</div>}
                      </td>
                      <td><span className={`pill ${r.status === 'approved' ? 'pill-ok' : r.status === 'rejected' ? 'pill-bad' : r.status === 'pending_manager' ? 'pill-warn' : ''}`}>{STATUS_LABEL[r.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {isManager && (
        <section className="card">
          <div className="card-head"><h2>Assenze nei prossimi 60 giorni</h2><span className="muted small">Da richieste approvate, import o inserite in timeline</span></div>
          {upcoming.length === 0 ? <div className="empty">Nessuna assenza in programma.</div> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Giorno</th><th>Persona</th><th>Tipo</th><th>Orario</th></tr></thead>
                <tbody>
                  {upcoming.map((u, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(u.day, 'EEE d MMM')}</td>
                      <td>{u.person}</td>
                      <td><span className="swatch" style={{ background: u.act?.color, marginRight: 6 }} />{u.act?.name}</td>
                      <td className="tabnum small muted">{fmt(u.s, tz, 'HH:mm')}–{fmt(u.e, tz, 'HH:mm')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
