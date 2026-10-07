-- =====================================================================
-- CADASTRO EFICIENTE — 0007
-- 1) Colunas fixas passam a ser:  ID · configuráveis 1..N · LATITUDE · LONGITUDE · LINK_FOTOS
--    (graus decimais do GPS, prontos para o QGIS — EPSG:4326 / WGS84).
--    TMX/TMY continuam calculados internamente, mas saem da tela e da exportação.
-- 2) Coluna "lista" aceita VÁRIAS opções, gravadas separadas por vírgula ("LED, SÓDIO").
--    Novo tipo "lista_unica" para campos de uma opção só.
-- =====================================================================

alter table public.contract_columns drop constraint if exists contract_columns_type_check;
alter table public.contract_columns add constraint contract_columns_type_check
  check (type in ('texto', 'numero', 'inteiro', 'data', 'booleano', 'lista', 'lista_unica'));

-- Layout oficial (tela, exportação, importação e app de campo)
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
  select 2 + n.total, 'LATITUDE', 'LATITUDE', true, null, null, 'sistema', true, '[]'::jsonb from n
  union all
  select 3 + n.total, 'LONGITUDE', 'LONGITUDE', true, null, null, 'sistema', true, '[]'::jsonb from n
  union all
  select 4 + n.total, 'LINK_FOTOS', 'LINK_FOTOS', true, null, null, 'sistema', true, '[]'::jsonb from n
  order by 1;
$$;

-- Validação dos valores: lista múltipla separada por vírgula
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
  v_itens text[];
  v_item  text;
  v_ok    text[];
  v_canon text;
begin
  for v_key, v_val in select key, value from jsonb_each(coalesce(p_valores, '{}'::jsonb)) loop
    select * into v_col from public.contract_columns
     where contract_id = p_contract and id::text = v_key;
    if v_col.id is null then
      raise exception 'Valor para coluna inexistente neste contrato (%).', v_key using errcode = 'check_violation';
    end if;
    if v_val is null or v_val = 'null'::jsonb
       or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '')
       or (jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) = 0) then
      continue;
    end if;
    if jsonb_typeof(v_val) = 'array' then
      select string_agg(x, ',') into v_txt from jsonb_array_elements_text(v_val) x;
    else
      v_txt := btrim(v_val #>> '{}');
    end if;
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
      when 'lista_unica' then
        if jsonb_array_length(v_col.options) > 0 then
          select o into v_canon from jsonb_array_elements_text(v_col.options) o where upper(btrim(o)) = upper(v_txt) limit 1;
          if v_canon is null then
            raise exception 'Valor "%" não está entre as opções da coluna %.', v_txt, v_col.label using errcode = 'check_violation';
          end if;
          v_txt := v_canon;
        end if;
        v_val := to_jsonb(v_txt);
      when 'lista' then
        -- várias opções separadas por vírgula; grava na ordem das opções, sem repetir
        v_itens := array(select btrim(x) from unnest(string_to_array(v_txt, ',')) x where btrim(x) <> '');
        if jsonb_array_length(v_col.options) > 0 then
          foreach v_item in array v_itens loop
            if not exists (select 1 from jsonb_array_elements_text(v_col.options) o where upper(btrim(o)) = upper(v_item)) then
              raise exception 'Valor "%" não está entre as opções da coluna %.', v_item, v_col.label using errcode = 'check_violation';
            end if;
          end loop;
          v_ok := array(
            select o from jsonb_array_elements_text(v_col.options) with ordinality t(o, i)
             where upper(btrim(o)) in (select upper(x) from unnest(v_itens) x)
             order by i);
        else
          v_ok := array(select distinct x from unnest(v_itens) x);
        end if;
        if coalesce(array_length(v_ok, 1), 0) = 0 then
          continue;
        end if;
        v_val := to_jsonb(array_to_string(v_ok, ', '));
      else
        v_val := to_jsonb(v_txt);
    end case;
    v_out := v_out || jsonb_build_object(v_key, v_val);
  end loop;
  return v_out;
end;
$$;

-- View com LATITUDE/LONGITUDE prontas (novas colunas entram no fim)
create or replace view public.points_view
with (security_invoker = true)
as
select
  p.id, p.contract_id, p.seq,
  p.codigo as "ID", p.valores, p.tmx as "TMX", p.tmy as "TMY",
  '/contratos/' || p.contract_id || '/pontos/' || p.id || '/fotos' as "LINK_FOTOS",
  (select count(*) from public.point_photos f where f.point_id = p.id)::int as total_fotos,
  p.latitude, p.longitude, p.precisao_m, p.capturado_em, p.origem_coord,
  p.created_by, p.created_at, p.updated_at,
  p.codigo || ' ' || coalesce((select string_agg(v.value #>> '{}', ' ') from jsonb_each(p.valores) v), '') as busca,
  round(p.latitude::numeric, 7)  as "LATITUDE",
  round(p.longitude::numeric, 7) as "LONGITUDE"
from public.points p;
