import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { ouvirSync, sincronizar } from '../lib/sync'
import type { Tela, Usuario } from '../App'
import { useOnline } from './BarraStatus'
import BotaoSincronizar from './Sincronizar'
import { supabase } from '../lib/supabase'

const hojeISO = () => new Date().toISOString().slice(0, 10)

export default function Contratos({ usuario, irPara }: { usuario: Usuario; irPara: (t: Tela) => void }) {
  const online = useOnline()
  const contratos = useLiveQuery(() => db.contratos.orderBy('nome').toArray(), [])
  const contagens = useLiveQuery(async () => {
    const pts = await db.pontos.where('userId').equals(usuario.id).toArray()
    const m: Record<string, { hoje: number; pendentes: number }> = {}
    const hoje = hojeISO()
    for (const p of pts) {
      m[p.contractId] ??= { hoje: 0, pendentes: 0 }
      if (p.criadoEm.slice(0, 10) === hoje) m[p.contractId].hoje++
      m[p.contractId].pendentes++
    }
    return m
  }, [usuario.id])

  // Produção enviada (servidor): pontos que já saíram do celular
  const [producao, setProducao] = useState<Record<string, { hoje: number; total: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('producao') ?? '{}') } catch { return {} }
  })
  const ultimoEnvio = useLiveQuery(() => db.pontos.count(), [])
  useEffect(() => {
    if (!online || !contratos?.length) return
    ;(async () => {
      const m: Record<string, { hoje: number; total: number }> = {}
      for (const c of contratos) {
        const { data } = await supabase.rpc('campo_minha_producao', { p_contract: c.id })
        const r = (data as { hoje: number; total: number }[] | null)?.[0]
        if (r) m[c.id] = { hoje: Number(r.hoje), total: Number(r.total) }
      }
      setProducao(m)
      localStorage.setItem('producao', JSON.stringify(m))
    })()
  }, [online, contratos?.length, ultimoEnvio])

  const [atualizando, setAtualizando] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    const off = ouvirSync((e) => e.ultimoErro && setMsg(e.ultimoErro))
    return () => {
      off()
    }
  }, [])

  async function atualizar() {
    setMsg('')
    setAtualizando(true)
    await sincronizar({ contratos: true })
    setAtualizando(false)
  }

  if (!contratos) return <div className="centro">Carregando…</div>
  const atualizadoEm = contratos.reduce<string | null>((m, c) => (!m || c.atualizadoEm > m ? c.atualizadoEm : m), null)

  return (
    <main className="tela">
      <div className="titulo-linha">
        <h2 className="titulo">Meus contratos</h2>
        <button className="btn" onClick={atualizar} disabled={!online || atualizando}>
          {atualizando ? '⟳ Atualizando…' : '⟳ Atualizar'}
        </button>
      </div>
      <p className="nota">
        {online
          ? `Contratos e campos atualizados automaticamente${atualizadoEm ? ` · última vez às ${new Date(atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}.`
          : 'Sem internet: usando os campos baixados por último.'}
      </p>
      {msg && <div className="alerta erro">{msg}</div>}
      <BotaoSincronizar userId={usuario.id} />
      {contratos.length === 0 ? (
        <div className="vazio">
          <p>Nenhum contrato atribuído a você neste aparelho.</p>
          <p className="nota">Peça ao administrador para incluir você na equipe do contrato no painel de gestão{online ? ' e toque em atualizar.' : '. Depois conecte à internet.'}</p>
          <button className="btn" disabled={!online} onClick={() => sincronizar({ contratos: true })}>Atualizar</button>
        </div>
      ) : (
        <ul className="cards">
          {contratos.map((c) => {
            const k = contagens?.[c.id]
            return (
              <li key={c.id} className="card">
                <div className="card-topo">
                  <span className="card-nome">{c.nome}</span>
                  <span className="card-sub">{[c.municipio, c.uf].filter(Boolean).join(' / ')}</span>
                </div>
                <div className="card-numeros">
                  {k?.pendentes ? <span className="pend"><b>{k.pendentes}</b> no celular</span> : <span>0 no celular</span>}
                  <span><b>{producao[c.id]?.hoje ?? 0}</b> enviados hoje</span>
                  <span className="mono">{c.colunas.length} campos</span>
                </div>
                <div className="card-acoes">
                  <button className="btn" onClick={() => irPara({ nome: 'lista', contractId: c.id })}>No celular{k?.pendentes ? ` (${k.pendentes})` : ''}</button>
                  <button className="btn primario" onClick={() => irPara({ nome: 'cadastro', contractId: c.id })} disabled={c.colunas.length === 0}>
                    + Cadastrar ponto
                  </button>
                </div>
                {c.colunas.length === 0 && <p className="nota">Contrato ainda sem colunas configuradas no painel.</p>}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
