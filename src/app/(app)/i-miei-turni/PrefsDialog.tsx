'use client';
import { useState } from 'react';
import { fmtDay } from '@/lib/time';
import { useAction } from '@/components/ui';
import { IcClose } from '@/components/icons';
import { addMyPref, deletePref } from '../genera/actions';

export interface MyPrefs { month: string; list: { id: string; text: string; reviewed: boolean }[] }

export default function PrefsDialog({ prefs, onClose }: { prefs: MyPrefs; onClose: () => void }) {
  const [text, setText] = useState('');
  const { run, busy } = useAction();
  const label = fmtDay(`${prefs.month}-15`, 'MMMM yyyy');
  // una frase può essere diventata più vincoli: si mostra una volta sola
  const groups = Array.from(new Map(prefs.list.map((p) => [p.text, prefs.list.filter((x) => x.text === p.text)])).entries());
  const left = 3 - groups.length;
  return (
    <div className="dlg-back" onClick={onClose}>
      <div className="dlg" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Preferenze del mese">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ textTransform: 'capitalize' }}>Preferenze di {label}</h2>
          <button className="btn btn-icon btn-ghost btn-sm" aria-label="Chiudi" onClick={onClose}><IcClose /></button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Puoi indicarne fino a 3. Se ne tiene conto quando si preparano i turni del mese, quando è possibile.</p>
        {groups.length > 0 && (
          <div style={{ display: 'grid', gap: 6 }}>
            {groups.map(([text, rows], i) => (
              <div key={text} className="opt" style={{ cursor: 'default', alignItems: 'center' }}>
                <span>{i + 1}. {text}</span>
                {rows.some((r) => r.reviewed) ? (
                  <span className="small muted">vista dal responsabile</span>
                ) : (
                  <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(async () => {
                    for (const r of rows) {
                      const res = await deletePref(r.id);
                      if (!res.ok) return res;
                    }
                    return { ok: true as const, message: 'Preferenza tolta' };
                  })}>Togli</button>
                )}
              </div>
            ))}
          </div>
        )}
        {left > 0 ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => addMyPref(prefs.month, text), () => setText(''));
            }}
            style={{ display: 'grid', gap: 8 }}
          >
            <label className="field">
              <span>Preferenza {groups.length + 1} di 3</span>
              <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="Es. riposo il 12 · il martedì entro alle 10 · niente chiusure il venerdì" />
            </label>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={onClose}>Chiudi</button>
              <button className="btn btn-primary" disabled={busy || !text.trim()}>Invia</button>
            </div>
          </form>
        ) : (
          <div className="small muted">Hai indicato tutte e 3 le preferenze.</div>
        )}
      </div>
    </div>
  );
}
