// Sincronização do app de campo.
// - Automática: baixa contratos e colunas.
// - Botão SINCRONIZAR (enviarTudo): envia pontos e fotos e tira do celular o que foi enviado.
import { db, type ColunaCampo, type ContratoLocal, type FotoLocal, type PontoLocal } from './db'
import { supabase, msgErro } from './supabase'
import { API_BASE } from './config'

type Ouvinte = (e: EstadoSync) => void
export interface EstadoSync {
  rodando: boolean
  ultimaVez: string | null
  ultimoErro: string | null
  precisaLogin: boolean
  enviando: boolean
  resultado: { ok: boolean; mensagem: string; em: number } | null
}

let estado: EstadoSync = { rodando: false, ultimaVez: localStorage.getItem('ultima-sync'), ultimoErro: null, precisaLogin: false, enviando: false, resultado: null }
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

class SemR2 extends Error {}

/** Envia uma foto: Cloudflare R2 se configurado; senão, armazenamento do Supabase. */
async function subirFoto(f: FotoLocal, ponto: PontoLocal, token: string) {
  const tipo = f.blob.type || 'image/jpeg'
  try {
    const res = await fetch(`${API_BASE}/api/fotos-upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ point_id: ponto.serverId, content_type: tipo, nome: f.nome }),
    })
    if (res.status === 503) throw new SemR2()
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error ?? `Falha ${res.status}`)
    const put = await fetch(j.url, { method: 'PUT', body: f.blob, headers: { 'Content-Type': tipo } })
    if (!put.ok) throw new Error(`Armazenamento recusou a foto (${put.status}).`)
    const { error } = await supabase.from('point_photos').insert({
      point_id: ponto.serverId, r2_key: j.key, nome_arquivo: f.nome, content_type: tipo, tamanho_bytes: f.blob.size, armazenamento: 'r2',
    })
    if (error) throw error
  } catch (e) {
    if (!(e instanceof SemR2)) throw e
    const key = `contratos/${ponto.contractId}/pontos/${ponto.serverId}/${ponto.codigo ?? 'p'}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.jpg`
    const up = await supabase.storage.from('fotos').upload(key, f.blob, { contentType: tipo, upsert: false })
    if (up.error) throw up.error
    const { error } = await supabase.from('point_photos').insert({
      point_id: ponto.serverId, r2_key: key, nome_arquivo: f.nome, content_type: tipo, tamanho_bytes: f.blob.size, armazenamento: 'supabase',
    })
    if (error) throw error
  }
}

async function enviarFotos(token: string) {
  let enviadas = 0
  const fotos = await db.fotos.where('status').anyOf('pendente', 'erro', 'enviando').toArray()
  for (const f of fotos) {
    const ponto = await db.pontos.get(f.localPointId)
    if (!ponto?.serverId) continue // o ponto ainda não foi enviado
    try {
      await db.fotos.update(f.id, { status: 'enviando' })
      await subirFoto(f, ponto, token)
      await db.fotos.update(f.id, { status: 'enviado', erro: undefined, blob: new Blob([]) })
      enviadas++
    } catch (e) {
      const rede = erroDeRede(e)
      await db.fotos.update(f.id, { status: rede ? 'pendente' : 'erro', erro: rede ? undefined : msgErro(e), tentativas: f.tentativas + 1 })
      if (rede) throw e
    }
  }
  return enviadas
}

/** Apaga do aparelho os pontos que já foram enviados com todas as fotos. */
async function limparEnviados(userId: string) {
  const enviados = await db.pontos.where('status').equals('enviado').and((p) => p.userId === userId).toArray()
  let removidos = 0
  for (const p of enviados) {
    const fotos = await db.fotos.where('localPointId').equals(p.localId).toArray()
    if (fotos.some((f) => f.status !== 'enviado')) continue
    await db.transaction('rw', db.pontos, db.fotos, async () => {
      await db.fotos.where('localPointId').equals(p.localId).delete()
      await db.pontos.delete(p.localId)
    })
    removidos++
  }
  return removidos
}

let emAndamento: Promise<void> | null = null
let ultimaBaixaContratos = 0
// Contratos e colunas são conferidos no servidor a cada 1 minuto (com internet),
// além de ao abrir o app, ao voltar para ele e no botão Atualizar.
const INTERVALO_CONTRATOS_MS = 60_000

/**
 * Automático (abrir o app, voltar para ele, a cada minuto): só baixa contratos e colunas.
 * Os pontos NÃO são enviados sozinhos — ficam no celular até o botão SINCRONIZAR.
 */
export function sincronizar(opcoes: { contratos?: boolean } = {}): Promise<void> {
  if (emAndamento) return opcoes.contratos ? emAndamento.then(() => sincronizar(opcoes)) : emAndamento
  if (!navigator.onLine) return Promise.resolve()
  if (!opcoes.contratos && Date.now() - ultimaBaixaContratos < INTERVALO_CONTRATOS_MS) return Promise.resolve()
  emAndamento = (async () => {
    emitir({ rodando: true, ultimoErro: null })
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data.session) {
        emitir({ precisaLogin: true })
        return
      }
      emitir({ precisaLogin: false })
      await baixarContratos()
      ultimaBaixaContratos = Date.now()
    } catch (e) {
      emitir({ ultimoErro: msgErro(e) })
    } finally {
      emitir({ rodando: false })
      emAndamento = null
    }
  })()
  return emAndamento
}

export interface ResultadoEnvio {
  ok: boolean
  pontos: number
  fotos: number
  removidos: number
  comErro: number
  mensagem: string
}

/** Botão SINCRONIZAR: envia tudo o que está no aparelho e remove o que foi enviado. */
export async function enviarTudo(): Promise<ResultadoEnvio> {
  const falha = (mensagem: string): ResultadoEnvio => {
    emitir({ resultado: { ok: false, mensagem, em: Date.now() } })
    return { ok: false, pontos: 0, fotos: 0, removidos: 0, comErro: 0, mensagem }
  }
  if (!navigator.onLine) return falha('Sem internet. Os pontos continuam salvos no celular; sincronize quando tiver sinal.')
  if (emAndamento) await emAndamento.catch(() => {})
  let pontosOk = 0
  let fotosOk = 0
  let removidos = 0
  emAndamento = (async () => {})()
  emitir({ rodando: true, enviando: true, ultimoErro: null, resultado: null })
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) {
      emitir({ precisaLogin: true })
      return falha('Sessão expirada. Saia e entre de novo — os pontos não serão perdidos.')
    }
    emitir({ precisaLogin: false })
    const userId = data.session.user.id
    // Nova tentativa manual: o que deu erro antes volta para a fila.
    await db.pontos.where('status').equals('erro').modify({ status: 'pendente', erro: undefined })
    await db.fotos.where('status').equals('erro').modify({ status: 'pendente', erro: undefined })

    const fila = await db.pontos.where('status').anyOf('pendente', 'enviando').and((p) => p.userId === userId).sortBy('criadoEm')
    for (const p of fila) {
      await enviarPonto(p)
      if ((await db.pontos.get(p.localId))?.status === 'enviado') pontosOk++
    }
    fotosOk = await enviarFotos(data.session.access_token)
    removidos = await limparEnviados(userId)

    const comErro = (await db.pontos.where('status').equals('erro').count()) + (await db.fotos.where('status').equals('erro').count())
    const agora = new Date().toISOString()
    localStorage.setItem('ultima-sync', agora)
    emitir({ ultimaVez: agora })
    try {
      await baixarContratos()
      ultimaBaixaContratos = Date.now()
    } catch {
      /* não impede o envio */
    }
    const partes = [`${pontosOk} ponto(s) e ${fotosOk} foto(s) enviados`]
    if (removidos) partes.push(`${removidos} removido(s) do celular`)
    if (comErro) partes.push(`${comErro} com erro — veja a lista do contrato`)
    const r = { ok: comErro === 0, pontos: pontosOk, fotos: fotosOk, removidos, comErro, mensagem: partes.join(' · ') + '.' }
    emitir({ resultado: { ok: r.ok, mensagem: r.mensagem, em: Date.now() } })
    return r
  } catch (e) {
    const m = erroDeRede(e) ? 'A internet caiu durante o envio. O que faltou continua no celular; toque em SINCRONIZAR de novo.' : msgErro(e)
    emitir({ ultimoErro: m, resultado: { ok: false, mensagem: m, em: Date.now() } })
    return { ...falha(m), pontos: pontosOk, fotos: fotosOk, removidos }
  } finally {
    emitir({ rodando: false, enviando: false })
    emAndamento = null
  }
}
