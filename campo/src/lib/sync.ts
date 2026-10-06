// Sincronização: baixa contratos/colunas e envia pontos e fotos pendentes.
// Roda ao abrir o app, quando a internet volta, a cada 30 s e após cada cadastro.
import { db, type ColunaCampo, type ContratoLocal, type PontoLocal } from './db'
import { supabase, msgErro } from './supabase'

type Ouvinte = (e: EstadoSync) => void
export interface EstadoSync {
  rodando: boolean
  ultimaVez: string | null
  ultimoErro: string | null
  precisaLogin: boolean
}

let estado: EstadoSync = { rodando: false, ultimaVez: localStorage.getItem('ultima-sync'), ultimoErro: null, precisaLogin: false }
const ouvintes = new Set<Ouvinte>()
const emitir = (p: Partial<EstadoSync>) => {
  estado = { ...estado, ...p }
  ouvintes.forEach((o) => o(estado))
}
export const ouvirSync = (o: Ouvinte) => {
  ouvintes.add(o)
  o(estado)
  return () => ouvintes.delete(o)
}

const erroDeRede = (e: unknown) => {
  const m = (e as { message?: string })?.message ?? ''
  return !navigator.onLine || m.includes('Failed to fetch') || m.includes('NetworkError') || m.includes('Load failed')
}

/** Baixa os contratos atribuídos e a sequência de colunas de cada um. */
export async function baixarContratos() {
  const { data, error } = await supabase.rpc('campo_meus_contratos')
  if (error) throw error
  const lista = (data ?? []) as { id: string; nome: string; municipio: string | null; uf: string | null; epsg: number; proj4: string }[]
  const agora = new Date().toISOString()
  const novos: ContratoLocal[] = []
  for (const c of lista) {
    const { data: layout, error: e2 } = await supabase.rpc('contract_layout', { p_contract: c.id })
    if (e2) throw e2
    const colunas: ColunaCampo[] = (layout as { sistema: boolean; column_id: string; chave: string; rotulo: string; sequencia: number; tipo: string; obrigatoria: boolean; opcoes: string[] }[])
      .filter((l) => !l.sistema)
      .sort((a, b) => a.sequencia - b.sequencia)
      .map((l) => ({
        column_id: l.column_id, chave: l.chave, rotulo: l.rotulo, sequencia: l.sequencia,
        tipo: l.tipo as ColunaCampo['tipo'], obrigatoria: l.obrigatoria, opcoes: l.opcoes ?? [],
      }))
    novos.push({ ...c, colunas, atualizadoEm: agora })
  }
  await db.transaction('rw', db.contratos, async () => {
    await db.contratos.clear()
    await db.contratos.bulkPut(novos)
  })
}

async function enviarPonto(p: PontoLocal) {
  const contrato = await db.contratos.get(p.contractId)
  // Remove valores de colunas que o admin excluiu depois do cadastro.
  const validas = new Set(contrato?.colunas.map((c) => c.column_id) ?? [])
  const valores = Object.fromEntries(Object.entries(p.valores).filter(([k]) => validas.has(k)))

  await db.pontos.update(p.localId, { status: 'enviando' })
  const { data, error } = await supabase.rpc('campo_salvar_ponto', {
    p_contract: p.contractId,
    p_client_uuid: p.localId,
    p_latitude: p.latitude,
    p_longitude: p.longitude,
    p_precisao_m: p.precisaoM,
    p_capturado_em: p.capturadoEm,
    p_valores: valores,
  })
  if (error) {
    const rede = erroDeRede(error)
    await db.pontos.update(p.localId, {
      status: rede ? 'pendente' : 'erro',
      erro: rede ? undefined : msgErro(error),
      tentativas: p.tentativas + 1,
    })
    if (rede) throw error
    return
  }
  const r = (data as { id: string; codigo: string; tmx: number; tmy: number }[])[0]
  await db.pontos.update(p.localId, {
    status: 'enviado', erro: undefined, serverId: r.id, codigo: r.codigo,
    tmx: r.tmx === null ? undefined : Number(r.tmx), tmy: r.tmy === null ? undefined : Number(r.tmy),
  })
}

async function enviarFotos() {
  const { data: s } = await supabase.auth.getSession()
  const token = s.session?.access_token
  if (!token) return
  const fotos = await db.fotos.where('status').anyOf('pendente', 'erro', 'enviando').toArray()
  for (const f of fotos) {
    const ponto = await db.pontos.get(f.localPointId)
    if (!ponto?.serverId) continue // o ponto ainda não foi enviado
    if (f.status === 'erro' && f.tentativas >= 5) continue
    try {
      await db.fotos.update(f.id, { status: 'enviando' })
      const tipo = f.blob.type || 'image/jpeg'
      const res = await fetch('/api/fotos-upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ point_id: ponto.serverId, content_type: tipo, nome: f.nome }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Falha ${res.status}`)
      const put = await fetch(j.url, { method: 'PUT', body: f.blob, headers: { 'Content-Type': tipo } })
      if (!put.ok) throw new Error(`Armazenamento recusou a foto (${put.status}).`)
      const { error } = await supabase.from('point_photos').insert({
        point_id: ponto.serverId, r2_key: j.key, nome_arquivo: f.nome, content_type: tipo, tamanho_bytes: f.blob.size,
      })
      if (error) throw error
      // Enviada: libera o espaço do aparelho, mantendo o registro.
      await db.fotos.update(f.id, { status: 'enviado', erro: undefined, blob: new Blob([]) })
    } catch (e) {
      const rede = erroDeRede(e)
      await db.fotos.update(f.id, { status: rede ? 'pendente' : 'erro', erro: rede ? undefined : msgErro(e), tentativas: f.tentativas + 1 })
      if (rede) return
    }
  }
}

let emAndamento: Promise<void> | null = null

export function sincronizar(opcoes: { contratos?: boolean } = {}): Promise<void> {
  if (emAndamento) return emAndamento
  if (!navigator.onLine) return Promise.resolve()
  emAndamento = (async () => {
    emitir({ rodando: true, ultimoErro: null })
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session) {
        emitir({ precisaLogin: true })
        return
      }
      emitir({ precisaLogin: false })
      if (opcoes.contratos) await baixarContratos()

      const pendentes = await db.pontos
        .where('status').anyOf('pendente', 'enviando')
        .and((p) => p.userId === data.session!.user.id)
        .sortBy('criadoEm')
      for (const p of pendentes) await enviarPonto(p)
      await enviarFotos()

      const agora = new Date().toISOString()
      localStorage.setItem('ultima-sync', agora)
      emitir({ ultimaVez: agora })
    } catch (e) {
      emitir({ ultimoErro: msgErro(e) })
    } finally {
      emitir({ rodando: false })
      emAndamento = null
    }
  })()
  return emAndamento
}

/** Reenvia manualmente um ponto que deu erro (após o cadastrador corrigir). */
export async function reenviar(localId: string) {
  await db.pontos.update(localId, { status: 'pendente', erro: undefined })
  await db.fotos.where('localPointId').equals(localId).modify((f) => {
    if (f.status === 'erro') {
      f.status = 'pendente'
      f.tentativas = 0
    }
  })
  return sincronizar()
}
