import { requireManager } from '@/lib/session';
import type { Activity, DayType } from '@/lib/types';
import ConfigForms from './ConfigForms';

export const dynamic = 'force-dynamic';

export default async function ConfigPage() {
  const { supabase, settings, isAdmin } = await requireManager();
  const [{ data }, { data: dts }] = await Promise.all([
    supabase.from('activity_types').select('*').order('sort_order'),
    supabase.from('day_types').select('*').order('sort_order'),
  ]);
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1>Configura</h1>
      <ConfigForms activities={(data ?? []) as Activity[]} dayTypes={(dts ?? []) as DayType[]} settings={settings} isAdmin={isAdmin} />
    </div>
  );
}
