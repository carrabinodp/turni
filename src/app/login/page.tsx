import LoginButton from './LoginButton';
import { Logo } from '@/components/icons';

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <Logo size={34} />
        <h1>Accedi ai turni</h1>
        <p className="muted">
          Usa il tuo account Google aziendale. Al primo accesso il profilo viene creato e collegato ai
          tuoi turni automaticamente.
        </p>
        {searchParams.error && <div className="alert alert-bad">{searchParams.error}</div>}
        <LoginButton next={searchParams.next} />
      </div>
      <style>{`
        .auth{min-height:100%;display:grid;place-items:center;padding:24px max(16px,env(safe-area-inset-left,0px));background:var(--side)}
        .auth-card{width:100%;max-width:380px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:28px;display:grid;gap:14px}
        .auth-card p{margin:0}
      `}</style>
    </main>
  );
}
