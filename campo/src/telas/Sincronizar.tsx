import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { enviarTudo, ouvirSync, type EstadoSync } from '../lib/sync'
import { useOnline } from './BarraStatus'

/** Quantos pontos e fotos ainda estão só no celular. */
export function usePendentes(userId: string) {
  // Só contagens pelos índices: não lê as fotos (o celular aguenta milhares).
  return useLiveQuery(async () => {
    const noCelular = await db.pontos.where('userId').equals(userId).count()
    const enviados = await db.pontos.where('status').equals('enviado').and((p) => p.userId === userId).count()
    const fotos = await db.fotos.where('status').anyOf('pendente', 'erro', 'enviando').count()
    return { pontos: noCelular - enviados, noCelular, fotos }
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
      {enviando && sync?.progresso && <Progresso p={sync.progresso} />}
      {!enviando && total > 0 && pend.fotos > 0 && <p className="nota">{pend.fotos} foto(s) a enviar.</p>}
      {!online && total > 0 && <p className="nota">Sem internet: os pontos ficam guardados no celular até você sincronizar.</p>}
      {sync?.resultado && Date.now() - sync.resultado.em < 120_000 && (
        <div className={`alerta ${sync.resultado.ok ? 'ok' : 'erro'}`}>{sync.resultado.mensagem}</div>
      )}
    </div>
  )
}

export function Progresso({ p }: { p: NonNullable<EstadoSync['progresso']> }) {
  const pct = p.total ? Math.round((p.feito / p.total) * 100) : 0
  return (
    <div className="progresso" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="progresso-txt">
        <span>{p.etapa}…</span>
        {p.total > 0 && <span className="mono">{p.feito} de {p.total}</span>}
      </div>
      <div className="progresso-barra"><div style={{ width: `${p.total ? pct : 100}%` }} /></div>
      <small>Mantenha o app aberto. Se a internet cair, ele tenta de novo sozinho; nada se perde.</small>
    </div>
  )
}
