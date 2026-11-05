# Turni

Sito interno per pianificare turni e attività del team, in stile "staffing timeline".

- **Timeline** giorno, settimana o periodo personalizzato (fino a 62 giorni, solo ore lavorate): blocchi colorati per attività, trascina per spostare, tira i bordi per allungare/accorciare, disegna nuovi blocchi, copia/incolla, annulla, salva in blocco.
- **Import Excel**: griglia giorni × persone (come il file turni attuale, un foglio per mese), griglia persone × giorni o elenco di blocchi (anche export di Assembled). Riconosce orari, colori delle celle con la legenda del file (Ferie, Rec, Reclami, Smart…), ignora righe di totali e colonne di statistiche, e collega ogni colonna alla persona anche col solo cognome.
- **Login con Google aziendale**: chi entra con l'email del dominio ottiene il profilo in automatico; se era già nel file importato, viene collegato ai suoi turni.
- **Scambi, cessioni in bacheca, ferie e permessi** con approvazione di un manager (basta uno dei tre). Il manager può anche inserirli direttamente col clic destro sulla giornata.
- **Tipo di giornata** (Ufficio, Smart working, …) con colore di sfondo, dalla timeline o dai colori dell’Excel. I colori abbinati all’import vengono ricordati.
- **Pause automatiche**: 15 min ogni 2 ore di lavoro continuativo, sfalsate di 5 min tra gli operatori, e pranzo di 1 ora dopo 4 ore nei turni da 8+ ore (tutto configurabile).
- **Scambi**: l'operatore vede i turni compatibili dei colleghi (stesso giorno o scambio di riposo tra giorni diversi); ufficio/smart seguono il turno; il riposo minimo viene segnalato e il manager può approvare comunque.
- **Controllo del riposo minimo** (11 h, configurabile) sul server: uno scambio che lo viola non passa.
- **Bozza / pubblicata** per settimana: i dipendenti vedono solo le settimane pubblicate.
- **Notifiche** in-app, email e push (anche su iPhone con il sito aggiunto alla schermata Home).
- **Registro modifiche** di chi ha cambiato cosa, anche per singolo blocco ("Vedi tutte le modifiche").
- **Calendario personale** per gli operatori (giorno / settimana / mese) con Tempo libero, Scambio turno e Richiesta di modifica.
- **Google Calendar**: sincronizzazione automatica dei turni pubblicati, nel calendario principale o in uno separato.
- **Ruoli** Standard, Team Lead, Manager, Amministratore; **team** e **canali** per persona.

Stack: Next.js 14 · Supabase (Postgres, Auth, RLS) · Vercel.

---

## Messa online (circa 30 minuti)

### 1. Supabase
1. Crea un progetto su <https://supabase.com> scegliendo la regione **Central EU (Frankfurt)**.
2. **SQL Editor** → incolla ed esegui `supabase/migrations/0001_init.sql`, poi `0002_giornate_pause.sql`, `0003_team_calendario.sql` e `0004_scambi_pause.sql` (in quest'ordine, una volta sola ciascuno).
3. Apri `supabase/setup.sql`, metti il tuo dominio e la tua email, ed eseguilo.
4. **Project Settings → API**: copia `Project URL`, `anon key` e `service_role key`.

### 2. Login Google
1. <https://console.cloud.google.com> → nuovo progetto → **API e servizi → Schermata consenso OAuth**.
   Se l'azienda usa Google Workspace scegli **Interno**: così possono entrare solo account aziendali.
2. **Credenziali → Crea credenziali → ID client OAuth → Applicazione web**.
   URI di reindirizzamento autorizzato: `https://<id-progetto>.supabase.co/auth/v1/callback`
3. Su Supabase: **Authentication → Providers → Google** → attiva e incolla Client ID e Secret.
4. **Authentication → URL Configuration**:
   - Site URL: l'indirizzo del sito (es. `https://turni-azienda.vercel.app`)
   - Redirect URLs: `https://turni-azienda.vercel.app/auth/callback` e `http://localhost:3000/auth/callback`

### 3. Vercel
1. Carica il progetto su GitHub e importalo su <https://vercel.com>.
2. Variabili d'ambiente (vedi `.env.example`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_GOOGLE_HD` (il dominio).
3. Deploy.

### 4. Notifiche (facoltative, si possono aggiungere dopo)
- **Email**: account su <https://resend.com>, verifica il dominio, poi `RESEND_API_KEY` e `EMAIL_FROM`.
- **Push**: `npx web-push generate-vapid-keys` → `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

### 5. Google Calendar (facoltativo)
1. Google Cloud → **API e servizi → Libreria** → cerca **Google Calendar API** → **Abilita**.
2. **Credenziali** → apri il client OAuth già usato per il login → in **URI di reindirizzamento autorizzati** aggiungi
   `https://<il-tuo-sito>.vercel.app/api/calendar/callback` (lascia anche quello di Supabase).
3. **Schermata consenso / Accesso ai dati** → aggiungi gli ambiti `.../auth/calendar.events` e `.../auth/calendar.app.created`
   (con app di tipo Interno non serve la verifica di Google).
4. Su Vercel aggiungi `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (gli stessi messi in Supabase) e `CRON_SECRET`
   (una stringa casuale lunga), poi Redeploy.

Ogni persona collega il proprio calendario da **Impostazioni → App collegate**. I turni si aggiornano a ogni modifica
salvata e comunque una volta al giorno.

### 6. Primo utilizzo
1. Entra con la tua email (quella in `admin_emails`): diventi amministratore.
2. **Team** → promuovi gli altri due manager quando si sono registrati.
3. **Importa Excel** → carica i turni → controlla i collegamenti → importa.
4. **Timeline** → ritocca → **Pubblica settimana**: il team viene avvisato.

---

## Come funziona il collegamento delle persone
1. Al primo accesso con Google, se esiste un profilo con la stessa **email** → collegato.
2. Altrimenti, se esiste **un solo** profilo non registrato con lo stesso **nome e cognome** (in qualsiasi ordine, senza badare ad accenti e maiuscole) o con quel nome tra gli alias → collegato, e il nome del file diventa un alias.
3. Altrimenti → nuovo profilo.

Nell'import, i collegamenti scelti a mano ("Genari F." → Francesca Gennari) vengono ricordati come alias, così la volta dopo il riconoscimento è automatico. Lo stesso vale per le etichette delle attività ("Tel" → Telefono).

Chi lascia l'azienda: **Team → Disattiva**. Non può più entrare, lo storico resta.

## Sviluppo
```bash
npm install
cp .env.example .env.local   # e compila
npm run dev                  # http://localhost:3000
npm run dev  →  /dev/timeline, /dev/week, /dev/import   # anteprima con dati finti, senza Supabase
npm test                     # test dell'import Excel
npm run test:sql             # test del database (serve Postgres 16 in locale)
```

## Struttura
```
supabase/migrations/0001_init.sql   schema, regole, permessi (RLS), funzioni
src/components/timeline/            timeline editabile
src/lib/import/                     lettura Excel e collegamento persone/attività
src/app/(app)/                      pagine (timeline, i miei turni, richieste, assenze, import, team, configura…)
src/lib/notify.ts                   notifiche in-app, email, push
```
