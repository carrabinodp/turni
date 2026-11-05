-- =====================================================================
-- Turni · 0004
-- Scambi: ufficio/smart seguono il turno, scambio di riposo tra giorni
-- diversi, elenco dei turni compatibili per l'operatore, revisore facoltativo.
-- Il riposo minimo non blocca più la richiesta: viene segnalato e decide il
-- manager (che può approvare comunque). Regole delle pause automatiche.
-- Da eseguire nel SQL Editor DOPO 0003.
-- =====================================================================

alter table public.requests add column if not exists reviewer_id uuid references public.people (id) on delete set null;

-- ---------------------------------------------------------------------
-- Pause automatiche: 15 min ogni 2 ore di lavoro continuativo, sfalsate
-- di 5 minuti tra gli operatori; pranzo di 1 ora dopo 4 ore nei turni da 8+.
-- ---------------------------------------------------------------------
alter table public.settings
  add column if not exists break_policy jsonb not null default
    '{"interval_minutes":120,"break_minutes":15,"stagger_minutes":5,"stagger_slots":6,"min_tail_minutes":15,"lunch_min_shift_hours":8,"lunch_after_hours":4,"lunch_minutes":60}'::jsonb,
  add column if not exists lunch_activity_id uuid references public.activity_types (id) on delete set null;

update public.settings
   set lunch_activity_id = coalesce(lunch_activity_id, (select id from public.activity_types where name = 'Pranzo' limit 1))
 where id = 1;

-- ---------------------------------------------------------------------
-- Il tipo di giornata (ufficio/smart…) segue il turno quando passa di mano.
-- a/da = chi cede e il suo giorno; b/db = chi riceve e il suo giorno (null = cessione)
-- ---------------------------------------------------------------------
create or replace function public._move_marks(a uuid, da date, b uuid, db date)
returns void language plpgsql security definer set search_path = public as $$
declare
  ta uuid;
  tb uuid;
begin
  select day_type_id into ta from public.day_marks where person_id = a and day = da;
  if db is not null then
    select day_type_id into tb from public.day_marks where person_id = b and day = db;
  end if;
  delete from public.day_marks
   where (person_id = a and day = da) or (person_id = b and day = da)
      or (db is not null and ((person_id = b and day = db) or (person_id = a and day = db)));
  if ta is not null then
    insert into public.day_marks (person_id, day, day_type_id) values (b, da, ta)
    on conflict (person_id, day) do update set day_type_id = excluded.day_type_id;
  end if;
  if tb is not null then
    insert into public.day_marks (person_id, day, day_type_id) values (a, db, tb)
    on conflict (person_id, day) do update set day_type_id = excluded.day_type_id;
  end if;
end $$;

create or replace function public._apply_request(r public.requests)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  cfg   public.settings := public.app_settings();
  ids_a uuid[];
  ids_b uuid[];
  d     date;
  st    timestamptz;
  en    timestamptz;
begin
  if r.kind::text = 'change' then
    return array[r.requester_id];   -- richiesta di modifica: la applica il manager a mano
  end if;
  if r.kind = 'swap' then
    ids_a := public.day_event_ids(r.requester_id, r.day_a);
    ids_b := public.day_event_ids(r.target_id, r.day_b);
    if cardinality(ids_a) = 0 then
      raise exception 'Il turno di % non è più disponibile', to_char(r.day_a, 'DD/MM');
    end if;
    if cardinality(ids_b) = 0 then
      raise exception 'Il turno del collega del % non è più disponibile', to_char(r.day_b, 'DD/MM');
    end if;
    if r.day_a <> r.day_b then
      if cardinality(public.day_event_ids(r.target_id, r.day_a)) > 0 then
        raise exception '% lavora già il %', (select full_name from public.people where id = r.target_id), to_char(r.day_a, 'DD/MM');
      end if;
      if cardinality(public.day_event_ids(r.requester_id, r.day_b)) > 0 then
        raise exception '% lavora già il %', (select full_name from public.people where id = r.requester_id), to_char(r.day_b, 'DD/MM');
      end if;
    end if;
    update public.events set person_id = r.target_id, source = 'request' where id = any (ids_a);
    update public.events set person_id = r.requester_id, source = 'request' where id = any (ids_b);
    perform public._move_marks(r.requester_id, r.day_a, r.target_id, r.day_b);  -- ufficio/smart seguono il turno
    return array[r.requester_id, r.target_id];

  elsif r.kind = 'give' then
    if r.target_id is null then
      raise exception 'Nessun collega ha ancora preso il turno';
    end if;
    ids_a := public.day_event_ids(r.requester_id, r.day_a);
    if cardinality(ids_a) = 0 then
      raise exception 'Il turno di % non è più disponibile', to_char(r.day_a, 'DD/MM');
    end if;
    if cardinality(public.day_event_ids(r.target_id, r.day_a)) > 0 then
      raise exception '% lavora già il %', (select full_name from public.people where id = r.target_id), to_char(r.day_a, 'DD/MM');
    end if;
    update public.events set person_id = r.target_id, source = 'request' where id = any (ids_a);
    perform public._move_marks(r.requester_id, r.day_a, r.target_id, null);
    return array[r.requester_id, r.target_id];

  else -- time_off
    d := r.from_date;
    while d <= r.to_date loop
      if r.time_from is null then
        select min(e.starts_at), max(e.ends_at) into st, en
        from public.events e where e.id = any (public.day_event_ids(r.requester_id, d));
        delete from public.events where id = any (public.day_event_ids(r.requester_id, d));
        if st is null then
          st := (d + time '09:00') at time zone cfg.timezone;
          en := (d + time '17:00') at time zone cfg.timezone;
        end if;
      else
        st := (d + r.time_from) at time zone cfg.timezone;
        en := (d + r.time_to) at time zone cfg.timezone;
        if en <= st then en := en + interval '1 day'; end if;
      end if;
      insert into public.events (person_id, activity_id, starts_at, ends_at, note, source, created_by)
      values (r.requester_id, r.activity_id, st, en, r.note, 'request', r.decided_by);
      d := d + 1;
    end loop;
    return array[r.requester_id];
  end if;
