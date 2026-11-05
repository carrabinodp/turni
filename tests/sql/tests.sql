-- Test end-to-end dello schema. Ogni blocco fallisce con eccezione se un controllo non passa.
\set QUIET on
\pset tuples_only on

update settings set allowed_domains = '{azienda.it}', admin_emails = '{carlo@azienda.it}';

-- Registrazioni: admin + utente fuori dominio
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000c', 'Carlo@azienda.it', '{"full_name":"Carlo Carrabino"}'),
  ('00000000-0000-0000-0000-0000000000ee', 'estraneo@gmail.com', '{"full_name":"Estraneo"}');

do $$ begin
  assert (select role from people where email = 'carlo@azienda.it') = 'admin', 'carlo deve essere admin';
  assert not exists (select 1 from people where full_name = 'Estraneo'), 'fuori dominio: nessun profilo';
  assert norm_name('Rossi  Giulia') = norm_name('GIULIA RÒSSI'), 'norm_name ordine/accenti';
  assert norm_name('D''Angelo Màrio') = 'angelo d mario', 'norm_name apostrofo: ' || norm_name('D''Angelo Màrio');
end $$;

-- ---- Da qui agisco come Carlo (manager/admin)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;

-- Import: Giulia e Marco non sono ancora registrati -> profili in attesa
select import_schedule(jsonb_build_object(
  'replace', true, 'from_date', '2026-11-09', 'to_date', '2026-11-15', 'file_name', 'test.xlsx',
  'people_create', '[{"key":"g","full_name":"Rossi Giulia"},{"key":"m","full_name":"Marco Bianchi"}]'::jsonb,
  'rows', jsonb_build_array(
    jsonb_build_object('person_key','g','activity_id',(select id from activity_types where name='Telefono'),'starts_at','2026-11-09 14:00+01','ends_at','2026-11-09 22:00+01'),
    jsonb_build_object('person_key','g','activity_id',(select id from activity_types where name='Pausa'),   'starts_at','2026-11-09 18:00+01','ends_at','2026-11-09 18:30+01'),
    jsonb_build_object('person_key','g','activity_id',(select id from activity_types where name='Telefono'),'starts_at','2026-11-10 14:00+01','ends_at','2026-11-10 22:00+01'),
    jsonb_build_object('person_key','g','activity_id',(select id from activity_types where name='Chat'),    'starts_at','2026-11-12 14:00+01','ends_at','2026-11-12 22:00+01'),
    jsonb_build_object('person_key','m','activity_id',(select id from activity_types where name='Telefono'),'starts_at','2026-11-09 08:00+01','ends_at','2026-11-09 16:00+01'),
    jsonb_build_object('person_key','m','activity_id',(select id from activity_types where name='Telefono'),'starts_at','2026-11-11 08:00+01','ends_at','2026-11-11 16:00+01'),
    jsonb_build_object('person_key','m','activity_id',(select id from activity_types where name='Email'),   'starts_at','2026-11-13 08:00+01','ends_at','2026-11-13 16:00+01')
  )));

do $$ begin
  assert (select count(*) from events) = 7, 'import: 7 blocchi';
  assert (select count(*) from people where user_id is null) = 2, 'import: 2 profili in attesa';
  assert (select count(*) from audit_log where action = 'import') = 1, 'import: una riga di registro';
  assert (select count(*) from audit_log where action = 'insert') = 0, 'import: niente righe per blocco';
end $$;

reset role;

-- Giulia si registra con Google ("Giulia Rossi"): deve collegarsi al profilo importato
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'giulia.rossi@azienda.it', '{"full_name":"Giulia Rossi"}'),
  ('00000000-0000-0000-0000-00000000000b', 'marco.bianchi@azienda.it', '{"given_name":"Marco","family_name":"Bianchi"}');

