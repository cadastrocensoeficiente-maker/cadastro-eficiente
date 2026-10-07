-- =====================================================================
-- CADASTRO EFICIENTE — 0008 FOTOS NO ARMAZENAMENTO DO SUPABASE
-- Enquanto o Cloudflare R2 não estiver configurado (ou se ele falhar),
-- as fotos vão para o bucket privado "fotos" do Supabase.
-- point_photos.armazenamento diz onde cada foto está: 'r2' ou 'supabase'.
-- Caminho igual nos dois: contratos/{contract_id}/pontos/{point_id}/{arquivo}
-- =====================================================================

alter table public.point_photos
  add column if not exists armazenamento text not null default 'r2'
  check (armazenamento in ('r2', 'supabase'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 15728640, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

create or replace function public.contrato_do_caminho(p_nome text)
returns uuid
language sql immutable
as $$
  select case when p_nome ~ '^contratos/[0-9a-fA-F-]{36}/pontos/[0-9a-fA-F-]{36}/[^/]+$'
              then split_part(p_nome, '/', 2)::uuid end;
$$;

create policy fotos_ler on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos' and public.can_see_contract(public.contrato_do_caminho(name)));

create policy fotos_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos'
              and public.contrato_do_caminho(name) is not null
              and public.can_edit_points()
              and public.can_see_contract(public.contrato_do_caminho(name)));

create policy fotos_excluir on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos' and public.is_admin());
