
-- Busca textual simples (ID + valores)
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
  p.codigo || ' ' || coalesce((select string_agg(v.value #>> '{}', ' ') from jsonb_each(p.valores) v), '') as busca
from public.points p;
