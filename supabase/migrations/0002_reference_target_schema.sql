-- Reference schema proposed for a future migration phase.
-- This file is intentionally not compatible as a direct replacement for 0001_init.sql
-- because the current application still depends on legacy tables/columns (e.g. profiles,
-- clinics.trade_name, patients.primary_dentist_id).
--
-- Use this as the target contract for a phased migration plan.

-- ============================
-- EXTENSOES
-- ============================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================
-- ENUMS
-- ============================
do $$ begin
  create type app_role as enum (
    'master_admin',
    'dentist_admin',
    'dentist_client',
    'clinic_client',
    'lab_tech',
    'receptionist'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type scan_status as enum ('pendente', 'aprovado', 'reprovado', 'convertido');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type case_status as enum ('planejamento', 'em_producao', 'em_entrega', 'finalizado');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type case_phase as enum ('planejamento', 'orcamento', 'contrato', 'lab');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type lab_status as enum (
    'aguardando_iniciar',
    'em_producao',
    'controle_qualidade',
    'pronta',
    'entregue',
    'rework'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type arch_type as enum ('superior', 'inferior', 'ambos');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type doc_status as enum ('ok', 'erro');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type doc_category as enum (
    'scan_3d',
    'foto_intraoral',
    'foto_extraoral',
    'radiografia',
    'planejamento',
    'comprovante_entrega',
    'outros'
  );
exception when duplicate_object then null;
end $$;

-- ============================
-- TABELAS PRINCIPAIS
-- ============================
create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cnpj text,
  phone text,
  email text,
  address jsonb,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists dentists (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id),
  name text not null,
  gender text,
  cro text,
  phone text,
  whatsapp text,
  email text,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id),
  dentist_id uuid references dentists(id),
  name text not null,
  gender text,
  birth_date date,
  phone text,
  email text,
  notes text,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id),
  dentist_id uuid references dentists(id),
  patient_id uuid references patients(id),
  status scan_status default 'pendente',
  arch arch_type default 'ambos',
  complaint text,
  dentist_guidance text,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists cases (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id),
  dentist_id uuid references dentists(id),
  patient_id uuid references patients(id),
  scan_id uuid references scans(id),
  status case_status default 'planejamento',
  phase case_phase default 'planejamento',
  total_upper integer,
  total_lower integer,
  change_days integer,
  attachments boolean default false,
  contract_approved_at timestamptz,
  treatment_started_at timestamptz,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists lab_items (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id),
  clinic_id uuid references clinics(id),
  arch arch_type default 'ambos',
  plate_number integer,
  status lab_status default 'aguardando_iniciar',
  priority text,
  due_date date,
  notes text,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id),
  lab_item_id uuid references lab_items(id),
  delivered_at timestamptz not null,
  proof_document_id uuid,
  created_at timestamptz default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id),
  patient_id uuid references patients(id),
  case_id uuid references cases(id),
  scan_id uuid references scans(id),
  category doc_category,
  status doc_status default 'ok',
  description text,
  file_path text,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists user_roles (
  user_id uuid primary key,
  role app_role not null,
  clinic_id uuid,
  dentist_id uuid,
  created_at timestamptz default now()
);

-- ============================
-- RLS
-- ============================
alter table clinics enable row level security;
alter table dentists enable row level security;
alter table patients enable row level security;
alter table scans enable row level security;
alter table cases enable row level security;
alter table lab_items enable row level security;
alter table deliveries enable row level security;
alter table documents enable row level security;
alter table user_roles enable row level security;

-- ============================
-- FUNCOES AUXILIARES
-- ============================
create or replace function app_current_role()
returns app_role language sql stable as $$
  select role from user_roles where user_id = auth.uid();
$$;

create or replace function app_is_admin()
returns boolean language sql stable as $$
  select app_current_role() in ('master_admin','dentist_admin');
$$;

-- ============================
-- POLICIES (BASE)
-- ============================
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'clinics' and policyname = 'admins_full_access'
  ) then
    create policy "admins_full_access"
    on clinics for all
    using (app_is_admin());
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'dentists' and policyname = 'admins_full_access_dentists'
  ) then
    create policy "admins_full_access_dentists"
    on dentists for all
    using (app_is_admin());
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'patients' and policyname = 'admins_full_access_patients'
  ) then
    create policy "admins_full_access_patients"
    on patients for all
    using (app_is_admin());
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'scans' and policyname = 'admins_full_access_scans'
  ) then
    create policy "admins_full_access_scans"
    on scans for all
    using (app_is_admin());
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'cases' and policyname = 'admins_full_access_cases'
  ) then
    create policy "admins_full_access_cases"
    on cases for all
    using (app_is_admin());
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'lab_items' and policyname = 'lab_read_write'
  ) then
    create policy "lab_read_write"
    on lab_items
    for all
    using (app_current_role() in ('lab_tech','master_admin','dentist_admin'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'documents' and policyname = 'documents_access'
  ) then
    create policy "documents_access"
    on documents
    for all
    using (app_is_admin() or app_current_role() = 'dentist_client');
  end if;
end $$;
