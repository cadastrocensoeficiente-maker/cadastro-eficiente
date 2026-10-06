-- =====================================================================
-- CADASTRO EFICIENTE — 0001 BASE
-- Extensões, perfis de usuário, contratos e contador de ID operacional
-- =====================================================================

create extension if not exists postgis with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------
-- PERFIS
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text,
  email       text,
  role        text not null default 'cadastrador'
              check (role in ('admin', 'cadastrador', 'visualizador')),
  created_at  timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.can_edit_points()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','cadastrador'));
$$;

-- Primeiro usuário cadastrado vira admin; os demais entram como cadastrador.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nome, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles) then 'cadastrador' else 'admin' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- CONTRATOS
-- ---------------------------------------------------------------------
create table public.contracts (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  municipio   text,
  uf          text default 'CE',
  -- Sistema de referência das coordenadas projetadas (TMX/TMY).
  -- Padrão: 31984 = SIRGAS 2000 / UTM zone 24S. Configurável por contrato.
  epsg        integer not null default 31984,
  -- Quantidade mínima de dígitos do ID operacional (mínimo 2).
  id_digitos  integer not null default 6 check (id_digitos between 2 and 12),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint contracts_nome_unique unique (nome)
);

-- O EPSG precisa existir no catálogo do PostGIS e ser um sistema projetado.
create or replace function public.contracts_validate_epsg()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from extensions.spatial_ref_sys where srid = new.epsg) then
    raise exception 'EPSG % não existe no catálogo de sistemas de referência.', new.epsg
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from extensions.spatial_ref_sys where srid = new.epsg and proj4text like '%+proj=longlat%') then
    raise exception 'EPSG % é geográfico (lat/long). TMX/TMY exigem um sistema projetado (ex.: 31984 = SIRGAS 2000 / UTM 24S).', new.epsg
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger contracts_validate_epsg
  before insert or update on public.contracts
  for each row execute function public.contracts_validate_epsg();

-- Contador do ID operacional por contrato (sem buracos por rollback de sequence global).
create table public.contract_counters (
  contract_id uuid primary key references public.contracts(id) on delete cascade,
  ultimo_seq  bigint not null default 0
);

create or replace function public.contracts_create_counter()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.contract_counters (contract_id) values (new.id);
  return new;
end;
$$;

create trigger contracts_create_counter
  after insert on public.contracts
  for each row execute function public.contracts_create_counter();