do $$ begin
  assert (select count(*) from people) = 3, 'nessun duplicato dopo la registrazione';
  assert (select full_name from people where email = 'giulia.rossi@azienda.it') = 'Giulia Rossi', 'nome da Google';
  assert (select 'Rossi Giulia' = any (aliases) from people where email = 'giulia.rossi@azienda.it'), 'vecchio nome come alias';
  assert (select count(*) from events e join people p on p.id = e.person_id where p.email = 'giulia.rossi@azienda.it') = 4, 'turni di Giulia collegati';
  assert (select role from people where email = 'marco.bianchi@azienda.it') = 'agent', 'Marco agente';
end $$;

-- ---- Giulia (agente) prima della pubblicazione: non vede nulla
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$ begin
  assert (select count(*) from events) = 0, 'settimana non pubblicata: invisibile';
  assert (select count(*) from people) = 3, 'agente vede i colleghi';
  begin
    perform save_schedule('{"upserts":[]}');
    raise exception 'agente non deve salvare';
  exception when others then
    assert sqlerrm like 'Solo i manager%', sqlerrm;
  end;
  begin
    update people set role = 'admin' where user_id = auth.uid();
    raise exception 'agente non deve promuoversi';
  exception when others then
    assert sqlerrm like 'Solo un amministratore%', sqlerrm;
  end;
end $$;
reset role;

-- ---- Carlo pubblica la settimana
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;
select publish_week('2026-11-11');
reset role;

-- ---- Giulia: scambio che viola il riposo (Gio 14-22 <-> Mer 08-16 di Marco)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$
declare m uuid := (select id from people where email = 'marco.bianchi@azienda.it');
begin
  assert (select count(*) from events) = 7, 'pubblicata: visibile';
  -- scambio che viola il riposo: ora viene creato e segnalato al manager
  perform request_create('swap', m, '2026-11-12', '2026-11-11');
  assert cardinality(request_preview((select id from requests where day_b = '2026-11-11'))) > 0, 'violazione segnalata';
  perform request_cancel((select id from requests where day_b = '2026-11-11'));
  -- scambio valido: Gio di Giulia <-> Ven di Marco
  perform request_create('swap', m, '2026-11-12', '2026-11-13', p_note => 'Visita medica');
  assert (select status from requests where status <> 'cancelled') = 'pending_peer';
  -- seconda richiesta sullo stesso turno: bloccata
  begin
    perform request_create('give', null, '2026-11-12');
    raise exception 'doppia richiesta';
  exception when others then
    assert sqlerrm like 'C''è già una richiesta%', sqlerrm;
  end;
end $$;
reset role;
delete from requests where status = 'cancelled';

-- ---- Marco accetta
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
select request_respond((select id from requests limit 1), true);
do $$ begin
  assert (select status from requests limit 1) = 'pending_manager';
end $$;
reset role;

-- ---- Carlo approva: i turni si scambiano
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;
do $$
declare g uuid := (select id from people where email = 'giulia.rossi@azienda.it');
        m uuid := (select id from people where email = 'marco.bianchi@azienda.it');
begin
  assert cardinality(request_preview((select id from requests limit 1))) = 0, 'anteprima pulita';
  perform request_decide((select id from requests limit 1), true);
  assert (select status from requests limit 1) = 'approved';
  assert (select person_id from events where starts_at = '2026-11-12 14:00+01') = m, 'giovedì ora a Marco';
  assert (select person_id from events where starts_at = '2026-11-13 08:00+01') = g, 'venerdì ora a Giulia';
  begin
    perform request_decide((select id from requests limit 1), true);
    raise exception 'doppia approvazione';
  exception when others then
    assert sqlerrm like '%già stata gestita%', sqlerrm;
  end;
end $$;
reset role;

-- ---- Cessione in bacheca: Giulia cede lunedì, Marco lavora già quel giorno -> errore; poi annulla
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
select request_create('give', null, '2026-11-10');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
do $$ begin
  assert (select count(*) from requests where status = 'open') = 1, 'Marco vede la bacheca';
  -- Marco lavora mercoledì 08:00: martedì 14-22 lascerebbe 10h di riposo → segnalato, non bloccato
  perform request_take((select id from requests where status = 'open'));
  assert cardinality(request_preview((select id from requests where kind = 'give'))) > 0, 'riposo segnalato';
