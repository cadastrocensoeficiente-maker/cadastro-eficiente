import { supabase } from './supabase'
import type { Contract, ContractColumn, LayoutItem, PointRow, Photo, Valor, ColumnType } from './types'

const unwrap = <T,>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error
  return r.data as T
}

// ---------------- Contratos ----------------
export async function listContracts() {
  return unwrap(await supabase.from('contracts').select('*').order('nome')) as Contract[]
}

export async function getContract(id: string) {
  return unwrap(await supabase.from('contracts').select('*').eq('id', id).single()) as Contract
}

export async function saveContract(c: Partial<Contract> & { nome: string }) {
  const payload = { nome: c.nome, municipio: c.municipio, uf: c.uf, epsg: c.epsg, id_digitos: c.id_digitos, ativo: c.ativo }
  if (c.id) return unwrap(await supabase.from('contracts').update(payload).eq('id', c.id).select().single()) as Contract
  return unwrap(await supabase.from('contracts').insert(payload).select().single()) as Contract
}

// ---------------- Colunas (sempre via RPC: o banco mantém 1..N) ----------------
export async function listColumns(contractId: string) {
  return unwrap(
    await supabase.from('contract_columns').select('*').eq('contract_id', contractId).order('position'),
  ) as ContractColumn[]
}

export async function getLayout(contractId: string) {
  return unwrap(await supabase.rpc('contract_layout', { p_contract: contractId })) as LayoutItem[]
}

export async function addColumn(contractId: string, label: string, type: ColumnType, required: boolean, options: string[], position: number | null) {
  return unwrap(
    await supabase.rpc('col_add', {
      p_contract: contractId, p_label: label, p_type: type, p_required: required, p_options: options, p_position: position,
    }),
  ) as ContractColumn
}

export async function updateColumn(columnId: string, label: string, type: ColumnType, required: boolean, options: string[]) {
  return unwrap(
    await supabase.rpc('col_update', { p_column: columnId, p_label: label, p_type: type, p_required: required, p_options: options }),
  ) as ContractColumn
}

export async function removeColumn(columnId: string) {
  unwrap(await supabase.rpc('col_remove', { p_column: columnId }))
}

export async function reorderColumns(contractId: string, orderedIds: string[]) {
  return unwrap(await supabase.rpc('col_reorder', { p_contract: contractId, p_ordered_ids: orderedIds })) as ContractColumn[]
}

export async function copyColumns(target: string, source: string) {
  return unwrap(await supabase.rpc('col_copy_from', { p_target: target, p_source: source })) as ContractColumn[]
}

// ---------------- Pontos ----------------
export async function listPoints(contractId: string, page: number, pageSize: number, busca: string) {
  let q = supabase
    .from('points_view')
    .select('*', { count: 'exact' })
    .eq('contract_id', contractId)
    .order('seq', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1)
  if (busca.trim()) {
    const b = busca.trim().replace(/[%,()]/g, '')
    q = q.ilike('busca', `%${b}%`)
  }
  const r = await q
  if (r.error) throw r.error
  return { rows: (r.data ?? []) as PointRow[], total: r.count ?? 0 }
}

/** Todos os pontos em ordem de ID (para exportação), em lotes de 1000. */
export async function listAllPoints(contractId: string, onProgress?: (n: number) => void) {
  const all: PointRow[] = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const r = await supabase
      .from('points_view')
      .select('*')
      .eq('contract_id', contractId)
      .order('seq')
      .range(from, from + size - 1)
    if (r.error) throw r.error
    all.push(...((r.data ?? []) as PointRow[]))
    onProgress?.(all.length)
    if (!r.data || r.data.length < size) break
  }
  return all
}

export async function getPoint(pointId: string) {
  return unwrap(await supabase.from('points_view').select('*').eq('id', pointId).single()) as PointRow
}

export interface PointInput {
  latitude: number | null
  longitude: number | null
  precisao_m: number | null
  capturado_em: string | null
  valores: Record<string, Valor>
}

/** ID, TMX e TMY nunca são enviados: o banco gera/calcula. */
export async function createPoint(contractId: string, p: PointInput) {
  const r = await supabase.from('points').insert({ contract_id: contractId, ...p }).select('id').single()
  return unwrap(r) as { id: string }
}

export async function updatePoint(pointId: string, p: PointInput) {
  unwrap(await supabase.from('points').update(p).eq('id', pointId).select('id').single())
}