end $$;

create or replace function public.manager_swap(
  p_person_a uuid, p_day_a date, p_person_b uuid, p_day_b date,
  p_note text default null, p_force boolean default false
) returns public.requests
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_person_id();
  r  public.requests;
  affected uuid[];
  p  uuid;
  v  text[] := '{}';
begin
  if not public.is_manager() then raise exception 'Solo i manager possono spostare i turni'; end if;
  if p_person_a = p_person_b and p_day_a = p_day_b then raise exception 'Scegli un collega o un giorno diverso'; end if;
  if cardinality(public.day_event_ids(p_person_a, p_day_a)) = 0 then
    raise exception '% non ha un turno il %', (select full_name from public.people where id = p_person_a), to_char(p_day_a, 'DD/MM');
  end if;

  r.id := gen_random_uuid();
  r.requester_id := p_person_a;
  r.target_id := p_person_b;
  r.day_a := p_day_a;
  r.note := nullif(trim(p_note), '');
  r.status := 'approved';
  r.decided_by := me;
  r.decided_at := now();
  r.decision_note := 'Inserito dal manager';
  r.created_at := now();
  r.updated_at := now();

  if cardinality(public.day_event_ids(p_person_b, p_day_b)) = 0 then
    if p_day_a <> p_day_b then
      raise exception '% non lavora il %: per spostargli il turno scegli lo stesso giorno',
        (select full_name from public.people where id = p_person_b), to_char(p_day_b, 'DD/MM');
    end if;
    r.kind := 'give';
  else
    r.kind := 'swap';
    r.day_b := p_day_b;
  end if;

  affected := public._apply_request(r);
  if not p_force then
    foreach p in array affected loop
      v := v || public.rest_violations(p, public.day_start(least(p_day_a, p_day_b)),
                                       public.day_start(greatest(p_day_a, p_day_b) + 1));
    end loop;
    perform public._raise_violations(v);
  end if;

  insert into public.requests values (r.*) returning * into r;
  return r;
end $$;

drop function if exists public.request_create(public.request_kind, uuid, date, date, date, date, time, time, uuid, text);
create or replace function public.request_create(
  p_kind        public.request_kind,
  p_target      uuid default null,
  p_day_a       date default null,
  p_day_b       date default null,
  p_from        date default null,
  p_to          date default null,
  p_time_from   time default null,
  p_time_to     time default null,
  p_activity    uuid default null,
  p_note        text default null,
  p_reviewer    uuid default null
) returns public.requests
language plpgsql security definer set search_path = public as $$
declare
  me     uuid := public.current_person_id();
  today  date := (now() at time zone (public.app_settings()).timezone)::date;
  r      public.requests;
