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
  begin
    perform request_create('swap', m, '2026-11-12', '2026-11-11');
    raise exception 'doveva fallire per riposo';
  exception when others then
    assert sqlerrm like '%riposo%', 'messaggio: ' || sqlerrm;
  end;
  -- scambio valido: Gio di Giulia <-> Ven di Marco
  perform request_create('swap', m, '2026-11-12', '2026-11-13', p_note => 'Visita medica');
  assert (select status from requests) = 'pending_peer';
  -- seconda richiesta sullo stesso turno: bloccata
  begin
    perform request_create('give', null, '2026-11-12');
    raise exception 'doppia richiesta';
  exception when others then
    assert sqlerrm like 'C''è già una richiesta%', sqlerrm;
  end;
end $$;
reset role;

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
  -- Marco lavora mercoledì 08:00: martedì 14-22 lascerebbe 10h di riposo
  begin
    perform request_take((select id from requests where status = 'open'));
    raise exception 'doveva fallire';
  exception when others then
    assert sqlerrm like '%riposo%', sqlerrm;
  end;
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

select 'TUTTI I TEST SQL PASSATI';
