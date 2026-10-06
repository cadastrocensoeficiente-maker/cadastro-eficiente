-- =====================================================================
-- CADASTRO EFICIENTE — 0003 PONTOS E FOTOS
--
-- Colunas sistêmicas de um ponto:
--   ID          -> points.codigo (ID operacional, gerado aqui, nunca digitado)
--                  + points.id (UUID interno de integridade)
--   TMX / TMY   -> calculados AQUI a partir de latitude/longitude, no EPSG
--                  do contrato (PostGIS ST_Transform). Valores enviados pelo
--                  cliente são sempre descartados.
--   LINK_FOTOS  -> derivado: /contratos/{contract_id}/pontos/{point_id}/fotos
--                  (fotos no Cloudflare R2; aqui só metadados em point_photos)
-- Colunas configuráveis -> points.valores (jsonb { column_id: valor })
-- =====================================================================

create table public.points (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references public.contracts(id) on delete cascade,
  seq           bigint not null,
  codigo        text not null,
  latitude      double precision,
  longitude     double precision,
  precisao_m    numeric(8, 2),
  capturado_em  timestamptz,
  origem_coord  text not null default 'gps' check (origem_coord in ('gps', 'importacao', 'manual_admin')),
  tmx           numeric(14, 3),
  tmy           numeric(14, 3),
  geom          extensions.geometry(Point, 4326),
  valores       jsonb not null default '{}'::jsonb check (jsonb_typeof(valores) = 'object'),
  created_by    uuid references auth.users(id) default auth.uid(),
  updated_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint points_seq_unique unique (contract_id, seq),
  constraint points_codigo_unique unique (contract_id, codigo),
  constraint points_lat_range check (latitude is null or latitude between -90 and 90),
  constraint points_lon_range check (longitude is null or longitude between -180 and 180),
  constraint points_latlon_pair check ((latitude is null) = (longitude is null))
);

create index points_contract_seq_idx on public.points (contract_id, seq);
create index points_geom_idx on public.points using gist (geom);
create index points_valores_idx on public.points using gin (valores);

-- ---------------------------------------------------------------------
-- Conversão de coordenadas (usada pelo trigger e pela pré-visualização)
-- ---------------------------------------------------------------------
create or replace function public.coord_to_projected(p_lat double precision, p_lon double precision, p_epsg integer)
returns table (tmx numeric, tmy numeric)
language sql immutable
set search_path = public, extensions
as $$
  select round(extensions.st_x(g)::numeric, 3), round(extensions.st_y(g)::numeric, 3)
    from (select extensions.st_transform(extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326), p_epsg) as g) t;
$$;

create or replace function public.coord_from_projected(p_tmx double precision, p_tmy double precision, p_epsg integer)
returns table (latitude double precision, longitude double precision)
language sql immutable
set search_path = public, extensions
as $$
  select extensions.st_y(g), extensions.st_x(g)
    from (select extensions.st_transform(extensions.st_setsrid(extensions.st_makepoint(p_tmx, p_tmy), p_epsg), 4326) as g) t;
$$;

-- Pré-visualização para o app de campo: mostra TMX/TMY antes de salvar.
create or replace function public.preview_coordenada(p_contract uuid, p_lat double precision, p_lon double precision)
returns table (tmx numeric, tmy numeric, epsg integer)
language sql stable
set search_path = public
as $$
  select c2.tmx, c2.tmy, c.epsg
    from public.contracts c,
         lateral public.coord_to_projected(p_lat, p_lon, c.epsg) c2
   where c.id = p_contract;
$$;

-- ---------------------------------------------------------------------
-- Validação dos valores configuráveis contra a estrutura do contrato
-- ---------------------------------------------------------------------
create or replace function public.points_validate_valores(p_contract uuid, p_valores jsonb)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  v_key   text;
  v_val   jsonb;
  v_col   public.contract_columns;
  v_out   jsonb := '{}'::jsonb;
  v_txt   text;
