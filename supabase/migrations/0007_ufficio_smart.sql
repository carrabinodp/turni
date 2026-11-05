-- =====================================================================
-- Turni · 0007
-- Richiesta ufficio/smart: l'operatore chiede di cambiare il tipo di una
-- giornata (es. smart invece che ufficio), con o senza un giorno di recupero.
-- Regola: 3 giorni in ufficio a settimana (lun–ven), sabato e domenica in smart.
-- Se la regola non torna la richiesta parte lo stesso, con un avviso per chi approva.
-- Da eseguire nel SQL Editor DOPO 0006.
-- =====================================================================

alter type public.request_kind add value if not exists 'place';

-- dove si lavora in quel tipo di giornata
alter table public.day_types add column if not exists place text check (place in ('office', 'remote'));
update public.day_types set place = 'office'
 where place is null and (name ~* '(uffic|presenz|sede|office)' or exists (select 1 from unnest(aliases) a where a ~* '^(uffic|presenz|sede)'));
update public.day_types set place = 'remote'
 where place is null and (name ~* '(smart|remot|casa|home|agile)' or exists (select 1 from unnest(aliases) a where a ~* '^(smart|sw$|remot|casa)'));

alter table public.settings add column if not exists office_days_per_week int not null default 3
  check (office_days_per_week between 0 and 7);

alter table public.requests
  add column if not exists day_type_a uuid references public.day_types (id) on delete set null,
  add column if not exists day_type_b uuid references public.day_types (id) on delete set null;

-- Avvisi sulla regola ufficio/smart dopo la modifica richiesta
create or replace function public._place_issues(r public.requests)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  cfg    public.settings := public.app_settings();
  out    text[] := '{}';
  w      date;
  d      date;
  t      uuid;
  pl     text;
  works  int;
  office int;
  target int;
begin
  for w in select distinct public.week_of(public.day_start(x)) from unnest(array[r.day_a, r.day_b]) x where x is not null order by 1 loop
    works := 0; office := 0;
    for i in 0..4 loop
      d := w + i;
      if cardinality(public.day_event_ids(r.requester_id, d)) = 0 then continue; end if;
      works := works + 1;
      t := case when d = r.day_a then r.day_type_a when d = r.day_b then r.day_type_b
                else (select day_type_id from public.day_marks where person_id = r.requester_id and day = d) end;
      select place into pl from public.day_types where id = t;
      if pl = 'office' then office := office + 1; end if;
    end loop;
    target := least(cfg.office_days_per_week, works);
    if office < target then
      out := out || format('Settimana dal %s: %s %s in ufficio invece di %s', to_char(w, 'DD/MM'), office,
                           case when office = 1 then 'giorno' else 'giorni' end, target);
    elsif office > target then
      out := out || format('Settimana dal %s: %s giorni in ufficio, più dei %s previsti', to_char(w, 'DD/MM'), office, target);
    end if;
  end loop;
  foreach d in array array_remove(array[r.day_a, r.day_b], null) loop
    t := case when d = r.day_a then r.day_type_a else r.day_type_b end;
    if extract(isodow from d) >= 6 and (select place from public.day_types where id = t) = 'office' then
      out := out || format('%s è nel fine settimana: sabato e domenica sono in smart', to_char(d, 'DD/MM'));
    end if;
  end loop;
  return out;
end $$;

create or replace function public.request_place(p_day_a date, p_type_a uuid, p_day_b date default null,
                                                p_note text default null, p_reviewer uuid default null)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  me     uuid := public.current_person_id();
  today  date := (now() at time zone (public.app_settings()).timezone)::date;
  cur_a  uuid;
  cur_b  uuid;
  pl_a   text;
  type_b uuid;
  r      public.requests;
