import { requireManager } from '@/lib/session';
import type { Activity } from '@/lib/types';
import ConfigForms from './ConfigForms';

export const dynamic = 'force-dynamic';

export default async function ConfigPage() {
  const { supabase, settings, isAdmin } = await requireManager();
  const { data } = await supabase.from('activity_types').select('*').order('sort_order');
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1>Configura</h1>
      <ConfigForms activities={(data ?? []) as Activity[]} settings={settings} isAdmin={isAdmin} />
    </div>
  );
}
