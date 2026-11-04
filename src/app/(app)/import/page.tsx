import { requireManager } from '@/lib/session';
import Importer from '@/components/import/Importer';
import type { Activity, DayType } from '@/lib/types';
import type { BreakRule } from '@/lib/breaks';
import type { SavedColor } from '@/components/import/Importer';
import type { PersonLite } from '@/lib/import/match';
import { importAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const { supabase, tz, settings } = await requireManager();
  const [people, activities, dayTypes, colors] = await Promise.all([
    supabase.from('people').select('id, full_name, email, aliases, user_id').eq('active', true).order('full_name'),
    supabase.from('activity_types').select('*').order('sort_order'),
    supabase.from('day_types').select('*').order('sort_order'),
    supabase.from('import_color_map').select('fill, target, activity_id, day_type_id'),
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
        dayTypes={(dayTypes.data ?? []) as DayType[]}
        savedColors={(colors.data ?? []) as SavedColor[]}
        breakRules={(settings.break_rules ?? []) as BreakRule[]}
        breakActivityId={settings.break_activity_id ?? null}
        tz={tz}
        onImport={importAction}
      />
    </div>
  );
}
