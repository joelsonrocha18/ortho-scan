create table if not exists public.agenda_eventos (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics(id),
  titulo text not null,
  tipo text not null check (tipo in ('escaneamento', 'planejamento')),
  inicio timestamptz not null,
  fim timestamptz not null,
  id_profissional uuid references public.dentists(id),
  id_paciente uuid references public.patients(id),
  observacoes text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint agenda_eventos_periodo_valido check (fim > inicio)
);

create index if not exists idx_agenda_eventos_inicio_fim
  on public.agenda_eventos(inicio, fim)
  where deleted_at is null;

create index if not exists idx_agenda_eventos_clinic_inicio
  on public.agenda_eventos(clinic_id, inicio)
  where deleted_at is null;

create index if not exists idx_agenda_eventos_profissional_inicio
  on public.agenda_eventos(id_profissional, inicio)
  where deleted_at is null;

create index if not exists idx_agenda_eventos_paciente_inicio
  on public.agenda_eventos(id_paciente, inicio)
  where deleted_at is null;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_agenda_eventos_updated_at') then
    create trigger trg_agenda_eventos_updated_at
      before update on public.agenda_eventos
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.agenda_eventos enable row level security;

drop policy if exists "agenda_eventos_select_scope" on public.agenda_eventos;
create policy "agenda_eventos_select_scope"
on public.agenda_eventos for select
using (
  public.app_is_master()
  or clinic_id = public.app_current_clinic_id()
  or (
    public.app_current_role() = 'dentist_client'
    and id_profissional = (select dentist_id from public.profiles where user_id = auth.uid())
  )
);

drop policy if exists "agenda_eventos_insert_internal" on public.agenda_eventos;
create policy "agenda_eventos_insert_internal"
on public.agenda_eventos for insert
with check (
  public.app_is_master()
  or (
    public.app_current_role() in ('dentist_admin', 'receptionist')
    and (
      clinic_id is null
      or clinic_id = public.app_current_clinic_id()
      or public.app_current_clinic_id() is null
    )
  )
);

drop policy if exists "agenda_eventos_update_internal" on public.agenda_eventos;
create policy "agenda_eventos_update_internal"
on public.agenda_eventos for update
using (
  public.app_is_master()
  or (
    public.app_current_role() in ('dentist_admin', 'receptionist')
    and (
      clinic_id is null
      or clinic_id = public.app_current_clinic_id()
      or public.app_current_clinic_id() is null
    )
  )
)
with check (
  public.app_is_master()
  or (
    public.app_current_role() in ('dentist_admin', 'receptionist')
    and (
      clinic_id is null
      or clinic_id = public.app_current_clinic_id()
      or public.app_current_clinic_id() is null
    )
  )
);

drop policy if exists "agenda_eventos_delete_internal" on public.agenda_eventos;
create policy "agenda_eventos_delete_internal"
on public.agenda_eventos for delete
using (
  public.app_is_master()
  or (
    public.app_current_role() in ('dentist_admin', 'receptionist')
    and (
      clinic_id is null
      or clinic_id = public.app_current_clinic_id()
      or public.app_current_clinic_id() is null
    )
  )
);

do $$
begin
  if to_regclass('public.permissions') is not null then
    insert into public.permissions (key, label, module) values
      ('agenda.read', 'Visualizar agenda', 'Agenda'),
      ('agenda.write', 'Criar/editar agenda', 'Agenda')
    on conflict (key) do update
    set label = excluded.label,
        module = excluded.module;
  end if;

  if to_regclass('public.profile_permissions') is not null then
    insert into public.profile_permissions (role, permission_id)
    select 'master_admin'::app_role, p.id
    from public.permissions p
    where p.key in ('agenda.read', 'agenda.write')
    on conflict do nothing;

    insert into public.profile_permissions (role, permission_id)
    select 'dentist_admin'::app_role, p.id
    from public.permissions p
    where p.key in ('agenda.read', 'agenda.write')
    on conflict do nothing;

    insert into public.profile_permissions (role, permission_id)
    select 'receptionist'::app_role, p.id
    from public.permissions p
    where p.key in ('agenda.read', 'agenda.write')
    on conflict do nothing;
  end if;
end $$;
