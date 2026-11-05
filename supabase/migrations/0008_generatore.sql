-- =====================================================================
-- Turni · 0008
-- Generatore di turni: profilo di ogni persona (durata del turno, giorni a
-- settimana), regole del team, preferenze mensili degli operatori e
-- salvataggio della bozza nelle settimane non pubblicate.
-- Da eseguire nel SQL Editor DOPO 0007.
-- =====================================================================

alter table public.people
  add column if not exists shift_hours   numeric(4,1) check (shift_hours between 1 and 13),
  add column if not exists days_per_week smallint check (days_per_week between 1 and 7),
  add column if not exists gen_exclude   boolean not null default false,   -- non entra nel generatore (es. maternità, responsabili)
  add column if not exists can_weekend   boolean not null default true;

-- solo i responsabili cambiano il profilo del generatore
create or replace function public.people_gen_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.system', true), '') <> 'on' and not public.is_manager() then
    new.shift_hours := old.shift_hours;
    new.days_per_week := old.days_per_week;
    new.gen_exclude := old.gen_exclude;
    new.can_weekend := old.can_weekend;
  end if;
  return new;
end $$;
drop trigger if exists people_gen_guard on public.people;
create trigger people_gen_guard before update on public.people
  for each row execute function public.people_gen_guard();

alter table public.settings add column if not exists generator jsonb not null default '{}'::jsonb;