/** Move pontos para a lixeira (somente admin). Fotos e ID ficam guardados. */
export async function deletePoints(ids: string[]) {
  return unwrap(await supabase.rpc('admin_excluir_pontos', { p_ids: ids })) as number
}

export async function deletePoint(pointId: string) {
  await deletePoints([pointId])
}

export async function restorePoints(ids: string[]) {
  return unwrap(await supabase.rpc('admin_restaurar_pontos', { p_ids: ids })) as number
}

export interface PontoLixeira {
  id: string
  codigo: string
  valores: Record<string, Valor>
  latitude: number | null
  longitude: number | null
  total_fotos: number
  excluido_em: string
  excluido_por_nome: string | null
}

export async function listTrash(contractId: string) {
  return unwrap(await supabase.rpc('admin_lixeira', { p_contract: contractId })) as PontoLixeira[]
}

export async function previewCoord(contractId: string, lat: number, lon: number) {
  const r = unwrap(await supabase.rpc('preview_coordenada', { p_contract: contractId, p_lat: lat, p_lon: lon })) as {
    tmx: number; tmy: number; epsg: number
  }[]
  return r[0]
}

export async function importPoints(contractId: string, rows: unknown[]) {
  const r = unwrap(await supabase.rpc('points_import', { p_contract: contractId, p_rows: rows })) as {
    inseridos: number; sem_coordenada: number
  }[]
  return r[0]
}

// ---------------- Fotos (Cloudflare R2 via /api) ----------------
async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sessão expirada. Entre novamente.')
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function callApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: await authHeader(), body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Falha ${res.status} em ${path}`)
  return json as T
}

export async function listPhotos(pointId: string) {
  return unwrap(
    await supabase.from('point_photos').select('*').eq('point_id', pointId).order('ordem').order('created_at'),
  ) as Photo[]
}

/** Links temporários das fotos: R2 via /api e armazenamento do Supabase direto. */
export async function photoUrls(fotos: Photo[]) {
  const urls: Record<string, string> = {}
  const doSupabase = fotos.filter((f) => f.armazenamento === 'supabase')
  if (doSupabase.length) {
    const { data, error } = await supabase.storage.from('fotos').createSignedUrls(doSupabase.map((f) => f.r2_key), 3600)
    if (error) throw error
    data?.forEach((d, i) => { if (d.signedUrl) urls[doSupabase[i].id] = d.signedUrl })
  }
  const doR2 = fotos.filter((f) => f.armazenamento !== 'supabase')
  if (doR2.length) {
    const r = await callApi<{ urls: Record<string, string> }>('/api/fotos-ver', { point_id: doR2[0].point_id })
    Object.assign(urls, r.urls)
  }
  return urls
}

class SemR2 extends Error {}

export async function uploadPhoto(pointId: string, contractId: string, file: Blob, nome: string) {
  const tipo = file.type || 'image/jpeg'
  try {
    const res = await fetch('/api/fotos-upload', {
      method: 'POST', headers: await authHeader(), body: JSON.stringify({ point_id: pointId, content_type: tipo, nome }),
    })
    if (res.status === 503) throw new SemR2()
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error ?? `Falha ${res.status}`)
    const put = await fetch(j.url, { method: 'PUT', body: file, headers: { 'Content-Type': tipo } })
    if (!put.ok) throw new Error(`Falha ao enviar a foto para o armazenamento (${put.status}).`)
    unwrap(await supabase.from('point_photos').insert({
      point_id: pointId, r2_key: j.key, nome_arquivo: nome, content_type: tipo, tamanho_bytes: file.size, armazenamento: 'r2',
    }))
  } catch (e) {
    if (!(e instanceof SemR2)) throw e
    // R2 ainda não configurado: guarda no armazenamento do Supabase
    const key = `contratos/${contractId}/pontos/${pointId}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.jpg`
    const up = await supabase.storage.from('fotos').upload(key, file, { contentType: tipo, upsert: false })
    if (up.error) throw up.error
    unwrap(await supabase.from('point_photos').insert({
      point_id: pointId, r2_key: key, nome_arquivo: nome, content_type: tipo, tamanho_bytes: file.size, armazenamento: 'supabase',
    }))
  }
}

export async function deletePhoto(foto: Photo) {
  if (foto.armazenamento === 'supabase') {
    unwrap(await supabase.from('point_photos').delete().eq('id', foto.id))
    await supabase.storage.from('fotos').remove([foto.r2_key])
    return
  }
  await callApi('/api/fotos-excluir', { photo_id: foto.id })
}
