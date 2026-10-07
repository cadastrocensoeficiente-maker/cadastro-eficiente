import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { listContracts, listDeletedContracts, restoreContract, saveContract, type ContratoExcluido } from '../lib/api'
import { msgErro } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract } from '../lib/types'

export const EPSG_SUGERIDOS = [
  { epsg: 31984, nome: 'SIRGAS 2000 / UTM 24S (Ceará leste, RN, PB, PE)' },
  { epsg: 31983, nome: 'SIRGAS 2000 / UTM 23S (Ceará oeste, PI, MA)' },
  { epsg: 31985, nome: 'SIRGAS 2000 / UTM 25S (litoral PB/PE/AL)' },
  { epsg: 31982, nome: 'SIRGAS 2000 / UTM 22S (PR, SC, RS, GO)' },
  { epsg: 31981, nome: 'SIRGAS 2000 / UTM 21S' },
]

export default function Contratos() {
  const { isAdmin, profile } = useAuth()
  const [contratos, setContratos] = useState<Contract[]>([])
  const [erro, setErro] = useState('')
  const [novo, setNovo] = useState(false)
  const location = useLocation()
  const [aviso, setAviso] = useState<string>((location.state as { aviso?: string } | null)?.aviso ?? '')
  const [excluidos, setExcluidos] = useState<ContratoExcluido[]>([])
  const [verExcluidos, setVerExcluidos] = useState(false)

  const carregar = () => {
    listContracts().then(setContratos).catch((e) => setErro(msgErro(e)))
    if (isAdmin) listDeletedContracts().then(setExcluidos).catch(() => {})
  }
  useEffect(() => {
    carregar()
  }, [isAdmin])

  async function restaurar(c: ContratoExcluido) {
    try {
      await restoreContract(c.id)
      setAviso(`Contrato ${c.nome} restaurado.`)
      carregar()
    } catch (e) {
      setErro(msgErro(e))
    }
  }

  if (profile?.role === 'pendente') {
    return (
      <div className="vazio">
        <h2>Acesso aguardando liberação</h2>
        <p>Sua conta foi criada. Um administrador precisa liberar seu acesso.</p>
      </div>
    )
  }

  return (
    <section>
      <div className="cabecalho-pagina">
        <h1>Contratos</h1>
        {isAdmin && (
          <button className="btn primario" onClick={() => setNovo(true)}>
            + Novo contrato
          </button>
        )}
      </div>
      {erro && <div className="alerta erro">{erro}</div>}
      {aviso && (
        <div className="alerta ok barra-acao">
          <span>{aviso}</span>
          <button className="btn-x" onClick={() => setAviso('')} aria-label="Fechar">×</button>
        </div>
      )}
      {novo && <ContratoForm onFechar={() => setNovo(false)} onSalvo={() => { setNovo(false); carregar() }} />}

      {contratos.length === 0 && !novo ? (
        <div className="vazio">
          <p>Nenhum contrato cadastrado.</p>
          {isAdmin && <p>Crie o primeiro contrato e depois configure as colunas dele.</p>}
        </div>
      ) : (
        <div className="grade-cards">
          {contratos.map((c) => (
            <Link key={c.id} to={`/contratos/${c.id}`} className="card-contrato">
              <span className="card-titulo">{c.nome}</span>
              <span className="card-sub">{[c.municipio, c.uf].filter(Boolean).join(' / ')}</span>
              {!c.ativo && <span className="etiqueta">inativo</span>}
            </Link>
          ))}
        </div>
      )}

      {isAdmin && excluidos.length > 0 && (
        <div className="contratos-excluidos">
          <button className="link-btn" onClick={() => setVerExcluidos(!verExcluidos)}>
            {verExcluidos ? '▾' : '▸'} 🗑 Contratos excluídos ({excluidos.length})
          </button>
          {verExcluidos && (
            <ul>
              {excluidos.map((c) => (
                <li key={c.id}>
                  <span>
                    <b>{c.nome}</b> <small>{[c.municipio, c.uf].filter(Boolean).join(' / ')} · {c.pontos} ponto(s) · excluído em{' '}
                    {new Date(c.excluido_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {c.excluido_por_nome ? ` por ${c.excluido_por_nome}` : ''}</small>
                  </span>
                  <button className="btn" onClick={() => restaurar(c)}>↶ Restaurar</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export function ContratoForm({ contrato, onFechar, onSalvo }: { contrato?: Contract; onFechar: () => void; onSalvo: (c: Contract) => void }) {
  const [nome, setNome] = useState(contrato?.nome ?? '')
  const [municipio, setMunicipio] = useState(contrato?.municipio ?? '')
  const [uf, setUf] = useState(contrato?.uf ?? 'CE')
  const [epsg, setEpsg] = useState(contrato?.epsg ?? 31984)
  const [digitos, setDigitos] = useState(contrato?.id_digitos ?? 6)
  const [ativo, setAtivo] = useState(contrato?.ativo ?? true)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
        setSalvando(true)
    setErro('')
    try {
      onSalvo(await saveContract({ id: contrato?.id, nome: nome.trim().toUpperCase(), municipio, uf, epsg, id_digitos: digitos, ativo }))
    } catch (err) {
      setErro(msgErro(err))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form className="painel" onSubmit={salvar}>
      <h3>{contrato ? 'Dados do contrato' : 'Novo contrato'}</h3>
      <div className="linha-campos">
        <label>
          Nome do contrato
          <input value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="AQUIRAZ" />
        </label>
        <label>
          Município
          <input value={municipio} onChange={(e) => setMunicipio(e.target.value)} />
        </label>
        <label className="estreito">
          UF
          <input value={uf} maxLength={2} onChange={(e) => setUf(e.target.value.toUpperCase())} />
        </label>
      </div>
      <div className="linha-campos">
        <label>
          Fuso UTM (só para importar planilhas antigas em X/Y)
          <select
            value={EPSG_SUGERIDOS.some((s) => s.epsg === epsg) ? epsg : 'outro'}
            onChange={(e) => e.target.value !== 'outro' && setEpsg(Number(e.target.value))}
          >
            {EPSG_SUGERIDOS.map((s) => (
              <option key={s.epsg} value={s.epsg}>
                {s.epsg} — {s.nome}
              </option>
            ))}
            <option value="outro">Outro EPSG…</option>
          </select>
        </label>
        <label className="estreito">
          EPSG
          <input type="number" value={epsg} onChange={(e) => setEpsg(Number(e.target.value))} required />
        </label>
        <label className="estreito">
          Dígitos do ID
          <input type="number" min={2} max={12} value={digitos} onChange={(e) => setDigitos(Number(e.target.value))} />
        </label>
      </div>
      <p className="nota">
        Exemplo de ID com {digitos} dígitos: <span className="mono">{'1'.padStart(digitos, '0')}</span>. Ao passar do limite o ID
        cresce sozinho, sem perder a unicidade.
      </p>
      {contrato && (
        <label className="check">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Contrato ativo
        </label>
      )}
      {erro && <div className="alerta erro">{erro}</div>}
      <div className="acoes">
        <button type="button" className="btn" onClick={onFechar}>
          Cancelar
        </button>
        <button className="btn primario" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}
