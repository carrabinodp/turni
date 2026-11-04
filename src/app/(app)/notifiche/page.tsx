import { getSession } from '@/lib/session';
import { fmt } from '@/lib/time';
import { markAllRead } from './actions';
import { ActionButton } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const { supabase, me, tz } = await getSession();
  const { data } = await supabase.from('notifications').select('*').eq('person_id', me.id).order('created_at', { ascending: false }).limit(100);
  const list = data ?? [];
  const unread = list.filter((n) => !n.read_at).length;

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <h1>Notifiche</h1>
        {unread > 0 && <ActionButton action={markAllRead}>Segna tutte come lette</ActionButton>}
      </div>
      <p className="muted" style={{ margin: 0 }}>Email, notifiche sul telefono e Google Calendar si impostano in <a href="/impostazioni">Impostazioni</a>.</p>
      <section className="card">
        {list.length === 0 ? <div className="empty">Nessuna notifica.</div> : (
          <div>
            {list.map((n) => (
              <a key={n.id} href={n.url ?? '#'} className="notif" data-unread={!n.read_at || undefined}>
                <div style={{ minWidth: 0 }}>
                  <b>{n.title}</b>
                  {n.body && <div className="small muted" style={{ whiteSpace: 'pre-line' }}>{n.body}</div>}
                </div>
                <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{fmt(n.created_at, tz, 'd MMM HH:mm')}</span>
              </a>
            ))}
          </div>
        )}
      </section>
      <style dangerouslySetInnerHTML={{ __html: `.notif{display:flex;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line-2);color:var(--ink);text-decoration:none}.notif:hover{background:var(--hover);text-decoration:none}.notif:last-child{border-bottom:0}.notif[data-unread]{background:#f7f9ff}.notif[data-unread] b::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent);margin-right:7px;vertical-align:middle}` }} />
    </div>
  );
}
