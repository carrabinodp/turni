-- =====================================================================
-- Turni · 0005
-- Forecast: totali delle chiamate per mezz'ora (nessun dato su operatori o
-- numeri di telefono), registro dei caricamenti, impostazioni del forecast.
-- Da eseguire nel SQL Editor DOPO 0004.
-- =====================================================================

create table if not exists public.call_intervals (
  day              date not null,
  slot             smallint not null check (slot between 0 and 47),  -- mezz'ora locale: 0 = 00:00, 18 = 09:00
  queue            text not null default '',
  offered          int not null default 0,
  answered         int not null default 0,
  abandoned        int not null default 0,
  short_abandoned  int not null default 0,   -- riattaccate entro 5 secondi
  ans_10           int not null default 0,   -- risposte entro 10 / 20 / 30 / 60 / 120 secondi
  ans_20           int not null default 0,
  ans_30           int not null default 0,
  ans_60           int not null default 0,
  ans_120          int not null default 0,
  wait_sum_sec     bigint not null default 0,  -- attesa totale delle chiamate risposte
  handle_sum_sec   bigint not null default 0,  -- durata totale (conversazione + post-chiamata)
  primary key (day, slot, queue)
);
create index if not exists call_intervals_day_idx on public.call_intervals (day);

create table if not exists public.call_uploads (
  id           uuid primary key default gen_random_uuid(),
  file_name    text,
  from_day     date not null,
  to_day       date not null,
  calls        int not null,
  queues       text[] not null default '{}',
  uploaded_by  uuid references public.people (id) on delete set null,
  uploaded_at  timestamptz not null default now()
);

alter table public.settings
  add column if not exists forecast_policy jsonb not null default
    '{"sl_target":80,"sl_seconds":20,"max_occupancy":85,"history_weeks":8}'::jsonb,
  add column if not exists forecast_activity_ids uuid[] not null default '{}';

-- attività che rispondono al telefono: di base quelle che si chiamano Telefono / Phone
update public.settings
   set forecast_activity_ids = (
     select coalesce(array_agg(id), '{}') from public.activity_types
      where kind = 'work' and (name ~* '(tel|phone)' or exists (select 1 from unnest(aliases) a where a ~* '(tel|phone)'))
   )
 where id = 1 and cardinality(forecast_activity_ids) = 0;

alter table public.call_intervals enable row level security;
alter table public.call_uploads   enable row level security;

create policy call_intervals_mgr on public.call_intervals for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy call_uploads_mgr on public.call_uploads for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- i responsabili (non solo l'amministratore) possono cambiare le impostazioni del forecast
create or replace function public.save_forecast_settings(p_policy jsonb, p_activities uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Solo i responsabili'; end if;
  update public.settings set forecast_policy = p_policy, forecast_activity_ids = coalesce(p_activities, '{}') where id = 1;
end $$;
revoke all on function public.save_forecast_settings(jsonb, uuid[]) from public, anon;
grant execute on function public.save_forecast_settings(jsonb, uuid[]) to authenticated;

notify pgrst, 'reload schema';
