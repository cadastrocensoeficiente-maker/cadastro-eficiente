-- =====================================================================
-- CADASTRO EFICIENTE — 0002a COLUNAS CONFIGURÁVEIS (tabela + guarda)
--
-- REGRA FUNDAMENTAL: em cada contrato, as posições das colunas
-- configuráveis são SEMPRE exatamente 1, 2, 3, …, N — sem buracos.
--   * RLS sem políticas de escrita: o cliente não grava direto;
--   * toda alteração passa pelas funções col_* (0002b), que renumeram;
--   * a constraint trigger abaixo (DEFERRED) valida 1..N no fim de
--     qualquer transação, como última barreira.
-- ID, TMX, TMY e LINK_FOTOS NÃO existem aqui: são sistêmicas e fixas.
-- =====================================================================

create table public.contract_columns (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references public.contracts(id) on delete cascade,
  name         text not null,   -- chave técnica normalizada: ENDERECO
  label        text not null,   -- rótulo exibido: ENDEREÇO
  type         text not null default 'texto'
               check (type in ('texto', 'numero', 'inteiro', 'data', 'booleano', 'lista')),
  options      jsonb not null default '[]'::jsonb,
  required     boolean not null default false,
  position     integer not null check (position >= 1),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint contract_columns_name_unique unique (contract_id, name),
  constraint contract_columns_position_unique unique (contract_id, position) deferrable initially deferred,
  constraint contract_columns_name_format check (name ~ '^[A-Z][A-Z0-9_]{0,62}$'),
  constraint contract_columns_name_reserved check (name not in ('ID', 'UUID', 'TMX', 'TMY', 'LINK_FOTOS', 'LATITUDE', 'LONGITUDE')),
  constraint contract_columns_options_array check (jsonb_typeof(options) = 'array')
);
alter table public.contract_columns enable row level security;
alter table public.profiles enable row level security;
alter table public.contracts enable row level security;
alter table public.contract_counters enable row level security;

create index contract_columns_contract_position_idx on public.contract_columns (contract_id, position);

-- "Tipo lâmpada" -> TIPO_LAMPADA
create or replace function public.col_normalize_name(p_label text)
returns text
language sql immutable
set search_path = public, extensions
as $$
  select nullif(
    regexp_replace(
      regexp_replace(upper(extensions.unaccent(trim(coalesce(p_label, '')))), '[^A-Z0-9]+', '_', 'g'),
      '^_+|_+$', '', 'g'),
    '');
$$;

create or replace function public.col_assert_sequence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_contract uuid := coalesce(new.contract_id, old.contract_id);
  v_count    integer;
  v_min      integer;
  v_max      integer;
  v_distinct integer;
begin
  if not exists (select 1 from public.contracts where id = v_contract) then
    return null;
  end if;
  select count(*), min(position), max(position), count(distinct position)
    into v_count, v_min, v_max, v_distinct
    from public.contract_columns
   where contract_id = v_contract;
  if v_count > 0 and (v_min <> 1 or v_max <> v_count or v_distinct <> v_count) then
    raise exception 'Sequência de colunas inválida no contrato %: as posições devem ser 1..% sem buracos (encontrado min=%, max=%).',
      v_contract, v_count, v_min, v_max
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger contract_columns_sequence_guard
  after insert or update or delete on public.contract_columns
  deferrable initially deferred
  for each row execute function public.col_assert_sequence();

create or replace function public.col_protect_identity()
returns trigger
language plpgsql
as $$
begin
  if new.contract_id <> old.contract_id then
    raise exception 'Uma coluna não pode mudar de contrato.' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger contract_columns_protect_identity
  before update on public.contract_columns
  for each row execute function public.col_protect_identity();
