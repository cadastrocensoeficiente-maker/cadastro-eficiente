import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { deletePoints, listAllPoints, listPoints, restorePoints } from '../lib/api'
import Lixeira from './Lixeira'
import { msgErro } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract, LayoutItem, PointRow, Valor } from '../lib/types'

const POR_PAGINA = 50

export function exibirValor(v: Valor | undefined, tipo: string): string {
  if (v === null || v === undefined || v === '') return ''
  if (tipo === 'booleano') return v ? 'SIM' : 'NÃO'
  if (tipo === 'data' && typeof v === 'string') return v.split('-').reverse().join('/')
  if (typeof v === 'number') return v.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
  return String(v)
}

export const fmtGraus = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toFixed(7)

export const fmtCoord = (n: number | null) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

export default function TabelaPontos({ contrato, layout }: { contrato: Contract; layout: LayoutItem[] }) {
  const { podeEditar, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [pagina, setPagina] = useState(0)
  const [busca, setBusca] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [dados, setDados] = useState<{ rows: PointRow[]; total: number }>({ rows: [], total: 0 })
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [exportando, setExportando] = useState('')
  const [selecao, setSelecao] = useState<Set<string>>(new Set())
  const [excluindo, setExcluindo] = useState(false)
  const [desfazer, setDesfazer] = useState<{ ids: string[]; texto: string } | null>(null)
  const [verLixeira, setVerLixeira] = useState(false)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    setCarregando(true)
    listPoints(contrato.id, pagina, POR_PAGINA, buscaAplicada)
      .then((d) => {
        setDados(d)
        // página vazia depois de excluir: volta uma
        if (d.rows.length === 0 && pagina > 0) setPagina(pagina - 1)
      })
      .catch((e) => setErro(msgErro(e)))
      .finally(() => setCarregando(false))
  }, [contrato.id, pagina, buscaAplicada, recarga])

  useEffect(() => setSelecao(new Set()), [contrato.id, pagina, buscaAplicada])

  function alternar(id: string) {
    setSelecao((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  const todosMarcados = dados.rows.length > 0 && dados.rows.every((r) => selecao.has(r.id))
  function alternarTodos() {
    setSelecao(todosMarcados ? new Set() : new Set(dados.rows.map((r) => r.id)))
  }

  async function excluir(ids: string[], rotulo: string) {
    if (!ids.length) return
    if (!confirm(`Excluir ${rotulo}?\n\nVai para a lixeira do contrato: some do painel e do Excel, mas pode ser restaurado.`)) return
    setExcluindo(true)
    setErro('')
    try {
      const n = await deletePoints(ids)
      setSelecao(new Set())
      setDesfazer({ ids, texto: `${n} ponto(s) movido(s) para a lixeira.` })
      setRecarga((x) => x + 1)
    } catch (e) {
      setErro(msgErro(e))
    } finally {
      setExcluindo(false)
    }
  }

  async function desfazerExclusao() {
    if (!desfazer) return
    try {
      await restorePoints(desfazer.ids)
      setDesfazer(null)
      setRecarga((x) => x + 1)
    } catch (e) {
      setErro(msgErro(e))
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      setPagina(0)
      setBuscaAplicada(busca)
    }, 350)
    return () => clearTimeout(t)
  }, [busca])

  async function exportar() {
    setExportando('Lendo pontos…')
    try {
      const todos = await listAllPoints(contrato.id, (n) => setExportando(`Lendo pontos… ${n.toLocaleString('pt-BR')}`))
      setExportando('Gerando planilha…')
      const { exportarXlsx } = await import('../lib/excel')
      await exportarXlsx(contrato.nome, layout, todos, window.location.origin)
    } catch (e) {
      setErro(msgErro(e))
    } finally {
      setExportando('')
    }
  }

  const ordenado = [...layout].sort((a, b) => a.ordem - b.ordem)
  const paginas = Math.max(1, Math.ceil(dados.total / POR_PAGINA))
  const semColunas = !layout.some((c) => !c.sistema)

  return (
    <div>
      <div className="barra-ferramentas">
        <input className="busca" placeholder="Buscar por ID, plaqueta, endereço…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="contagem">{dados.total.toLocaleString('pt-BR')} ponto(s)</span>
        <div className="espaco" />
        <button className="btn" onClick={exportar} disabled={!!exportando || dados.total === 0}>
          {exportando || '⬇ Exportar Excel'}
        </button>
        {isAdmin && (
          <button className="btn" onClick={() => setVerLixeira(true)}>🗑 Lixeira</button>
        )}
        {podeEditar && (
          <button className="btn primario" onClick={() => navigate(`/contratos/${contrato.id}/pontos/novo`)}>
            + Novo ponto
          </button>
        )}
      </div>
      {semColunas && (
        <div className="alerta aviso">
          Este contrato ainda não tem colunas configuráveis. Vá na aba <b>Colunas</b> para criá-las.
        </div>
      )}
      {erro && <div className="alerta erro">{erro}</div>}
      {desfazer && (
        <div className="alerta ok barra-acao">
          <span>{desfazer.texto}</span>
          <button className="btn" onClick={desfazerExclusao}>↶ Desfazer</button>
          <button className="btn-x" onClick={() => setDesfazer(null)} aria-label="Fechar">×</button>
        </div>
      )}
      {isAdmin && selecao.size > 0 && (
        <div className="alerta aviso barra-acao">
          <span><b>{selecao.size}</b> ponto(s) selecionado(s)</span>
          <button className="btn perigo" disabled={excluindo} onClick={() => excluir([...selecao], `${selecao.size} ponto(s) selecionado(s)`)}>
            {excluindo ? 'Excluindo…' : '🗑 Excluir selecionados'}
          </button>
          <button className="btn" onClick={() => setSelecao(new Set())}>Limpar seleção</button>
        </div>
      )}
      {verLixeira && (
        <Lixeira contrato={contrato} layout={layout} onFechar={(mudou) => { setVerLixeira(false); if (mudou) setRecarga((x) => x + 1) }} />
      )}

      <div className="tabela-scroll">
        <table className="tabela">
          <thead>
            <tr>
              {podeEditar && (
                <th className="col-acoes">
                  {isAdmin && <input type="checkbox" checked={todosMarcados} onChange={alternarTodos} aria-label="Selecionar todos da página" />}
                  <span>Ações</span>
                </th>
              )}
              {ordenado.map((c) => (
                <th key={c.chave} className={c.sistema ? 'col-sistema' : ''}>
                  {!c.sistema && <span className="seq">{c.sequencia}</span>}
                  {c.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {carregando ? (
              <tr>
                <td colSpan={ordenado.length + (podeEditar ? 1 : 0)} className="celula-vazia">Carregando…</td>
              </tr>
            ) : dados.rows.length === 0 ? (
              <tr>
                <td colSpan={ordenado.length + (podeEditar ? 1 : 0)} className="celula-vazia">Nenhum ponto encontrado.</td>
              </tr>
            ) : (
              dados.rows.map((p) => (
                <tr key={p.id} onClick={() => navigate(`/contratos/${contrato.id}/pontos/${p.id}`)} className={`clicavel ${selecao.has(p.id) ? 'linha-ativa' : ''}`}>
                  {podeEditar && (
                    <td className="col-acoes" onClick={(e) => e.stopPropagation()}>
                      {isAdmin && <input type="checkbox" checked={selecao.has(p.id)} onChange={() => alternar(p.id)} aria-label={`Selecionar ponto ${p.ID}`} />}
                      <Link className="acao" to={`/contratos/${contrato.id}/pontos/${p.id}`} title="Editar ponto">✏️ Editar</Link>
                      {isAdmin && (
                        <button className="acao perigo" title="Excluir ponto" disabled={excluindo} onClick={() => excluir([p.id], `o ponto ${p.ID}`)}>🗑</button>
                      )}
                    </td>
                  )}
                  {ordenado.map((c) => {
                    switch (c.chave) {
                      case 'ID':
                        return <td key="ID" className="mono forte">{p.ID}</td>
                      case 'LATITUDE':
                        return <td key="LATITUDE" className="mono num">{fmtGraus(p.latitude)}</td>
                      case 'LONGITUDE':
                        return <td key="LONGITUDE" className="mono num">{fmtGraus(p.longitude)}</td>
                      case 'LINK_FOTOS':
                        return (
                          <td key="LINK_FOTOS" onClick={(e) => e.stopPropagation()}>
                            <Link className="btn-fotos" to={p.LINK_FOTOS}>
                              📷 Ver fotos{p.total_fotos > 0 ? ` (${p.total_fotos})` : ''}
                            </Link>
                          </td>
                        )
                      default:
                        return <td key={c.chave}>{exibirValor(p.valores[c.column_id!], c.tipo)}</td>
                    }
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {paginas > 1 && (
        <div className="paginacao">
          <button className="btn" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>
            ‹ Anterior
          </button>
          <span>
            Página {pagina + 1} de {paginas}
          </span>
          <button className="btn" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>
            Próxima ›
          </button>
        </div>
      )}
    </div>
  )
}
