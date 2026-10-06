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

export async function deletePoint(pointId: string) {
  unwrap(await supabase.from('points').delete().eq('id', pointId))
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

export async function photoUrls(pointId: string) {
  return callApi<{ urls: Record<string, string> }>('/api/fotos-ver', { point_id: pointId })
}

export async function uploadPhoto(pointId: string, file: Blob, nome: string) {
  const { url, key } = await callApi<{ url: string; key: string }>('/api/fotos-upload', {
    point_id: pointId, content_type: file.type || 'image/jpeg', nome,
  })
  const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'image/jpeg' } })
  if (!put.ok) throw new Error(`Falha ao enviar a foto para o armazenamento (${put.status}).`)
  unwrap(
    await supabase.from('point_photos').insert({
      point_id: pointId, r2_key: key, nome_arquivo: nome, content_type: file.type || 'image/jpeg', tamanho_bytes: file.size,
    }),
  )
}

export async function deletePhoto(photoId: string) {
  await callApi('/api/fotos-excluir', { photo_id: photoId })
}
