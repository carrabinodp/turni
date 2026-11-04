'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginButton({ next }: { next?: string }) {
  const [busy, setBusy] = useState(false);
  async function signIn() {
    setBusy(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`;
    const hd = process.env.NEXT_PUBLIC_GOOGLE_HD;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { prompt: 'select_account', ...(hd ? { hd } : {}) },
      },
    });
  }
  return (
    <button className="btn btn-primary" style={{ height: 40 }} onClick={signIn} disabled={busy}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#fff" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.4 2.9-7.3Z" />
        <path fill="#fff" opacity=".85" d="M12 22c2.7 0 5-.9 6.7-2.5l-3.3-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.6A10 10 0 0 0 12 22Z" />
        <path fill="#fff" opacity=".7" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3a10 10 0 0 0 0 9l3.4-2.6Z" />
        <path fill="#fff" opacity=".85" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3 7.5l3.4 2.6C7.2 7.8 9.4 6 12 6Z" />
      </svg>
      {busy ? 'Apertura di Google…' : 'Accedi con Google'}
    </button>
  );
}
