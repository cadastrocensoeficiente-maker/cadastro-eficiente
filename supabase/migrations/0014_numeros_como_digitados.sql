-- =====================================================================
-- Colunas "Número" e "Número inteiro": guardar EXATAMENTE o que foi digitado.
-- Antes: o texto era convertido para número (045 virava 45).
-- Agora: valida (só dígitos / número válido) e guarda o texto original.
-- * Aceita tudo o que já era aceito (nenhum ponto pendente nos celulares passa
--   a ser recusado na sincronização).
-- * Não reescreve nenhum ponto já existente.
-- =====================================================================
create or replace function public.points_validate_valores(p_contract uuid, p_valores jsonb)
returns jsonb
language plpgsql stable
set search_path to 'public'
as $$
declare
  v_key   text;
  v_val   jsonb;
  v_col   public.contract_columns;
  v_out   jsonb := '{}'::jsonb;
  v_txt   text;
  v_itens text[];
  v_item  text;
  v_ok    text[];
  v_canon text;
  v_num   numeric;
begin
  for v_key, v_val in select key, value from jsonb_each(coalesce(p_valores, '{}'::jsonb)) loop
    select * into v_col from public.contract_columns
     where contract_id = p_contract and id::text = v_key;
    if v_col.id is null then
      raise exception 'Valor para coluna inexistente neste contrato (%).', v_key using errcode = 'check_violation';
    end if;
    if v_val is null or v_val = 'null'::jsonb
       or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '')
       or (jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) = 0) then
      continue;
    end if;
    if jsonb_typeof(v_val) = 'array' then
      select string_agg(x, ',') into v_txt from jsonb_array_elements_text(v_val) x;
    else
      v_txt := btrim(v_val #>> '{}');
    end if;
    case v_col.type
      when 'numero' then
        begin
          v_num := replace(v_txt, ',', '.')::numeric;
        exception when others then
          raise exception 'A coluna % aceita apenas números (recebido "%").', v_col.label, v_txt using errcode = 'check_violation';
        end;
        v_val := to_jsonb(v_txt);           -- exatamente como digitado
      when 'inteiro' then
        if v_txt !~ '^[+-]?[0-9]+$' then
          raise exception 'A coluna % aceita apenas números inteiros (recebido "%").', v_col.label, v_txt using errcode = 'check_violation';
        end if;
        v_val := to_jsonb(v_txt);           -- mantém zeros à esquerda
      when 'data' then
        begin
          v_val := to_jsonb(to_char(v_txt::date, 'YYYY-MM-DD'));
        exception when others then
          raise exception 'A coluna % aceita apenas datas (recebido "%").', v_col.label, v_txt using errcode = 'check_violation';
        end;
      when 'booleano' then
        if lower(v_txt) in ('true', 'sim', 's', '1', 'yes') then v_val := 'true'::jsonb;
        elsif lower(v_txt) in ('false', 'nao', 'não', 'n', '0', 'no') then v_val := 'false'::jsonb;
        else
          raise exception 'A coluna % aceita apenas Sim/Não (recebido "%").', v_col.label, v_txt using errcode = 'check_violation';
        end if;
      when 'lista_unica' then
        if jsonb_array_length(v_col.options) > 0 then
          select o into v_canon from jsonb_array_elements_text(v_col.options) o where upper(btrim(o)) = upper(v_txt) limit 1;
          if v_canon is null then
            raise exception 'Valor "%" não está entre as opções da coluna %.', v_txt, v_col.label using errcode = 'check_violation';
          end if;
          v_txt := v_canon;
        end if;
        v_val := to_jsonb(v_txt);
      when 'lista' then
        v_itens := array(select btrim(x) from unnest(string_to_array(v_txt, ',')) x where btrim(x) <> '');
        if jsonb_array_length(v_col.options) > 0 then
          foreach v_item in array v_itens loop
            if not exists (select 1 from jsonb_array_elements_text(v_col.options) o where upper(btrim(o)) = upper(v_item)) then
              raise exception 'Valor "%" não está entre as opções da coluna %.', v_item, v_col.label using errcode = 'check_violation';
            end if;
          end loop;
          v_ok := array(
            select o from jsonb_array_elements_text(v_col.options) with ordinality t(o, i)
             where upper(btrim(o)) in (select upper(x) from unnest(v_itens) x)
             order by i);
        else
          v_ok := array(select distinct x from unnest(v_itens) x);
        end if;
        if coalesce(array_length(v_ok, 1), 0) = 0 then
          continue;
        end if;
        v_val := to_jsonb(array_to_string(v_ok, ', '));
      else
        v_val := to_jsonb(v_txt);
    end case;
    v_out := v_out || jsonb_build_object(v_key, v_val);
  end loop;
  return v_out;
end;
$$;
