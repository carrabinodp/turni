-- =====================================================================
-- Turni · schema iniziale
-- Da eseguire su Supabase (SQL Editor o `supabase db push`).
-- Tutti gli orari sono salvati in UTC (timestamptz); la logica "per giorno"
-- usa il fuso orario in settings.timezone (default Europe/Rome).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipi
-- ---------------------------------------------------------------------
create type public.app_role as enum ('agent', 'manager', 'admin');
create type public.activity_kind as enum ('work', 'break', 'absence');
create type public.request_kind as enum ('swap', 'give', 'time_off');
create type public.request_status as enum
  ('pending_peer', 'open', 'pending_manager', 'approved', 'rejected', 'cancelled');

-- Nome normalizzato e indipendente dall'ordine:
-- "Rossi  Giulia" = "giulia rossi" = "GIULIA RÒSSI".
-- La stessa logica esiste in src/lib/names.ts: tenerle allineate.
create or replace function public.norm_name(t text)
returns text language sql immutable parallel safe as $$
  select coalesce(string_agg(tok, ' ' order by tok), '')
  from regexp_split_to_table(
         regexp_replace(
           lower(translate(coalesce(t, ''),
             'ÀÁÂÄÃÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÇÑàáâäãèéêëìíîïòóôöõùúûüçñ',
             'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
           '[^a-z0-9]+', ' ', 'g'),
         '\s+') as tok
  where tok <> ''
$$;

-- ---------------------------------------------------------------------
-- Impostazioni (riga unica)
-- ---------------------------------------------------------------------
create table public.settings (
  id               int primary key default 1 check (id = 1),
  org_name         text    not null default 'Turni',
  allowed_domains  text[]  not null default '{}',   -- es. {'azienda.it'}
  admin_emails     text[]  not null default '{}',   -- diventano admin al primo accesso
  timezone         text    not null default 'Europe/Rome',
  min_rest_hours   numeric not null default 11 check (min_rest_hours between 0 and 24),
  split_gap_hours  numeric not null default 4  check (split_gap_hours between 0 and 12),
  snap_minutes     int     not null default 15 check (snap_minutes in (1, 5, 10, 15, 30, 60)),
  updated_at       timestamptz not null default now()
);
insert into public.settings default values;

-- ---------------------------------------------------------------------
-- Persone
-- user_id è null finché la persona non si registra (profili creati dall'import).
-- ---------------------------------------------------------------------
create table public.people (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid unique references auth.users (id) on delete set null,
  full_name            text not null check (length(trim(full_name)) > 0),
  email                text unique check (email = lower(email)),
  aliases              text[] not null default '{}',
  role                 public.app_role not null default 'agent',
  active               boolean not null default true,
  contract             text,
  email_notifications  boolean not null default true,
  created_at           timestamptz not null default now()
);
create index people_norm_idx on public.people (public.norm_name(full_name));

-- ---------------------------------------------------------------------
-- Tipi di attività (configurabili dai manager)
-- ---------------------------------------------------------------------
create table public.activity_types (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) > 0),
  color        text not null default '#4b3f72' check (color ~ '^#[0-9a-fA-F]{6}$'),
  kind         public.activity_kind not null default 'work',
  aliases      text[] not null default '{}',
  requestable  boolean not null default false,   -- richiedibile come assenza dai dipendenti
  sort_order   int not null default 0,
  archived     boolean not null default false,
  created_at   timestamptz not null default now()
);
create unique index activity_types_name_uq on public.activity_types (lower(name));

insert into public.activity_types (name, color, kind, aliases, requestable, sort_order) values
  ('Telefono',    '#483d73', 'work',    '{phone,tel,telefono,voce}',         false, 10),
  ('Chat',        '#2e6e9e', 'work',    '{chat,live chat}',                  false, 20),
  ('Email',       '#b4a7dd', 'work',    '{mail,e-mail,email,ticket}',        false, 30),
  ('Back office', '#5d7686', 'work',    '{bo,backoffice,back office}',       false, 40),
  ('Riunione',    '#a33a5a', 'work',    '{meeting,riunione,call}',           false, 50),
  ('Formazione',  '#c58b2b', 'work',    '{training,formazione,corso}',       false, 60),
  ('Pausa',       '#a9d3ea', 'break',   '{break,pausa}',                     false, 70),
  ('Pranzo',      '#f6e7a6', 'break',   '{lunch,pranzo}',                    false, 80),
  ('Ferie',       '#bdb6d8', 'absence', '{ferie,vacation,holiday,fe}',       true,  90),
  ('Permesso',    '#d9ccb4', 'absence', '{permesso,rol,par,perm}',           true, 100),
  ('Malattia',    '#f48ca0', 'absence', '{malattia,sick,mal}',               false, 110);

-- ---------------------------------------------------------------------
-- Settimane pubblicate (lunedì in ora locale).
-- I dipendenti vedono solo i blocchi delle settimane pubblicate.
-- ---------------------------------------------------------------------
create table public.schedule_weeks (
  week_start    date primary key check (extract(isodow from week_start) = 1),
  published_at  timestamptz not null default now(),
  published_by  uuid references public.people (id) on delete set null
);

-- ---------------------------------------------------------------------
-- Blocchi di attività (gli "eventi" della timeline)
-- ---------------------------------------------------------------------
create table public.events (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.people (id) on delete cascade,
  activity_id  uuid not null references public.activity_types (id),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  note         text,
  source       text not null default 'manual',   -- manual | import | request | copy
  created_by   uuid references public.people (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint events_time_ck check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours')
);
create index events_person_time_idx on public.events (person_id, starts_at);
create index events_time_idx on public.events (starts_at, ends_at);

-- ---------------------------------------------------------------------
-- Richieste: scambi, cessioni, assenze
-- ---------------------------------------------------------------------
create table public.requests (
  id             uuid primary key default gen_random_uuid(),
  kind           public.request_kind not null,
  status         public.request_status not null,
  requester_id   uuid not null references public.people (id) on delete cascade,
  target_id      uuid references public.people (id) on delete cascade,
  day_a          date,          -- giorno del richiedente (scambio/cessione)
  day_b          date,          -- giorno del collega (scambio)
  from_date      date,          -- assenza
  to_date        date,
  time_from      time,          -- assenza a ore (facoltativo)
  time_to        time,
  activity_id    uuid references public.activity_types (id),
  note           text,
  decided_by     uuid references public.people (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index requests_status_idx on public.requests (status);
create index requests_people_idx on public.requests (requester_id, target_id);

-- ---------------------------------------------------------------------
-- Notifiche in-app, sottoscrizioni push, registro modifiche
-- ---------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people (id) on delete cascade,
  title       text not null,
  body        text,
  url         text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_person_idx on public.notifications (person_id, created_at desc);

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid references public.people (id) on delete set null,
  entity      text not null,
  entity_id   uuid,
  action      text not null,
  summary     text,
  before      jsonb,
  after       jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);

-- =====================================================================
-- Funzioni di supporto
-- =====================================================================
create or replace function public.app_settings()
returns public.settings language sql stable security definer set search_path = public as $$
  select * from public.settings where id = 1
$$;

create or replace function public.current_person_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.people where user_id = auth.uid() and active
$$;

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.people where user_id = auth.uid() and active)
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.people
                 where user_id = auth.uid() and active and role in ('manager', 'admin'))
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.people
                 where user_id = auth.uid() and active and role = 'admin')
