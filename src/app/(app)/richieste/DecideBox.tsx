'use client';
import { useState } from 'react';
import { useAction } from '@/components/ui';
import { decide } from './actions';

export default function DecideBox({ id, issues }: { id: string; issues: string[] }) {
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  return (
    <div style={{ display: 'grid', gap: 8, flex: '1 1 280px', maxWidth: 420 }}>
      {issues.length > 0 ? (
        <div className="alert alert-bad small">{issues.join('\n')}</div>
      ) : (
        <span className="small" style={{ color: 'var(--ok)' }}>Rispetta il riposo minimo</span>
      )}
      <input id={`note-${id}`} className="input" placeholder="Nota per il dipendente (facoltativa)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row">
        <button className="btn btn-sm btn-primary" disabled={busy || issues.length > 0} title={issues.length ? 'Non approvabile: viola le regole' : undefined} onClick={() => run(() => decide(id, true, note))}>
          Approva
        </button>
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => run(() => decide(id, false, note))}>
          Rifiuta
        </button>
      </div>
    </div>
  );
}
