// Atualização automática das telas do APK (sem reinstalar).
// O GitHub Actions publica, a cada versão, o pacote "campo-web.zip" no Releases.
// O app confere a versão mais nova e baixa em segundo plano, mas SÓ aplica
// quando o cadastrador toca na faixa "Nova versão" (nunca sozinho: abrir a
// câmera coloca o app em segundo plano e uma troca nessa hora tirava o
// cadastrador do formulário).
// Os pontos ficam no banco do aparelho (IndexedDB) e não são afetados.
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { NATIVO } from './config'

export const VERSAO = Number(import.meta.env.VITE_VERSAO || 0)
export const versaoTexto = (n: number) => (n ? `1.${n}` : 'web')

const API_RELEASE = 'https://api.github.com/repos/cadastrocensoeficiente-maker/cadastro-eficiente/releases/latest'
const INTERVALO_MS = 15 * 60_000

let ultimaVerificacao = 0
let emAndamento = false
const CHAVE_PACOTE = 'pacote-baixado'
let baixada = 0
let ouvinte: (versao: number) => void = () => {}

export async function iniciarAtualizacao(aoBaixar: (versao: number) => void) {
  ouvinte = aoBaixar
  if (!NATIVO) return
  try {
    // Confirma que esta versão abriu bem (senão o plugin volta para a anterior).
    await CapacitorUpdater.notifyAppReady()
  } catch {
    /* ignora */
  }
  try {
    // Versões antigas agendavam a troca para o segundo plano; cancela isso
    // apontando a "próxima" para a atual (o plugin ignora quando são iguais).
    const prox = await CapacitorUpdater.getNextBundle()
    if (prox) {
      const atual = await CapacitorUpdater.current()
      if (prox.id !== atual.bundle.id) {
        localStorage.setItem(CHAVE_PACOTE, JSON.stringify({ id: prox.id, versao: Number(prox.version) || 0 }))
        await CapacitorUpdater.next({ id: atual.bundle.id })
      }
    }
  } catch {
    /* ignora */
  }
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE_PACOTE) ?? 'null') as { id: string; versao: number } | null
    if (p && p.versao > VERSAO) {
      const { bundles } = await CapacitorUpdater.list()
      if (bundles.some((b) => b.id === p.id)) {
        baixada = p.versao
        ouvinte(p.versao)
        return
      }
    }
    localStorage.removeItem(CHAVE_PACOTE)
  } catch {
    /* ignora */
  }
  verificarAtualizacao(true)
}

export type ResultadoVerificacao = 'nova' | 'atual' | 'erro' | 'ignorado'

export async function verificarAtualizacao(forcar = false): Promise<ResultadoVerificacao> {
  if (!NATIVO || emAndamento || !navigator.onLine) return 'ignorado'
  if (baixada) return 'nova'
  if (!forcar && Date.now() - ultimaVerificacao < INTERVALO_MS) return 'ignorado'
  emAndamento = true
  ultimaVerificacao = Date.now()
  try {
    const r = await fetch(API_RELEASE, { headers: { Accept: 'application/vnd.github+json' } })
    if (!r.ok) return 'erro'
    const rel = (await r.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] }
    const nova = Number(String(rel.tag_name).replace(/\D/g, ''))
    const pacote = rel.assets.find((a) => a.name === 'campo-web.zip')
    if (!pacote || !nova || nova <= VERSAO) return 'atual'
    const bundle = await CapacitorUpdater.download({ url: pacote.browser_download_url, version: String(nova) })
    localStorage.setItem(CHAVE_PACOTE, JSON.stringify({ id: bundle.id, versao: nova }))
    baixada = nova
    ouvinte(nova)
    return 'nova'
  } catch {
    // sem internet ou GitHub indisponível: tenta de novo mais tarde
    return 'erro'
  } finally {
    emAndamento = false
  }
}

/** Troca para a versão baixada (o formulário em andamento fica salvo no aparelho). */
export async function aplicarAgora() {
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE_PACOTE) ?? 'null') as { id: string } | null
    localStorage.removeItem(CHAVE_PACOTE)
    if (p) {
      await CapacitorUpdater.set({ id: p.id })
      return
    }
  } catch {
    /* cai no reload abaixo */
  }
  await CapacitorUpdater.reload()
}
