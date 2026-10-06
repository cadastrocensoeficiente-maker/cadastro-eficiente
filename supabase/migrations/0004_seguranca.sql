-- =====================================================================
-- CADASTRO EFICIENTE — 0004 SEGURANÇA (RLS e permissões)
--   admin        : tudo (contratos, colunas, importação, exclusões)
--   cadastrador  : lê tudo, cria/edita pontos e envia fotos
--   visualizador : somente leitura
-- contract_columns NÃO tem política de escrita: só as funções col_*.
-- =====================================================================

alter table public.profiles          enable row level security;
alter table public.contracts         enable row level security;
alter table public.contract_counters enable row level security;
alter table public.contract_columns  enable row level security;
alter table public.points            enable row level security;
alter table public.point_photos      enable row level security;

-- PROFILES
create policy profiles_select on public.profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_admin());
create policy profiles_admin_update on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- CONTRACTS
create policy contracts_select on public.contracts
  for select to authenticated using (true);
create policy contracts_admin_insert on public.contracts
  for insert to authenticated with check (public.is_admin());
create policy contracts_admin_update on public.contracts
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy contracts_admin_delete on public.contracts
  for delete to authenticated using (public.is_admin());

-- CONTRACT_COUNTERS: nenhum acesso direto (só triggers security definer)

-- CONTRACT_COLUMNS: leitura livre para autenticados; escrita só via RPC
create policy contract_columns_select on public.contract_columns
  for select to authenticated using (true);

-- POINTS
create policy points_select on public.points
  for select to authenticated using (true);
create policy points_insert on public.points
  for insert to authenticated with check (public.can_edit_points());
create policy points_update on public.points
  for update to authenticated using (public.can_edit_points()) with check (public.can_edit_points());
create policy points_admin_delete on public.points
  for delete to authenticated using (public.is_admin());

-- POINT_PHOTOS
create policy point_photos_select on public.point_photos
  for select to authenticated using (true);
create policy point_photos_insert on public.point_photos
  for insert to authenticated with check (public.can_edit_points());
create policy point_photos_admin_delete on public.point_photos
  for delete to authenticated using (public.is_admin());

-- Colunas sistêmicas dos pontos não podem ser escritas pelo cliente.
revoke insert, update on public.points from anon, authenticated;
grant insert (contract_id, latitude, longitude, precisao_m, capturado_em, valores) on public.points to authenticated;
grant update (latitude, longitude, precisao_m, capturado_em, valores) on public.points to authenticated;

revoke all on public.contract_counters from anon, authenticated;
revoke insert, update, delete on public.contract_columns from anon, authenticated;

-- Nada para usuários anônimos
revoke all on all tables in schema public from anon;

-- Funções: somente autenticados
revoke execute on function public.col_add(uuid, text, text, boolean, jsonb, integer) from public, anon;
revoke execute on function public.col_remove(uuid) from public, anon;
revoke execute on function public.col_move(uuid, integer) from public, anon;
revoke execute on function public.col_reorder(uuid, uuid[]) from public, anon;
revoke execute on function public.col_update(uuid, text, text, boolean, jsonb) from public, anon;
revoke execute on function public.col_copy_from(uuid, uuid) from public, anon;
revoke execute on function public.points_import(uuid, jsonb) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.contracts_create_counter() from public, anon, authenticated;
revoke execute on function public.contracts_recalc_on_epsg() from public, anon, authenticated;
revoke execute on function public.points_before_write() from public, anon, authenticated;

grant execute on function public.col_add(uuid, text, text, boolean, jsonb, integer) to authenticated;
grant execute on function public.col_remove(uuid) to authenticated;
grant execute on function public.col_move(uuid, integer) to authenticated;
grant execute on function public.col_reorder(uuid, uuid[]) to authenticated;
grant execute on function public.col_update(uuid, text, text, boolean, jsonb) to authenticated;
grant execute on function public.col_copy_from(uuid, uuid) to authenticated;
grant execute on function public.points_import(uuid, jsonb) to authenticated;
grant execute on function public.contract_layout(uuid) to authenticated;
grant execute on function public.preview_coordenada(uuid, double precision, double precision) to authenticated;
