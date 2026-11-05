-- =====================================================================
-- Turni · 0006
-- Cambio turno: mostra tutti i colleghi con un turno, anche chi non ha
-- ancora fatto il primo accesso (prima venivano esclusi e la lista era vuota).
-- Da eseguire nel SQL Editor DOPO 0005.
-- =====================================================================

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
    select e.person_id as pid, p.full_name as pname, (p.user_id is not null) as reg, (e.starts_at at time zone tz)::date as d,
           min(e.starts_at) filter (where a.kind <> 'absence') as s,
           max(e.ends_at) filter (where a.kind <> 'absence') as en,
           jsonb_agg(jsonb_build_object('s', e.starts_at, 'e', e.ends_at, 'name', a.name, 'color', a.color, 'kind', a.kind)
                     order by e.starts_at) as bl
    from public.events e
    join public.activity_types a on a.id = e.activity_id
    join public.people p on p.id = e.person_id and p.active and p.id <> me
    where e.starts_at >= public.day_start(greatest(p_from, today)) and e.starts_at < public.day_start(p_to + 1)
      and public.week_published(e.starts_at)
    group by e.person_id, p.full_name, p.user_id, (e.starts_at at time zone tz)::date
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
    if not c.reg then
      issues := coalesce(issues, '{}') || (c.pname || ' non è ancora entrato nel sito: vedrà la richiesta al primo accesso');
    end if;

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

notify pgrst, 'reload schema';
