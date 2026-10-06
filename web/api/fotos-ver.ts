// POST /api/fotos-ver  { point_id }
// Devolve URLs assinadas (GET, 1 h) das fotos do ponto. O bucket continua privado.
import { HttpError, responder, urlAssinada, usuario } from './_r2.js'

export const POST = responder(async (req) => {
  const { sb, role } = await usuario(req)
  if (role === 'pendente') throw new HttpError(403, 'Acesso ainda não liberado.')
  const { point_id } = (await req.json()) as { point_id?: string }
  if (!point_id) throw new HttpError(400, 'point_id é obrigatório.')

  const { data, error } = await sb.from('point_photos').select('id, r2_key').eq('point_id', point_id)
  if (error) throw new HttpError(400, error.message)

  const urls: Record<string, string> = {}
  for (const f of data ?? []) urls[f.id] = await urlAssinada('GET', f.r2_key, 3600)
  return { urls }
})