$$;

-- Inizio e fine del giorno locale come timestamptz
create or replace function public.day_start(d date)
returns timestamptz language sql stable set search_path = public as $$
  select (d::timestamp) at time zone (select timezone from public.settings where id = 1)
$$;

create or replace function public.week_of(ts timestamptz)
returns date language sql stable set search_path = public as $$
  select date_trunc('week', ts at time zone (select timezone from public.settings where id = 1))::date
$$;

create or replace function public.week_published(ts timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.schedule_weeks where week_start = public.week_of(ts))
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();
create trigger requests_touch before update on public.requests
  for each row execute function public.touch_updated_at();

-- Registro modifiche (saltato durante import massivi: app.bulk = on)
create or replace function public.audit_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.bulk', true), '') = 'on' then
    return null;
  end if;
  insert into public.audit_log (actor_id, entity, entity_id, action, before, after)
  values (
    public.current_person_id(),
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end $$;

create trigger events_audit after insert or update or delete on public.events
  for each row execute function public.audit_trg();
create trigger requests_audit after insert or update on public.requests
  for each row execute function public.audit_trg();

-- Protezione campi sensibili delle persone
create or replace function public.people_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.system', true), '') = 'on' then
    return new;
  end if;
  -- solo l'admin cambia i ruoli
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Solo un amministratore può cambiare i ruoli';
  end if;
  -- i dipendenti possono cambiare solo le proprie preferenze
  if not public.is_manager() then
    new.active := old.active;
    new.full_name := old.full_name;
    new.aliases := old.aliases;
    new.contract := old.contract;
  end if;
  new.user_id := old.user_id;
  new.email := old.email;
  return new;
end $$;

create trigger people_guard before update on public.people
  for each row execute function public.people_guard();

-- =====================================================================
-- Collegamento account Google → profilo
-- 1) email già presente (persona creata a mano)  2) stesso nome (o alias)
--    di un profilo creato dall'import  3) altrimenti nuovo profilo.
-- =====================================================================
create or replace function public.link_user(uid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cfg   public.settings;
  em    text;
  meta  jsonb;
  nm    text;
  pid   uuid;
  n     int;
  is_adm boolean;
begin
  select id into pid from public.people where user_id = uid;
  if pid is not null then
    return pid;
  end if;

  select lower(u.email), coalesce(u.raw_user_meta_data, '{}'::jsonb)
    into em, meta from auth.users u where u.id = uid;
  if em is null then
    return null;
  end if;

  cfg := public.app_settings();
  is_adm := em = any (cfg.admin_emails);
  if not is_adm and not (split_part(em, '@', 2) = any (cfg.allowed_domains)) then
    return null;   -- dominio non autorizzato
  end if;

  nm := coalesce(
    nullif(trim(meta ->> 'full_name'), ''),
    nullif(trim(meta ->> 'name'), ''),
    nullif(trim(concat_ws(' ', meta ->> 'given_name', meta ->> 'family_name')), ''),
    initcap(replace(split_part(em, '@', 1), '.', ' '))
  );

  perform set_config('app.system', 'on', true);

  select id into pid from public.people where email = em and user_id is null;

  if pid is null then
    select count(*), (array_agg(id))[1] into n, pid
    from public.people p
    where p.user_id is null and p.email is null
      and (public.norm_name(p.full_name) = public.norm_name(nm)
           or public.norm_name(nm) in (select public.norm_name(a) from unnest(p.aliases) a));
    if n <> 1 then
      pid := null;   -- nessuna corrispondenza o ambigua
    end if;
  end if;

  if pid is null then
    -- profilo importato col solo cognome ("Borra" → "Claudia Borra"), se è l'unico
    select count(*), (array_agg(id))[1] into n, pid
    from public.people p
    where p.user_id is null and p.email is null
      and string_to_array(public.norm_name(p.full_name), ' ') <@ string_to_array(public.norm_name(nm), ' ');
    if n <> 1 then
      pid := null;   -- nessuna corrispondenza o ambigua: profilo nuovo
    end if;
  end if;

  if pid is not null then
    update public.people p
       set user_id = uid,
           email = em,
           active = true,
           aliases = case when p.full_name <> nm
                          then array(select distinct x from unnest(p.aliases || p.full_name) x)
                          else p.aliases end,
           full_name = nm,
           role = case when is_adm then 'admin'::public.app_role else p.role end
     where p.id = pid;
  else
    insert into public.people (user_id, full_name, email, role)
    values (uid, nm, em, case when is_adm then 'admin'::public.app_role else 'agent'::public.app_role end)
    returning id into pid;
  end if;

  perform set_config('app.system', 'off', true);
  return pid;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.link_user(new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Chiamata a ogni login: collega il profilo se non era stato collegato
-- (es. dominio aggiunto dopo la registrazione).
create or replace function public.ensure_profile()
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return null;
  end if;
  return public.link_user(auth.uid());
end $$;

-- =====================================================================
-- Regole: riposo minimo tra turni
-- I blocchi (non assenze) separati da meno di split_gap_hours formano un
-- unico turno (turno spezzato). Tra due turni servono min_rest_hours.
-- =====================================================================
create or replace function public.rest_violations(p uuid, win_from timestamptz, win_to timestamptz)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  cfg    public.settings := public.app_settings();
  pname  text;
  res    text[] := '{}';
  r      record;
begin
  select full_name into pname from public.people where id = p;
  for r in
    with ev as (
      select e.starts_at as s, e.ends_at as e
      from public.events e
      join public.activity_types a on a.id = e.activity_id
      where e.person_id = p and a.kind <> 'absence'
        and e.ends_at > win_from - interval '2 days'
        and e.starts_at < win_to + interval '2 days'
    ),
    o as (
      select s, e, max(e) over (order by s, e rows between unbounded preceding and 1 preceding) as pe
      from ev
    ),
    g as (
      select s, e,
             sum(case when pe is null or s - pe > make_interval(mins => (cfg.split_gap_hours * 60)::int)
                      then 1 else 0 end) over (order by s, e) as grp
      from o
    ),
    sh as (select min(s) as s, max(e) as e from g group by grp),
    gp as (select s, e, lag(e) over (order by s) as prev_e from sh)
    select s, prev_e from gp
    where prev_e is not null
      and s - prev_e < make_interval(mins => (cfg.min_rest_hours * 60)::int)
      and s >= win_from - interval '1 day'
      and prev_e < win_to + interval '1 day'
    order by s
  loop
    res := res || format('%s: solo %s di riposo prima del turno di %s (minimo %s h)',
                         pname,
                         to_char(r.s - r.prev_e, 'FMHH24"h"MI'),
                         to_char(r.s at time zone cfg.timezone, 'DD/MM "alle" HH24:MI'),
                         trim(to_char(cfg.min_rest_hours, 'FM990.##'), '.'));
  end loop;
  return res;
end $$;

-- Blocchi lavorativi (non assenze) di una persona in un giorno locale
create or replace function public.day_event_ids(p uuid, d date)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(e.id), '{}')
  from public.events e
  join public.activity_types a on a.id = e.activity_id
  where e.person_id = p and a.kind <> 'absence'
    and e.starts_at >= public.day_start(d) and e.starts_at < public.day_start(d + 1)
$$;

-- Applica una richiesta agli eventi (nessun controllo permessi: uso interno)
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

-- Simula una richiesta e restituisce le violazioni, senza modificare nulla
create or replace function public._simulate(r public.requests)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v        text[] := '{}';
  affected uuid[];
  p        uuid;
  d1       date := least(coalesce(r.day_a, r.from_date), coalesce(r.day_b, r.day_a, r.from_date));
  d2       date := greatest(coalesce(r.day_a, r.to_date), coalesce(r.day_b, r.day_a, r.to_date));
begin
  begin
    affected := public._apply_request(r);
    foreach p in array affected loop
      v := v || public.rest_violations(p, public.day_start(d1), public.day_start(d2 + 1));
    end loop;
    raise exception using errcode = 'ZZ001', message = '__simulate__';
  exception when sqlstate 'ZZ001' then
    null;  -- modifiche annullate, le violazioni restano in v
  end;
  return v;
end $$;

create or replace function public._raise_violations(v text[])
returns void language plpgsql as $$
begin
  if cardinality(v) > 0 then
    raise exception '%', array_to_string(v, E'\n');
  end if;
end $$;

-- =====================================================================
-- API richieste (chiamate dall'app via RPC)
-- =====================================================================
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
  p_note        text default null
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
      perform public._raise_violations(public._simulate(r));
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
    perform public._raise_violations(public._simulate(r));
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
  perform public._raise_violations(public._simulate(r));
  update public.requests set target_id = me, status = 'pending_manager' where id = p_id returning * into r;
  return r;
end $$;

create or replace function public.request_cancel(p_id uuid)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_person_id();
  r  public.requests;
begin
  update public.requests set status = 'cancelled'
   where id = p_id and requester_id = me and status in ('pending_peer', 'open', 'pending_manager')
  returning * into r;
  if r.id is null then raise exception 'Richiesta non annullabile'; end if;
  return r;
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
  if r.kind <> 'time_off' and r.target_id is null then
    return '{}';
  end if;
  return public._simulate(r);
end $$;

create or replace function public.request_decide(p_id uuid, p_approve boolean, p_note text default null)
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
    perform public._raise_violations(v);   -- annulla tutto se ci sono violazioni
  end if;

  update public.requests
     set status = case when p_approve then 'approved'::public.request_status else 'rejected'::public.request_status end,
         decided_by = me, decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = p_id returning * into r;
  return r;
end $$;

-- =====================================================================
-- API pianificazione (solo manager)
-- =====================================================================

-- Salvataggio in blocco dalla timeline.
-- payload: { "upserts": [{id, person_id, activity_id, starts_at, ends_at, note, version?}],
--            "deletes": [{id, version?}] }
-- "version" = updated_at letto dal client: se nel frattempo un altro manager
-- ha modificato lo stesso blocco, il salvataggio viene rifiutato.
create or replace function public.save_schedule(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me   uuid := public.current_person_id();
  it   jsonb;
  n_up int := 0;
  n_in int := 0;
  n_del int := 0;
  affected uuid[] := '{}';
  pid  uuid;
begin
  if not public.is_manager() then raise exception 'Solo i manager possono modificare i turni'; end if;

  for it in select * from jsonb_array_elements(coalesce(payload -> 'deletes', '[]')) loop
    delete from public.events
     where id = (it ->> 'id')::uuid
       and (it ->> 'version' is null or updated_at = (it ->> 'version')::timestamptz)
    returning person_id into pid;
    if not found then
      if exists (select 1 from public.events where id = (it ->> 'id')::uuid) then
        raise exception 'Un altro manager ha modificato questi turni nel frattempo. Ricarica la pagina.';
      end if;
    else
      n_del := n_del + 1;
      affected := affected || pid;
    end if;
  end loop;

  for it in select * from jsonb_array_elements(coalesce(payload -> 'upserts', '[]')) loop
    if exists (select 1 from public.events where id = (it ->> 'id')::uuid) then
      -- persona precedente (per notifiche)
      select person_id into pid from public.events where id = (it ->> 'id')::uuid;
      affected := affected || pid;
      update public.events
         set person_id   = (it ->> 'person_id')::uuid,
             activity_id = (it ->> 'activity_id')::uuid,
             starts_at   = (it ->> 'starts_at')::timestamptz,
             ends_at     = (it ->> 'ends_at')::timestamptz,
             note        = nullif(it ->> 'note', '')
       where id = (it ->> 'id')::uuid
         and (it ->> 'version' is null or updated_at = (it ->> 'version')::timestamptz);
      if not found then
        raise exception 'Un altro manager ha modificato questi turni nel frattempo. Ricarica la pagina.';
      end if;
      n_up := n_up + 1;
    else
      insert into public.events (id, person_id, activity_id, starts_at, ends_at, note, source, created_by)
      values (coalesce((it ->> 'id')::uuid, gen_random_uuid()),
              (it ->> 'person_id')::uuid, (it ->> 'activity_id')::uuid,
              (it ->> 'starts_at')::timestamptz, (it ->> 'ends_at')::timestamptz,
              nullif(it ->> 'note', ''), coalesce(it ->> 'source', 'manual'), me);
      n_in := n_in + 1;
    end if;
    affected := affected || (it ->> 'person_id')::uuid;
  end loop;

  return jsonb_build_object(
    'inserted', n_in, 'updated', n_up, 'deleted', n_del,
    'affected', (select coalesce(jsonb_agg(distinct x), '[]') from unnest(affected) x)
  );
end $$;

create or replace function public.publish_week(p_week date, p_publish boolean default true)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_person_id();
  wk date := date_trunc('week', p_week)::date;
begin
  if not public.is_manager() then raise exception 'Solo i manager possono pubblicare'; end if;
  if p_publish then
    insert into public.schedule_weeks (week_start, published_by) values (wk, me)
    on conflict (week_start) do update set published_at = now(), published_by = me;
  else
    delete from public.schedule_weeks where week_start = wk;
  end if;
  return (select coalesce(array_agg(distinct person_id), '{}') from public.events
          where starts_at >= public.day_start(wk) and starts_at < public.day_start(wk + 7));
end $$;

-- Copia una settimana su un'altra (orari locali, corretto anche col cambio ora legale)
create or replace function public.copy_week(p_src date, p_dst date, p_replace boolean default true)
returns int language plpgsql security definer set search_path = public as $$
declare
  me  uuid := public.current_person_id();
  tz  text := (public.app_settings()).timezone;
  src date := date_trunc('week', p_src)::date;
  dst date := date_trunc('week', p_dst)::date;
  n   int;
begin
  if not public.is_manager() then raise exception 'Solo i manager possono copiare i turni'; end if;
  if src = dst then raise exception 'Scegli una settimana diversa'; end if;
  perform set_config('app.bulk', 'on', true);
  if p_replace then
    delete from public.events
     where starts_at >= public.day_start(dst) and starts_at < public.day_start(dst + 7)
       and person_id in (select id from public.people where active);
  end if;
  insert into public.events (person_id, activity_id, starts_at, ends_at, note, source, created_by)
  select e.person_id, e.activity_id,
         ((e.starts_at at time zone tz) + (dst - src) * interval '1 day') at time zone tz,
         ((e.ends_at   at time zone tz) + (dst - src) * interval '1 day') at time zone tz,
         e.note, 'copy', me
  from public.events e
  join public.people p on p.id = e.person_id and p.active
  where e.starts_at >= public.day_start(src) and e.starts_at < public.day_start(src + 7);
  get diagnostics n = row_count;
  perform set_config('app.bulk', 'off', true);
  insert into public.audit_log (actor_id, entity, action, summary)
  values (me, 'events', 'copy_week',
          format('Copiata la settimana del %s su quella del %s (%s blocchi)',
                 to_char(src, 'DD/MM'), to_char(dst, 'DD/MM'), n));
  return n;
end $$;

-- Import da Excel (già interpretato e collegato dal client).
-- payload: {
--   replace: bool, from_date: 'YYYY-MM-DD', to_date: 'YYYY-MM-DD', file_name: text,
--   people_create:  [{key, full_name}],
--   people_alias:   [{person_id, alias}],
--   activity_create:[{key, name, kind, color}],
--   activity_alias: [{activity_id, alias}],
--   rows: [{person_id | person_key, activity_id | activity_key, starts_at, ends_at, note?}]
-- }
create or replace function public.import_schedule(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me        uuid := public.current_person_id();
  it        jsonb;
  pmap      jsonb := '{}';
  amap      jsonb := '{}';
  nid       uuid;
  n_people  int := 0;
  n_ins     int := 0;
  n_del     int := 0;
  persons   uuid[];
  d_from    date := (payload ->> 'from_date')::date;
  d_to      date := (payload ->> 'to_date')::date;
begin
  if not public.is_manager() then raise exception 'Solo i manager possono importare'; end if;
  if d_from is null or d_to is null or d_to < d_from then raise exception 'Intervallo date non valido'; end if;

  perform set_config('app.bulk', 'on', true);

  for it in select * from jsonb_array_elements(coalesce(payload -> 'people_create', '[]')) loop
    insert into public.people (full_name) values (trim(it ->> 'full_name')) returning id into nid;
    pmap := pmap || jsonb_build_object(it ->> 'key', nid);
    n_people := n_people + 1;
  end loop;

  for it in select * from jsonb_array_elements(coalesce(payload -> 'people_alias', '[]')) loop
    update public.people
       set aliases = array(select distinct x from unnest(aliases || (it ->> 'alias')) x)
     where id = (it ->> 'person_id')::uuid
       and public.norm_name(full_name) <> public.norm_name(it ->> 'alias');
  end loop;

  for it in select * from jsonb_array_elements(coalesce(payload -> 'activity_create', '[]')) loop
    insert into public.activity_types (name, kind, color, sort_order)
    values (trim(it ->> 'name'), coalesce((it ->> 'kind')::public.activity_kind, 'work'),
            coalesce(it ->> 'color', '#5d7686'),
            (select coalesce(max(sort_order), 0) + 10 from public.activity_types))
    on conflict (lower(name)) do update set archived = false
    returning id into nid;
    amap := amap || jsonb_build_object(it ->> 'key', nid);
  end loop;

  for it in select * from jsonb_array_elements(coalesce(payload -> 'activity_alias', '[]')) loop
    update public.activity_types
       set aliases = array(select distinct x from unnest(aliases || lower(trim(it ->> 'alias'))) x)
     where id = (it ->> 'activity_id')::uuid;
  end loop;

  create temporary table _imp (
    person_id uuid, activity_id uuid, starts_at timestamptz, ends_at timestamptz, note text
  ) on commit drop;

  insert into _imp
  select coalesce((r ->> 'person_id')::uuid, (pmap ->> (r ->> 'person_key'))::uuid),
         coalesce((r ->> 'activity_id')::uuid, (amap ->> (r ->> 'activity_key'))::uuid),
         (r ->> 'starts_at')::timestamptz, (r ->> 'ends_at')::timestamptz,
         nullif(r ->> 'note', '')
  from jsonb_array_elements(coalesce(payload -> 'rows', '[]')) r;

  if exists (select 1 from _imp where person_id is null or activity_id is null) then
    raise exception 'Alcune righe non sono collegate a una persona o a un''attività';
  end if;

  select array_agg(distinct person_id) into persons from _imp;

  if coalesce((payload ->> 'replace')::boolean, true) then
    delete from public.events
     where person_id = any (persons)
       and starts_at >= public.day_start(d_from) and starts_at < public.day_start(d_to + 1);
    get diagnostics n_del = row_count;
  end if;

  insert into public.events (person_id, activity_id, starts_at, ends_at, note, source, created_by)
  select person_id, activity_id, starts_at, ends_at, note, 'import', me from _imp;
  get diagnostics n_ins = row_count;

  perform set_config('app.bulk', 'off', true);

  insert into public.audit_log (actor_id, entity, action, summary)
  values (me, 'events', 'import',
          format('Import "%s": %s blocchi dal %s al %s (%s sostituiti, %s nuove persone)',
                 coalesce(payload ->> 'file_name', 'Excel'), n_ins,
                 to_char(d_from, 'DD/MM'), to_char(d_to, 'DD/MM'), n_del, n_people));

  return jsonb_build_object('inserted', n_ins, 'deleted', n_del, 'people_created', n_people,
                            'persons', to_jsonb(persons));
end $$;

-- =====================================================================
-- Sicurezza: Row Level Security
-- =====================================================================
alter table public.settings           enable row level security;
alter table public.people             enable row level security;
alter table public.activity_types     enable row level security;
alter table public.schedule_weeks     enable row level security;
alter table public.events             enable row level security;
alter table public.requests           enable row level security;
alter table public.notifications      enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.audit_log          enable row level security;

create policy settings_read  on public.settings for select to authenticated using (public.is_member());
create policy settings_write on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy people_read on public.people for select to authenticated
  using (public.is_member() and (active or public.is_manager()) or user_id = auth.uid());
create policy people_insert on public.people for insert to authenticated with check (public.is_manager());
create policy people_update on public.people for update to authenticated
  using (public.is_manager() or user_id = auth.uid())
  with check (public.is_manager() or user_id = auth.uid());

create policy activity_read  on public.activity_types for select to authenticated using (public.is_member());
create policy activity_write on public.activity_types for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy weeks_read  on public.schedule_weeks for select to authenticated using (public.is_member());
create policy weeks_write on public.schedule_weeks for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy events_read on public.events for select to authenticated
  using (public.is_manager() or (public.is_member() and public.week_published(starts_at)));
create policy events_write on public.events for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy requests_read on public.requests for select to authenticated
  using (public.is_manager()
         or requester_id = public.current_person_id()
         or target_id = public.current_person_id()
         or (status = 'open' and public.is_member()));

create policy notifications_own on public.notifications for select to authenticated
  using (person_id = public.current_person_id());
create policy notifications_own_upd on public.notifications for update to authenticated
  using (person_id = public.current_person_id()) with check (person_id = public.current_person_id());

create policy push_own on public.push_subscriptions for all to authenticated
  using (person_id = public.current_person_id()) with check (person_id = public.current_person_id());

create policy audit_read on public.audit_log for select to authenticated using (public.is_manager());

-- Le funzioni interne non sono richiamabili dal client
revoke execute on function public._apply_request(public.requests) from public, anon, authenticated;
revoke execute on function public._simulate(public.requests)      from public, anon, authenticated;
revoke execute on function public.link_user(uuid)                 from public, anon, authenticated;
revoke execute on function public.handle_new_user()               from public, anon, authenticated;
revoke execute on function public.rest_violations(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.rest_violations(uuid, timestamptz, timestamptz) from authenticated;
revoke execute on function public.day_event_ids(uuid, date) from public, anon, authenticated;
revoke execute on function public.app_settings() from public, anon;
grant  execute on function public.app_settings() to authenticated;
