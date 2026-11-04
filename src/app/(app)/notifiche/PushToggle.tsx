'use client';
import { useEffect, useState } from 'react';
import { showToast } from '@/components/ui';

function b64ToUint8(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function PushToggle({ vapidKey }: { vapidKey: string }) {
  const [state, setState] = useState<'loading' | 'unsupported' | 'ios-install' | 'off' | 'on' | 'denied'>('loading');

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return setState(ios && !standalone ? 'ios-install' : 'unsupported');
      }
      if (Notification.permission === 'denied') return setState('denied');
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);

  async function enable() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setState('denied');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(vapidKey) });
      const res = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error();
      setState('on');
      showToast('Notifiche attivate su questo dispositivo');
    } catch {
      showToast('Non sono riuscito ad attivare le notifiche', true);
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState('off');
    showToast('Notifiche disattivate su questo dispositivo');
  }

  const msg: Record<typeof state, string> = {
    loading: 'Controllo…',
    unsupported: 'Questo browser non supporta le notifiche push.',
    'ios-install': 'Su iPhone: tocca Condividi → “Aggiungi alla schermata Home”, apri il sito da lì e torna qui.',
    denied: 'Le notifiche sono bloccate nelle impostazioni del browser per questo sito.',
    off: 'Ricevi un avviso sul telefono o sul computer anche a sito chiuso.',
    on: 'Attive su questo dispositivo.',
  };

  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <b>Notifiche su questo dispositivo</b>
        <div className="small muted">{vapidKey ? msg[state] : 'Non ancora configurate dall’amministratore.'}</div>
      </div>
      {vapidKey && state === 'off' && <button className="btn btn-sm btn-primary" onClick={enable}>Attiva</button>}
      {vapidKey && state === 'on' && <button className="btn btn-sm" onClick={disable}>Disattiva</button>}
    </div>
  );
}
