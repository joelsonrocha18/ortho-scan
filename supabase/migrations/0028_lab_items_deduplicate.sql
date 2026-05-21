-- Clean active duplicate LAB orders and add guards for the duplicate paths.
do $$
begin
  if to_regclass('public.lab_items') is null then
    return;
  end if;

  with keyed as (
    select
      id,
      case
        when coalesce(data->>'requestKind', 'producao') = 'producao'
          and coalesce(data->>'requestCode', '') !~ '/[0-9]+$'
          and coalesce(data->>'reworkOfCaseId', '') = ''
          and coalesce(data->>'reworkOfLabOrderId', '') = ''
          and coalesce(data->>'reworkOfTrayNumber', '') = ''
          then concat_ws('|',
            'base-production',
            case_id::text,
            coalesce(data->>'requestCode', ''),
            coalesce(product_id, product_type, data->>'productId', data->>'productType', '')
          )
        when coalesce(data->>'requestKind', 'producao') = 'producao'
          and (
            coalesce(data->>'reworkOfCaseId', '') <> ''
            or coalesce(data->>'reworkOfLabOrderId', '') <> ''
            or coalesce(data->>'reworkOfTrayNumber', '') <> ''
          )
          then concat_ws('|',
            'rework-production',
            case_id::text,
            coalesce(tray_number::text, data->>'trayNumber', ''),
            coalesce(data->>'arch', 'ambos'),
            coalesce(product_id, product_type, data->>'productId', data->>'productType', ''),
            coalesce(data->>'reworkOfCaseId', ''),
            coalesce(data->>'reworkOfLabOrderId', ''),
            coalesce(data->>'reworkOfTrayNumber', '')
          )
        when coalesce(data->>'requestKind', 'producao') = 'reposicao_programada'
          then concat_ws('|',
            'programmed-replenishment',
            case_id::text,
            coalesce(tray_number::text, data->>'trayNumber', ''),
            coalesce(data->>'expectedReplacementDate', data->>'dueDate', ''),
            coalesce(data->>'arch', 'ambos'),
            coalesce(product_id, product_type, data->>'productId', data->>'productType', '')
          )
        else concat_ws('|',
          coalesce(data->>'requestKind', 'producao'),
          case_id::text,
          coalesce(tray_number::text, data->>'trayNumber', ''),
          coalesce(data->>'expectedReplacementDate', data->>'dueDate', ''),
          coalesce(data->>'arch', 'ambos'),
          coalesce(product_id, product_type, data->>'productId', data->>'productType', ''),
          coalesce(data->>'requestCode', ''),
          coalesce(data->>'reworkOfCaseId', ''),
          coalesce(data->>'reworkOfLabOrderId', ''),
          coalesce(data->>'reworkOfTrayNumber', '')
        )
      end as dedupe_key
    from public.lab_items
    where deleted_at is null
      and case_id is not null
  ),
  ranked as (
    select
      lab.id,
      row_number() over (
        partition by keyed.dedupe_key
        order by
          case when coalesce(data->>'deliveredToProfessionalAt', '') <> '' then 1 else 0 end desc,
          case status
            when 'prontas' then 4
            when 'controle_qualidade' then 3
            when 'em_producao' then 2
            else 1
          end desc,
          case
            when
              (case when (data->>'plannedUpperQty') ~ '^-?[0-9]+([.][0-9]+)?$' then (data->>'plannedUpperQty')::numeric else 0 end) +
              (case when (data->>'plannedLowerQty') ~ '^-?[0-9]+([.][0-9]+)?$' then (data->>'plannedLowerQty')::numeric else 0 end) > 0
            then 1
            else 0
          end desc,
          created_at asc,
          updated_at desc,
          lab.id asc
      ) as duplicate_rank
    from public.lab_items lab
    inner join keyed on keyed.id = lab.id
  )
  update public.lab_items as lab
  set
    deleted_at = now(),
    updated_at = now(),
    data = jsonb_set(
      lab.data,
      '{duplicateCleanup}',
      jsonb_build_object(
        'deletedAt', now(),
        'reason', 'active duplicate LAB order',
        'migration', '0028_lab_items_deduplicate'
      ),
      true
    )
  from ranked
  where lab.id = ranked.id
    and ranked.duplicate_rank > 1;
end $$;

create unique index if not exists idx_lab_items_active_programmed_replenishment_unique
on public.lab_items (
  case_id,
  (coalesce(tray_number::text, data->>'trayNumber', '')),
  (coalesce(data->>'expectedReplacementDate', data->>'dueDate', '')),
  (coalesce(data->>'arch', 'ambos')),
  (coalesce(product_id, product_type, data->>'productId', data->>'productType', ''))
)
where deleted_at is null
  and case_id is not null
  and coalesce(data->>'requestKind', 'producao') = 'reposicao_programada';

create unique index if not exists idx_lab_items_active_base_production_unique
on public.lab_items (
  case_id,
  (coalesce(data->>'requestCode', '')),
  (coalesce(product_id, product_type, data->>'productId', data->>'productType', ''))
)
where deleted_at is null
  and case_id is not null
  and coalesce(data->>'requestKind', 'producao') = 'producao'
  and coalesce(data->>'reworkOfCaseId', '') = ''
  and coalesce(data->>'reworkOfLabOrderId', '') = ''
  and coalesce(data->>'reworkOfTrayNumber', '') = ''
  and coalesce(data->>'requestCode', '') !~ '/[0-9]+$';
