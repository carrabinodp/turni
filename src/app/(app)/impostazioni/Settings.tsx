'use client';
import { useState } from 'react';
import { useAction } from '@/components/ui';
import PushToggle from '../notifiche/PushToggle';
import { disconnectCalendar, savePrefs, syncMyCalendar } from './actions';

export default function Settings(props: {
  profile: { first: string; last: string; email: string; role: string; team: string | null; channels: string[] };
  prefs: { email_notifications: boolean; notify_requests: boolean };
  isManager: boolean;
  vapidKey: string;
  calendar: { configured: boolean; connected: boolean; mode: 'primary' | 'separate' | null; lastSync: string | null; lastError: string | null; message: string | null };
}) {
  const [tab, setTab] = useState<'profile' | 'prefs' | 'apps'>(props.calendar.message ? 'apps' : 'profile');
  const [prefs, setPrefs] = useState(props.prefs);
  const [mode, setMode] = useState<'primary' | 'separate'>(props.calendar.mode ?? 'primary');
  const { run, busy } = useAction();
  const c = props.calendar;
  const okMsg = c.message?.startsWith('ok:') ? `Collegato! ${c.message.slice(3)} giornate inserite nel tuo calendario.` : null;

  return (
    <>
      <div className="tabs">
        <button aria-pressed={tab === 'profile'} onClick={() => setTab('profile')}>Profilo</button>
        <button aria-pressed={tab === 'prefs'} onClick={() => setTab('prefs')}>Notifiche</button>
        <button aria-pressed={tab === 'apps'} onClick={() => setTab('apps')} id="calendario">App collegate</button>
      </div>

      {tab === 'profile' && (
        <section className="card">
          <div className="card-head"><h2>Dati personali</h2></div>
          <div className="card-body">
            <div className="row">
              <label className="field" style={{ flex: 1 }}><span>Nome</span><input className="input" value={props.profile.first} readOnly /></label>
              <label className="field" style={{ flex: 1 }}><span>Cognome</span><input className="input" value={props.profile.last} readOnly /></label>
            </div>
            <label className="field"><span>Email</span><input className="input" value={props.profile.email} readOnly /></label>
            <div className="row small" style={{ gap: 18 }}>
              <span><span className="muted">Ruolo</span> {props.profile.role}</span>
              <span><span className="muted">Team</span> {props.profile.team ?? '—'}</span>
              <span><span className="muted">Canali</span> {props.profile.channels.join(', ') || '—'}</span>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Nome ed email arrivano dal tuo account Google aziendale; per la password usa Google. Team e canali li gestisce un manager.
            </p>
          </div>
        </section>
      )}

      {tab === 'prefs' && (
        <section className="card">
          <div className="card-head"><h2>Notifiche</h2></div>
          <div className="card-body">
            <label className="check">
              <input id="pf-email" type="checkbox" checked={prefs.email_notifications} onChange={(e) => setPrefs({ ...prefs, email_notifications: e.target.checked })} />
              Ricevi le notifiche anche via email
            </label>
            {props.isManager && (
              <label className="check">
                <input id="pf-req" type="checkbox" checked={prefs.notify_requests} onChange={(e) => setPrefs({ ...prefs, notify_requests: e.target.checked })} />
                Avvisami quando un operatore chiede ferie, scambi o modifiche
              </label>
            )}
            <div><button className="btn btn-primary" disabled={busy} onClick={() => run(() => savePrefs(prefs))}>Salva</button></div>
            <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
            <PushToggle vapidKey={props.vapidKey} />
          </div>
        </section>
      )}

      {tab === 'apps' && (
        <section className="card">
          <div className="card-head"><h2>Google Calendar</h2>{c.connected && <span className="pill pill-ok">Collegato</span>}</div>
          <div className="card-body">
            {okMsg && <div className="alert alert-ok">{okMsg}</div>}
            {c.message && !okMsg && <div className="alert alert-bad">{c.message}</div>}
            <div className="gcal">
              <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><rect x="6" y="8" width="36" height="34" rx="5" fill="#fff" stroke="#4285f4" strokeWidth="3" /><rect x="6" y="8" width="36" height="9" rx="4" fill="#4285f4" /><text x="24" y="36" textAnchor="middle" fontSize="15" fontWeight="700" fill="#4285f4" fontFamily="Inter, sans-serif">31</text></svg>
              <div style={{ display: 'grid', gap: 8 }}>
                <b>Turni → Google Calendar</b>
                <span className="muted">I tuoi turni pubblicati compaiono nel tuo calendario Google e si aggiornano da soli quando cambiano: un evento per giornata, con le attività nella descrizione.</span>
                {!c.configured ? (
                  <div className="alert alert-warn">Non ancora attivo: l’amministratore deve completare la configurazione Google (vedi README).</div>
                ) : c.connected ? (
                  <>
                    <span className="small">
                      Nel {c.mode === 'separate' ? 'calendario separato “Turni”' : 'tuo calendario principale'} · ultimo aggiornamento {c.lastSync ?? 'mai'}
                    </span>
                    {c.lastError && <div className="alert alert-bad small">{c.lastError}</div>}
                    <div className="row">
                      <button className="btn" disabled={busy} onClick={() => run(() => syncMyCalendar())}>Aggiorna ora</button>
                      <button className="btn btn-danger" disabled={busy} onClick={() => window.confirm('Scollegare Google Calendar? I turni verranno tolti dal calendario.') && run(() => disconnectCalendar())}>Scollega</button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="check"><input type="radio" name="calmode" checked={mode === 'primary'} onChange={() => setMode('primary')} /> Il mio calendario</label>
                    <label className="check"><input type="radio" name="calmode" checked={mode === 'separate'} onChange={() => setMode('separate')} /> Calendario separato “Turni” (lo puoi nascondere quando vuoi)</label>
                    <div><a className="btn btn-primary" href={`/api/calendar/connect?mode=${mode}`}>Collega</a></div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .tabs{display:flex;gap:4px;border-bottom:1px solid var(--line)}
        .tabs button{border:0;background:none;font:inherit;padding:8px 14px;cursor:pointer;color:var(--ink-2);border-bottom:2px solid transparent;margin-bottom:-1px}
        .tabs button[aria-pressed="true"]{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
        .gcal{display:flex;gap:16px;align-items:flex-start;border:1px solid var(--line);border-radius:10px;padding:16px}
        .input[readonly]{background:#f7f8fa;color:var(--ink-2)}
      ` }} />
    </>
  );
}
