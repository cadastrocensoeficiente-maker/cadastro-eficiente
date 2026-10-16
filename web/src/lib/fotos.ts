/** Reduz a foto para no máximo 2048 px e JPEG 85% — economiza dados móveis e armazenamento. */
export async function comprimir(arquivo: File): Promise<Blob> {
  if (!arquivo.type.startsWith('image/')) return arquivo
  try {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' })
    const max = 2048
    const escala = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * escala)
    const h = Math.round(bmp.height * escala)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85))
    return blob && blob.size < arquivo.size ? blob : arquivo
  } catch {
    return arquivo
  }
}
