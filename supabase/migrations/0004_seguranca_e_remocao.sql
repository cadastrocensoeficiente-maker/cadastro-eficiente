-- =====================================================================
-- CADASTRO EFICIENTE — 0004 REMOÇÃO DE COLUNA, EXCLUSÕES E PERMISSÕES
--
-- ⚠️ Este arquivo contém DELETE/REVOKE, que exigem confirmação manual no
-- Supabase. Rode-o uma vez no SQL Editor do projeto (cole e execute).
-- =====================================================================

-- Remover coluna: a sequência se fecha sozinha; valores da coluna saem dos pontos.
create or replace function public.col_remove(p_column uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract uuid;
begin
  perform private.col_require_admin();
  select contract_id into v_contract from public.contract_columns where id = p_column;
  if v_contract is null then
    raise exception 'Coluna não encontrada.' using errcode = 'no_data_found';
  end if;
  perform private.col_lock_contract(v_contract);
  delete from public.contract_columns where id = p_column;
  update public.points
     set valores = valores - p_column::text
   where contract_id = v_contract and valores ? p_column::text;
  perform private.col_renumber(v_contract);
end;
$$;

-- Exclusões somente por admin
create policy contracts_admin_delete on public.contracts
  for delete to authenticated using (public.is_admin());
create policy points_admin_delete on public.points
  for delete to authenticated using (public.is_admin());
create policy point_photos_admin_delete on public.point_photos
  for delete to authenticated using (public.is_admin());

-- Colunas sistêmicas dos pontos não podem ser enviadas pelo cliente
revoke insert, update on public.points from anon, authenticated;
grant insert (contract_id, latitude, longitude, precisao_m, capturado_em, valores) on public.points to authenticated;
grant update (latitude, longitude, precisao_m, capturado_em, valores) on public.points to authenticated;

revoke all on public.contract_counters from anon, authenticated;
revoke insert, update, delete on public.contract_columns from anon, authenticated;
revoke all on all tables in schema public from anon;

revoke usage on schema private from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

revoke execute on function public.col_add(uuid, text, text, boolean, jsonb, integer) from public, anon;
revoke execute on function public.col_remove(uuid) from public, anon;
revoke execute on function public.col_move(uuid, integer) from public, anon;
revoke execute on function public.col_reorder(uuid, uuid[]) from public, anon;
revoke execute on function public.col_update(uuid, text, text, boolean, jsonb) from public, anon;
revoke execute on function public.col_copy_from(uuid, uuid) from public, anon;
revoke execute on function public.points_import(uuid, jsonb) from public, anon;
revoke execute on function public.contract_layout(uuid) from public, anon;
revoke execute on function public.preview_coordenada(uuid, double precision, double precision) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.contracts_create_counter() from public, anon, authenticated;

grant execute on function public.col_add(uuid, text, text, boolean, jsonb, integer) to authenticated;
grant execute on function public.col_remove(uuid) to authenticated;
grant execute on function public.col_move(uuid, integer) to authenticated;
grant execute on function public.col_reorder(uuid, uuid[]) to authenticated;
grant execute on function public.col_update(uuid, text, text, boolean, jsonb) to authenticated;
grant execute on function public.col_copy_from(uuid, uuid) to authenticated;
grant execute on function public.points_import(uuid, jsonb) to authenticated;
grant execute on function public.contract_layout(uuid) to authenticated;
grant execute on function public.preview_coordenada(uuid, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------
-- Cadastro aberto com aprovação: quem se cadastra entra como "pendente"
-- e não vê nada até um admin liberar o papel.
-- ---------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'cadastrador', 'visualizador', 'pendente'));
alter table public.profiles alter column role set default 'pendente';

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
    case when exists (select 1 from public.profiles) then 'pendente' else 'admin' end
  );
  return new;
end;
$$;

create or replace function public.has_access()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','cadastrador','visualizador'));
$$;

drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts
  for select to authenticated using (public.has_access());
drop policy if exists contract_columns_select on public.contract_columns;
create policy contract_columns_select on public.contract_columns
  for select to authenticated using (public.has_access());
drop policy if exists points_select on public.points;
create policy points_select on public.points
  for select to authenticated using (public.has_access());
drop policy if exists point_photos_select on public.point_photos;
create policy point_photos_select on public.point_photos
  for select to authenticated using (public.has_access());
