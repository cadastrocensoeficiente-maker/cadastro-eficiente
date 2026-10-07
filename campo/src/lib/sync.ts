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
  /** Andamento do botão SINCRONIZAR (para a barra de progresso). */
  progresso: { etapa: string; feito: number; total: number } | null
}

let estado: EstadoSync = { rodando: false, ultimaVez: localStorage.getItem('ultima-sync'), ultimoErro: null, precisaLogin: false, enviando: false, resultado: null, progresso: null }
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
  const n = (e as { name?: string })?.name ?? ''
  return !navigator.onLine || n === 'TimeoutError' || n === 'AbortError' ||
    m.includes('Failed to fetch') || m.includes('NetworkError') || m.includes('Load failed') ||
    m.includes('timed out') || m.includes('network') || /\b(502|503|504)\b/.test(m)
}

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

/**
 * Tenta de novo quando a internet oscila (sinal fraco no campo):
 * espera 2 s, 5 s, 10 s, 20 s… antes de desistir. Erros de dados não repetem.
 */
async function comRepeticao<T>(fn: () => Promise<T>, tentativas = 5): Promise<T> {
  const pausas = [2000, 5000, 10000, 20000, 30000]
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (!erroDeRede(e) || i >= tentativas - 1) throw e
      await esperar(pausas[Math.min(i, pausas.length - 1)])
    }
  }
}

/** Token sempre válido (o envio pode durar mais que a validade do login). */
async function tokenAtual() {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('Sessão expirada. Saia e entre de novo — os pontos não serão perdidos.')
  return data.session.access_token
}

/** Mantém a tela do celular ligada enquanto sincroniza (o Android pausa o app com a tela apagada). */
async function manterTelaLigada(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    const trava = await nav.wakeLock?.request('screen')
    return () => { trava?.release().catch(() => {}) }
  } catch {
    return () => {}
  }
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

const LOTE_PONTOS = 50

/** Envia os pontos em lotes de 50 (uma chamada por lote). */
async function enviarPontos(fila: PontoLocal[], aoAvancar: (n: number) => void) {
  let ok = 0
  const colunasValidas = new Map<string, Set<string>>()
  for (const c of await db.contratos.toArray()) colunasValidas.set(c.id, new Set(c.colunas.map((x) => x.column_id)))

  for (let i = 0; i < fila.length; i += LOTE_PONTOS) {
    const lote = fila.slice(i, i + LOTE_PONTOS)
    const corpo = lote.map((p) => {
      // Remove valores de colunas que o admin excluiu depois do cadastro.
      const validas = colunasValidas.get(p.contractId)
      const valores = validas ? Object.fromEntries(Object.entries(p.valores).filter(([k]) => validas.has(k))) : p.valores
      return {
        contract: p.contractId, client_uuid: p.localId, latitude: p.latitude, longitude: p.longitude,
        precisao_m: p.precisaoM, capturado_em: p.capturadoEm, valores,
      }
    })
    await db.pontos.bulkUpdate(lote.map((p) => ({ key: p.localId, changes: { status: 'enviando' as const } })))
    let resp: { client_uuid: string; id: string | null; codigo: string | null; erro: string | null }[]
    try {
      resp = await comRepeticao(async () => {
        const { data, error } = await supabase.rpc('campo_salvar_pontos', { p_pontos: corpo })
        if (error) throw error
        return data as typeof resp
      })
    } catch (e) {
      // volta para a fila; o reenvio não duplica (client_uuid)
      await db.pontos.bulkUpdate(lote.map((p) => ({ key: p.localId, changes: { status: 'pendente' as const } })))
      throw e
    }
    const porId = new Map(resp.map((r) => [r.client_uuid, r]))
    await db.transaction('rw', db.pontos, async () => {
      for (const p of lote) {
        const r = porId.get(p.localId)
        if (r?.id) {
          ok++
          await db.pontos.update(p.localId, { status: 'enviado', erro: undefined, serverId: r.id, codigo: r.codigo ?? undefined })
        } else {
          await db.pontos.update(p.localId, { status: 'erro', erro: r?.erro ?? 'O servidor não confirmou este ponto.', tentativas: p.tentativas + 1 })
        }
      }
    })
    aoAvancar(Math.min(i + LOTE_PONTOS, fila.length))
  }
  return ok
}

class SemR2 extends Error {}
const jaExiste = (e: unknown) => /already exists|duplicate|409/i.test(String((e as { message?: string })?.message ?? e) + String((e as { statusCode?: string })?.statusCode ?? ''))

/**
 * Envia uma foto: Cloudflare R2 se configurado; senão, armazenamento do Supabase.
 * O nome do arquivo usa o id da foto no celular, então reenviar não duplica.
 */
