import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { sincronizar } from '../lib/sync'
import type { Tela, Usuario } from '../App'
import { useOnline } from './BarraStatus'

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
      if (p.status !== 'enviado') m[p.contractId].pendentes++
    }
    return m
  }, [usuario.id])

  if (!contratos) return <div className="centro">Carregando…</div>

  return (
    <main className="tela">
      <h2 className="titulo">Meus contratos</h2>
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
                  <span><b>{k?.hoje ?? 0}</b> hoje</span>
                  {k?.pendentes ? <span className="pend"><b>{k.pendentes}</b> a enviar</span> : null}
                  <span className="mono">{c.colunas.length} campos</span>
                </div>
                <div className="card-acoes">
                  <button className="btn" onClick={() => irPara({ nome: 'lista', contractId: c.id })}>Meus pontos</button>
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
