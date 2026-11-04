'use client';
import { useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import Timeline from '@/components/timeline/Timeline';
import Importer from '@/components/import/Importer';
import type { Activity, DayMark, DayType, EventRow } from '@/lib/types';
import { localToUtc, todayIn, weekStart, addDays } from '@/lib/time';

const TZ = 'Europe/Rome';
const A = (id: string, name: string, color: string, kind: Activity['kind'], requestable = false): Activity => ({ id, name, color, kind, aliases: [], requestable, sort_order: 0, archived: false });
const ACTS: Activity[] = [
  A('tel', 'Telefono', '#483d73', 'work'), A('chat', 'Chat', '#2e6e9e', 'work'), A('mail', 'Email', '#b4a7dd', 'work'),
  A('form', 'Formazione', '#c58b2b', 'work'), A('riun', 'Riunione', '#a33a5a', 'work'),
  A('pausa', 'Pausa', '#a9d3ea', 'break'), A('pranzo', 'Pranzo', '#f6e7a6', 'break'),
  A('ferie', 'Ferie', '#bdb6d8', 'absence', true), A('mal', 'Malattia', '#f48ca0', 'absence'),
];
const DT: DayType[] = [
  { id: 'uff', name: 'Ufficio', color: '#dbe7ff', aliases: [], sort_order: 10, archived: false },
  { id: 'sw', name: 'Smart working', color: '#fff27a', aliases: [], sort_order: 20, archived: false },
  { id: 'ver', name: 'Da verificare', color: '#b7dee8', aliases: [], sort_order: 30, archived: false },
];
const NAMES = ['Claudia Borra', 'Andrea Pettineo', 'Davide Mascitelli', 'Francesca Gennari', 'Gabriella Martorana', 'Francesca Ceraolo', 'Luca Neri', 'Sara Colombo', 'Paolo Bruno', 'Elena Ricci', 'Marco Bianchi', 'Giulia Rossi', 'Simone Fontana', 'Martina Costa'];
const PEOPLE = NAMES.map((n, i) => ({ id: `p${i}`, full_name: n, contract: i % 5 === 3 ? 'part time' : 'full time', user_id: i === 12 ? null : `u${i}`, email: null, aliases: [] as string[] }));

function buildEvents(dates: string[]): EventRow[] {
  const out: EventRow[] = [];
  let k = 0;
  const add = (p: string, a: string, d: string, s: string, e: string) => out.push({ id: `e${k++}`, person_id: p, activity_id: a, starts_at: new Date(localToUtc(d, s, TZ)).toISOString(), ends_at: new Date(localToUtc(d, e, TZ)).toISOString(), note: null, source: 'import', updated_at: '2026-11-01T10:00:00Z' });
  dates.forEach((d, di) => {
    PEOPLE.forEach((p, i) => {
      const r = (i + di) % 7;
      if (r === 6 && di > 0) return; // riposo
      if (i === 0) return add(p.id, 'ferie', d, '08:00', '17:00');
      if (i === 1 && di === 0) return add(p.id, 'mal', d, '08:00', '17:00');
      const starts = ['08:00', '08:00', '09:00', '10:00', '12:00', '13:00'];
      const st = starts[(i + di) % starts.length]!;
      const h = Number(st.slice(0, 2));
      const fmt = (x: number) => `${String(Math.floor(x)).padStart(2, '0')}:${x % 1 ? '30' : '00'}`;
      const main = i % 4 === 3 ? 'chat' : i % 5 === 4 ? 'mail' : 'tel';
      add(p.id, main, d, st, fmt(h + 9));
      const hh = String(h + 2).padStart(2, '0');
      add(p.id, 'pausa', d, `${hh}:00`, `${hh}:15`);
      add(p.id, 'pausa', d, `${String(h + 7).padStart(2, '0')}:30`, `${String(h + 7).padStart(2, '0')}:45`);
      add(p.id, 'pranzo', d, fmt(h + 4), fmt(h + 5));
      if (i % 3 === 0) add(p.id, 'form', d, fmt(h + 7), fmt(h + 8));
    });
  });
  return out.filter((e) => Date.parse(e.ends_at) > Date.parse(e.starts_at));
}

export default function DevPreview({ screen }: { screen: string }) {
  const today = todayIn(TZ);
  const [date, setDate] = useState(today);
  const [view, setView] = useState<'day' | 'week' | 'custom'>(screen === 'week' ? 'week' : screen === 'custom' ? 'custom' : 'day');
  const [to, setTo] = useState<string | undefined>(screen === 'custom' ? addDays(weekStart(today), 27) : undefined);
  const from = view === 'custom' ? date : weekStart(date);
  const n = view === 'custom' && to ? Math.round((Date.parse(to) - Date.parse(date)) / 86400000) + 1 : 7;
  const events = useMemo(() => buildEvents(Array.from({ length: n }, (_, i) => addDays(from, i))), [from, n]);
  const marks = useMemo<DayMark[]>(() => {
    const out: DayMark[] = [];
    for (let i = 0; i < n; i++) {
      const d = addDays(from, i);
      PEOPLE.forEach((p, k) => {
        if (k === 0) return;
        out.push({ person_id: p.id, day: d, day_type_id: (k + i) % 4 === 0 ? 'sw' : 'uff' });
      });
    }
    return out;
  }, [from, n]);

  return (
    <div className="shell">
      <Sidebar me={{ name: 'Carlo Carrabino', role: 'admin' }} orgName="Turni Supporto" isManager isAdmin counts={{ requests: 2, notifications: 1 }} />
      <main className="main">
        {screen === 'import' ? (
          <div className="page" style={{ maxWidth: 1100 }}>
            <h1>Importa Excel</h1>
            <Importer
              people={PEOPLE}
              activities={ACTS}
              dayTypes={DT}
              savedColors={[{ fill: 'BF4F14', target: 'activity', activity_id: 'riun', day_type_id: null }]}
              breakRules={[]}
              breakActivityId="pausa"
              tz={TZ}
              onImport={async (p) => ({ ok: true, inserted: p.rows.length, deleted: 0, people_created: p.people_create.length, marks: p.marks.length, published: [] })}
            />
          </div>
        ) : (
          <Timeline
            view={view}
            date={date}
            tz={TZ}
            people={PEOPLE}
            activities={ACTS}
            events={events}
            to={view === 'custom' ? to : undefined}
            dayTypes={DT}
            marks={marks}
            publishedWeeks={screen === 'week' ? [] : [weekStart(date)]}
            canEdit
            meId="p11"
            snapMinutes={15}
            serverKey={`${view}${date}${to}`}
            navigate={(d, v, t) => { setDate(d); setView(v); setTo(t); }}
            onTimeOff={async () => ({ ok: true, message: 'Assenza inserita (anteprima)' })}
            onSwap={async (p) => (p.force ? { ok: true, message: 'Applicato (anteprima)' } : { ok: false, error: 'Marco: solo 10h00 di riposo prima del turno di 11/11 alle 08:00 (minimo 11 h)' })}
            onSave={async (p) => ({ ok: true, message: `Salvate ${p.upserts.length + p.deletes.length} modifiche (anteprima)` })}
            onPublish={async () => ({ ok: true })}
            onCopyWeek={async () => ({ ok: true })}
          />
        )}
      </main>
    </div>
  );
}
