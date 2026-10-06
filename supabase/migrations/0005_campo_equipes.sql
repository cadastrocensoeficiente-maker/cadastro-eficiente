-- =====================================================================
-- CADASTRO EFICIENTE — 0005 APP DE CAMPO E EQUIPES POR CONTRATO
--
-- * contract_members: o admin atribui cadastradores a contratos.
--   Remover = marcar ativo=false (histórico preservado).
-- * Políticas RESTRITIVAS: cadastrador só enxerga/grava nos contratos
--   atribuídos. Admin e visualizador (administrativo) veem tudo.
-- * points.client_uuid + campo_salvar_ponto(): envio idempotente do app
--   offline — reenviar o mesmo ponto nunca duplica.
-- =====================================================================

create table public.contract_members (
  contract_id  uuid not null references public.contracts(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  ativo        boolean not null default true,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (contract_id, user_id)
);
alter table public.contract_members enable row level security;
create index contract_members_user_idx on public.contract_members (user_id) where ativo;

create policy contract_members_select on public.contract_members
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

create or replace function public.my_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Admin e visualizador veem todos os contratos; cadastrador só os atribuídos.
create or replace function public.can_see_contract(p_contract uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case public.my_role()
    when 'admin' then true
    when 'visualizador' then true
    when 'cadastrador' then exists (
      select 1 from public.contract_members m
       where m.contract_id = p_contract and m.user_id = auth.uid() and m.ativo)
    else false
  end;
$$;

-- Políticas restritivas: somam-se (AND) às permissivas existentes.
create policy contracts_escopo on public.contracts
  as restrictive for select to authenticated using (public.can_see_contract(id));
create policy contract_columns_escopo on public.contract_columns
  as restrictive for select to authenticated using (public.can_see_contract(contract_id));
create policy points_escopo_select on public.points
  as restrictive for select to authenticated using (public.can_see_contract(contract_id));
create policy points_escopo_insert on public.points
  as restrictive for insert to authenticated with check (public.can_see_contract(contract_id));
create policy points_escopo_update on public.points
  as restrictive for update to authenticated using (public.can_see_contract(contract_id));
create policy point_photos_escopo_select on public.point_photos
  as restrictive for select to authenticated using (public.can_see_contract(contract_id));
create policy point_photos_escopo_insert on public.point_photos
  as restrictive for insert to authenticated with check (public.can_see_contract(contract_id));

-- Admin define a equipe de um contrato (ativar/desativar).
create or replace function public.membro_definir(p_contract uuid, p_user uuid, p_ativo boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente administradores definem equipes.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.contract_members (contract_id, user_id, ativo)
  values (p_contract, p_user, p_ativo)
  on conflict (contract_id, user_id)
  do update set ativo = excluded.ativo, updated_at = now();
end;
$$;

-- Lista de usuários com acesso para o admin montar equipes.
create or replace function public.equipe_do_contrato(p_contract uuid)
returns table (user_id uuid, nome text, email text, role text, membro boolean, pontos bigint)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.nome, p.email, p.role,
         coalesce(m.ativo, false),
         (select count(*) from public.points pt where pt.contract_id = p_contract and pt.created_by = p.id)
    from public.profiles p
    left join public.contract_members m on m.contract_id = p_contract and m.user_id = p.id
   where public.is_admin()
     and p.role in ('cadastrador', 'admin')
   order by coalesce(m.ativo, false) desc, p.nome;
$$;

-- ---------------------------------------------------------------------
-- APP DE CAMPO
-- ---------------------------------------------------------------------
alter table public.points add column client_uuid uuid;
create unique index points_client_uuid_key on public.points (client_uuid) where client_uuid is not null;

-- Contratos do usuário + definição proj4 do EPSG (para pré-visualizar TMX/TMY offline).
create or replace function public.campo_meus_contratos()
returns table (id uuid, nome text, municipio text, uf text, epsg integer, proj4 text, id_digitos integer)
language sql stable security definer
set search_path = public, extensions
as $$
  select c.id, c.nome, c.municipio, c.uf, c.epsg, s.proj4text::text, c.id_digitos
    from public.contracts c
    join extensions.spatial_ref_sys s on s.srid = c.epsg
   where c.ativo
     and public.my_role() in ('admin', 'cadastrador')
     and public.can_see_contract(c.id)
   order by c.nome;
$$;

-- Envio idempotente de um ponto cadastrado no app.
-- O ID operacional, TMX e TMY continuam sendo gerados pelo banco.
create or replace function public.campo_salvar_ponto(
  p_contract     uuid,
  p_client_uuid  uuid,
  p_latitude     double precision,
  p_longitude    double precision,
  p_precisao_m   numeric,
  p_capturado_em timestamptz,
  p_valores      jsonb
)
returns table (id uuid, codigo text, tmx numeric, tmy numeric, ja_existia boolean)
language plpgsql security definer
set search_path = public
as $$
declare
  v_row public.points;
begin
  if public.my_role() not in ('admin', 'cadastrador') then
    raise exception 'Seu perfil não pode cadastrar pontos.' using errcode = 'insufficient_privilege';
  end if;
  if not public.can_see_contract(p_contract) then
    raise exception 'Você não está atribuído a este contrato.' using errcode = 'insufficient_privilege';
  end if;
  if p_client_uuid is null then
    raise exception 'client_uuid obrigatório.' using errcode = 'check_violation';
  end if;

  select * into v_row from public.points p where p.client_uuid = p_client_uuid;
  if found then
    if v_row.contract_id <> p_contract then
      raise exception 'Identificador do envio já usado em outro contrato.' using errcode = 'unique_violation';
    end if;
    return query select v_row.id, v_row.codigo, v_row.tmx, v_row.tmy, true;
    return;
  end if;

  insert into public.points (contract_id, client_uuid, latitude, longitude, precisao_m, capturado_em, valores, origem_coord)
  values (p_contract, p_client_uuid, p_latitude, p_longitude, p_precisao_m, p_capturado_em, coalesce(p_valores, '{}'::jsonb), 'gps')
  returning * into v_row;

  return query select v_row.id, v_row.codigo, v_row.tmx, v_row.tmy, false;
end;
$$;

-- Produção do cadastrador (para o resumo do dia no app).
create or replace function public.campo_minha_producao(p_contract uuid)
returns table (hoje bigint, total bigint)
language sql stable security definer
set search_path = public
as $$
  select count(*) filter (where (created_at at time zone 'America/Fortaleza')::date = (now() at time zone 'America/Fortaleza')::date),
         count(*)
    from public.points
   where contract_id = p_contract and created_by = auth.uid();
$$;
