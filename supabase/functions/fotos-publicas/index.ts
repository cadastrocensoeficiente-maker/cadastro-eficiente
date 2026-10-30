// Supabase Edge Function: fotos-publicas
// GET /functions/v1/fotos-publicas?t=<link_publico>
//     /functions/v1/fotos-publicas?p=<id interno do ponto>  (link antigo /contratos/.../pontos/<id>/fotos)
//
// Página pública de fotos (sem login). Recebe o código aleatório de UM ponto
// e devolve somente: o ID do ponto e links temporários (1 h) das fotos dele.
// Não aceita nenhum outro parâmetro e não devolve nenhum outro dado do sistema.
// Ponto ou contrato na lixeira = link desativado.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'GET') return json({ error: 'Método não permitido.' }, 405)

  const params = new URL(req.url).searchParams
  const token = params.get('t') ?? ''
  const pontoId = params.get('p') ?? ''
  const naoEncontrado = () => json({ error: 'Link inválido ou desativado.' }, 404)
  const campo = UUID.test(token) ? 'link_publico' : UUID.test(pontoId) ? 'id' : null
  if (!campo) return naoEncontrado()

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: ponto } = await sb
    .from('points')
    .select('id, codigo, excluido_em, contracts!inner(excluido_em)')
    .eq(campo, campo === 'id' ? pontoId : token)
    .maybeSingle()
  // deno-lint-ignore no-explicit-any
  if (!ponto || ponto.excluido_em || (ponto as any).contracts?.excluido_em) return naoEncontrado()

  const { data: fotos, error } = await sb
    .from('point_photos')
    .select('id, r2_key, armazenamento, created_at')
    .eq('point_id', ponto.id)
    .order('ordem')
    .order('created_at')
  if (error) return json({ error: 'Não foi possível carregar as fotos.' }, 500)

  const doSupabase = (fotos ?? []).filter((f) => f.armazenamento === 'supabase')
  const lista: { id: string; url: string; data: string }[] = []
  if (doSupabase.length) {
    const { data: assinadas } = await sb.storage.from('fotos').createSignedUrls(doSupabase.map((f) => f.r2_key), 3600)
    assinadas?.forEach((a, i) => {
      // Arquivo inexistente não gera link: a foto simplesmente não aparece.
      if (a.signedUrl && !a.error) lista.push({ id: doSupabase[i].id, url: a.signedUrl, data: doSupabase[i].created_at })
    })
  }

  return json({ ponto: ponto.codigo, fotos: lista })
})