begin
  if me is null then raise exception 'Accesso non autorizzato'; end if;
  if p_day_a is null or p_day_a < today then raise exception 'Scegli un giorno da oggi in poi'; end if;
  select place into pl_a from public.day_types where id = p_type_a and not archived;
  if pl_a is null then raise exception 'Scegli ufficio o smart'; end if;
  if cardinality(public.day_event_ids(me, p_day_a)) = 0 then
    raise exception 'Il % non hai un turno', to_char(p_day_a, 'DD/MM');
  end if;
  if not public.week_published(public.day_start(p_day_a)) then
    raise exception 'La settimana del % non è ancora pubblicata', to_char(p_day_a, 'DD/MM');
  end if;
  select day_type_id into cur_a from public.day_marks where person_id = me and day = p_day_a;
  if cur_a = p_type_a then raise exception 'Il % è già così', to_char(p_day_a, 'DD/MM'); end if;

  if p_day_b is not null then
    if p_day_b = p_day_a then raise exception 'Il giorno di recupero deve essere diverso'; end if;
    if p_day_b < today then raise exception 'Il giorno di recupero deve essere da oggi in poi'; end if;
    if cardinality(public.day_event_ids(me, p_day_b)) = 0 then
      raise exception 'Il % non hai un turno da usare come recupero', to_char(p_day_b, 'DD/MM');
    end if;
    if not public.week_published(public.day_start(p_day_b)) then
      raise exception 'La settimana del % non è ancora pubblicata', to_char(p_day_b, 'DD/MM');
    end if;
    -- il recupero prende il tipo che aveva il primo giorno (o il contrario di quello richiesto)
    type_b := coalesce(cur_a, (select id from public.day_types where place is not null and place <> pl_a and not archived order by sort_order limit 1));
    select day_type_id into cur_b from public.day_marks where person_id = me and day = p_day_b;
    if cur_b = type_b then
      raise exception 'Il % sei già in %', to_char(p_day_b, 'DD/MM'), (select name from public.day_types where id = type_b);
    end if;
  end if;

  if exists (select 1 from public.requests q
             where q.requester_id = me and q.kind::text = 'place' and q.status = 'pending_manager'
               and (q.day_a in (p_day_a, p_day_b) or q.day_b in (p_day_a, p_day_b))) then
    raise exception 'C’è già una richiesta ufficio/smart in attesa per questi giorni';
  end if;
  if p_reviewer is not null and not exists (select 1 from public.people where id = p_reviewer and active and role::text <> 'agent') then
    raise exception 'Responsabile non valido';
  end if;

  insert into public.requests (kind, status, requester_id, day_a, day_b, day_type_a, day_type_b, note, reviewer_id)
  values ('place'::text::public.request_kind, 'pending_manager', me, p_day_a, p_day_b, p_type_a, type_b,
          nullif(trim(p_note), ''), p_reviewer)
  returning * into r;
  return r;
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
  if r.kind::text = 'place' then
    -- ufficio/smart: cambia solo il tipo di giornata, i turni restano uguali
    if cardinality(public.day_event_ids(r.requester_id, r.day_a)) = 0 then
      raise exception 'Il % non hai più un turno', to_char(r.day_a, 'DD/MM');
    end if;
    insert into public.day_marks (person_id, day, day_type_id) values (r.requester_id, r.day_a, r.day_type_a)
      on conflict (person_id, day) do update set day_type_id = excluded.day_type_id;
    if r.day_b is not null then
      if cardinality(public.day_event_ids(r.requester_id, r.day_b)) = 0 then
        raise exception 'Il % non hai più un turno', to_char(r.day_b, 'DD/MM');
      end if;
      insert into public.day_marks (person_id, day, day_type_id) values (r.requester_id, r.day_b, r.day_type_b)
        on conflict (person_id, day) do update set day_type_id = excluded.day_type_id;
    end if;
    return array[r.requester_id];
  end if;
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

create or replace function public.request_preview(p_id uuid)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_person_id();
  r  public.requests;
begin
  select * into r from public.requests where id = p_id;
  if r.id is null or not (public.is_manager() or me in (r.requester_id, r.target_id)) then
    raise exception 'Richiesta non disponibile';
  end if;
  if r.kind::text = 'place' then
    return public._place_issues(r);
  end if;
  if r.kind <> 'time_off' and r.target_id is null then
    return '{}';
  end if;
  return public._simulate(r);
end $$;

revoke execute on function public._place_issues(public.requests) from public, anon, authenticated;
revoke execute on function public._apply_request(public.requests) from public, anon, authenticated;
grant execute on function public.request_place(date, uuid, date, text, uuid) to authenticated;

notify pgrst, 'reload schema';
