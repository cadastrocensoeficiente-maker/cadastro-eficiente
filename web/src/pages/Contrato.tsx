import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { deleteContract, getContract, getLayout } from '../lib/api'
import { msgErro } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract, LayoutItem } from '../lib/types'
import TabelaPontos from '../components/TabelaPontos'
import Colunas from '../components/Colunas'
import Equipe from '../components/Equipe'
import { ContratoForm } from './Contratos'

const Importar = lazy(() => import('../components/Importar'))

type Aba = 'pontos' | 'colunas' | 'equipe' | 'importar' | 'dados'

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
    { id: 'equipe', nome: 'Equipe', admin: true },
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
            {[contrato.municipio, contrato.uf].filter(Boolean).join(' / ')}
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
      {aba === 'equipe' && isAdmin && <Equipe contrato={contrato} />}
      {aba === 'importar' && isAdmin && (
        <Suspense fallback={<div className="carregando">Carregando…</div>}>
          <Importar contrato={contrato} layout={layout} />
        </Suspense>
      )}
      {aba === 'dados' && isAdmin && (
        <>
          <ContratoForm contrato={contrato} onFechar={() => setParams({ aba: 'pontos' })} onSalvo={(c) => { setContrato(c); recarregar() }} />
          <ExcluirContrato contrato={contrato} />
        </>
      )}
    </section>
  )
}

function ExcluirContrato({ contrato }: { contrato: Contract }) {
  const navigate = useNavigate()
  const [aberto, setAberto] = useState(false)
  const [digitado, setDigitado] = useState('')
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState('')
  const confere = digitado.trim().toUpperCase() === contrato.nome.trim().toUpperCase()

  async function excluir() {
    if (!confere) return
    setExcluindo(true)
    setErro('')
    try {
      await deleteContract(contrato.id)
      navigate('/', { state: { aviso: `Contrato ${contrato.nome} movido para a lixeira.` } })
    } catch (e) {
      setErro(msgErro(e))
      setExcluindo(false)
    }
  }

  return (
    <section className="zona-perigo">
      <div>
        <h3>Excluir contrato</h3>
        <p className="nota">
          O contrato vai para a <b>lixeira</b>: some do painel e do app de campo, junto com os pontos, colunas e fotos dele.
          Nada é apagado — dá para restaurar na tela de Contratos, em “Contratos excluídos”.
        </p>
      </div>
      {!aberto ? (
        <button className="btn perigo" onClick={() => setAberto(true)}>🗑 Excluir contrato</button>
      ) : (
        <div className="confirmar-exclusao">
          <label>
            Para confirmar, digite o nome do contrato: <b>{contrato.nome}</b>
            <input value={digitado} onChange={(e) => setDigitado(e.target.value)} placeholder={contrato.nome} autoFocus />
          </label>
          <div className="linha-botoes">
            <button className="btn perigo cheio" disabled={!confere || excluindo} onClick={excluir}>
              {excluindo ? 'Excluindo…' : 'Excluir contrato'}
            </button>
            <button className="btn" onClick={() => { setAberto(false); setDigitado('') }}>Cancelar</button>
          </div>
          {erro && <div className="alerta erro">{erro}</div>}
        </div>
      )}
    </section>
  )
}
