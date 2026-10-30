-- =====================================================================
-- CADASTRO EFICIENTE — 0016 LINK PÚBLICO DAS FOTOS
-- Cada ponto ganha um código aleatório (link_publico). O link
--   https://<painel>/f/<link_publico>
-- abre SOMENTE as fotos daquele ponto, sem login. Quem tem o link não
-- consegue ver nenhum outro dado do sistema: a página pública fala apenas
-- com a função "fotos-publicas" (Supabase Edge Function), que devolve as
-- fotos daquele ponto e nada mais. Nada foi liberado para anônimos no banco.
--
-- Também remove registros de foto cujo arquivo já não existe no
-- armazenamento (eles apareciam como moldura vazia na galeria).
-- =====================================================================

alter table public.points
  add column if not exists link_publico uuid not null default gen_random_uuid();
create unique index if not exists points_link_publico_idx on public.points (link_publico);
-- link_publico não entra nos grants de insert/update: o cliente não consegue definir nem trocar.

-- points_view: mesma definição de antes + coluna LINK_PUBLICO no final.
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
  p.updated_at,
  (p.codigo || ' ' || coalesce((select string_agg(v.value #>> '{}', ' ') from jsonb_each(p.valores) v(key, value)), '')
     || ' ' || coalesce(p.colaborador_nome, public.nome_colaborador(p.created_by), ''))  as busca,
  round(p.latitude::numeric, 7)                                      as "LATITUDE",
  round(p.longitude::numeric, 7)                                     as "LONGITUDE",
  coalesce(p.cadastrado_em, p.capturado_em, p.created_at)            as cadastrado_em,
  to_char(coalesce(p.cadastrado_em, p.capturado_em, p.created_at) at time zone 'America/Fortaleza', 'DD/MM/YYYY') as "DATA_CADASTRO",
  to_char(coalesce(p.cadastrado_em, p.capturado_em, p.created_at) at time zone 'America/Fortaleza', 'HH24:MI')    as "HORA_CADASTRO",
  coalesce(p.colaborador_nome, public.nome_colaborador(p.created_by)) as "COLABORADOR",
  '/f/' || p.link_publico                                            as "LINK_PUBLICO"
from public.points p;

-- Limpeza: registros de foto do armazenamento do Supabase sem o arquivo correspondente.
delete from public.point_photos f
 where f.armazenamento = 'supabase'
   and not exists (select 1 from storage.objects o where o.bucket_id = 'fotos' and o.name = f.r2_key);