begin
  if me is null then
    raise exception 'Accesso non autorizzato';
  end if;

  r.id := gen_random_uuid();
  r.kind := p_kind;
  r.requester_id := me;
  r.note := nullif(trim(p_note), '');
  r.reviewer_id := p_reviewer;
  r.created_at := now();
  r.updated_at := now();

  if p_kind in ('swap', 'give') then
    if p_day_a is null or p_day_a < today then
      raise exception 'Scegli un turno di oggi o dei prossimi giorni';
    end if;
    if not public.week_published(public.day_start(p_day_a)) then
      raise exception 'La settimana del turno non è ancora pubblicata';
    end if;
    if cardinality(public.day_event_ids(me, p_day_a)) = 0 then
      raise exception 'Non hai un turno il %', to_char(p_day_a, 'DD/MM');
    end if;
    if exists (select 1 from public.requests q
               where q.status in ('pending_peer', 'open', 'pending_manager')
                 and q.kind in ('swap', 'give')
                 and ((q.requester_id = me and q.day_a = p_day_a)
                   or (q.target_id = me and q.day_b = p_day_a))) then
      raise exception 'C''è già una richiesta aperta per il turno del %', to_char(p_day_a, 'DD/MM');
    end if;
    r.day_a := p_day_a;

    if p_target is not null then
      if p_target = me or not exists (select 1 from public.people where id = p_target and active) then
        raise exception 'Collega non valido';
      end if;
      r.target_id := p_target;
    end if;

    if p_kind = 'swap' then
      if p_target is null or p_day_b is null then
        raise exception 'Per uno scambio scegli collega e turno';
      end if;
      if p_day_b < today then
        raise exception 'Il turno del collega è già passato';
      end if;
      if cardinality(public.day_event_ids(p_target, p_day_b)) = 0 then
        raise exception 'Il collega non ha un turno il %', to_char(p_day_b, 'DD/MM');
      end if;
      r.day_b := p_day_b;
    end if;

    r.status := case when r.target_id is null then 'open' else 'pending_peer' end;
    if r.target_id is not null then
      perform public._simulate(r);  -- controlla che lo scambio sia possibile; il riposo lo valuta il manager
    end if;

  else -- time_off
    if p_from is null or p_to is null or p_to < p_from then
      raise exception 'Date non valide';
    end if;
    if p_from < today then
      raise exception 'Non puoi chiedere un''assenza nel passato';
    end if;
    if p_to - p_from > 60 then
      raise exception 'Massimo 60 giorni per richiesta';
    end if;
    if (p_time_from is null) <> (p_time_to is null) then
      raise exception 'Indica sia l''ora di inizio che di fine';
    end if;
    if not exists (select 1 from public.activity_types
                   where id = p_activity and kind = 'absence' and requestable and not archived) then
      raise exception 'Tipo di assenza non valido';
    end if;
    r.from_date := p_from; r.to_date := p_to;
    r.time_from := p_time_from; r.time_to := p_time_to;
    r.activity_id := p_activity;
    r.status := 'pending_manager';
  end if;

  insert into public.requests values (r.*) returning * into r;
  return r;
end $$;

create or replace function public.request_respond(p_id uuid, p_accept boolean)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_person_id();
  r  public.requests;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null or r.target_id is distinct from me or r.status <> 'pending_peer' then
    raise exception 'Richiesta non disponibile';
  end if;
  if p_accept then
    perform public._simulate(r);
    update public.requests set status = 'pending_manager' where id = p_id returning * into r;
  else
    update public.requests set status = 'rejected', decided_at = now(), decided_by = me
     where id = p_id returning * into r;
  end if;
  return r;
end $$;

create or replace function public.request_take(p_id uuid)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_person_id();
  r  public.requests;
begin
  if me is null then raise exception 'Accesso non autorizzato'; end if;
  select * into r from public.requests where id = p_id for update;
  if r.id is null or r.status <> 'open' then
    raise exception 'Il turno non è più in bacheca';
  end if;
  if r.requester_id = me then
    raise exception 'Non puoi prendere un tuo turno';
  end if;
  r.target_id := me;
  perform public._simulate(r);
  update public.requests set target_id = me, status = 'pending_manager' where id = p_id returning * into r;
  return r;
end $$;

drop function if exists public.request_decide(uuid, boolean, text);
create or replace function public.request_decide(p_id uuid, p_approve boolean, p_note text default null, p_force boolean default false)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_person_id();
  r  public.requests;
  affected uuid[];
  p  uuid;
  v  text[] := '{}';
  d1 date; d2 date;
