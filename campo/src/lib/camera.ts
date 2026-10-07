import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'

/**
 * Abre direto a câmera traseira do celular (APK) e devolve a foto.
 * Retorna null se o cadastrador cancelar.
 */
export async function tirarFotoNativa(): Promise<Blob | null> {
  try {
    const foto = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri,
      quality: 80,
      width: 1920,
      correctOrientation: true,
      saveToGallery: false,
    })
    if (!foto.webPath) return null
    const resp = await fetch(foto.webPath)
    return await resp.blob()
  } catch (e) {
    const m = String((e as Error)?.message ?? e).toLowerCase()
    if (m.includes('cancel')) return null
    if (m.includes('permission') || m.includes('denied')) {
      throw new Error('Permissão da câmera negada. Libere a câmera para o app nas configurações do celular.')
    }
    throw e
  }
}
