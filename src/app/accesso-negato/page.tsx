export default function AccessDenied() {
  return (
    <main style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--side)' }}>
      <div className="card" style={{ maxWidth: 420, padding: 28, display: 'grid', gap: 12 }}>
        <h1>Accesso non autorizzato</h1>
        <p className="muted" style={{ margin: 0 }}>
          Puoi entrare solo con l&apos;email aziendale. Se hai usato l&apos;account giusto, il tuo profilo
          potrebbe essere stato disattivato: chiedi a un manager.
        </p>
        <form action="/auth/signout" method="post">
          <button className="btn">Esci e usa un altro account</button>
        </form>
      </div>
    </main>
  );
}