begin
  if not public.is_manager() then raise exception 'Solo i manager possono decidere'; end if;
  select * into r from public.requests where id = p_id for update;
  if r.id is null or r.status <> 'pending_manager' then
    raise exception 'La richiesta è già stata gestita';
  end if;

  if p_approve then
    r.decided_by := me;
    affected := public._apply_request(r);
    d1 := least(coalesce(r.day_a, r.from_date), coalesce(r.day_b, r.day_a, r.from_date));
    d2 := greatest(coalesce(r.day_a, r.to_date), coalesce(r.day_b, r.day_a, r.to_date));
    foreach p in array affected loop
      v := v || public.rest_violations(p, public.day_start(d1), public.day_start(d2 + 1));
    end loop;
    if not p_force then
      perform public._raise_violations(v);   -- annulla tutto se ci sono violazioni
    end if;
  end if;

  update public.requests
     set status = case when p_approve then 'approved'::public.request_status else 'rejected'::public.request_status end,
         decided_by = me, decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Turni con cui l'operatore può scambiare il proprio turno del giorno p_day_a:
--  - stesso giorno: il collega lavora quel giorno (qualsiasi orario o tipo)
--  - scambio di riposo: giorno diverso, il collega è a riposo il mio giorno
--    e io sono a riposo il suo (es. lavoro sabato e riposo martedì)
-- issues = regole violate (riposo minimo), solo come avviso.
-- ---------------------------------------------------------------------
create or replace function public.swap_candidates(p_day_a date, p_from date, p_to date)
returns table (person_id uuid, full_name text, day date, starts_at timestamptz, ends_at timestamptz,
               mode text, day_type text, day_color text, blocks jsonb, issues text[])
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  me    uuid := public.current_person_id();
  tz    text := (public.app_settings()).timezone;
  today date := (now() at time zone (public.app_settings()).timezone)::date;
  c     record;
  r     public.requests;
begin
  if me is null then raise exception 'Accesso non autorizzato'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 31 then
    raise exception 'Scegli un intervallo di massimo 31 giorni';
  end if;
  if cardinality(public.day_event_ids(me, p_day_a)) = 0 then
    raise exception 'Non hai un turno il %', to_char(p_day_a, 'DD/MM');
  end if;

  for c in
    select e.person_id as pid, p.full_name as pname, (e.starts_at at time zone tz)::date as d,
           min(e.starts_at) filter (where a.kind <> 'absence') as s,
           max(e.ends_at) filter (where a.kind <> 'absence') as en,
           jsonb_agg(jsonb_build_object('s', e.starts_at, 'e', e.ends_at, 'name', a.name, 'color', a.color, 'kind', a.kind)
                     order by e.starts_at) as bl
    from public.events e
    join public.activity_types a on a.id = e.activity_id
    join public.people p on p.id = e.person_id and p.active and p.user_id is not null and p.id <> me
    where e.starts_at >= public.day_start(greatest(p_from, today)) and e.starts_at < public.day_start(p_to + 1)
      and public.week_published(e.starts_at)
    group by e.person_id, p.full_name, (e.starts_at at time zone tz)::date
    having count(*) filter (where a.kind <> 'absence') > 0
    order by 3, 4, 2
  loop
    if c.d = p_day_a then
      mode := 'same_day';
    elsif cardinality(public.day_event_ids(me, c.d)) = 0 and cardinality(public.day_event_ids(c.pid, p_day_a)) = 0 then
      mode := 'rest_swap';
    else
      continue;
    end if;
    -- turno già coinvolto in un'altra richiesta aperta
    if exists (select 1 from public.requests q
               where q.status in ('pending_peer', 'open', 'pending_manager') and q.kind in ('swap', 'give')
                 and ((q.requester_id = c.pid and q.day_a = c.d) or (q.target_id = c.pid and q.day_b = c.d))) then
      continue;
    end if;

    r := null;
    r.id := gen_random_uuid();
    r.kind := 'swap';
    r.status := 'pending_peer';
    r.requester_id := me;
    r.target_id := c.pid;
    r.day_a := p_day_a;
    r.day_b := c.d;
    begin
      issues := public._simulate(r);
    exception when others then
      continue;   -- scambio non possibile
    end;

    person_id := c.pid;
    full_name := c.pname;
    day := c.d;
    starts_at := c.s;
    ends_at := c.en;
    blocks := c.bl;
    select t.name, t.color into day_type, day_color
      from public.day_marks m join public.day_types t on t.id = m.day_type_id
     where m.person_id = c.pid and m.day = c.d;
    if not found then day_type := null; day_color := null; end if;
    return next;
  end loop;
end $$;

revoke execute on function public._move_marks(uuid, date, uuid, date) from public, anon, authenticated;
revoke execute on function public._apply_request(public.requests) from public, anon, authenticated;

notify pgrst, 'reload schema';
