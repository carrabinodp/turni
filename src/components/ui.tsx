'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export type Res = { ok: true; message?: string } | { ok: false; error: string };

let toastTimer: number | undefined;
export function showToast(msg: string, bad = false) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.className = `toast${bad ? ' bad' : ''}`;
  el.textContent = msg;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (el) el.hidden = true;
  }, bad ? 6500 : 3000);
}

/** Esegue una server action, mostra l'esito e ricarica i dati della pagina */
export function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<Res>, onOk?: () => void) {
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) {
        if (r.message) showToast(r.message);
        onOk?.();
        start(() => router.refresh());
      } else showToast(r.error, true);
      return r;
    } catch {
      showToast('Qualcosa non ha funzionato. Riprova.', true);
      return { ok: false as const, error: 'errore' };
    } finally {
      setBusy(false);
    }
  }
  return { run, busy: busy || pending };
}

export function ActionButton(props: {
  action: () => Promise<Res>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  disabled?: boolean;
  title?: string;
}) {
  const { run, busy } = useAction();
  return (
    <button
      className={props.className ?? 'btn btn-sm'}
      disabled={busy || props.disabled}
      title={props.title}
      onClick={() => {
        if (props.confirm && !window.confirm(props.confirm)) return;
        run(props.action);
      }}
    >
      {props.children}
    </button>
  );
}
