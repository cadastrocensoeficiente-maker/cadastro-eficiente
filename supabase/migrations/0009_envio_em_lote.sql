-- Envio em lote do app de campo: até 200 pontos por chamada.
-- Cada ponto é salvo de forma independente (um erro não derruba o lote) e
-- continua idempotente pelo client_uuid (reenviar não duplica).
-- Sem login, campo_salvar_ponto recusa cada ponto (perfil não pode cadastrar).
create or replace function public.campo_salvar_pontos(p_pontos jsonb)
returns table (client_uuid uuid, id uuid, codigo text, erro text)
language plpgsql security definer
set search_path = public
as $$
declare
  e jsonb;
  r record;
begin
  if jsonb_typeof(p_pontos) is distinct from 'array' or jsonb_array_length(p_pontos) > 200 then
    raise exception 'Lote inválido (máximo 200 pontos).' using errcode = 'check_violation';
  end if;
  for e in select x from jsonb_array_elements(p_pontos) as t(x) loop
    client_uuid := (e->>'client_uuid')::uuid;
    id := null; codigo := null; erro := null;
    begin
      select s.id, s.codigo into r
        from public.campo_salvar_ponto(
          (e->>'contract')::uuid,
          (e->>'client_uuid')::uuid,
          (e->>'latitude')::double precision,
          (e->>'longitude')::double precision,
          (e->>'precisao_m')::numeric,
          (e->>'capturado_em')::timestamptz,
          coalesce(e->'valores', '{}'::jsonb)
        ) s;
      id := r.id;
      codigo := r.codigo;
    exception when others then
      erro := sqlerrm;
    end;
    return next;
  end loop;
end;
$$;

