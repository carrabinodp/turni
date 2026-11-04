import { requireManager } from '@/lib/session';
import type { Person } from '@/lib/types';
import TeamTable from './TeamTable';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const { supabase, me, isAdmin } = await requireManager();
  const { data } = await supabase.from('people').select('*').order('active', { ascending: false }).order('full_name');
  const people = (data ?? []) as Person[];
  const pending = people.filter((p) => !p.user_id && p.active).length;
  return (
    <div className="page" style={{ maxWidth: 1150 }}>
      <div className="page-head">
        <div>
          <h1>Persone</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {people.filter((p) => p.active).length} persone attive{pending ? ` · ${pending} non ancora registrate` : ''}. I colleghi entrano da soli con l’email aziendale:
            il profilo si collega per email o per nome e cognome.
          </p>
        </div>
      </div>
      <TeamTable people={people} meId={me.id} isAdmin={isAdmin} />
    </div>
  );
}
