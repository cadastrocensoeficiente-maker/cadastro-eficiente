-- =====================================================================
-- Lixeira de pontos (somente admin)
-- Excluir = mover para a lixeira: o ponto some do painel, da busca, do Excel
-- e das contagens, mas pode ser restaurado. Fotos ficam guardadas.
-- O ID (codigo) de um ponto excluído não é reaproveitado.
-- =====================================================================
alter table public.points add column if not exists excluido_em timestamptz;
alter table public.points add column if not exists excluido_por uuid references auth.users(id);
create index if not exists points_lixeira_idx on public.points (contract_id, excluido_em) where excluido_em is not null;

-- Ninguém enxerga pontos na lixeira pelas consultas normais (inclui points_view).
create policy points_fora_da_lixeira on public.points
  as restrictive for select to authenticated using (excluido_em is null);

create or replace function public.admin_excluir_pontos(p_ids uuid[])
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  if not public.is_admin() then
    raise exception 'Somente administradores excluem pontos.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 1000 then
    raise exception 'Selecione de 1 a 1000 pontos.' using errcode = 'check_violation';
  end if;
  update public.points set excluido_em = now(), excluido_por = auth.uid()
   where id = any(p_ids) and excluido_em is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.admin_restaurar_pontos(p_ids uuid[])
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  if not public.is_admin() then
    raise exception 'Somente administradores restauram pontos.' using errcode = 'insufficient_privilege';
  end if;
  update public.points set excluido_em = null, excluido_por = null
   where id = any(p_ids) and excluido_em is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.admin_lixeira(p_contract uuid)
returns table (id uuid, codigo text, valores jsonb, latitude double precision, longitude double precision,
               total_fotos integer, excluido_em timestamptz, excluido_por_nome text)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.codigo, p.valores, p.latitude, p.longitude,
         (select count(*) from public.point_photos f where f.point_id = p.id)::integer,
         p.excluido_em, pr.nome
    from public.points p
    left join public.profiles pr on pr.id = p.excluido_por
   where public.is_admin() and p.contract_id = p_contract and p.excluido_em is not null
   order by p.excluido_em desc
   limit 2000;
$$;

-- Contagens de produção ignoram pontos na lixeira.
create or replace function public.campo_minha_producao(p_contract uuid)
returns table(hoje bigint, total bigint)
language sql stable security definer
set search_path to 'public'
as $$
  select count(*) filter (where (created_at at time zone 'America/Fortaleza')::date = (now() at time zone 'America/Fortaleza')::date),
         count(*)
    from public.points
   where contract_id = p_contract and created_by = auth.uid() and excluido_em is null;
$$;

create or replace function public.equipe_do_contrato(p_contract uuid)
returns table(user_id uuid, nome text, email text, role text, membro boolean, pontos bigint)
language sql stable security definer
set search_path to 'public'
as $$
  select p.id, p.nome, p.email, p.role,
         coalesce(m.ativo, false),
         (select count(*) from public.points pt where pt.contract_id = p_contract and pt.created_by = p.id and pt.excluido_em is null)
    from public.profiles p
    left join public.contract_members m on m.contract_id = p_contract and m.user_id = p.id
   where public.is_admin()
     and p.role in ('cadastrador', 'admin')
   order by coalesce(m.ativo, false) desc, p.nome;
$$;
