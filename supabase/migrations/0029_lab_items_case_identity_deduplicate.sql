do $$
begin
  if to_regclass('public.lab_items') is null then
    return;
  end if;

  with recursive base as (
    select
      lab.id,
      coalesce(lab.product_id, lab.product_type, lab.data->>'productId', lab.data->>'productType', '') as product_key,
      nullif(lab.case_id::text, '') as case_key,
      nullif(lab.data->>'requestCode', '') as request_key,
      nullif(case_row.data->>'treatmentCode', '') as treatment_key
    from public.lab_items lab
    left join public.cases case_row on case_row.id = lab.case_id
    where lab.deleted_at is null
      and coalesce(lab.data->>'requestKind', 'producao') = 'producao'
      and coalesce(lab.data->>'requestCode', '') !~ '/[0-9]+$'
      and coalesce(lab.data->>'reworkOfCaseId', '') = ''
      and coalesce(lab.data->>'reworkOfLabOrderId', '') = ''
      and coalesce(lab.data->>'reworkOfTrayNumber', '') = ''
  ),
  aliases as (
    select id, product_key, 'case:' || case_key as alias_key
    from base
    where case_key is not null

    union

    select id, product_key, 'request:' || request_key as alias_key
    from base
    where request_key is not null

    union

    select id, product_key, 'request:' || treatment_key as alias_key
    from base
    where treatment_key is not null

    union

    select id, product_key, 'order:' || id::text as alias_key
    from base
    where case_key is null
      and request_key is null
      and treatment_key is null
  ),
  edges as (
    select distinct
      left_alias.product_key,
      left_alias.id,
      right_alias.id as linked_id
    from aliases left_alias
    inner join aliases right_alias
      on right_alias.product_key = left_alias.product_key
     and right_alias.alias_key = left_alias.alias_key
  ),
  walk(product_key, id, linked_id) as (
    select product_key, id, linked_id
    from edges

    union

    select walk.product_key, walk.id, edges.linked_id
    from walk
    inner join edges
      on edges.product_key = walk.product_key
     and edges.id = walk.linked_id
  ),
  groups as (
    select
      product_key,
      id,
      min(linked_id::text) as group_id
    from walk
    group by product_key, id
  ),
  ranked as (
    select
      lab.id,
      row_number() over (
        partition by groups.product_key, groups.group_id
        order by
          case when lab.case_id is not null then 1 else 0 end desc,
          case when coalesce(lab.data->>'deliveredToProfessionalAt', '') <> '' then 1 else 0 end desc,
          case lab.status
            when 'prontas' then 4
            when 'controle_qualidade' then 3
            when 'em_producao' then 2
            else 1
          end desc,
          case
            when
              (case when (lab.data->>'plannedUpperQty') ~ '^-?[0-9]+([.][0-9]+)?$' then (lab.data->>'plannedUpperQty')::numeric else 0 end) +
              (case when (lab.data->>'plannedLowerQty') ~ '^-?[0-9]+([.][0-9]+)?$' then (lab.data->>'plannedLowerQty')::numeric else 0 end) > 0
            then 1
            else 0
          end desc,
          lab.created_at asc,
          lab.updated_at desc,
          lab.id asc
      ) as duplicate_rank
    from public.lab_items lab
    inner join groups on groups.id = lab.id
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
        'reason', 'active duplicate base LAB production order by case identity',
        'migration', '0029_lab_items_case_identity_deduplicate'
      ),
      true
    )
  from ranked
  where lab.id = ranked.id
    and ranked.duplicate_rank > 1;
end $$;

drop index if exists public.idx_lab_items_active_base_production_unique;

create unique index if not exists idx_lab_items_active_base_production_unique
on public.lab_items (
  case_id,
  (coalesce(product_id, product_type, data->>'productId', data->>'productType', ''))
)
where deleted_at is null
  and case_id is not null
  and coalesce(data->>'requestKind', 'producao') = 'producao'
  and coalesce(data->>'reworkOfCaseId', '') = ''
  and coalesce(data->>'reworkOfLabOrderId', '') = ''
  and coalesce(data->>'reworkOfTrayNumber', '') = ''
  and coalesce(data->>'requestCode', '') !~ '/[0-9]+$';
