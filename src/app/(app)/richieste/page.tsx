import { getSession } from '@/lib/session';
import { describeRequest, groupShifts } from '@/lib/shifts';
import { addDays, dayStart, fmt, todayIn } from '@/lib/time';
import { STATUS_LABEL, type Activity, type EventRow, type RequestRow } from '@/lib/types';
import { ActionButton } from '@/components/ui';
import DecideBox from './DecideBox';
import { cancel, respond, take } from './actions';

export const dynamic = 'force-dynamic';

const PILL: Record<string, string> = {
  pending_peer: 'pill pill-warn', open: 'pill pill-info', pending_manager: 'pill pill-warn',
  approved: 'pill pill-ok', rejected: 'pill pill-bad', cancelled: 'pill',
};

export default async function RequestsPage() {
  const { supabase, me, tz, isManager } = await getSession();
  const since = new Date(Date.now() - 45 * 86400000).toISOString();

  const [{ data: reqData }, { data: peopleData }, { data: actData }] = await Promise.all([
    supabase.from('requests').select('*').or(`status.in.(pending_peer,open,pending_manager),created_at.gte.${since}`).order('created_at', { ascending: false }).limit(300),
    supabase.from('people').select('id, full_name'),
    supabase.from('activity_types').select('*'),
  ]);
  const requests = (reqData ?? []) as RequestRow[];
  const names = new Map((peopleData ?? []).map((p) => [p.id, p.full_name as string]));
  const acts = new Map(((actData ?? []) as Activity[]).map((a) => [a.id, a]));

  // turni coinvolti, per mostrare gli orari
  const days = requests.flatMap((r) => [r.day_a, r.day_b]).filter(Boolean) as string[];
  let shifts = new Map();
  if (days.length) {
    const min = days.reduce((a, b) => (a < b ? a : b));
    const max = days.reduce((a, b) => (a > b ? a : b));
    const { data: ev } = await supabase
      .from('events')
      .select('id, person_id, activity_id, starts_at, ends_at, note, source, updated_at')
      .gte('starts_at', new Date(dayStart(min, tz)).toISOString())
      .lt('starts_at', new Date(dayStart(addDays(max, 1), tz)).toISOString());
    shifts = groupShifts((ev ?? []) as EventRow[], Array.from(acts.values()), tz);
  }
  const desc = (r: RequestRow) => describeRequest(r, names, acts, shifts, tz);

  const toDecide = isManager ? requests.filter((r) => r.status === 'pending_manager') : [];
  const forMe = requests.filter((r) => r.status === 'pending_peer' && r.target_id === me.id);
  const board = requests.filter((r) => r.status === 'open' && r.requester_id !== me.id && r.day_a! >= todayIn(tz));
  const mine = requests.filter((r) => r.requester_id === me.id || (r.target_id === me.id && r.status !== 'pending_peer'));
  const history = isManager ? requests.filter((r) => ['approved', 'rejected'].includes(r.status)).slice(0, 30) : [];

  // anteprima regole per le richieste da approvare
  const previews = new Map<string, string[]>();
  await Promise.all(
    toDecide.map(async (r) => {
      const { data, error } = await supabase.rpc('request_preview', { p_id: r.id });
      previews.set(r.id, error ? [error.message] : ((data ?? []) as string[]));
    }),
  );

  const Note = ({ r }: { r: RequestRow }) => (r.note ? <div className="small muted">“{r.note}”</div> : null);

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <h1>Richieste</h1>
        <a className="btn btn-primary" href="/i-miei-turni">Nuovo scambio o cessione</a>
      </div>

      {isManager && (
        <section className="card">
          <div className="card-head"><h2>Da approvare</h2>{toDecide.length > 0 && <span className="pill pill-warn">{toDecide.length}</span>}</div>
          {toDecide.length === 0 ? (
            <div className="empty">Nessuna richiesta in attesa.</div>
          ) : (
            <div className="card-body">
              {toDecide.map((r) => (
                <div key={r.id} className="req">
                  <div>
                    <b>{desc(r)}</b>
                    <Note r={r} />
                    <div className="small muted">Richiesta il {fmt(r.created_at, tz, "d MMM 'alle' HH:mm")}</div>
                  </div>
                  <DecideBox id={r.id} issues={previews.get(r.id) ?? []} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Chiedono a te</h2>{forMe.length > 0 && <span className="pill pill-warn">{forMe.length}</span>}</div>
          {forMe.length === 0 ? <div className="empty">Nessuna richiesta dai colleghi.</div> : (
            <div className="card-body">
              {forMe.map((r) => (
                <div key={r.id} className="req">
                  <div><b>{desc(r)}</b><Note r={r} /></div>
                  <div className="row">
                    <ActionButton className="btn btn-sm btn-primary" action={respond.bind(null, r.id, true)}>Accetta</ActionButton>
                    <ActionButton className="btn btn-sm btn-danger" action={respond.bind(null, r.id, false)}>Rifiuta</ActionButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2>Bacheca turni liberi</h2></div>
          {board.length === 0 ? <div className="empty">Nessun turno disponibile.</div> : (
            <div className="card-body">
              {board.map((r) => (
                <div key={r.id} className="req">
                  <div><b>{desc(r)}</b><Note r={r} /></div>
                  <ActionButton className="btn btn-sm btn-primary" action={take.bind(null, r.id)}>Prendo io</ActionButton>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Le mie richieste</h2></div>
        {mine.length === 0 ? <div className="empty">Non hai richieste recenti.</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Richiesta</th><th>Stato</th><th>Data</th><th /></tr></thead>
              <tbody>
                {mine.map((r) => (
                  <tr key={r.id}>
                    <td>{desc(r)}{r.decision_note && <div className="small muted">Manager: {r.decision_note}</div>}</td>
                    <td><span className={PILL[r.status]}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fmt(r.created_at, tz, 'd MMM')}</td>
                    <td>
                      {r.requester_id === me.id && ['pending_peer', 'open', 'pending_manager'].includes(r.status) && (
                        <ActionButton className="btn btn-sm btn-ghost" action={cancel.bind(null, r.id)} confirm="Annullare la richiesta?">Annulla</ActionButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isManager && history.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Decise di recente</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Richiesta</th><th>Esito</th><th>Da</th><th>Quando</th></tr></thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td>{desc(r)}</td>
                    <td><span className={PILL[r.status]}>{STATUS_LABEL[r.status]}</span></td>
                    <td>{names.get(r.decided_by ?? '') ?? ''}</td>
                    <td className="small muted">{r.decided_at ? fmt(r.decided_at, tz, 'd MMM HH:mm') : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <style>{`.req{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--line-2)}.req:last-child{border-bottom:0;padding-bottom:0}.req > div:first-child{min-width:0;flex:1 1 320px}`}</style>
    </div>
  );
}
