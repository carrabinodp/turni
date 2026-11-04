-- =====================================================================
-- Turni · 0002
-- Tipi di giornata (Ufficio / Smart working…), colori Excel ricordati,
-- regole delle pause, assenze e scambi inseriti direttamente dal manager.
-- Da eseguire nel SQL Editor DOPO 0001_init.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipi di giornata
-- ---------------------------------------------------------------------
create table public.day_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  color       text not null default '#e8eefc' check (color ~ '^#[0-9a-fA-F]{6}$'),
  aliases     text[] not null default '{}',
  sort_order  int not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index day_types_name_uq on public.day_types (lower(name));

insert into public.day_types (name, color, aliases, sort_order) values
  ('Ufficio',        '#e3ecff', '{ufficio,presenza,sede,lavorativo}', 10),
  ('Smart working',  '#fff27a', '{smart,sw,smart working,remoto,casa}', 20),
  ('Da verificare',  '#b7dee8', '{da verificare,da confermare,da verificare/confermare}', 30);

-- Tipo di giornata assegnato a una persona in un giorno
create table public.day_marks (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.people (id) on delete cascade,
  day          date not null,
  day_type_id  uuid not null references public.day_types (id) on delete cascade,
  note         text,
  updated_at   timestamptz not null default now(),
  unique (person_id, day)
);
create index day_marks_day_idx on public.day_marks (day);

create trigger day_marks_touch before update on public.day_marks
  for each row execute function public.touch_updated_at();
create trigger day_marks_audit after insert or update or delete on public.day_marks
  for each row execute function public.audit_trg();

-- ---------------------------------------------------------------------
-- Colori delle celle Excel già abbinati (ricordati tra un import e l'altro)
-- ---------------------------------------------------------------------
create table public.import_color_map (
  fill         text primary key check (fill ~ '^[0-9A-F]{6}$'),
  target       text not null check (target in ('activity', 'day_type', 'ignore', 'skip')),
  activity_id  uuid references public.activity_types (id) on delete cascade,
  day_type_id  uuid references public.day_types (id) on delete cascade,
  label        text,
  updated_at   timestamptz not null default now(),
  check ((target = 'activity') = (activity_id is not null)),
  check ((target = 'day_type') = (day_type_id is not null))
);

-- ---------------------------------------------------------------------
-- Regole delle pause automatiche
-- Ogni regola: per turni di almeno min_shift_hours ore, una pausa di
-- duration_minutes a offset_minutes dall'inizio ("start") o dalla fine ("end").
-- ---------------------------------------------------------------------
alter table public.settings
  add column break_rules jsonb not null default
    '[{"min_shift_hours":6,"from":"start","offset_minutes":120,"duration_minutes":15},
      {"min_shift_hours":6,"from":"end","offset_minutes":120,"duration_minutes":15}]'::jsonb,
  add column break_activity_id uuid references public.activity_types (id) on delete set null;

update public.settings
   set break_activity_id = (select id from public.activity_types where name = 'Pausa' limit 1)
 where id = 1;

-- ---------------------------------------------------------------------
-- Sicurezza
-- ---------------------------------------------------------------------
alter table public.day_types        enable row level security;
alter table public.day_marks        enable row level security;
alter table public.import_color_map enable row level security;

create policy day_types_read  on public.day_types for select to authenticated using (public.is_member());
create policy day_types_write on public.day_types for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy day_marks_read on public.day_marks for select to authenticated
  using (public.is_manager() or (public.is_member() and public.week_published(public.day_start(day))));
