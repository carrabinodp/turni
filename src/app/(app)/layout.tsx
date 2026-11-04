import { getSession } from '@/lib/session';
import Sidebar from '@/components/Sidebar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, me, isManager, settings } = await getSession();

  const [mgr, peer, unread] = await Promise.all([
    isManager
      ? supabase.from('requests').select('id', { count: 'exact', head: true }).eq('status', 'pending_manager')
      : Promise.resolve({ count: 0 }),
    supabase.from('requests').select('id', { count: 'exact', head: true }).eq('status', 'pending_peer').eq('target_id', me.id),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('person_id', me.id).is('read_at', null),
  ]);

  return (
    <div className="shell">
      <Sidebar
        me={{ name: me.full_name, role: me.role }}
        orgName={settings.org_name}
        isManager={isManager}
        isAdmin={me.role === 'admin'}
        counts={{ requests: (mgr.count ?? 0) + (peer.count ?? 0), notifications: unread.count ?? 0 }}
      />
      <main className="main">{children}</main>
    </div>
  );
}
