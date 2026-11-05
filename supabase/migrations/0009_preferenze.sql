-- =====================================================================
-- Turni · 0009
-- Preferenze più ricche: mattina, chiusura voluta, ufficio/smart nel giorno,
-- turni a settimana, sabato scelto, weekend "solo se serve", finestra di
-- ingresso, pranzo fisso, alternative ("il 15, altrimenti il 5").
-- Da eseguire nel SQL Editor DOPO 0008.
-- =====================================================================

alter table public.gen_preferences drop constraint if exists gen_preferences_kind_check;
alter table public.gen_preferences add constraint gen_preferences_kind_check check (kind in (
  'off', 'start_after', 'end_by', 'no_close', 'no_open', 'shift', 'no_weekend', 'note',
  'morning', 'want_close', 'week_shift', 'sat_pick', 'weekend_ok', 'start_window', 'lunch_at', 'place'));

alter table public.gen_preferences
  add column if not exists place   text check (place in ('office', 'remote')),
  add column if not exists alt_for uuid references public.gen_preferences (id) on delete set null;

-- una frase può diventare più vincoli: il limite di 3 vale sulle frasi scritte
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
  if tg_op = 'INSERT' and (select count(distinct text) from public.gen_preferences
                           where person_id = new.person_id and month = new.month and source = 'operator' and text <> new.text) >= 3 then
    raise exception 'Puoi indicare al massimo 3 preferenze al mese';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