async function subirFoto(f: FotoLocal, ponto: PontoLocal) {
  const tipo = f.blob.type || 'image/jpeg'
  const registro = { point_id: ponto.serverId, nome_arquivo: f.nome, content_type: tipo, tamanho_bytes: f.blob.size }
  const registrar = async (key: string, armazenamento: 'r2' | 'supabase') => {
    const { error } = await supabase.from('point_photos').upsert({ ...registro, r2_key: key, armazenamento }, { onConflict: 'r2_key', ignoreDuplicates: true })
    if (error) throw error
  }
  try {
    const res = await fetch(`${API_BASE}/api/fotos-upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await tokenAtual()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ point_id: ponto.serverId, content_type: tipo, nome: f.nome, ref: f.id }),
      signal: AbortSignal.timeout(60_000),
    })
    if (res.status === 503) throw new SemR2()
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error ?? `Falha ${res.status}`)
    const put = await fetch(j.url, { method: 'PUT', body: f.blob, headers: { 'Content-Type': tipo }, signal: AbortSignal.timeout(180_000) })
    if (!put.ok) throw new Error(`Armazenamento recusou a foto (${put.status}).`)
    await registrar(j.key, 'r2')
  } catch (e) {
    if (!(e instanceof SemR2)) throw e
    const key = `contratos/${ponto.contractId}/pontos/${ponto.serverId}/${ponto.codigo ?? 'p'}_${f.id}.jpg`
    const up = await supabase.storage.from('fotos').upload(key, f.blob, { contentType: tipo, upsert: false })
    if (up.error && !jaExiste(up.error)) throw up.error
    await registrar(key, 'supabase')
  }
}

const FOTOS_SIMULTANEAS = 3

/**
 * Envia as fotos com 3 envios ao mesmo tempo. Só a lista de ids fica na
 * memória; cada foto é lida do aparelho na hora de enviar e liberada logo depois.
 */
async function enviarFotos(aoAvancar: (feito: number, total: number) => void) {
  const ids = (await db.fotos.where('status').anyOf('pendente', 'erro', 'enviando').primaryKeys()) as string[]
  let enviadas = 0
  let feitas = 0
  let proximo = 0
  let falhaRede: unknown = null
  aoAvancar(0, ids.length)

  async function trabalhador() {
    while (!falhaRede && proximo < ids.length) {
      const id = ids[proximo++]
      const f = await db.fotos.get(id)
      if (f && f.status !== 'enviado' && f.status !== 'rascunho') {
        const ponto = await db.pontos.get(f.localPointId)
        if (ponto?.serverId) {
          try {
            await db.fotos.update(f.id, { status: 'enviando' })
            await comRepeticao(() => subirFoto(f, ponto))
            await db.fotos.update(f.id, { status: 'enviado', erro: undefined, blob: new Blob([]) })
            enviadas++
          } catch (e) {
            const rede = erroDeRede(e)
            await db.fotos.update(f.id, { status: rede ? 'pendente' : 'erro', erro: rede ? undefined : msgErro(e), tentativas: f.tentativas + 1 })
            if (rede) falhaRede = e
          }
        }
      }
      aoAvancar(++feitas, ids.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(FOTOS_SIMULTANEAS, ids.length) }, trabalhador))
  if (falhaRede) throw falhaRede
  return enviadas
}

/** Apaga do aparelho os pontos que já foram enviados com todas as fotos (sem ler as fotos). */
async function limparEnviados(userId: string) {
  const enviados = await db.pontos.where('status').equals('enviado').and((p) => p.userId === userId).primaryKeys() as string[]
  let removidos = 0
  for (const id of enviados) {
    const total = await db.fotos.where('localPointId').equals(id).count()
    const ok = await db.fotos.where('[localPointId+status]').equals([id, 'enviado']).count()
    if (ok < total) continue
    await db.transaction('rw', db.pontos, db.fotos, async () => {
      await db.fotos.where('localPointId').equals(id).delete()
      await db.pontos.delete(id)
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
  emitir({ rodando: true, enviando: true, ultimoErro: null, resultado: null, progresso: null })
  const liberarTela = await manterTelaLigada()
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) {
      emitir({ precisaLogin: true })
      return falha('Sessão expirada. Saia e entre de novo — os pontos não serão perdidos.')
    }
    emitir({ precisaLogin: false })
    const userId = data.session.user.id
    // Nova tentativa manual: o que deu erro (ou ficou no meio, se o app fechou) volta para a fila.
    await db.pontos.where('status').anyOf('erro', 'enviando').modify({ status: 'pendente', erro: undefined })
    await db.fotos.where('status').anyOf('erro', 'enviando').modify({ status: 'pendente', erro: undefined })

    const fila = await db.pontos.where('status').equals('pendente').and((p) => p.userId === userId).sortBy('criadoEm')
    emitir({ progresso: { etapa: 'Enviando pontos', feito: 0, total: fila.length } })
    pontosOk = await enviarPontos(fila, (n) => emitir({ progresso: { etapa: 'Enviando pontos', feito: n, total: fila.length } }))
    fotosOk = await enviarFotos((feito, total) => emitir({ progresso: { etapa: 'Enviando fotos', feito, total } }))
    emitir({ progresso: { etapa: 'Limpando o celular', feito: 0, total: 0 } })
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
    const m = erroDeRede(e) ? 'A internet caiu durante o envio e não voltou. O que já foi enviado está salvo; o restante continua no celular — toque em SINCRONIZAR de novo quando tiver sinal.' : msgErro(e)
    emitir({ ultimoErro: m, resultado: { ok: false, mensagem: m, em: Date.now() } })
    return { ...falha(m), pontos: pontosOk, fotos: fotosOk, removidos }
  } finally {
    liberarTela()
    emitir({ rodando: false, enviando: false, progresso: null })
    emAndamento = null
  }
}