end $$;
reset role;

-- ---- Ferie: Giulia chiede lunedì, Carlo approva -> blocchi sostituiti da Ferie
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
select request_create('time_off', p_from => '2026-11-09', p_to => '2026-11-09',
                      p_activity => (select id from activity_types where name = 'Ferie'));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;
do $$
declare g uuid := (select id from people where email = 'giulia.rossi@azienda.it');
begin
  perform request_decide((select id from requests where kind = 'time_off'), true);
  assert (select count(*) from events e join activity_types a on a.id = e.activity_id
          where e.person_id = g and e.starts_at::date = '2026-11-09' and a.name = 'Ferie'
            and e.starts_at = '2026-11-09 14:00+01' and e.ends_at = '2026-11-09 22:00+01') = 1, 'ferie sulla fascia del turno';
  assert (select count(*) from events e where e.person_id = g
          and e.starts_at >= '2026-11-09' and e.starts_at < '2026-11-10') = 1, 'turno e pausa rimossi';

  -- copia settimana (con cambio ora non rilevante qui) e conflitto di versione
  assert copy_week('2026-11-09', '2026-11-16') = 6, 'copia 6 blocchi (turno+pausa diventati ferie)';
  assert (select count(*) from events where starts_at >= '2026-11-16 08:00+01' and starts_at < '2026-11-16 08:01+01') = 1, 'orario locale mantenuto';
  begin
    perform save_schedule(jsonb_build_object('deletes', jsonb_build_array(jsonb_build_object(
      'id', (select id from events order by starts_at limit 1), 'version', '2000-01-01T00:00:00Z'))));
    raise exception 'doveva rilevare il conflitto';
  exception when others then
    assert sqlerrm like 'Un altro manager%', sqlerrm;
  end;
  perform save_schedule(jsonb_build_object('upserts', jsonb_build_array(jsonb_build_object(
      'id', (select id from events order by starts_at limit 1),
      'version', (select updated_at from events order by starts_at limit 1),
      'person_id', g, 'activity_id', (select id from activity_types where name = 'Chat'),
      'starts_at', '2026-11-09 07:30+01', 'ends_at', '2026-11-09 16:00+01'))));
  assert (select count(*) from audit_log where action = 'update') >= 1, 'modifica registrata';
end $$;
reset role;

-- ---- Settimana copiata non pubblicata: invisibile a Giulia
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$ begin
  assert (select count(*) from events where starts_at >= '2026-11-16') = 0, 'settimana 16/11 non pubblicata';
end $$;
reset role;

-- DST: copia attraverso il cambio ora (fine marzo)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;
do $$
declare g uuid := (select id from people where email = 'giulia.rossi@azienda.it');
begin
  perform save_schedule(jsonb_build_object('upserts', jsonb_build_array(jsonb_build_object(
      'person_id', g, 'activity_id', (select id from activity_types where name = 'Chat'),
      'starts_at', '2027-03-22 09:00+01', 'ends_at', '2027-03-22 17:00+01'))));
  perform copy_week('2027-03-22', '2027-03-29');
  assert exists (select 1 from events where starts_at = '2027-03-29 09:00+02'), 'ora legale: resta alle 09:00 locali';
end $$;
reset role;

-- Import col solo cognome: "Borra" si collega a "Claudia Borra" al primo accesso
reset role;
insert into people (full_name) values ('Borra'), ('Li Vigni');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'claudia.borra@azienda.it', '{"full_name":"Claudia Borra"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'maria.livigni@azienda.it', '{"full_name":"Maria Li Vigni"}');
do $$ begin
  assert (select count(*) from people where full_name in ('Borra', 'Li Vigni')) = 0, 'placeholder rinominati';
  assert (select 'Borra' = any (aliases) from people where email = 'claudia.borra@azienda.it'), 'cognome come alias';
  assert exists (select 1 from people where email = 'maria.livigni@azienda.it' and 'Li Vigni' = any (aliases)), 'cognome composto';
