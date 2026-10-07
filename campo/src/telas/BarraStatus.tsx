import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { enviarTudo, ouvirSync, type EstadoSync } from '../lib/sync'
import type { Usuario } from '../App'
import { VERSAO, verificarAtualizacao, versaoTexto } from '../lib/atualizacao'
import { NATIVO } from '../lib/config'

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine)
  useEffect(() => {
    const a = () => setOn(true)
    const b = () => setOn(false)
    window.addEventListener('online', a)
    window.addEventListener('offline', b)
    return () => {
      window.removeEventListener('online', a)
      window.removeEventListener('offline', b)
    }
  }, [])
  return on
}

export default function BarraStatus({ usuario, onSair }: { usuario: Usuario; onSair: () => void }) {
  const online = useOnline()
  const [sync, setSync] = useState<EstadoSync | null>(null)
  useEffect(() => {
    const off = ouvirSync(setSync)
    return () => {
      off()
    }
  }, [])
  const noCelular = useLiveQuery(() => db.pontos.where('userId').equals(usuario.id).count(), [usuario.id], 0)
  const erros = useLiveQuery(async () => (await db.pontos.where('status').equals('erro').count()) + (await db.fotos.where('status').equals('erro').count()), [], 0)
  const [menu, setMenu] = useState(false)
  const [procurando, setProcurando] = useState(false)
  const [msgVersao, setMsgVersao] = useState('')

  const ultima = sync?.ultimaVez ? new Date(sync.ultimaVez).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'nunca'

  return (
    <>
      <header className="barra">
        <span className={`sinal ${online ? 'on' : 'off'}`}>{online ? 'Online' : 'Offline'}</span>
        <button className="sync" onClick={() => enviarTudo()} disabled={!online || sync?.enviando || noCelular === 0}>
          {sync?.enviando ? `⟳ Sincronizando…${sync.progresso?.total ? ` ${sync.progresso.feito}/${sync.progresso.total}` : ''}` : noCelular > 0 ? `⇡ Sincronizar · ${noCelular} no celular` : `✓ Tudo sincronizado · ${ultima}`}
        </button>
        <button className="menu-btn" onClick={() => setMenu(!menu)} aria-label="Menu">☰</button>
      </header>
      {erros > 0 && <div className="faixa erro">{erros} item(ns) não foram enviados — abra "Pontos no celular" para ver o motivo e toque em SINCRONIZAR de novo.</div>}
      {sync?.precisaLogin && online && <div className="faixa aviso">Sessão expirada. Saia e entre de novo para enviar os pendentes (eles não serão perdidos).</div>}
      {!online && <div className="faixa off">Sem internet: os cadastros ficam salvos no celular. Sincronize quando tiver sinal.</div>}
      {menu && (
        <div className="menu" onClick={() => setMenu(false)}>
          <div className="menu-caixa" onClick={(e) => e.stopPropagation()}>
            <p><b>{usuario.nome}</b><br /><small>{usuario.email}</small></p>
            <p><small>Última sincronização: {ultima}</small></p>
            <p><small>Versão do app: {versaoTexto(VERSAO)}</small></p>
            {NATIVO && online && (
              <button className="btn" disabled={procurando} onClick={async () => {
                setProcurando(true)
                setMsgVersao('')
                const r = await verificarAtualizacao(true)
                setProcurando(false)
                setMsgVersao(r === 'nova' ? 'Nova versão baixada — toque na faixa verde para aplicar.' : r === 'atual' ? 'Você já está na versão mais nova.' : 'Não foi possível verificar agora.')
              }}>{procurando ? 'Procurando…' : 'Procurar atualização'}</button>
            )}
            {msgVersao && <p><small>{msgVersao}</small></p>}
            {sync?.ultimoErro && <p className="erro-txt"><small>{sync.ultimoErro}</small></p>}
            <button className="btn" onClick={() => { setMenu(false); onSair() }}>Sair da conta</button>
          </div>
        </div>
      )}
    </>
  )
}