begin
  for v_key, v_val in select key, value from jsonb_each(coalesce(p_valores, '{}'::jsonb)) loop
    select * into v_col from public.contract_columns
     where contract_id = p_contract and id::text = v_key;
    if v_col.id is null then
      raise exception 'Valor para coluna inexistente neste contrato (%).', v_key using errcode = 'check_violation';
    end if;

    -- vazio = remove a chave
    if v_val is null or v_val = 'null'::jsonb or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '') then
      continue;
    end if;

    v_txt := btrim(v_val #>> '{}');

    case v_col.type
      when 'numero' then
        begin
          v_val := to_jsonb(replace(v_txt, ',', '.')::numeric);
        exception when others then
          raise exception 'A coluna % aceita apenas números (recebido "%").', v_col.label, v_txt using errcode = 'check_violation';
        end;
      when 'inteiro' then
        begin
          v_val := to_jsonb(v_txt::bigint);
        exception when others then
          raise exception 'A coluna % aceita apenas números inteiros (recebido "%").', v_col.label, v_txt using errcode = 'check_violation';
        end;
      when 'data' then
        begin
          v_val := to_jsonb(to_char(v_txt::date, 'YYYY-MM-DD'));
        exception when others then
          raise exception 'A coluna % aceita apenas datas (recebido "%").', v_col.label, v_txt using errcode = 'check_violation';
        end;
      when 'booleano' then
        if lower(v_txt) in ('true', 'sim', 's', '1', 'yes') then v_val := 'true'::jsonb;
        elsif lower(v_txt) in ('false', 'nao', 'não', 'n', '0', 'no') then v_val := 'false'::jsonb;
        else
          raise exception 'A coluna % aceita apenas Sim/Não (recebido "%").', v_col.label, v_txt using errcode = 'check_violation';
        end if;
      when 'lista' then
        if jsonb_array_length(v_col.options) > 0
           and not exists (select 1 from jsonb_array_elements_text(v_col.options) o where upper(o) = upper(v_txt)) then
          raise exception 'Valor "%" não está entre as opções da coluna %.', v_txt, v_col.label using errcode = 'check_violation';
        end if;
        v_val := to_jsonb(v_txt);
      else
        v_val := to_jsonb(v_txt);
    end case;

    v_out := v_out || jsonb_build_object(v_key, v_val);
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------
-- Trigger principal dos pontos: ID, coordenadas e valores sob controle do sistema
-- ---------------------------------------------------------------------
create or replace function public.points_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_epsg   integer;
  v_digits integer;
  v_seq    bigint;
  v_proj   record;
begin
  select epsg, id_digitos into v_epsg, v_digits from public.contracts where id = new.contract_id;
  if v_epsg is null then
    raise exception 'Contrato não encontrado.' using errcode = 'foreign_key_violation';
  end if;

  if tg_op = 'INSERT' then
    -- ID operacional: sempre gerado aqui; qualquer valor enviado é ignorado.
    update public.contract_counters
       set ultimo_seq = ultimo_seq + 1
     where contract_id = new.contract_id
     returning ultimo_seq into v_seq;
    new.seq    := v_seq;
    new.codigo := lpad(v_seq::text, greatest(v_digits, length(v_seq::text)), '0');
    new.id     := coalesce(new.id, gen_random_uuid());
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    -- ID, UUID e contrato são imutáveis.
    new.id          := old.id;
    new.contract_id := old.contract_id;
    new.seq         := old.seq;
    new.codigo      := old.codigo;
    new.created_at  := old.created_at;
    new.created_by  := old.created_by;
    new.updated_by  := coalesce(auth.uid(), new.updated_by);
  end if;

  -- TMX/TMY: SEMPRE derivados da latitude/longitude, no EPSG do contrato.
  if new.latitude is not null and new.longitude is not null then
    select * into v_proj from public.coord_to_projected(new.latitude, new.longitude, v_epsg);
    new.tmx  := v_proj.tmx;
    new.tmy  := v_proj.tmy;
    new.geom := st_setsrid(st_makepoint(new.longitude, new.latitude), 4326);
  else
    new.tmx  := null;
    new.tmy  := null;
    new.geom := null;
  end if;

  -- Somente admin pode marcar origem diferente de GPS (importação/ajuste).
  if new.origem_coord <> 'gps' and not public.is_admin() and auth.uid() is not null then
    new.origem_coord := 'gps';
  end if;

  new.valores    := public.points_validate_valores(new.contract_id, new.valores);
  new.updated_at := now();
  return new;
end;
$$;

create trigger points_before_write
  before insert or update on public.points
  for each row execute function public.points_before_write();

-- Mudou o EPSG do contrato? Recalcula TMX/TMY de todos os pontos dele.
create or replace function public.contracts_recalc_on_epsg()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.epsg <> old.epsg then
    update public.points set latitude = latitude where contract_id = new.id and latitude is not null;
  end if;
  return new;
end;
$$;

create trigger contracts_recalc_on_epsg
  after update of epsg on public.contracts
  for each row execute function public.contracts_recalc_on_epsg();

-- ---------------------------------------------------------------------
-- FOTOS — binário no Cloudflare R2, metadados aqui
-- ---------------------------------------------------------------------
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

create index point_photos_point_idx on public.point_photos (point_id, ordem, created_at);

create or replace function public.point_photos_check_contract()
returns trigger
language plpgsql
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

-- BEFORE INSERT roda antes do CHECK de r2_key, garantindo contract_id coerente.
create trigger point_photos_check_contract
  before insert on public.point_photos
  for each row execute function public.point_photos_check_contract();

-- ---------------------------------------------------------------------
-- VIEW com as colunas sistêmicas prontas (ID, TMX, TMY, LINK_FOTOS)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- IMPORTAÇÃO EM LOTE (admin)
-- Cada item: { "valores": {column_id: valor}, "latitude":?, "longitude":?, "tmx":?, "tmy":? }
-- ID nunca é aceito da planilha. Se vier TMX/TMY sem lat/long, o sistema
-- converte para lat/long (EPSG do contrato) e recalcula TMX/TMY pela regra.
-- ---------------------------------------------------------------------
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
