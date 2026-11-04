import { requireManager } from '@/lib/session';
import Importer from '@/components/import/Importer';
import type { Activity } from '@/lib/types';
import type { PersonLite } from '@/lib/import/match';
import { importAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const { supabase, tz } = await requireManager();
  const [people, activities] = await Promise.all([
    supabase.from('people').select('id, full_name, email, aliases, user_id').eq('active', true).order('full_name'),
    supabase.from('activity_types').select('*').order('sort_order'),
  ]);
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <h1>Importa Excel</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Carica il file dei turni: il sistema riconosce orari e attività e collega ogni riga alla persona giusta.
          </p>
        </div>
      </div>
      <Importer
        people={(people.data ?? []) as PersonLite[]}
        activities={(activities.data ?? []) as Activity[]}
        tz={tz}
        onImport={importAction}
      />
    </div>
  );
}
