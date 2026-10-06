import proj4 from 'proj4'

/**
 * Pré-visualização de TMX/TMY no aparelho, inclusive offline.
 * O valor oficial é sempre recalculado pelo servidor (PostGIS) no envio.
 */
export function previaTM(lat: number, lon: number, proj4def: string): { tmx: number; tmy: number } | null {
  try {
    const [x, y] = proj4('EPSG:4326', proj4def, [lon, lat])
    return { tmx: Math.round(x * 1000) / 1000, tmy: Math.round(y * 1000) / 1000 }
  } catch {
    return null
  }
}

export const fmt3 = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

export interface Leitura {
  latitude: number
  longitude: number
  precisao: number | null
  em: string
}

/**
 * Acompanha o GPS e devolve a melhor leitura. Para sozinho quando a precisão
 * fica boa (≤ alvo) ou após o tempo máximo; o cadastrador pode aceitar antes.
 */
export function capturarGPS(
  aoAtualizar: (melhor: Leitura) => void,
  aoTerminar: (melhor: Leitura | null, erro?: string) => void,
  alvoM = 8,
  maxS = 45,
): () => void {
  if (!navigator.geolocation) {
    aoTerminar(null, 'Este aparelho não oferece GPS ao navegador.')
    return () => {}
  }
  let melhor: Leitura | null = null
  let fim = false
  const terminar = (erro?: string) => {
    if (fim) return
    fim = true
    navigator.geolocation.clearWatch(id)
    clearTimeout(t)
    aoTerminar(melhor, erro)
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const l: Leitura = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        precisao: pos.coords.accuracy ? Math.round(pos.coords.accuracy * 10) / 10 : null,
        em: new Date(pos.timestamp).toISOString(),
      }
      if (!melhor || (l.precisao ?? 999) <= (melhor.precisao ?? 999)) {
        melhor = l
        aoAtualizar(l)
      }
      if (l.precisao !== null && l.precisao <= alvoM) terminar()
    },
    (err) =>
      terminar(
        err.code === err.PERMISSION_DENIED
          ? 'Permissão de localização negada. Libere a localização para o app nas configurações do celular.'
          : 'Não foi possível obter sinal de GPS. Vá para um local aberto e tente de novo.',
      ),
    { enableHighAccuracy: true, maximumAge: 0, timeout: maxS * 1000 },
  )
  const t = setTimeout(() => terminar(melhor ? undefined : 'O GPS não respondeu a tempo.'), maxS * 1000)
  return () => terminar()
}

/** Reduz a foto para no máximo 1920 px, JPEG 80% — economiza espaço e dados. */
export async function comprimirFoto(arquivo: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' })
    const max = 1920
    const esc = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * esc)
    c.height = Math.round(bmp.height * esc)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close()
    const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.8))
    return b && b.size < arquivo.size ? b : arquivo
  } catch {
    return arquivo
  }
}