-- Preferenze del mese: scritte dall'operatore (testo libero) e tradotte in vincolo dal responsabile
create table if not exists public.gen_preferences (
  id          uuid primary key default gen_random_uuid(),
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  person_id   uuid not null references public.people (id) on delete cascade,
  text        text not null check (length(trim(text)) between 1 and 300),
  kind        text not null default 'note'
              check (kind in ('off', 'start_after', 'end_by', 'no_close', 'no_open', 'shift', 'no_weekend', 'note')),
  day         date,
  weekday     smallint check (weekday between 1 and 7),
  time_a      time,
  time_b      time,
  source      text not null default 'operator' check (source in ('operator', 'manager')),
  reviewed    boolean not null default false,  -- il responsabile ha controllato il vincolo
  created_by  uuid references public.people (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists gen_preferences_month_idx on public.gen_preferences (month, person_id);
drop trigger if exists gen_preferences_touch on public.gen_preferences;
create trigger gen_preferences_touch before update on public.gen_preferences
  for each row execute function public.touch_updated_at();

-- l'operatore può scriverne al massimo 3 al mese, per il mese in corso o i successivi
create or replace function public.gen_preferences_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cur text := to_char((now() at time zone (public.app_settings()).timezone)::date, 'YYYY-MM');
begin
  if public.is_manager() then return new; end if;
  if new.person_id <> public.current_person_id() then raise exception 'Puoi indicare solo le tue preferenze'; end if;
  if new.month < cur then raise exception 'Il mese è già passato'; end if;
  if tg_op = 'UPDATE' and old.reviewed then raise exception 'Preferenza già vista dal responsabile: chiedigli di modificarla'; end if;
  new.source := 'operator';
  new.reviewed := false;
  new.kind := coalesce(new.kind, 'note');
  if tg_op = 'INSERT' and (select count(*) from public.gen_preferences
                           where person_id = new.person_id and month = new.month and source = 'operator') >= 3 then
    raise exception 'Puoi indicare al massimo 3 preferenze al mese';
  end if;
  return new;
end $$;
drop trigger if exists gen_preferences_guard on public.gen_preferences;
create trigger gen_preferences_guard before insert or update on public.gen_preferences
  for each row execute function public.gen_preferences_guard();

alter table public.gen_preferences enable row level security;
create policy gen_pref_read on public.gen_preferences for select to authenticated
  using (public.is_manager() or person_id = public.current_person_id());
create policy gen_pref_insert on public.gen_preferences for insert to authenticated
  with check (public.is_manager() or person_id = public.current_person_id());
create policy gen_pref_update on public.gen_preferences for update to authenticated
  using (public.is_manager() or (person_id = public.current_person_id() and not reviewed))
  with check (public.is_manager() or person_id = public.current_person_id());
create policy gen_pref_delete on public.gen_preferences for delete to authenticated
  using (public.is_manager() or (person_id = public.current_person_id() and not reviewed));

-- Regole del generatore (tutti i responsabili)
create or replace function public.save_generator_config(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Solo i responsabili'; end if;
  update public.settings set generator = coalesce(p, '{}'::jsonb) where id = 1;
end $$;

-- Profili delle persone per il generatore
create or replace function public.save_generator_profiles(p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_manager() then raise exception 'Solo i responsabili'; end if;
  update public.people pe
     set shift_hours = nullif(x ->> 'shift_hours', '')::numeric,
         days_per_week = nullif(x ->> 'days_per_week', '')::smallint,
         gen_exclude = coalesce((x ->> 'gen_exclude')::boolean, false),
         can_weekend = coalesce((x ->> 'can_weekend')::boolean, true)
    from jsonb_array_elements(p) x
   where pe.id = (x ->> 'id')::uuid;
  get diagnostics n = row_count;
  return n;
end $$;

-- Salva la bozza generata: sostituisce turni e pause (non le assenze) delle
-- persone indicate nel periodo, solo in settimane non pubblicate.
create or replace function public.generator_save(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me      uuid := public.current_person_id();
  d_from  date := (payload ->> 'from_date')::date;
  d_to    date := (payload ->> 'to_date')::date;
  persons uuid[];
  w       date;
  n_del   int := 0;
  n_ins   int := 0;
  n_mk    int := 0;
begin
  if not public.is_manager() then raise exception 'Solo i responsabili'; end if;
  if d_from is null or d_to is null or d_to < d_from or d_to - d_from > 45 then raise exception 'Periodo non valido'; end if;
  w := public.week_of(public.day_start(d_from));
  while w <= d_to loop
    if exists (select 1 from public.schedule_weeks where week_start = w) then
      raise exception 'La settimana del % è pubblicata: ritirala dalla timeline prima di sostituirla', to_char(w, 'DD/MM');
    end if;
    w := w + 7;
  end loop;
  select array_agg((x #>> '{}')::uuid) into persons from jsonb_array_elements(coalesce(payload -> 'persons', '[]')) x;
  if persons is null then raise exception 'Nessuna persona'; end if;

  perform set_config('app.bulk', 'on', true);

  delete from public.events e
   using public.activity_types a
   where a.id = e.activity_id and a.kind <> 'absence'
     and e.person_id = any (persons)
     and e.starts_at >= public.day_start(d_from) and e.starts_at < public.day_start(d_to + 1);
  get diagnostics n_del = row_count;
  delete from public.day_marks where person_id = any (persons) and day between d_from and d_to;

  insert into public.events (person_id, activity_id, starts_at, ends_at, note, source, created_by)
  select (r ->> 'person_id')::uuid, (r ->> 'activity_id')::uuid, (r ->> 'starts_at')::timestamptz,
         (r ->> 'ends_at')::timestamptz, nullif(r ->> 'note', ''), 'generator', me
    from jsonb_array_elements(coalesce(payload -> 'rows', '[]')) r
   where (r ->> 'person_id')::uuid = any (persons)
     and (r ->> 'starts_at')::timestamptz >= public.day_start(d_from)
     and (r ->> 'starts_at')::timestamptz < public.day_start(d_to + 1);
  get diagnostics n_ins = row_count;

  insert into public.day_marks (person_id, day, day_type_id)
  select (m ->> 'person_id')::uuid, (m ->> 'day')::date, (m ->> 'day_type_id')::uuid
    from jsonb_array_elements(coalesce(payload -> 'marks', '[]')) m
   where (m ->> 'person_id')::uuid = any (persons) and (m ->> 'day')::date between d_from and d_to
  on conflict (person_id, day) do update set day_type_id = excluded.day_type_id;
  get diagnostics n_mk = row_count;

  perform set_config('app.bulk', 'off', true);

  insert into public.audit_log (actor_id, entity, action, summary)
  values (me, 'events', 'generator',
          format('Turni generati dal %s al %s: %s blocchi (%s sostituiti), %s giornate ufficio/smart',
                 to_char(d_from, 'DD/MM'), to_char(d_to, 'DD/MM'), n_ins, n_del, n_mk));
  return jsonb_build_object('inserted', n_ins, 'deleted', n_del, 'marks', n_mk);
end $$;

revoke all on function public.generator_save(jsonb) from public, anon;
revoke all on function public.save_generator_config(jsonb) from public, anon;
revoke all on function public.save_generator_profiles(jsonb) from public, anon;
grant execute on function public.generator_save(jsonb) to authenticated;
grant execute on function public.save_generator_config(jsonb) to authenticated;
grant execute on function public.save_generator_profiles(jsonb) to authenticated;

notify pgrst, 'reload schema';
