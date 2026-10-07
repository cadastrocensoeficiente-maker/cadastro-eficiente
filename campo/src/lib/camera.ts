import { Camera, CameraResultType, CameraSource, type Photo } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { db, type FotoLocal } from './db'

/**
 * Câmera do APK, à prova de pouca memória.
 *
 * Ao abrir a câmera o app vai para segundo plano e, em celulares com pouca
 * memória, o Android pode fechá-lo. Por isso:
 *  1. antes de abrir, anotamos no aparelho em qual ponto a foto deve entrar;
 *  2. a foto é gravada direto no banco do aparelho (nada fica só na memória);
 *  3. se o app tiver sido fechado, a foto chega no evento "appRestoredResult"
 *     quando ele reabre, e é gravada no mesmo ponto.
 */

const CHAVE_DESTINO = 'camera-destino'

export interface DestinoFoto {
  localPointId: string
  status: FotoLocal['status']
}

const OPCOES = {
  source: CameraSource.Camera,
  resultType: CameraResultType.Uri, // arquivo em disco, não base64 na memória
  quality: 75,
  width: 1600, // o próprio Android reduz; o app não precisa reprocessar
  correctOrientation: true,
  saveToGallery: false,
}

async function gravar(foto: Photo | { webPath?: string; path?: string }, destino: DestinoFoto): Promise<boolean> {
  const caminho = foto.webPath ?? (foto.path ? Capacitor.convertFileSrc(foto.path) : null)
  if (!caminho) return false
  const blob = await (await fetch(caminho)).blob()
  if (!blob.size) return false
  await db.fotos.add({
    id: crypto.randomUUID(),
    localPointId: destino.localPointId,
    blob,
    nome: `foto_${Date.now()}.jpg`,
    criadaEm: new Date().toISOString(),
    status: destino.status,
    tentativas: 0,
  })
  return true
}

/** Abre a câmera traseira e grava a foto no ponto indicado. false = cancelou. */
export async function fotografarPara(destino: DestinoFoto): Promise<boolean> {
  localStorage.setItem(CHAVE_DESTINO, JSON.stringify(destino))
  try {
    const foto = await Camera.getPhoto(OPCOES)
    return await gravar(foto, destino)
  } catch (e) {
    const m = String((e as Error)?.message ?? e).toLowerCase()
    if (m.includes('cancel') || m.includes('no image')) return false
    if (m.includes('permission') || m.includes('denied')) {
      throw new Error('Permissão da câmera negada. Libere a câmera para o app nas configurações do celular.')
    }
    throw new Error('Não foi possível usar a câmera. Tente de novo.')
  } finally {
    localStorage.removeItem(CHAVE_DESTINO)
  }
}

/**
 * Chamar uma vez, logo ao abrir o app: recupera a foto tirada enquanto o
 * Android tinha fechado o app por falta de memória.
 */
export function recuperarFotoInterrompida() {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('App')) return
  try {
    App.addListener('appRestoredResult', async (r) => {
      if (r.pluginId !== 'Camera') return
      const destino = JSON.parse(localStorage.getItem(CHAVE_DESTINO) ?? 'null') as DestinoFoto | null
      localStorage.removeItem(CHAVE_DESTINO)
      if (!destino || !r.success || !r.data) return
      try {
        await gravar(r.data as Photo, destino)
      } catch {
        /* foto perdida pelo sistema: o cadastro continua salvo, basta tirar de novo */
      }
    }).catch(() => {})
  } catch {
    /* app instalado sem o plugin: segue sem a recuperação */
  }
}
