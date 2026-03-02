create or replace function public.assign_short_id_profile()
returns trigger
language plpgsql
as $$
declare
  clinic_code text;
  candidate text;
begin
  if new.short_id is not null and btrim(new.short_id) <> '' then
    return new;
  end if;

  if new.role = 'lab_tech' then
    loop
      candidate := 'LAB-' || lpad(nextval('public.short_lab_seq')::text, 3, '0');
      exit when not exists (select 1 from public.profiles where short_id = candidate);
    end loop;
    new.short_id := candidate;
    return new;
  end if;

  clinic_code := coalesce(
    (
      select regexp_replace(c.short_id, '[^A-Za-z0-9]', '', 'g')
      from public.clinics c
      where c.id = new.clinic_id
    ),
    'CLI0000'
  );

  loop
    candidate := 'COL-' || clinic_code || '-' || lpad(nextval('public.short_col_seq')::text, 4, '0');
    exit when not exists (select 1 from public.profiles where short_id = candidate);
  end loop;

  new.short_id := candidate;
  return new;
end;
$$;

