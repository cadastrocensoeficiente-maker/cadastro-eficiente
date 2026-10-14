-- =====================================================================
-- Colunas fixas novas: DATA_CADASTRO · HORA_CADASTRO · COLABORADOR
--
-- * Só ADICIONA colunas (vazias) em points: nenhum ponto já cadastrado é alterado.
-- * Pontos novos: data/hora = momento do cadastro no celular (enviada pelo app);
--   colaborador = nome do usuário que cadastrou, gravado na hora (não muda depois).
-- * Pontos antigos: a view calcula — data/hora da captura do GPS (ou do envio)
--   e o nome atual do usuário que cadastrou.
-- * Ordem oficial: ID · 1..N · LATITUDE · LONGITUDE · DATA_CADASTRO ·
--   HORA_CADASTRO · COLABORADOR · LINK_FOTOS
-- =====================================================================

alter table public.points add column if not exists cadastrado_em timestamptz;
alter table public.points add column if not exists colaborador_nome text;

create index if not exists points_cadastro_idx
  on public.points (contract_id, (coalesce(cadastrado_em, capturado_em, created_at)));

-- Nomes reservados para as novas colunas fixas (nenhuma coluna existente usa).
alter table public.contract_columns add constraint contract_columns_name_reserved_2
  check (name not in ('DATA_CADASTRO', 'HORA_CADASTRO', 'COLABORADOR'));

-- Nome de quem cadastrou (lê profiles mesmo para quem não pode ver outros perfis).
create or replace function public.nome_colaborador(p_user uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(nullif(trim(nome), ''), email) from public.profiles where id = p_user;
$$;

-- Carimbo do cadastro: preenchido uma vez na criação e nunca alterado depois.
create or replace function private.points_carimbo_cadastro()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_txt text;
  v_ts  timestamptz;
begin
  if tg_op = 'UPDATE' then
    new.cadastrado_em    := old.cadastrado_em;
    new.colaborador_nome := old.colaborador_nome;
    return new;
  end if;

  -- data/hora enviada pelo app (momento em que o ponto foi salvo no celular)
  v_ts := new.cadastrado_em;
  if v_ts is null then
    v_txt := nullif(current_setting('campo.cadastrado_em', true), '');
    if v_txt is not null then
      begin
        v_ts := v_txt::timestamptz;
      exception when others then
        v_ts := null;
      end;
    end if;
  end if;
  -- relógio do celular muito errado: usa a hora do servidor
  if v_ts is null or v_ts > now() + interval '1 day' or v_ts < now() - interval '3 years' then
    v_ts := now();
  end if;
  new.cadastrado_em := v_ts;
  new.colaborador_nome := coalesce(public.nome_colaborador(new.created_by), new.colaborador_nome);
  return new;
end;
$$;

create trigger points_carimbo_cadastro
  before insert or update on public.points
  for each row execute function private.points_carimbo_cadastro();

-- Envio em lote do app: repassa a data/hora do cadastro de cada ponto.
create or replace function public.campo_salvar_pontos(p_pontos jsonb)
returns table (client_uuid uuid, id uuid, codigo text, erro text)
language plpgsql security definer
set search_path = public
as $$
declare
  e jsonb;
  r record;
begin
  if jsonb_typeof(p_pontos) is distinct from 'array' or jsonb_array_length(p_pontos) > 200 then
    raise exception 'Lote inválido (máximo 200 pontos).' using errcode = 'check_violation';
  end if;
  for e in select x from jsonb_array_elements(p_pontos) as t(x) loop
    client_uuid := (e->>'client_uuid')::uuid;
    id := null; codigo := null; erro := null;
    perform set_config('campo.cadastrado_em', coalesce(e->>'cadastrado_em', ''), true);
    begin
      select s.id, s.codigo into r
        from public.campo_salvar_ponto(
          (e->>'contract')::uuid,
          (e->>'client_uuid')::uuid,
          (e->>'latitude')::double precision,
          (e->>'longitude')::double precision,
          (e->>'precisao_m')::numeric,
          (e->>'capturado_em')::timestamptz,
          coalesce(e->'valores', '{}'::jsonb)
        ) s;
      id := r.id;
      codigo := r.codigo;
    exception when others then
      erro := sqlerrm;
    end;
    return next;
  end loop;
  perform set_config('campo.cadastrado_em', '', true);
end;
$$;

-- View: mesmas colunas de antes, na mesma ordem, + as novas no fim.
create or replace view public.points_view with (security_invoker = true) as
select
  p.id,
  p.contract_id,
  p.seq,
  p.codigo as "ID",
  p.valores,
  p.tmx as "TMX",
  p.tmy as "TMY",
  '/contratos/' || p.contract_id || '/pontos/' || p.id || '/fotos' as "LINK_FOTOS",
  (select count(*) from public.point_photos f where f.point_id = p.id)::integer as total_fotos,
  p.latitude,
  p.longitude,
  p.precisao_m,
  p.capturado_em,
  p.origem_coord,
  p.created_by,
  p.created_at,
  p.updated_at,
  p.codigo || ' ' || coalesce((select string_agg(v.value #>> '{}', ' ') from jsonb_each(p.valores) v(key, value)), '')
    || ' ' || coalesce(p.colaborador_nome, public.nome_colaborador(p.created_by), '') as busca,
  round(p.latitude::numeric, 7) as "LATITUDE",
  round(p.longitude::numeric, 7) as "LONGITUDE",
  coalesce(p.cadastrado_em, p.capturado_em, p.created_at) as cadastrado_em,
  to_char(coalesce(p.cadastrado_em, p.capturado_em, p.created_at) at time zone 'America/Fortaleza', 'DD/MM/YYYY') as "DATA_CADASTRO",
  to_char(coalesce(p.cadastrado_em, p.capturado_em, p.created_at) at time zone 'America/Fortaleza', 'HH24:MI') as "HORA_CADASTRO",
  coalesce(p.colaborador_nome, public.nome_colaborador(p.created_by)) as "COLABORADOR"
from public.points p;

-- Layout oficial com as novas colunas fixas antes de LINK_FOTOS.
create or replace function public.contract_layout(p_contract uuid)
returns table(ordem integer, chave text, rotulo text, sistema boolean, sequencia integer, column_id uuid, tipo text, obrigatoria boolean, opcoes jsonb)
language sql stable
set search_path to 'public'
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
  select 4 + n.total, 'DATA_CADASTRO', 'DATA_CADASTRO', true, null, null, 'sistema', true, '[]'::jsonb from n
  union all
  select 5 + n.total, 'HORA_CADASTRO', 'HORA_CADASTRO', true, null, null, 'sistema', true, '[]'::jsonb from n
  union all
  select 6 + n.total, 'COLABORADOR', 'COLABORADOR', true, null, null, 'sistema', true, '[]'::jsonb from n
  union all
  select 7 + n.total, 'LINK_FOTOS', 'LINK_FOTOS', true, null, null, 'sistema', true, '[]'::jsonb from n
  order by 1;
$$;
