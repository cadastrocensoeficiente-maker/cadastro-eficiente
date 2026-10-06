// POST /api/fotos-excluir  { photo_id }  — somente admin
import { HttpError, apagarObjeto, responder, usuario } from './_r2.js'

export const POST = responder(async (req) => {
  const { sb, role } = await usuario(req)
  if (role !== 'admin') throw new HttpError(403, 'Somente administradores excluem fotos.')
  const { photo_id } = (await req.json()) as { photo_id?: string }
  if (!photo_id) throw new HttpError(400, 'photo_id é obrigatório.')

  const { data: foto } = await sb.from('point_photos').select('id, r2_key').eq('id', photo_id).single()
  if (!foto) throw new HttpError(404, 'Foto não encontrada.')

  const { error, count } = await sb.from('point_photos').delete({ count: 'exact' }).eq('id', photo_id)
  if (error) throw new HttpError(400, error.message)
  if (!count) throw new HttpError(403, 'A exclusão não foi permitida pelo banco.')
  await apagarObjeto(foto.r2_key)
  return { ok: true }
})