create policy day_marks_write on public.day_marks for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy color_map_all on public.import_color_map for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- =====================================================================
-- Tipi di giornata dalla timeline
-- marks: [{person_id, day: 'YYYY-MM-DD', day_type_id | null}]  (null = togli)
-- =====================================================================
create or replace function public.save_day_marks(marks jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  n  int := 0;
begin
  if not public.is_manager() then raise exception 'Solo i manager possono modificare le giornate'; end if;
  for it in select * from jsonb_array_elements(coalesce(marks, '[]')) loop
    if it ->> 'day_type_id' is null then
      delete from public.day_marks
       where person_id = (it ->> 'person_id')::uuid and day = (it ->> 'day')::date;
    else
      insert into public.day_marks (person_id, day, day_type_id)
      values ((it ->> 'person_id')::uuid, (it ->> 'day')::date, (it ->> 'day_type_id')::uuid)
      on conflict (person_id, day) do update set day_type_id = excluded.day_type_id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- =====================================================================
-- Scambio / spostamento deciso direttamente dal manager
-- Se il collega non lavora quel giorno, il turno viene spostato a lui.
-- p_force = true applica anche se viola il riposo minimo.
-- =====================================================================
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

  -- anche il tipo di giornata segue il turno
  if r.kind = 'swap' then
    update public.day_marks set person_id = case when person_id = p_person_a then p_person_b else p_person_a end
     where (person_id = p_person_a and day = p_day_a) or (person_id = p_person_b and day = p_day_b);
  else
    delete from public.day_marks where person_id = p_person_b and day = p_day_a;
    update public.day_marks set person_id = p_person_b where person_id = p_person_a and day = p_day_a;
  end if;

  insert into public.requests values (r.*) returning * into r;
  return r;
end $$;

-- =====================================================================
-- Assenza inserita direttamente dal manager (ferie, permesso, malattia…)
-- =====================================================================
create or replace function public.manager_time_off(
  p_person uuid, p_from date, p_to date, p_activity uuid,
  p_time_from time default null, p_time_to time default null, p_note text default null
) returns public.requests
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_person_id();
  r  public.requests;
begin
  if not public.is_manager() then raise exception 'Solo i manager possono inserire assenze'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Date non valide'; end if;
  if p_to - p_from > 90 then raise exception 'Massimo 90 giorni alla volta'; end if;
  if (p_time_from is null) <> (p_time_to is null) then raise exception 'Indica sia l''ora di inizio che di fine'; end if;
  if not exists (select 1 from public.activity_types where id = p_activity and kind = 'absence') then
    raise exception 'Scegli un tipo di assenza';
  end if;

  r.id := gen_random_uuid();
  r.kind := 'time_off';
  r.status := 'approved';
  r.requester_id := p_person;
  r.from_date := p_from;
  r.to_date := p_to;
  r.time_from := p_time_from;
  r.time_to := p_time_to;
  r.activity_id := p_activity;
  r.note := nullif(trim(p_note), '');
  r.decided_by := me;
  r.decided_at := now();
  r.decision_note := 'Inserito dal manager';
  r.created_at := now();
  r.updated_at := now();

  perform public._apply_request(r);
  insert into public.requests values (r.*) returning * into r;
  return r;
end $$;

-- =====================================================================
-- Import: ora gestisce anche i tipi di giornata.
-- In più rispetto a 0001:
--   day_type_create: [{key, name, color}]
--   marks: [{person_id | person_key, day, day_type_id | day_type_key}]
-- =====================================================================
create or replace function public.import_schedule(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me        uuid := public.current_person_id();
  it        jsonb;
  pmap      jsonb := '{}';
  amap      jsonb := '{}';
  dmap      jsonb := '{}';
  nid       uuid;
  n_people  int := 0;
  n_ins     int := 0;
  n_del     int := 0;
  n_marks   int := 0;
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

  for it in select * from jsonb_array_elements(coalesce(payload -> 'day_type_create', '[]')) loop
    insert into public.day_types (name, color, sort_order)
    values (trim(it ->> 'name'), coalesce(it ->> 'color', '#e8eefc'),
            (select coalesce(max(sort_order), 0) + 10 from public.day_types))
    on conflict (lower(name)) do update set archived = false
    returning id into nid;
    dmap := dmap || jsonb_build_object(it ->> 'key', nid);
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

  create temporary table _marks (person_id uuid, day date, day_type_id uuid) on commit drop;
  insert into _marks
  select distinct on (1, 2)
         coalesce((m ->> 'person_id')::uuid, (pmap ->> (m ->> 'person_key'))::uuid),
         (m ->> 'day')::date,
         coalesce((m ->> 'day_type_id')::uuid, (dmap ->> (m ->> 'day_type_key'))::uuid)
  from jsonb_array_elements(coalesce(payload -> 'marks', '[]')) m;
  delete from _marks where person_id is null or day_type_id is null;

  select array_agg(distinct x) into persons
  from (select person_id as x from _imp union select person_id from _marks) s;

  if coalesce((payload ->> 'replace')::boolean, true) then
    delete from public.events
     where person_id = any (persons)
       and starts_at >= public.day_start(d_from) and starts_at < public.day_start(d_to + 1);
    get diagnostics n_del = row_count;
    delete from public.day_marks
     where person_id = any (persons) and day between d_from and d_to;
  end if;

  insert into public.events (person_id, activity_id, starts_at, ends_at, note, source, created_by)
  select person_id, activity_id, starts_at, ends_at, note, 'import', me from _imp;
  get diagnostics n_ins = row_count;

  insert into public.day_marks (person_id, day, day_type_id)
  select person_id, day, day_type_id from _marks
  on conflict (person_id, day) do update set day_type_id = excluded.day_type_id;
  get diagnostics n_marks = row_count;

  perform set_config('app.bulk', 'off', true);

  insert into public.audit_log (actor_id, entity, action, summary)
  values (me, 'events', 'import',
          format('Import "%s": %s blocchi dal %s al %s (%s sostituiti, %s nuove persone, %s giornate segnate)',
                 coalesce(payload ->> 'file_name', 'Excel'), n_ins,
                 to_char(d_from, 'DD/MM'), to_char(d_to, 'DD/MM'), n_del, n_people, n_marks));

  return jsonb_build_object('inserted', n_ins, 'deleted', n_del, 'people_created', n_people,
                            'marks', n_marks, 'persons', to_jsonb(persons));
end $$;

-- La copia settimana porta con sé anche i tipi di giornata
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
    delete from public.day_marks
     where day between dst and dst + 6 and person_id in (select id from public.people where active);
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
  insert into public.day_marks (person_id, day, day_type_id)
  select m.person_id, m.day + (dst - src), m.day_type_id
  from public.day_marks m join public.people p on p.id = m.person_id and p.active
  where m.day between src and src + 6
  on conflict (person_id, day) do update set day_type_id = excluded.day_type_id;
  perform set_config('app.bulk', 'off', true);
  insert into public.audit_log (actor_id, entity, action, summary)
  values (me, 'events', 'copy_week',
          format('Copiata la settimana del %s su quella del %s (%s blocchi)',
                 to_char(src, 'DD/MM'), to_char(dst, 'DD/MM'), n));
  return n;
end $$;
