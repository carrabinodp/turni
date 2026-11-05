'use client';
import { useMemo, useState } from 'react';
import { fmtDay, weekStart } from '@/lib/time';
import { useAction } from '@/components/ui';
import { IcClose } from '@/components/icons';
import { createPlace } from '../richieste/actions';

export interface PlaceInfo {
  days: { day: string; text: string; typeId: string | null; past: boolean }[];
  types: { id: string; name: string; color: string; place: 'office' | 'remote' }[];
  pending: string[];
  officeTarget: number;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isWeekend = (d: string) => [0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay());

export default function PlaceDialog({ info, day, reviewers, onClose }: { info: PlaceInfo; day?: string; reviewers: { id: string; name: string }[]; onClose: () => void }) {
  const selectable = info.days.filter((d) => !d.past && !info.pending.includes(d.day));
  const [dayA, setDayA] = useState(selectable.find((d) => d.day === day)?.day ?? selectable[0]?.day ?? '');
  const typeById = useMemo(() => new Map(info.types.map((t) => [t.id, t])), [info.types]);
  const cur = info.days.find((d) => d.day === dayA);
  const curType = cur?.typeId ? typeById.get(cur.typeId) : undefined;
  const choices = info.types.filter((t) => t.id !== cur?.typeId);
  const [typeA, setTypeA] = useState<string>('');
  const newType = typeById.get(typeA) ?? choices.find((t) => t.place !== curType?.place) ?? choices[0];
  // il recupero prende il tipo che aveva il primo giorno (o il contrario di quello richiesto)
  const backType = curType ?? info.types.find((t) => t.place !== newType?.place);
  const [dayB, setDayB] = useState<string>('');
  const [note, setNote] = useState('');
  const [reviewer, setReviewer] = useState('');
  const { run, busy } = useAction();

  const week = dayA ? weekStart(dayA) : '';
  // sabato e domenica sono sempre in smart: non valgono come recupero in ufficio
  const candidates = selectable.filter((d) => d.day !== dayA && weekStart(d.day) === week && d.typeId !== backType?.id && !(backType?.place === 'office' && isWeekend(d.day)));
  const chosenB = candidates.find((d) => d.day === dayB)?.day ?? '';

  // controllo della regola sulla settimana, come la vedrà il responsabile
  const warnings = useMemo(() => {
    if (!dayA || !newType) return [];
    const out: string[] = [];
    const weekDays = info.days.filter((d) => weekStart(d.day) === week && !isWeekend(d.day));
    const typeOn = (d: string, base: string | null) => (d === dayA ? newType.id : d === chosenB ? backType?.id ?? base : base);
    const office = weekDays.filter((d) => typeById.get(typeOn(d.day, d.typeId) ?? '')?.place === 'office').length;
    const target = Math.min(info.officeTarget, weekDays.length);
    if (office < target) out.push(`In questa settimana avresti ${office} ${office === 1 ? 'giorno' : 'giorni'} in ufficio invece di ${target}.`);
    else if (office > target) out.push(`In questa settimana avresti ${office} giorni in ufficio, più dei ${target} previsti.`);
    if (isWeekend(dayA) && newType.place === 'office') out.push('Sabato e domenica si lavora in smart.');
    if (chosenB && isWeekend(chosenB) && backType?.place === 'office') out.push('Il recupero cade nel fine settimana, che è sempre in smart.');
    return out;
  }, [dayA, newType, chosenB, backType, info, week, typeById]);

  if (!info.types.length) {
    return (
      <Shell onClose={onClose}>
        <p className="muted">Non ci sono tipi di giornata “Ufficio” e “Smart” configurati. Chiedi a un responsabile.</p>
      </Shell>
    );
  }
  if (!selectable.length) {
    return (
      <Shell onClose={onClose}>
        <p className="muted">Non hai turni pubblicati nei prossimi giorni da cambiare.</p>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose}>
      <label className="field">
        <span>Giorno da cambiare</span>
        <select className="select" value={dayA} onChange={(e) => { setDayA(e.target.value); setTypeA(''); setDayB(''); }}>
          {selectable.map((d) => (
            <option key={d.day} value={d.day}>
              {cap(fmtDay(d.day, 'EEE d MMM'))} · {d.text} · {d.typeId ? typeById.get(d.typeId)?.name ?? '—' : 'non indicato'}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>Vorrei lavorare in</span>
        <div className="seg" role="group">
          {choices.map((t) => (
            <button type="button" key={t.id} aria-pressed={newType?.id === t.id} onClick={() => { setTypeA(t.id); setDayB(''); }}>
              <i className="swatch" style={{ background: t.color, marginRight: 6 }} />{t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Giorno di recupero{backType ? ` (diventa ${backType.name.toLowerCase()})` : ''}</span>
        <div className="opts">
          <button type="button" className="opt" aria-pressed={!chosenB} onClick={() => setDayB('')}>
            <span>Nessun recupero</span><span className="small muted">decide il responsabile</span>
          </button>
          {candidates.map((d) => (
            <button type="button" key={d.day} className="opt" aria-pressed={chosenB === d.day} onClick={() => setDayB(d.day)}>
              <span><b>{cap(fmtDay(d.day, 'EEE d MMM'))}</b> · {d.text}</span>
              <span className="small muted">ora {d.typeId ? typeById.get(d.typeId)?.name.toLowerCase() : 'non indicato'}</span>
            </button>
          ))}
          {candidates.length === 0 && <div className="small muted">In questa settimana non hai altri giorni da usare come recupero.</div>}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="alert alert-warn small">
          {warnings.map((w) => <div key={w}>{w}</div>)}
          <div>Puoi inviarla lo stesso: la vedrà chi approva.</div>
        </div>
      )}

      {reviewers.length > 0 && (
        <label className="field">
          <span>Chi deve approvare (facoltativo)</span>
          <select className="select" value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
            <option value="">Qualsiasi responsabile</option>
            {reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      )}
      <label className="field">
        <span>Motivo {chosenB ? '(facoltativo)' : ''}</span>
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Es. visita medica, sciopero dei mezzi…" />
      </label>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>Annulla</button>
        <button
          className="btn btn-primary"
          disabled={busy || !dayA || !newType}
          onClick={() => newType && run(() => createPlace(dayA, newType.id, chosenB || null, note, reviewer || null), onClose)}
        >
          Invia richiesta
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>I turni non cambiano: cambia solo dove lavori. Diventa effettivo quando un responsabile approva.</p>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="dlg-back" onClick={onClose}>
      <div className="dlg" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ufficio o smart">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Cambio ufficio / smart</h2>
          <button type="button" className="btn btn-icon btn-ghost btn-sm" aria-label="Chiudi" onClick={onClose}><IcClose /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

