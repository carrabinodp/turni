-- =====================================================================
-- Turni · 0003
-- Ruolo Team Lead, team e canali delle persone, richieste di modifica,
-- chi ha modificato un blocco, sincronizzazione Google Calendar.
-- Da eseguire nel SQL Editor DOPO 0002.
-- =====================================================================

alter type public.app_role add value if not exists 'team_lead';
alter type public.request_kind add value if not exists 'change';

-- ---------------------------------------------------------------------
-- Persone: team, canali, preferenze notifiche dei manager
-- ---------------------------------------------------------------------
alter table public.people
  add column if not exists team text,
  add column if not exists channels text[] not null default '{}',
  add column if not exists notify_requests boolean not null default true;

-- Team Lead ha gli stessi poteri del manager sui turni
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.people
                 where user_id = auth.uid() and active and role::text in ('manager', 'admin', 'team_lead'))
$$;

-- ---------------------------------------------------------------------
-- Blocchi: chi li ha modificati per ultimo
-- ---------------------------------------------------------------------
alter table public.events add column if not exists updated_by uuid references public.people (id) on delete set null;

create or replace function public.events_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := coalesce(public.current_person_id(), new.updated_by, new.created_by);
  return new;
end $$;

drop trigger if exists events_stamp on public.events;
create trigger events_stamp before insert or update on public.events
  for each row execute function public.events_stamp();

-- Storico di un blocco (per "Vedi tutte le modifiche")
create or replace function public.event_history(p_event uuid)
returns table (at timestamptz, actor text, action text, before jsonb, after jsonb)
language sql stable security definer set search_path = public as $$
  select a.at, coalesce(p.full_name, 'Sistema'), a.action, a.before, a.after
  from public.audit_log a
  left join public.people p on p.id = a.actor_id
  where public.is_manager() and a.entity = 'events' and a.entity_id = p_event
  order by a.at desc
  limit 50
$$;

-- ---------------------------------------------------------------------
-- Richiesta di modifica libera (es. "posso entrare alle 10 giovedì?")
-- ---------------------------------------------------------------------
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

create or replace function public.request_change(p_day date, p_note text)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_person_id();
  r  public.requests;
begin
  if me is null then raise exception 'Accesso non autorizzato'; end if;
  if p_day is null or p_day < (now() at time zone (public.app_settings()).timezone)::date then
    raise exception 'Scegli un giorno da oggi in poi';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Scrivi cosa vorresti cambiare'; end if;
  insert into public.requests (kind, status, requester_id, day_a, note)
  values ('change'::text::public.request_kind, 'pending_manager', me, p_day, trim(p_note))
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Google Calendar
-- I token sono cifrati dall'app e la tabella non è leggibile dai client.
-- ---------------------------------------------------------------------
create table if not exists public.calendar_links (
  person_id      uuid primary key references public.people (id) on delete cascade,
  refresh_token  text not null,
  mode           text not null default 'primary' check (mode in ('primary', 'separate')),
  calendar_id    text not null default 'primary',
  google_email   text,
  connected_at   timestamptz not null default now(),
  last_sync_at   timestamptz,
  last_error     text
);

create table if not exists public.calendar_events (
  person_id        uuid not null references public.people (id) on delete cascade,
  day              date not null,
  google_event_id  text not null,
  hash             text not null,
  primary key (person_id, day)
);

alter table public.calendar_links  enable row level security;
alter table public.calendar_events enable row level security;
-- nessuna policy: solo il server (chiave di servizio) può leggere e scrivere

create or replace function public.my_calendar_status()
returns table (mode text, google_email text, connected_at timestamptz, last_sync_at timestamptz, last_error text)
language sql stable security definer set search_path = public as $$
  select l.mode, l.google_email, l.connected_at, l.last_sync_at, l.last_error
  from public.calendar_links l where l.person_id = public.current_person_id()
$$;

-- I dipendenti non possono cambiarsi team e canali da soli
create or replace function public.people_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.system', true), '') = 'on' then
    return new;
  end if;
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Solo un amministratore può cambiare i ruoli';
  end if;
  if not public.is_manager() then
    new.active := old.active;
    new.full_name := old.full_name;
    new.aliases := old.aliases;
    new.contract := old.contract;
    new.team := old.team;
    new.channels := old.channels;
  end if;
  new.user_id := old.user_id;
  new.email := old.email;
  return new;
end $$;