end $$;

-- ---- 0002: giornate, assenze e scambi diretti del manager
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;
do $$
declare g uuid := (select id from people where email = 'giulia.rossi@azienda.it');
        m uuid := (select id from people where email = 'marco.bianchi@azienda.it');
        sw uuid := (select id from day_types where name = 'Smart working');
        fe uuid := (select id from activity_types where name = 'Permesso');
        r requests;
begin
  -- tipo giornata
  perform save_day_marks(jsonb_build_array(jsonb_build_object('person_id', g, 'day', '2026-11-10', 'day_type_id', sw)));
  assert (select day_type_id from day_marks where person_id = g and day = '2026-11-10') = sw, 'giornata smart';
  -- spostamento diretto: Giulia mar 10 -> Marco (libero quel giorno), il tipo giornata segue
  begin
    perform manager_swap(g, '2026-11-10', m, '2026-11-10', 'Copertura');
    raise exception 'doveva bloccare per riposo';
  exception when others then
    assert sqlerrm like '%riposo%', sqlerrm;
  end;
  assert (select person_id from events where starts_at = '2026-11-10 14:00+01') = g, 'nulla cambiato dopo il blocco';
  r := manager_swap(g, '2026-11-10', m, '2026-11-10', 'Copertura', true);
  assert r.kind = 'give' and r.status = 'approved', 'cessione diretta';
  assert (select person_id from events where starts_at = '2026-11-10 14:00+01') = m, 'turno spostato';
  assert (select person_id from day_marks where day = '2026-11-10') = m, 'giornata spostata';
  -- violazione riposo: rifiutato senza force
  begin
    perform manager_swap(m, '2026-11-10', g, '2026-11-11');
    raise exception 'doveva fallire';
  exception when others then
    assert sqlerrm like '%non lavora%' or sqlerrm like '%riposo%', sqlerrm;
  end;
  -- permesso a ore inserito dal manager
  r := manager_time_off(m, '2026-11-11', '2026-11-11', fe, '08:00', '10:00', 'Visita');
  assert exists (select 1 from events where person_id = m and activity_id = fe and starts_at = '2026-11-11 08:00+01'), 'permesso inserito';
  -- import con tipo giornata
  perform import_schedule(jsonb_build_object('replace', false, 'from_date', '2026-11-20', 'to_date', '2026-11-20',
    'day_type_create', '[{"key":"x","name":"Trasferta","color":"#aabbcc"}]'::jsonb,
    'people_create', '[{"key":"n","full_name":"Nuova Persona"}]'::jsonb,
    'rows', jsonb_build_array(jsonb_build_object('person_key','n','activity_id',(select id from activity_types where name='Chat'),'starts_at','2026-11-20 09:00+01','ends_at','2026-11-20 17:00+01')),
    'marks', '[{"person_key":"n","day":"2026-11-20","day_type_key":"x"}]'::jsonb));
  assert exists (select 1 from day_marks d join day_types t on t.id = d.day_type_id where t.name = 'Trasferta' and d.day = '2026-11-20'), 'giornata da import';
end $$;
reset role;

-- agente: non può segnare giornate
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$ begin
  begin
    perform save_day_marks('[]');
    raise exception 'agente non deve';
  exception when others then
    assert sqlerrm like 'Solo i manager%', sqlerrm;
  end;
  begin
    perform manager_time_off(current_person_id(), '2026-11-12', '2026-11-12', (select id from activity_types where name='Ferie'));
    raise exception 'agente non deve';
  exception when others then
    assert sqlerrm like 'Solo i manager%', sqlerrm;
  end;
end $$;
reset role;

