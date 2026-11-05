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
  const left = 3 - prefs.list.length;
  return (
    <div className="dlg-back" onClick={onClose}>
      <div className="dlg" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Preferenze del mese">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ textTransform: 'capitalize' }}>Preferenze di {label}</h2>
          <button className="btn btn-icon btn-ghost btn-sm" aria-label="Chiudi" onClick={onClose}><IcClose /></button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Puoi indicarne fino a 3. Se ne tiene conto quando si preparano i turni del mese, quando è possibile.</p>
        {prefs.list.length > 0 && (
          <div style={{ display: 'grid', gap: 6 }}>
            {prefs.list.map((p, i) => (
              <div key={p.id} className="opt" style={{ cursor: 'default', alignItems: 'center' }}>
                <span>{i + 1}. {p.text}</span>
                {p.reviewed ? (
                  <span className="small muted">vista dal responsabile</span>
                ) : (
                  <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => deletePref(p.id))}>Togli</button>
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
              <span>Preferenza {prefs.list.length + 1} di 3</span>
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
