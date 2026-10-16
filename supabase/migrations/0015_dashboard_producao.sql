-- =====================================================================
-- Dashboard de produção
--
-- * Só ADICIONA uma função de LEITURA: nenhuma tabela, ponto, coluna ou
--   regra existente é alterada.
-- * Independe do colunamento de cada contrato: a produção é medida pelos
--   campos fixos que todo ponto tem (contrato, data/hora do cadastro,
--   colaborador, origem e fotos). Funciona igual em qualquer contrato.
-- * Devolve uma linha por contrato × dia × colaborador × origem; o painel
--   soma e filtra no navegador.
-- * Respeita o escopo de quem consulta (can_see_contract) e ignora pontos
--   e contratos na lixeira.
-- =====================================================================

create or replace function public.dashboard_producao()
returns table (
  contract_id uuid,
  dia date,
  colaborador_id uuid,
  colaborador text,
  origem text,
  pontos integer,
  com_foto integer,
  fotos integer,
  primeiro timestamptz,
  ultimo timestamptz
)
language sql stable
security invoker
set search_path = public
as $$
  with base as (
    select
      p.id,
      p.contract_id,
      coalesce(p.cadastrado_em, p.capturado_em, p.created_at) as quando,
      p.created_by,
      coalesce(p.colaborador_nome, public.nome_colaborador(p.created_by), '(sem nome)') as colaborador,
      p.origem_coord::text as origem
    from public.points p
    join public.contracts c on c.id = p.contract_id
    where p.excluido_em is null
      and c.excluido_em is null
      and public.can_see_contract(p.contract_id)
  ), fotos as (
    select f.point_id, count(*)::int as n
      from public.point_photos f
      join base b on b.id = f.point_id
     group by f.point_id
  )
  select
    b.contract_id,
    (b.quando at time zone 'America/Fortaleza')::date as dia,
    b.created_by,
    b.colaborador,
    b.origem,
    count(*)::int,
    count(f.point_id)::int,
    coalesce(sum(f.n), 0)::int,
    min(b.quando),
    max(b.quando)
  from base b
  left join fotos f on f.point_id = b.id
  group by 1, 2, 3, 4, 5
  order by 2, 1, 4;
$$;

grant execute on function public.dashboard_producao() to authenticated;
