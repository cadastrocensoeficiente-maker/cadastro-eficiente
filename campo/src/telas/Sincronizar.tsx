import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { enviarTudo, ouvirSync, type EstadoSync } from '../lib/sync'
import { useOnline } from './BarraStatus'

/** Quantos pontos e fotos ainda estão só no celular. */
export function usePendentes(userId: string) {
  return useLiveQuery(async () => {
    const pontos = await db.pontos.where('userId').equals(userId).toArray()
    const ids = pontos.map((p) => p.localId)
    const fotos = ids.length ? await db.fotos.where('localPointId').anyOf(ids).and((f) => f.status !== 'enviado').count() : 0
    return { pontos: pontos.filter((p) => p.status !== 'enviado').length, noCelular: pontos.length, fotos }
  }, [userId], { pontos: 0, noCelular: 0, fotos: 0 })
}

export function useEstadoSync() {
  const [e, setE] = useState<EstadoSync | null>(null)
  useEffect(() => {
    const off = ouvirSync(setE)
    return () => {
      off()
    }
  }, [])
  return e
}

/** Botão grande SINCRONIZAR: envia tudo e tira do celular o que foi enviado. */
export default function BotaoSincronizar({ userId }: { userId: string }) {
  const online = useOnline()
  const pend = usePendentes(userId)
  const sync = useEstadoSync()
  const enviando = !!sync?.enviando
  const total = pend.noCelular

  return (
    <div className="sincronizar">
      <button className="btn sinc-btn" disabled={!online || enviando || total === 0} onClick={() => enviarTudo()}>
        {enviando ? '⟳ SINCRONIZANDO…' : total === 0 ? '✓ NADA PARA SINCRONIZAR' : `⇡ SINCRONIZAR (${total} ponto${total > 1 ? 's' : ''})`}
      </button>
      {!online && total > 0 && <p className="nota">Sem internet: os pontos ficam guardados no celular até você sincronizar.</p>}
      {sync?.resultado && Date.now() - sync.resultado.em < 120_000 && (
        <div className={`alerta ${sync.resultado.ok ? 'ok' : 'erro'}`}>{sync.resultado.mensagem}</div>
      )}
    </div>
  )
}
