-- =====================================================================
-- Lixeira de contratos (somente admin)
-- Excluir contrato = mover para a lixeira: some do painel e do app de campo,
-- junto com pontos, colunas e fotos dele (nada é apagado). Pode ser restaurado.
-- =====================================================================
alter table public.contracts add column if not exists excluido_em timestamptz;
alter table public.contracts add column if not exists excluido_por uuid references auth.users(id);

-- Contrato na lixeira não é visível para ninguém (inclui pontos, colunas e fotos,
-- que dependem desta função nas políticas).
create or replace function public.can_see_contract(p_contract uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.contracts c where c.id = p_contract and c.excluido_em is not null) then false
    else case public.my_role()
      when 'admin' then true
      when 'visualizador' then true
      when 'cadastrador' then exists (
        select 1 from public.contract_members m
         where m.contract_id = p_contract and m.user_id = auth.uid() and m.ativo)
      else false
    end
  end;
$$;

create or replace function public.admin_excluir_contrato(p_contract uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente administradores excluem contratos.' using errcode = 'insufficient_privilege';
  end if;
  update public.contracts set excluido_em = now(), excluido_por = auth.uid()
   where id = p_contract and excluido_em is null;
  if not found then
    raise exception 'Contrato não encontrado.' using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.admin_restaurar_contrato(p_contract uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente administradores restauram contratos.' using errcode = 'insufficient_privilege';
  end if;
  update public.contracts set excluido_em = null, excluido_por = null
   where id = p_contract and excluido_em is not null;
end;
$$;

create or replace function public.admin_contratos_excluidos()
returns table (id uuid, nome text, municipio text, uf text, pontos bigint, excluido_em timestamptz, excluido_por_nome text)
language sql stable security definer
set search_path = public
as $$
  select c.id, c.nome, c.municipio, c.uf,
         (select count(*) from public.points p where p.contract_id = c.id and p.excluido_em is null),
         c.excluido_em, pr.nome
    from public.contracts c
    left join public.profiles pr on pr.id = c.excluido_por
   where public.is_admin() and c.excluido_em is not null
   order by c.excluido_em desc;
$$;
