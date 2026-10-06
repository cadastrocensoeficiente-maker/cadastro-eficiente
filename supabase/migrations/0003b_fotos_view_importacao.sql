-- =====================================================================
-- CADASTRO EFICIENTE — 0003b FOTOS, VIEW, IMPORTAÇÃO, POLÍTICAS DE LEITURA/ESCRITA
-- Fotos: binário no Cloudflare R2; aqui só metadados.
-- Chave no R2: contratos/{contract_id}/pontos/{point_id}/{arquivo}
-- =====================================================================

create table public.point_photos (
  id             uuid primary key default gen_random_uuid(),
  point_id       uuid not null references public.points(id) on delete cascade,
  contract_id    uuid not null references public.contracts(id) on delete cascade,
  r2_key         text not null unique,
  nome_arquivo   text,
  content_type   text not null default 'image/jpeg',
  tamanho_bytes  bigint,
  largura        integer,
  altura         integer,
  latitude       double precision,
  longitude      double precision,
  ordem          integer not null default 0,
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint point_photos_key_format check (r2_key like 'contratos/' || contract_id::text || '/pontos/' || point_id::text || '/%')
);
alter table public.point_photos enable row level security;
create index point_photos_point_idx on public.point_photos (point_id, ordem, created_at);

create or replace function private.point_photos_check_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select contract_id into new.contract_id from public.points where id = new.point_id;
  if new.contract_id is null then
    raise exception 'Ponto não encontrado.' using errcode = 'foreign_key_violation';
  end if;
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end;
$$;

create trigger point_photos_check_contract
  before insert on public.point_photos
  for each row execute function private.point_photos_check_contract();

-- Colunas sistêmicas prontas: ID, TMX, TMY, LINK_FOTOS
create or replace view public.points_view
with (security_invoker = true)
as
select
  p.id,
  p.contract_id,
  p.seq,
  p.codigo                                                           as "ID",
  p.valores,
  p.tmx                                                              as "TMX",
  p.tmy                                                              as "TMY",
  '/contratos/' || p.contract_id || '/pontos/' || p.id || '/fotos'   as "LINK_FOTOS",
  (select count(*) from public.point_photos f where f.point_id = p.id)::int as total_fotos,
  p.latitude,
  p.longitude,
  p.precisao_m,
  p.capturado_em,
  p.origem_coord,
  p.created_by,
  p.created_at,
  p.updated_at
from public.points p;

-- Importação em lote (admin). ID nunca vem da planilha.
-- Item: { "valores": {column_id: valor}, "latitude"?, "longitude"?, "tmx"?, "tmy"? }
-- TMX/TMY sem lat/long -> convertidos para lat/long e recalculados pela regra.
create or replace function public.points_import(p_contract uuid, p_rows jsonb)
returns table (inseridos integer, sem_coordenada integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_epsg  integer;
  v_item  jsonb;
  v_lat   double precision;
  v_lon   double precision;
  v_geo   record;
  v_ins   integer := 0;
  v_nocoord integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem importar bases.' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Formato inválido: esperado uma lista de linhas.' using errcode = 'check_violation';
  end if;
  select epsg into v_epsg from public.contracts where id = p_contract;
  if v_epsg is null then
    raise exception 'Contrato não encontrado.' using errcode = 'no_data_found';
  end if;
  for v_item in select value from jsonb_array_elements(p_rows) loop
    v_lat := nullif(replace(v_item->>'latitude', ',', '.'), '')::double precision;
    v_lon := nullif(replace(v_item->>'longitude', ',', '.'), '')::double precision;
    if (v_lat is null or v_lon is null)
       and nullif(v_item->>'tmx', '') is not null and nullif(v_item->>'tmy', '') is not null then
      select * into v_geo from public.coord_from_projected(
        replace(v_item->>'tmx', ',', '.')::double precision,
        replace(v_item->>'tmy', ',', '.')::double precision,
        v_epsg);
      v_lat := v_geo.latitude;
      v_lon := v_geo.longitude;
    end if;
    if v_lat is null or v_lon is null then
      v_lat := null; v_lon := null;
      v_nocoord := v_nocoord + 1;
    end if;
    insert into public.points (contract_id, latitude, longitude, origem_coord, valores)
    values (p_contract, v_lat, v_lon, 'importacao', coalesce(v_item->'valores', '{}'::jsonb));
    v_ins := v_ins + 1;
  end loop;
  return query select v_ins, v_nocoord;
end;
$$;

-- POLÍTICAS (admin: tudo | cadastrador: pontos e fotos | visualizador: leitura)
create policy profiles_select on public.profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy profiles_admin_update on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy contracts_select on public.contracts
  for select to authenticated using (true);
create policy contracts_admin_insert on public.contracts
  for insert to authenticated with check (public.is_admin());
create policy contracts_admin_update on public.contracts
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- contract_columns: só leitura; escrita exclusivamente pelas funções col_*
create policy contract_columns_select on public.contract_columns
  for select to authenticated using (true);

create policy points_select on public.points
  for select to authenticated using (true);
create policy points_insert on public.points
  for insert to authenticated with check (public.can_edit_points());
create policy points_update on public.points
  for update to authenticated using (public.can_edit_points()) with check (public.can_edit_points());

create policy point_photos_select on public.point_photos
  for select to authenticated using (true);
create policy point_photos_insert on public.point_photos
  for insert to authenticated with check (public.can_edit_points());
