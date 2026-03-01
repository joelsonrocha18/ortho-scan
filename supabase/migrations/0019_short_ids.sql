-- Friendly short IDs for operational entities.

create sequence if not exists public.short_cli_seq start 1;
create sequence if not exists public.short_den_seq start 1;
create sequence if not exists public.short_pac_seq start 1;
create sequence if not exists public.short_lab_seq start 1;
create sequence if not exists public.short_col_seq start 1;
create sequence if not exists public.short_case_seq start 1;

alter table if exists public.clinics add column if not exists short_id text;
alter table if exists public.dentists add column if not exists short_id text;
alter table if exists public.patients add column if not exists short_id text;
alter table if exists public.cases add column if not exists short_id text;
alter table if exists public.profiles add column if not exists short_id text;

create or replace function public.assign_short_id_clinic()
returns trigger
language plpgsql
as $$
begin
  if new.short_id is null or btrim(new.short_id) = '' then
    new.short_id := 'CLI-' || lpad(nextval('public.short_cli_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace function public.assign_short_id_dentist()
returns trigger
language plpgsql
as $$
begin
  if new.short_id is null or btrim(new.short_id) = '' then
    new.short_id := 'DEN-' || lpad(nextval('public.short_den_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace function public.assign_short_id_patient()
returns trigger
language plpgsql
as $$
begin
  if new.short_id is null or btrim(new.short_id) = '' then
    new.short_id := 'PAC-' || lpad(nextval('public.short_pac_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace function public.assign_short_id_profile()
returns trigger
language plpgsql
as $$
declare
  clinic_code text;
  clinic_seq int;
begin
  if new.short_id is not null and btrim(new.short_id) <> '' then
    return new;
  end if;

  if new.role = 'lab_tech' then
    new.short_id := 'LAB-' || lpad(nextval('public.short_lab_seq')::text, 3, '0');
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
  clinic_seq := (
    select coalesce(count(1), 0) + 1
    from public.profiles p
    where p.clinic_id = new.clinic_id
      and p.short_id like 'COL-' || clinic_code || '-%'
  );
  new.short_id := 'COL-' || clinic_code || '-' || lpad(clinic_seq::text, 2, '0');
  return new;
end;
$$;

create or replace function public.assign_short_id_case()
returns trigger
language plpgsql
as $$
declare
  clinic_code text;
  suffix text;
begin
  if new.short_id is not null and btrim(new.short_id) <> '' then
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
  suffix := upper(lpad(to_hex(nextval('public.short_case_seq')), 4, '0'));
  new.short_id := 'CAS-' || clinic_code || '-' || suffix;
  return new;
end;
$$;

drop trigger if exists trg_short_id_clinic on public.clinics;
create trigger trg_short_id_clinic
before insert on public.clinics
for each row execute function public.assign_short_id_clinic();

drop trigger if exists trg_short_id_dentist on public.dentists;
create trigger trg_short_id_dentist
before insert on public.dentists
for each row execute function public.assign_short_id_dentist();

drop trigger if exists trg_short_id_patient on public.patients;
create trigger trg_short_id_patient
before insert on public.patients
for each row execute function public.assign_short_id_patient();

drop trigger if exists trg_short_id_profile on public.profiles;
create trigger trg_short_id_profile
before insert on public.profiles
for each row execute function public.assign_short_id_profile();

drop trigger if exists trg_short_id_case on public.cases;
create trigger trg_short_id_case
before insert on public.cases
for each row execute function public.assign_short_id_case();

update public.clinics set short_id = 'CLI-' || lpad(nextval('public.short_cli_seq')::text, 4, '0')
where short_id is null or btrim(short_id) = '';

update public.dentists set short_id = 'DEN-' || lpad(nextval('public.short_den_seq')::text, 4, '0')
where short_id is null or btrim(short_id) = '';

update public.patients set short_id = 'PAC-' || lpad(nextval('public.short_pac_seq')::text, 4, '0')
where short_id is null or btrim(short_id) = '';

update public.profiles p
set short_id = case
  when p.role = 'lab_tech' then 'LAB-' || lpad(nextval('public.short_lab_seq')::text, 3, '0')
  else
    'COL-' ||
    coalesce(
      (select regexp_replace(c.short_id, '[^A-Za-z0-9]', '', 'g') from public.clinics c where c.id = p.clinic_id),
      'CLI0000'
    ) ||
    '-' ||
    lpad(nextval('public.short_col_seq')::text, 2, '0')
end
where p.short_id is null or btrim(p.short_id) = '';

update public.cases cs
set short_id = 'CAS-' ||
  coalesce(
    (select regexp_replace(c.short_id, '[^A-Za-z0-9]', '', 'g') from public.clinics c where c.id = cs.clinic_id),
    'CLI0000'
  ) ||
  '-' ||
  upper(lpad(to_hex(nextval('public.short_case_seq')), 4, '0'))
where cs.short_id is null or btrim(cs.short_id) = '';

create unique index if not exists idx_clinics_short_id_unique on public.clinics (short_id);
create unique index if not exists idx_dentists_short_id_unique on public.dentists (short_id);
create unique index if not exists idx_patients_short_id_unique on public.patients (short_id);
create unique index if not exists idx_cases_short_id_unique on public.cases (short_id);
create unique index if not exists idx_profiles_short_id_unique on public.profiles (short_id);
