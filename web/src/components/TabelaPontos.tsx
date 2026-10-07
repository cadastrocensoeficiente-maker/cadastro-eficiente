import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listAllPoints, listPoints } from '../lib/api'
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
  const { podeEditar } = useAuth()
  const navigate = useNavigate()
  const [pagina, setPagina] = useState(0)
  const [busca, setBusca] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [dados, setDados] = useState<{ rows: PointRow[]; total: number }>({ rows: [], total: 0 })
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [exportando, setExportando] = useState('')

  useEffect(() => {
    setCarregando(true)
    listPoints(contrato.id, pagina, POR_PAGINA, buscaAplicada)
      .then(setDados)
      .catch((e) => setErro(msgErro(e)))
      .finally(() => setCarregando(false))
  }, [contrato.id, pagina, buscaAplicada])

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

      <div className="tabela-scroll">
        <table className="tabela">
          <thead>
            <tr>
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
                <td colSpan={ordenado.length} className="celula-vazia">Carregando…</td>
              </tr>
            ) : dados.rows.length === 0 ? (
              <tr>
                <td colSpan={ordenado.length} className="celula-vazia">Nenhum ponto encontrado.</td>
              </tr>
            ) : (
              dados.rows.map((p) => (
                <tr key={p.id} onClick={() => navigate(`/contratos/${contrato.id}/pontos/${p.id}`)} className="clicavel">
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
