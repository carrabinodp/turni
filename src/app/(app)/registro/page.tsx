import { requireManager } from '@/lib/session';
import { fmt } from '@/lib/time';

export const dynamic = 'force-dynamic';

type Row = { id: number; at: string; actor_id: string | null; entity: string; action: string; summary: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

export default async function LogPage() {
  const { supabase, tz } = await requireManager();
  const [{ data }, { data: people }, { data: acts }] = await Promise.all([
    supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(300),
    supabase.from('people').select('id, full_name'),
    supabase.from('activity_types').select('id, name'),
  ]);
  const pn = new Map((people ?? []).map((p) => [p.id, p.full_name as string]));
  const an = new Map((acts ?? []).map((a) => [a.id, a.name as string]));
  const time = (v: unknown) => (typeof v === 'string' ? fmt(v, tz, 'EEE d/M HH:mm') : '');

  function text(r: Row): string {
    if (r.summary) return r.summary;
    if (r.entity === 'events') {
      const e = (r.after ?? r.before)!;
      const who = pn.get(String(e.person_id)) ?? '?';
      const what = `${an.get(String(e.activity_id)) ?? 'blocco'} ${time(e.starts_at)}–${typeof e.ends_at === 'string' ? fmt(e.ends_at, tz, 'HH:mm') : ''}`;
      if (r.action === 'insert') return `Aggiunto ${what} a ${who}`;
      if (r.action === 'delete') return `Eliminato ${what} di ${who}`;
      const b = r.before!, a = r.after!;
      const parts: string[] = [];
      if (b.person_id !== a.person_id) parts.push(`da ${pn.get(String(b.person_id))} a ${who}`);
      if (b.activity_id !== a.activity_id) parts.push(`${an.get(String(b.activity_id))} → ${an.get(String(a.activity_id))}`);
      if (b.starts_at !== a.starts_at || b.ends_at !== a.ends_at) parts.push(`orario ${time(b.starts_at)}–${fmt(String(b.ends_at), tz, 'HH:mm')} → ${time(a.starts_at)}–${fmt(String(a.ends_at), tz, 'HH:mm')}`);
      return `Modificato blocco di ${who}: ${parts.join(', ') || 'nota'}`;
    }
    if (r.entity === 'requests') {
      const q = (r.after ?? r.before)!;
      return `Richiesta di ${pn.get(String(q.requester_id)) ?? '?'}: ${r.action === 'insert' ? 'creata' : `stato ${String(q.status)}`}`;
    }
    return `${r.entity} ${r.action}`;
  }

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1>Registro modifiche</h1>
      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Quando</th><th>Chi</th><th>Cosa</th></tr></thead>
            <tbody>
              {((data ?? []) as Row[]).map((r) => (
                <tr key={r.id}>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fmt(r.at, tz, 'd MMM HH:mm')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.actor_id ? pn.get(r.actor_id) ?? '—' : 'Sistema'}</td>
                  <td>{text(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(data ?? []).length === 0 && <div className="empty">Ancora nessuna modifica.</div>}
      </section>
    </div>
  );
}
