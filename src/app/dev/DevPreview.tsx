'use client';
import { useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import Timeline from '@/components/timeline/Timeline';
import Importer from '@/components/import/Importer';
import MyCalendar from '../(app)/i-miei-turni/MyCalendar';
import RequestsTable from '../(app)/richieste/RequestsTable';
import TimeOffBoard from '../(app)/assenze/TimeOffBoard';
import TeamTable from '../(app)/team/TeamTable';
import Settings from '../(app)/impostazioni/Settings';
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
const PEOPLE = NAMES.map((n, i) => ({ id: `p${i}`, full_name: n, contract: i % 5 === 3 ? 'part time' : 'full time', user_id: i === 12 ? null : `u${i}`, email: null, aliases: [] as string[], team: i % 5 === 3 ? 'part time' : 'full time', channels: i % 3 ? ['Chat', 'Phone', 'SMS'] : ['Phone'] }));

function buildEvents(dates: string[]): EventRow[] {
  const out: EventRow[] = [];
  let k = 0;
  const add = (p: string, a: string, d: string, s: string, e: string) => out.push({ id: `e${k++}`, person_id: p, activity_id: a, starts_at: new Date(localToUtc(d, s, TZ)).toISOString(), ends_at: new Date(localToUtc(d, e, TZ)).toISOString(), note: k % 11 === 0 ? 'Affiancamento nuovo collega' : null, source: 'import', updated_at: '2026-10-22T08:45:00Z', updated_by: 'p5' });
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
        {screen === 'requests' ? (
          <div className="page" style={{ maxWidth: 1300 }}>
            <h1>Richieste di modifica turni</h1>
            <RequestsTable
              tz={TZ}
              rows={[
                { id: 'r1', kind: 'swap', status: 'pending_manager', by: 'Claudia Borra', created_at: '2026-11-03T09:12:00Z', dates: 'gio 12 nov, ven 13 nov', firstDay: '2026-11-12', description: 'Claudia dà gio 12 nov (14:00–22:00) a Marco e prende ven 13 nov (08:00–16:00)', note: 'Visita medica', issues: [], decidedBy: null, decisionNote: null },
                { id: 'r2', kind: 'give', status: 'pending_manager', by: 'Luca Neri', created_at: '2026-11-02T15:40:00Z', dates: 'mar 10 nov', firstDay: '2026-11-10', description: 'Luca cede mar 10 nov (13:00–22:00) a Sara', note: null, issues: ['Sara Colombo: solo 10h00 di riposo prima del turno di 11/11 alle 08:00 (minimo 11 h)'], decidedBy: null, decisionNote: null },
                { id: 'r3', kind: 'change', status: 'pending_manager', by: 'Elena Ricci', created_at: '2026-11-01T08:00:00Z', dates: 'lun 16 nov', firstDay: '2026-11-16', description: 'Elena, lun 16 nov (turno 09:00–18:00): posso entrare alle 10?', note: 'posso entrare alle 10?', issues: [], decidedBy: null, decisionNote: null },
                { id: 'r4', kind: 'swap', status: 'approved', by: 'Paolo Bruno', created_at: '2026-10-20T08:00:00Z', dates: 'lun 26 ott', firstDay: '2026-10-26', description: 'Paolo dà lun 26 ott a Martina', note: null, issues: [], decidedBy: 'Carlo Carrabino', decisionNote: null },
              ]}
            />
          </div>
        ) : screen === 'timeoff' ? (
          <div className="page" style={{ maxWidth: 1300 }}>
            <h1>Richieste di assenza</h1>
            <TimeOffBoard
              tz={TZ}
              types={ACTS.filter((a) => a.kind === 'absence').map((a) => ({ id: a.id, name: a.name }))}
              cards={[
                { id: 't1', person: 'Vincenzo Carnevale', email: 'carnevale@dentalpro.it', type: 'Ferie', color: '#bdb6d8', activity_id: 'ferie', from: '2026-12-07', to: '2026-12-07', timeFrom: null, timeTo: null, hours: 8, status: 'pending_manager', byManager: false, created_at: '2026-09-04T10:00:00Z', note: null, decisionNote: null, overlap: [] },
                { id: 't2', person: 'Vincenzo Carnevale', email: 'carnevale@dentalpro.it', type: 'Ferie', color: '#bdb6d8', activity_id: 'ferie', from: '2026-12-23', to: '2027-01-06', timeFrom: null, timeTo: null, hours: 88, status: 'pending_manager', byManager: false, created_at: '2026-09-04T10:00:00Z', note: null, decisionNote: null, overlap: ['Claudia Borra'] },
                { id: 't3', person: 'Claudia Borra', email: 'borra@dentalpro.it', type: 'Ferie', color: '#bdb6d8', activity_id: 'ferie', from: '2026-12-28', to: '2026-12-31', timeFrom: null, timeTo: null, hours: 32, status: 'approved', byManager: false, created_at: '2026-10-01T10:00:00Z', note: 'Viaggio', decisionNote: null, overlap: ['Vincenzo Carnevale'] },
              ]}
            />
          </div>
        ) : screen === 'people' ? (
          <div className="page" style={{ maxWidth: 1300 }}>
            <h1>Persone</h1>
            <TeamTable
              meId="p0"
              isAdmin
              people={PEOPLE.map((p, i) => ({ ...p, email: `${p.full_name.split(' ').slice(-1)[0]!.toLowerCase()}@dentalpro.it`, role: i === 0 ? 'admin' : i === 1 ? 'team_lead' : 'agent', active: true, notify_requests: true, email_notifications: true, created_at: '' }))}
            />
          </div>
        ) : screen === 'settings' ? (
          <div className="page" style={{ maxWidth: 860 }}>
            <h1>Le mie impostazioni</h1>
            <Settings
              profile={{ first: 'Carlo', last: 'Carrabino', email: 'carrabino@dentalpro.it', role: 'Team Lead', team: null, channels: [] }}
              prefs={{ email_notifications: true, notify_requests: true }}
              isManager
              vapidKey=""
              calendar={{ configured: true, connected: false, mode: null, lastSync: null, lastError: null, message: 'ok:23' }}
            />
          </div>
        ) : screen === 'me' || screen === 'me-month' ? (
          (() => {
            const v = screen === 'me' ? 'week' : 'month';
            const from = v === 'week' ? weekStart(today) : weekStart(today.slice(0, 8) + '01');
            const n = v === 'week' ? 7 : 42;
            const evs = buildEvents(Array.from({ length: n }, (_, i) => addDays(from, i))).filter((e) => e.person_id === 'p5');
            const days: Record<string, { text: string; canAct: boolean; pending: boolean }> = {};
            evs.forEach((e) => {
              const d = e.starts_at.slice(0, 10);
              const s0 = new Date(e.starts_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
              if (!days[d] || ACTS.find((a) => a.id === e.activity_id)?.kind === 'work') days[d] = { text: `${s0}–…`, canAct: d >= today, pending: false };
            });
            return (
              <MyCalendar
                me={{ name: 'Francesca Ceraolo', email: 'ceraolo@dentalpro.it', channels: ['Chat', 'Phone', 'SMS'], team: 'full time', contract: 'full time', role: 'agent' }}
                view={v}
                date={today}
                from={from}
                to={addDays(from, n)}
                today={today}
                tz={TZ}
                events={evs.map((e) => {
                  const a = ACTS.find((x) => x.id === e.activity_id)!;
                  return { id: e.id, s: Date.parse(e.starts_at), e: Date.parse(e.ends_at), name: a.name, color: a.color, kind: a.kind, note: e.note };
                })}
                marks={{ [addDays(from, 2)]: { name: 'Smart working', color: '#fff27a' }, [addDays(from, 1)]: { name: 'Ufficio', color: '#e3ecff' } }}
                days={days}
                unpublishedWeeks={[]}
                colleagues={[]}
                absences={ACTS.filter((a) => a.kind === 'absence')}
                calendarConnected={false}
              />
            );
          })()
        ) : screen === 'import' ? (
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
            onHistory={async () => [{ at: '2026-10-22T08:45:00Z', actor: 'Carlo Carrabino', action: 'update', before: { starts_at: '2026-11-04T08:00:00Z', ends_at: '2026-11-04T16:00:00Z', activity_id: 'tel' }, after: { starts_at: '2026-11-04T08:00:00Z', ends_at: '2026-11-04T17:00:00Z', activity_id: 'chat' } }]}
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
