import { getSession } from '@/lib/session';
import { calendarConfigured } from '@/lib/gcal';
import { ROLE_LABEL } from '@/lib/types';
import { fmt } from '@/lib/time';
import Settings from './Settings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export default async function SettingsPage({ searchParams }: { searchParams: { calendar?: string } }) {
  const { supabase, me, tz, isManager } = await getSession();
  const { data: cal } = await supabase.rpc('my_calendar_status');
  const status = Array.isArray(cal) && cal[0] ? cal[0] : null;
  const parts = me.full_name.split(' ');
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1>Le mie impostazioni</h1>
      <Settings
        profile={{
          first: parts.slice(0, -1).join(' ') || me.full_name,
          last: parts.length > 1 ? parts[parts.length - 1]! : '',
          email: me.email ?? '',
          role: ROLE_LABEL[me.role],
          team: me.team,
          channels: me.channels ?? [],
        }}
        prefs={{ email_notifications: me.email_notifications, notify_requests: me.notify_requests ?? true }}
        isManager={isManager}
        vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''}
        calendar={{
          configured: calendarConfigured(),
          connected: !!status,
          mode: (status?.mode as 'primary' | 'separate' | undefined) ?? null,
          lastSync: status?.last_sync_at ? fmt(status.last_sync_at, tz, "d MMM 'alle' HH:mm") : null,
          lastError: status?.last_error ?? null,
          message: searchParams.calendar ?? null,
        }}
      />
    </div>
  );
}
