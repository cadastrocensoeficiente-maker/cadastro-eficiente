// POST /api/fotos-upload  { point_id, content_type, nome }
// Devolve uma URL assinada (PUT, 10 min) para o navegador enviar a foto direto ao R2.
import { HttpError, preflight, responder, urlAssinada, usuario } from './_r2.js'

export const OPTIONS = preflight

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

export const POST = responder(async (req) => {
  const { sb, role } = await usuario(req)
  if (role !== 'admin' && role !== 'cadastrador') throw new HttpError(403, 'Seu perfil não pode enviar fotos.')

  const body = (await req.json()) as { point_id?: string; content_type?: string; nome?: string; ref?: string }
  if (!body.point_id) throw new HttpError(400, 'point_id é obrigatório.')
  const tipo = body.content_type ?? 'image/jpeg'
  if (!TIPOS.includes(tipo)) throw new HttpError(400, `Tipo de arquivo não aceito: ${tipo}.`)

  // O ponto precisa existir e ser visível para o usuário (RLS).
  const { data: ponto } = await sb.from('points').select('id, contract_id, codigo').eq('id', body.point_id).single()
  if (!ponto) throw new HttpError(404, 'Ponto não encontrado.')

  const ext = tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : tipo.startsWith('image/hei') ? 'heic' : 'jpg'
  // ref = id da foto no celular: o mesmo envio repetido gera a mesma chave (não duplica)
  const ref = /^[0-9a-f-]{8,36}$/i.test(body.ref ?? '') ? body.ref! : `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
  const key = `contratos/${ponto.contract_id}/pontos/${ponto.id}/${ponto.codigo}_${ref}.${ext}`
  const url = await urlAssinada('PUT', key, 600, tipo)
  return { url, key }
})
