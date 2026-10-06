# Cadastro Eficiente

Cadastro de pontos de iluminação pública por contrato. Cada contrato tem colunas próprias; o sistema garante a regra de colunas no banco.

## Regra de colunas (garantida no Postgres, não só na tela)

| Grupo | Colunas | Quem controla |
|---|---|---|
| Sistêmicas | `ID`, `TMX`, `TMY`, `LINK_FOTOS` | O sistema. Não podem ser excluídas, renomeadas, movidas nem digitadas. |
| Configuráveis | Sequência `1, 2, 3 … N` | O administrador escolhe a ordem; o banco mantém a sequência sem buracos. |

Ordem oficial em tela, exportação, importação e app de campo:
`ID · configuráveis 1..N · TMX · TMY · LINK_FOTOS`.
Essa ordem sai sempre da função `contract_layout(contract_id)`.

O banco aplica a regra assim:

- **`contract_columns`** não aceita escrita direta. Toda alteração passa por `col_add`, `col_remove`, `col_move`, `col_reorder`, `col_update` e `col_copy_from`, que renumeram 1..N automaticamente.
- **Barreira final:** uma constraint trigger *deferred* recusa qualquer transação que termine com buraco ou posição repetida.
- **ID:** gerado por trigger com contador por contrato (`000001`, `000002`…, mínimo de dígitos configurável). Existe também um UUID interno (`points.id`). Valores enviados pelo cliente são ignorados.
- **TMX/TMY:** calculados no banco (PostGIS `ST_Transform`) a partir de latitude/longitude, no EPSG do contrato (padrão 31984 = SIRGAS 2000 / UTM 24S). A latitude/longitude original fica guardada. Se o EPSG do contrato mudar, todos os pontos são recalculados.
- **LINK_FOTOS:** derivado: `/contratos/{contract_id}/pontos/{point_id}/fotos`. O binário das fotos fica no Cloudflare R2 e o Supabase guarda só os metadados (`point_photos`).

## Estrutura

```
supabase/migrations/   SQL do banco (já aplicado no projeto pwesznsuwypbfqrayqoz, exceto 0004)
web/                   App React + Vite
web/api/               Funções Vercel: URLs assinadas do R2 (enviar, ver e excluir fotos)
```

## Pendências de configuração

1. **Migração `0004_seguranca_e_remocao.sql`.** Cole e execute no SQL Editor do Supabase. Ela ativa a remoção de colunas, as exclusões só por admin, o papel "pendente" para novos cadastros e o bloqueio das colunas sistêmicas por permissão.
2. **Cloudflare R2:**
   - Crie o bucket `cadastro-eficiente-fotos`, privado.
   - Crie um token de API R2 com leitura e escrita nesse bucket.
   - No bucket, configure CORS permitindo `PUT` e `GET` a partir do domínio do app, com o header `Content-Type`.
3. **Vercel:**
   - Em *Import Project*, escolha este repositório e defina *Root Directory* = `web`.
   - Cadastre as variáveis de `web/.env.example`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` e `R2_BUCKET`.
4. **Supabase Auth.** Em *Authentication → URL Configuration*, coloque a URL do Vercel como *Site URL*.
5. **Primeiro acesso.** O primeiro usuário que criar conta vira **admin**. Os seguintes entram como pendentes (após a 0004) e precisam ser liberados na tela *Usuários*.

## Desenvolvimento

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```
