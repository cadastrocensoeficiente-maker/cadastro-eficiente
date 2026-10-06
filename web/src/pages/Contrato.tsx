import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getContract, getLayout } from '../lib/api'
import { msgErro } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract, LayoutItem } from '../lib/types'
import TabelaPontos from '../components/TabelaPontos'
import Colunas from '../components/Colunas'
import { ContratoForm } from './Contratos'

const Importar = lazy(() => import('../components/Importar'))

type Aba = 'pontos' | 'colunas' | 'importar' | 'dados'

export default function Contrato() {
  const { contractId } = useParams()
  const { isAdmin } = useAuth()
  const [params, setParams] = useSearchParams()
  const aba = (params.get('aba') as Aba) || 'pontos'
  const [contrato, setContrato] = useState<Contract | null>(null)
  const [layout, setLayout] = useState<LayoutItem[]>([])
  const [erro, setErro] = useState('')

  const recarregar = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([getContract(contractId!), getLayout(contractId!)])
      setContrato(c)
      setLayout(l)
    } catch (e) {
      setErro(msgErro(e))
    }
  }, [contractId])

  useEffect(() => {
    recarregar()
  }, [recarregar])

  if (erro) return <div className="alerta erro">{erro}</div>
  if (!contrato) return <div className="carregando">Carregando contrato…</div>

  const abas: { id: Aba; nome: string; admin?: boolean }[] = [
    { id: 'pontos', nome: 'Pontos' },
    { id: 'colunas', nome: 'Colunas' },
    { id: 'importar', nome: 'Importar Excel', admin: true },
    { id: 'dados', nome: 'Dados do contrato', admin: true },
  ]

  return (
    <section>
      <div className="trilha">
        <Link to="/">Contratos</Link> / <span>{contrato.nome}</span>
      </div>
      <div className="cabecalho-pagina">
        <div>
          <h1>{contrato.nome}</h1>
          <p className="sub">
            {[contrato.municipio, contrato.uf].filter(Boolean).join(' / ')} · <span className="mono">EPSG {contrato.epsg}</span>
          </p>
        </div>
      </div>

      <div className="abas" role="tablist">
        {abas
          .filter((a) => !a.admin || isAdmin)
          .map((a) => (
            <button
              key={a.id}
              role="tab"
              aria-selected={aba === a.id}
              className={aba === a.id ? 'aba ativa' : 'aba'}
              onClick={() => setParams({ aba: a.id })}
            >
              {a.nome}
            </button>
          ))}
      </div>

      {aba === 'pontos' && <TabelaPontos contrato={contrato} layout={layout} />}
      {aba === 'colunas' && <Colunas contrato={contrato} onMudou={recarregar} />}
      {aba === 'importar' && isAdmin && (
        <Suspense fallback={<div className="carregando">Carregando…</div>}>
          <Importar contrato={contrato} layout={layout} />
        </Suspense>
      )}
      {aba === 'dados' && isAdmin && (
        <ContratoForm contrato={contrato} onFechar={() => setParams({ aba: 'pontos' })} onSalvo={(c) => { setContrato(c); recarregar() }} />
      )}
    </section>
  )
}
