-- =====================================================================
-- CADASTRO EFICIENTE — 0002b FUNÇÕES DE COLUNAS (único caminho de escrita)
-- Auxiliares ficam no schema "private", que não é exposto pela API.
-- =====================================================================

create schema if not exists private;

-- Recalcula a sequência inteira do contrato (1..N) mantendo a ordem atual.
create or replace function private.col_renumber(p_contract uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.contract_columns c
     set position = r.rn
    from (
      select id, row_number() over (order by position, created_at, id) as rn
        from public.contract_columns
       where contract_id = p_contract
    ) r
   where c.id = r.id
     and c.position <> r.rn;
$$;

-- Trava o contrato durante a alteração (evita corrida entre dois admins).
create or replace function private.col_lock_contract(p_contract uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.contracts where id = p_contract for update;
  if not found then
    raise exception 'Contrato não encontrado.' using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function private.col_require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem alterar a estrutura de colunas.'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Criar coluna. p_position nulo = no final; fora do intervalo é ajustada.
create or replace function public.col_add(
  p_contract  uuid,
  p_label     text,
  p_type      text default 'texto',
  p_required  boolean default false,
  p_options   jsonb default '[]'::jsonb,
  p_position  integer default null
)
returns public.contract_columns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text := public.col_normalize_name(p_label);
  v_count integer;
  v_pos   integer;
  v_row   public.contract_columns;
begin
  perform private.col_require_admin();
  perform private.col_lock_contract(p_contract);
  if v_name is null then
    raise exception 'Informe um nome para a coluna.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.contract_columns where contract_id = p_contract and name = v_name) then
    raise exception 'Já existe a coluna % neste contrato.', v_name using errcode = 'unique_violation';
  end if;
  select count(*) into v_count from public.contract_columns where contract_id = p_contract;
  v_pos := least(greatest(coalesce(p_position, v_count + 1), 1), v_count + 1);
  update public.contract_columns
     set position = position + 1
   where contract_id = p_contract and position >= v_pos;
  insert into public.contract_columns (contract_id, name, label, type, required, options, position)
  values (p_contract, v_name, upper(trim(p_label)), coalesce(p_type, 'texto'), coalesce(p_required, false),
          coalesce(p_options, '[]'::jsonb), v_pos)
  returning * into v_row;
  perform private.col_renumber(p_contract);
  return v_row;
end;
$$;

-- Mover uma coluna (arrastar e soltar).
create or replace function public.col_move(p_column uuid, p_new_position integer)
returns setof public.contract_columns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract uuid;
  v_old      integer;
  v_count    integer;
  v_new      integer;
begin
  perform private.col_require_admin();
  select contract_id into v_contract from public.contract_columns where id = p_column;
  if v_contract is null then
    raise exception 'Coluna não encontrada.' using errcode = 'no_data_found';
  end if;
  perform private.col_lock_contract(v_contract);
  select position into v_old from public.contract_columns where id = p_column;
  select count(*) into v_count from public.contract_columns where contract_id = v_contract;
  v_new := least(greatest(coalesce(p_new_position, v_old), 1), v_count);
  if v_new < v_old then
    update public.contract_columns set position = position + 1
     where contract_id = v_contract and position >= v_new and position < v_old;
  elsif v_new > v_old then
    update public.contract_columns set position = position - 1
     where contract_id = v_contract and position > v_old and position <= v_new;
  end if;
  update public.contract_columns set position = v_new where id = p_column;
  perform private.col_renumber(v_contract);
  return query select * from public.contract_columns where contract_id = v_contract order by position;
end;
$$;

-- Reordenar tudo: recebe a lista completa de IDs na nova ordem.
create or replace function public.col_reorder(p_contract uuid, p_ordered_ids uuid[])
returns setof public.contract_columns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count    integer;
  v_received integer;
  v_matched  integer;
begin
  perform private.col_require_admin();
  perform private.col_lock_contract(p_contract);
  select count(*) into v_count from public.contract_columns where contract_id = p_contract;
  v_received := coalesce(array_length(p_ordered_ids, 1), 0);
  select count(distinct c.id) into v_matched
    from public.contract_columns c
   where c.contract_id = p_contract and c.id = any(p_ordered_ids);
  if v_received <> v_count or v_matched <> v_count then
    raise exception 'A nova ordem precisa conter exatamente as % colunas do contrato, sem repetição (recebidas %).', v_count, v_received
      using errcode = 'check_violation';
  end if;
  update public.contract_columns c
     set position = o.ord
    from unnest(p_ordered_ids) with ordinality as o(id, ord)
   where c.id = o.id and c.contract_id = p_contract;
  return query select * from public.contract_columns where contract_id = p_contract order by position;
end;
$$;

-- Editar rótulo/tipo/obrigatoriedade/opções. Posição só por col_move/col_reorder.
create or replace function public.col_update(
  p_column   uuid,
  p_label    text default null,
  p_type     text default null,
  p_required boolean default null,
  p_options  jsonb default null
)
returns public.contract_columns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.contract_columns;
  v_name text;
begin
  perform private.col_require_admin();
  select * into v_row from public.contract_columns where id = p_column;
  if v_row.id is null then
    raise exception 'Coluna não encontrada.' using errcode = 'no_data_found';
  end if;
  perform private.col_lock_contract(v_row.contract_id);
  if p_label is not null then
    v_name := public.col_normalize_name(p_label);
    if v_name is null then
      raise exception 'Informe um nome para a coluna.' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.contract_columns
                where contract_id = v_row.contract_id and name = v_name and id <> p_column) then
      raise exception 'Já existe a coluna % neste contrato.', v_name using errcode = 'unique_violation';
    end if;
  end if;
  update public.contract_columns
     set label    = coalesce(upper(trim(p_label)), label),
         name     = coalesce(v_name, name),
         type     = coalesce(p_type, type),
         required = coalesce(p_required, required),
         options  = coalesce(p_options, options)
   where id = p_column
   returning * into v_row;
  return v_row;
end;
$$;

-- Copiar a estrutura de outro contrato (destino precisa estar vazio).
create or replace function public.col_copy_from(p_target uuid, p_source uuid)
returns setof public.contract_columns
language plpgsql
security definer
set search_path = public
as $$
begin
  perform private.col_require_admin();
  perform private.col_lock_contract(p_target);
  if exists (select 1 from public.contract_columns where contract_id = p_target) then
    raise exception 'O contrato de destino já possui colunas. Remova-as antes de copiar.' using errcode = 'check_violation';
  end if;
  insert into public.contract_columns (contract_id, name, label, type, required, options, position)
  select p_target, name, label, type, required, options, position
    from public.contract_columns where contract_id = p_source;
  perform private.col_renumber(p_target);
  return query select * from public.contract_columns where contract_id = p_target order by position;
end;
$$;

-- LAYOUT OFICIAL — fonte única da ordem para tela, exportação,
-- importação e app de campo:  ID · configuráveis 1..N · TMX · TMY · LINK_FOTOS
create or replace function public.contract_layout(p_contract uuid)
returns table (
  ordem       integer,
  chave       text,
  rotulo      text,
  sistema     boolean,
  sequencia   integer,
  column_id   uuid,
  tipo        text,
  obrigatoria boolean,
  opcoes      jsonb
)
language sql stable
security invoker
set search_path = public
as $$
  with cfg as (
    select * from public.contract_columns where contract_id = p_contract
  ), n as (select count(*)::int as total from cfg)
  select 1, 'ID', 'ID', true, null::int, null::uuid, 'sistema', true, '[]'::jsonb
  union all
  select 1 + c.position, c.name, c.label, false, c.position, c.id, c.type, c.required, c.options from cfg c
  union all
  select 2 + n.total, 'TMX', 'TMX', true, null, null, 'sistema', true, '[]'::jsonb from n
  union all
  select 3 + n.total, 'TMY', 'TMY', true, null, null, 'sistema', true, '[]'::jsonb from n
  union all
  select 4 + n.total, 'LINK_FOTOS', 'LINK_FOTOS', true, null, null, 'sistema', true, '[]'::jsonb from n
  order by 1;
$$;