-- ---- 0003: team lead, richiesta di modifica, storico blocco
select set_config('app.system', 'on', false);
update people set role = 'team_lead' where email = 'marco.bianchi@azienda.it';
select set_config('app.system', 'off', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
do $$
declare e uuid;
begin
  assert is_manager(), 'team lead = poteri da manager';
  perform save_schedule(jsonb_build_object('upserts', jsonb_build_array(jsonb_build_object(
    'person_id', current_person_id(), 'activity_id', (select id from activity_types where name='Chat'),
    'starts_at', '2026-12-01 09:00+01', 'ends_at', '2026-12-01 10:00+01'))));
  select id into e from events where starts_at = '2026-12-01 09:00+01';
  assert (select updated_by from events where id = e) = current_person_id(), 'ultima modifica registrata';
  assert (select count(*) from event_history(e)) = 1, 'storico del blocco';
end $$;
reset role;
insert into calendar_links (person_id, refresh_token) select id, 'segreto' from people where email = 'giulia.rossi@azienda.it';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$
declare r requests;
begin
  r := request_change('2026-12-02', 'Posso entrare alle 10?');
  assert r.kind::text = 'change' and r.status = 'pending_manager', 'richiesta di modifica';
  assert (select mode from my_calendar_status()) = 'primary', 'stato calendario visibile';
  assert (select count(*) from calendar_links) = 0, 'token non leggibili dai client';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
do $$ begin
  perform request_decide((select id from requests where kind::text = 'change'), true, 'Ok');
  assert (select status from requests where kind::text = 'change') = 'approved', 'modifica approvata';
end $$;
reset role;

-- ---- 0004: scambi con ufficio/smart, scambio di riposo, candidati, forza
reset role;
select set_config('app.bulk', 'on', false);
-- settimana pubblicata 30/11–6/12: Giulia lun ufficio / mar riposo / mer smart; Marco lun smart / mar ufficio / mer riposo
insert into schedule_weeks (week_start) values ('2026-12-07') on conflict do nothing;
insert into events (person_id, activity_id, starts_at, ends_at)
select p.id, (select id from activity_types where name = 'Telefono'), x.s::timestamptz, x.e::timestamptz
from (values
  ('giulia.rossi@azienda.it', '2026-12-07 09:00+01', '2026-12-07 18:00+01'),
  ('giulia.rossi@azienda.it', '2026-12-09 09:00+01', '2026-12-09 18:00+01'),
  ('marco.bianchi@azienda.it', '2026-12-07 10:00+01', '2026-12-07 19:00+01'),
  ('marco.bianchi@azienda.it', '2026-12-08 09:00+01', '2026-12-08 18:00+01'),
  ('giulia.rossi@azienda.it', '2026-12-10 04:00+01', '2026-12-10 12:00+01')
) x(em, s, e) join people p on p.email = x.em;
insert into day_marks (person_id, day, day_type_id)
select p.id, x.d::date, (select id from day_types where name = x.t)
from (values
  ('giulia.rossi@azienda.it', '2026-12-07', 'Ufficio'),
  ('giulia.rossi@azienda.it', '2026-12-09', 'Smart working'),
  ('marco.bianchi@azienda.it', '2026-12-07', 'Smart working'),
  ('marco.bianchi@azienda.it', '2026-12-08', 'Ufficio')
) x(em, d, t) join people p on p.email = x.em;
select set_config('app.bulk', 'off', false);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$
declare m uuid := (select id from people where email = 'marco.bianchi@azienda.it');
begin
  -- candidati per il mercoledì di Giulia: Marco martedì (scambio di riposo); lunedì no (Giulia lavora)
  assert exists (select 1 from swap_candidates('2026-12-09', '2026-12-07', '2026-12-13') where person_id = m and day = '2026-12-08' and mode = 'rest_swap' and day_type = 'Ufficio'), 'scambio di riposo proposto';
  assert not exists (select 1 from swap_candidates('2026-12-09', '2026-12-07', '2026-12-13') where day = '2026-12-07'), 'giorno in cui lavoro già escluso';
  -- candidati per il lunedì: Marco lunedì (stesso giorno)
  assert exists (select 1 from swap_candidates('2026-12-07', '2026-12-07', '2026-12-07') where person_id = m and mode = 'same_day' and day_type = 'Smart working'), 'stesso giorno';
  perform request_create('swap', m, '2026-12-09', '2026-12-08', p_note => 'Riposo mercoledì, lavoro martedì');
  perform request_create('swap', m, '2026-12-07', '2026-12-07');
  perform request_create('give', m, '2026-12-10', p_note => 'Mi serve il giovedì');
end $$;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
select request_respond(id, true) from requests where day_a in ('2026-12-09', '2026-12-07', '2026-12-10') and status = 'pending_peer';
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;
do $$
declare g uuid := (select id from people where email = 'giulia.rossi@azienda.it');
        m uuid := (select id from people where email = 'marco.bianchi@azienda.it');
        sw uuid := (select id from day_types where name = 'Smart working');
        uf uuid := (select id from day_types where name = 'Ufficio');
begin
  perform request_decide((select id from requests where day_a = '2026-12-09' and kind = 'swap'), true);
  -- doppio passaggio: Giulia ora lavora martedì (in ufficio, come era Marco) e riposa mercoledì
  assert (select person_id from events where starts_at = '2026-12-08 09:00+01') = g, 'Giulia prende il martedì';
  assert (select person_id from events where starts_at = '2026-12-09 09:00+01') = m, 'Marco prende il mercoledì';
  assert (select day_type_id from day_marks where person_id = g and day = '2026-12-08') = uf, 'martedì in ufficio segue il turno';
  assert (select day_type_id from day_marks where person_id = m and day = '2026-12-09') = sw, 'mercoledì in smart segue il turno';
  assert not exists (select 1 from day_marks where person_id = g and day = '2026-12-09'), 'Giulia a riposo mercoledì';
  -- stesso giorno: chi era in smart prende il turno in ufficio e viceversa
  perform request_decide((select id from requests where day_a = '2026-12-07' and kind = 'swap'), true);
  assert (select day_type_id from day_marks where person_id = g and day = '2026-12-07') = sw, 'Giulia ora smart';
  assert (select day_type_id from day_marks where person_id = m and day = '2026-12-07') = uf, 'Marco ora ufficio';
  -- approvazione forzata di una richiesta che viola il riposo
  begin
    perform request_decide((select id from requests where day_a = '2026-12-10'), true);
    raise exception 'doveva bloccare';
  exception when others then
    assert sqlerrm like '%riposo%', sqlerrm;
  end;
  perform request_decide((select id from requests where day_a = '2026-12-10'), true, 'Ok eccezionale', true);
  assert (select person_id from events where starts_at = '2026-12-10 04:00+01') = m, 'turno ceduto';
  assert (select status from requests where kind = 'give' and decision_note = 'Ok eccezionale') = 'approved', 'forzata';
end $$;
reset role;

-- ---- 0005: dati chiamate solo per i manager
reset role;
do $$ begin
  assert (select cardinality(forecast_activity_ids) from settings) = 1, 'Telefono come attività telefonica di base';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;
insert into call_intervals (day, slot, offered, answered) values ('2026-11-02', 18, 30, 28);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$ begin
  assert (select count(*) from call_intervals) = 0, 'operatore non vede i dati chiamate';
  begin
    perform save_forecast_settings('{"sl_target":90}'::jsonb, '{}');
    raise exception 'doveva fallire';
  exception when others then
    if sqlerrm = 'doveva fallire' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;
select save_forecast_settings('{"sl_target":90,"sl_seconds":30,"max_occupancy":85,"history_weeks":8}'::jsonb, '{}');
reset role;
do $$ begin
  assert (select (forecast_policy->>'sl_target')::int from settings) = 90, 'manager salva impostazioni forecast';
end $$;

-- ---- 0006: nei cambi turno compaiono anche i colleghi che non sono ancora entrati
reset role;
select set_config('app.bulk', 'on', false);
insert into people (full_name, active) values ('Nuovo Collega', true);
insert into schedule_weeks (week_start) values ('2026-12-14') on conflict do nothing;
insert into events (person_id, activity_id, starts_at, ends_at)
select p.id, (select id from activity_types where name = 'Telefono'), x.s::timestamptz, x.e::timestamptz
from (values ('Nuovo Collega', '2026-12-14 13:00+01', '2026-12-14 21:00+01'),
             ('Giulia Rossi', '2026-12-14 09:00+01', '2026-12-14 17:00+01')) x(n, s, e)
join people p on p.full_name = x.n;
select set_config('app.bulk', 'off', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$ begin
  assert exists (select 1 from swap_candidates('2026-12-14', '2026-12-14', '2026-12-14')
                 where full_name = 'Nuovo Collega' and issues[1] like '%non è ancora entrato%'), 'collega senza accesso proposto con avviso';
end $$;
reset role;

-- ---- 0007: richieste ufficio/smart
reset role;
select set_config('app.bulk', 'on', false);
insert into schedule_weeks (week_start) values ('2027-01-11') on conflict do nothing;
insert into events (person_id, activity_id, starts_at, ends_at)
select p.id, (select id from activity_types where name = 'Telefono'),
       (d::date + time '09:00') at time zone 'Europe/Rome', (d::date + time '17:00') at time zone 'Europe/Rome'
from people p, generate_series('2027-01-11'::date, '2027-01-15'::date, interval '1 day') d
where p.email = 'giulia.rossi@azienda.it';
insert into day_marks (person_id, day, day_type_id)
select p.id, d::date, (select id from day_types where name = case when extract(isodow from d) <= 3 then 'Ufficio' else 'Smart working' end)
from people p, generate_series('2027-01-11'::date, '2027-01-15'::date, interval '1 day') d
where p.email = 'giulia.rossi@azienda.it';
select set_config('app.bulk', 'off', false);
do $$ begin
  assert (select place from day_types where name = 'Ufficio') = 'office', 'Ufficio = in sede';
  assert (select place from day_types where name = 'Smart working') = 'remote', 'Smart = da remoto';
  assert (select place from day_types where name = 'Da verificare') is null, 'Da verificare senza luogo';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$
declare
  sw uuid := (select id from day_types where name = 'Smart working');
  uf uuid := (select id from day_types where name = 'Ufficio');
  r1 requests; r2 requests;
begin
  -- smart mercoledì, recupero in ufficio giovedì: la regola dei 3 giorni torna
  r1 := request_place('2027-01-13', sw, '2027-01-14', 'Visita medica');
  assert r1.status = 'pending_manager' and r1.day_type_b = uf, 'scambio ufficio/smart in attesa del manager';
  assert cardinality(request_preview(r1.id)) = 0, 'con recupero nessun avviso';
  -- smart lunedì senza recupero: parte lo stesso, con avviso
  r2 := request_place('2027-01-11', sw, null, 'Sciopero dei mezzi');
  assert (request_preview(r2.id))[1] like '%2 giorni in ufficio invece di 3%', 'avviso giorni in ufficio';
  begin
    perform request_place('2027-01-13', sw);
    raise exception 'doveva fallire';
  exception when others then
    if sqlerrm = 'doveva fallire' then raise; end if;
  end;
  begin
    perform request_place('2027-01-14', sw);   -- giovedì è già smart
    raise exception 'doveva fallire';
  exception when others then
    if sqlerrm = 'doveva fallire' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;
select request_decide((select id from requests where kind::text = 'place' and day_a = '2027-01-13'), true);
reset role;
do $$
declare g uuid := (select id from people where email = 'giulia.rossi@azienda.it');
begin
  assert (select t.name from day_marks m join day_types t on t.id = m.day_type_id where m.person_id = g and m.day = '2027-01-13') = 'Smart working', 'mercoledì diventa smart';
  assert (select t.name from day_marks m join day_types t on t.id = m.day_type_id where m.person_id = g and m.day = '2027-01-14') = 'Ufficio', 'giovedì diventa ufficio';
  assert (select count(*) from events where person_id = g and starts_at >= '2027-01-11' and starts_at < '2027-01-16') = 5, 'turni invariati';
end $$;

select 'TUTTI I TEST SQL PASSATI';
