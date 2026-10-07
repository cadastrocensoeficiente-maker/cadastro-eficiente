// Atualização automática das telas do APK (sem reinstalar).
// O GitHub Actions publica, a cada versão, o pacote "campo-web.zip" no Releases.
// O app confere a versão mais nova, baixa em segundo plano e aplica:
//  - na próxima vez que o app for para segundo plano, ou
//  - na hora, se o cadastrador tocar em "Atualizar agora".
// Os pontos ficam no banco do aparelho (IndexedDB) e não são afetados.
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { NATIVO } from './config'

export const VERSAO = Number(import.meta.env.VITE_VERSAO || 0)
export const versaoTexto = (n: number) => (n ? `1.${n}` : 'web')

const API_RELEASE = 'https://api.github.com/repos/cadastrocensoeficiente-maker/cadastro-eficiente/releases/latest'
const INTERVALO_MS = 15 * 60_000

let ultimaVerificacao = 0
let emAndamento = false
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
    await CapacitorUpdater.next({ id: bundle.id })
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

export async function aplicarAgora() {
  await CapacitorUpdater.reload()
}
