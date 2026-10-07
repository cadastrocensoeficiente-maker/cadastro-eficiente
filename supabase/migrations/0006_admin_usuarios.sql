-- =====================================================================
-- CADASTRO EFICIENTE — 0006 GESTÃO DE USUÁRIOS PELO ADMINISTRADOR
-- Funções exclusivas de admin (verificam is_admin() internamente):
--   admin_usuarios()            lista com status, último acesso e contratos
--   admin_atualizar_usuario()   nome, papel e ativo/bloqueado
--   admin_definir_senha()       nova senha (sem depender de e-mail)
--   admin_confirmar_email()     libera o login sem o e-mail de confirmação
-- =====================================================================

create or replace function private.exigir_admin()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem gerenciar usuários.' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function public.admin_usuarios()
returns table (
  id uuid, nome text, email text, role text, created_at timestamptz,
  email_confirmado boolean, ativo boolean, ultimo_acesso timestamptz, contratos uuid[]
)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  perform private.exigir_admin();
  return query
  select p.id, p.nome, coalesce(u.email, p.email)::text, p.role, p.created_at,
         u.email_confirmed_at is not null,
         (u.banned_until is null or u.banned_until < now()),
         u.last_sign_in_at,
         coalesce(array_agg(m.contract_id) filter (where m.ativo), '{}')
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.contract_members m on m.user_id = p.id
   group by p.id, u.id
   order by p.created_at;
end;
$$;

create or replace function public.admin_atualizar_usuario(p_user uuid, p_nome text, p_role text, p_ativo boolean)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
begin
  perform private.exigir_admin();
  if p_user = auth.uid() and (p_role <> 'admin' or not p_ativo) then
    raise exception 'Você não pode remover o seu próprio acesso de administrador.' using errcode = 'check_violation';
  end if;
  if p_role not in ('admin', 'cadastrador', 'visualizador', 'pendente') then
    raise exception 'Papel inválido.' using errcode = 'check_violation';
  end if;
  update public.profiles set nome = nullif(trim(p_nome), ''), role = p_role where id = p_user;
  if not found then
    raise exception 'Usuário não encontrado.' using errcode = 'no_data_found';
  end if;
  -- Bloquear impede novo login e renovação da sessão; desbloquear libera de novo.
  update auth.users
     set banned_until = case when p_ativo then null else 'infinity'::timestamptz end,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('nome', nullif(trim(p_nome), ''))
   where id = p_user;
end;
$$;

create or replace function public.admin_definir_senha(p_user uuid, p_senha text)
returns void
language plpgsql security definer
set search_path = public, auth, extensions
as $$
begin
  perform private.exigir_admin();
  if length(coalesce(p_senha, '')) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.' using errcode = 'check_violation';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user;
  if not found then
    raise exception 'Usuário não encontrado.' using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.admin_confirmar_email(p_user uuid)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
begin
  perform private.exigir_admin();
  update auth.users
     set email_confirmed_at = coalesce(email_confirmed_at, now()),
         confirmation_token = ''
   where id = p_user;
end;
$$;
