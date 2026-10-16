import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { dashboardProducao, type LinhaProducao } from '../lib/api'
import { msgErro } from '../lib/supabase'
import type { Contract } from '../lib/types'
import {
  br, brCurto, calcular, chaveColab, dataHora, diaSemana, hojeFortaleza, n, n1, pct, somarDias, type Filtros,
} from '../lib/producao'

type Preset = 'hoje' | 'ontem' | '7' | '30' | 'mes' | 'tudo' | 'personalizado'

const PRESETS: { id: Preset; nome: string }[] = [
  { id: 'hoje', nome: 'Hoje' },
  { id: 'ontem', nome: 'Ontem' },
  { id: '7', nome: '7 dias' },
  { id: '30', nome: '30 dias' },
  { id: 'mes', nome: 'Este mês' },
  { id: 'tudo', nome: 'Tudo' },
  { id: 'personalizado', nome: 'Período…' },
]

function intervalo(p: Preset, de: string, ate: string): { de: string | null; ate: string | null } {
  const h = hojeFortaleza()
  switch (p) {
    case 'hoje': return { de: h, ate: h }
    case 'ontem': { const o = somarDias(h, -1); return { de: o, ate: o } }
    case '7': return { de: somarDias(h, -6), ate: h }
    case '30': return { de: somarDias(h, -29), ate: h }
    case 'mes': return { de: h.slice(0, 8) + '01', ate: h }
    case 'tudo': return { de: null, ate: null }
    default: return { de: de || null, ate: ate || null }
  }
}

/** Dashboard de produção: geral e filtrado por contrato, cadastrador e período. */
export default function Dashboard({ contratos }: { contratos: Contract[] }) {
  const [linhas, setLinhas] = useState<LinhaProducao[] | null>(null)
  const [erro, setErro] = useState('')
  const [atualizado, setAtualizado] = useState<Date | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [preset, setPreset] = useState<Preset>('7')
  const [de, setDe] = useState(somarDias(hojeFortaleza(), -6))
  const [ate, setAte] = useState(hojeFortaleza())
  const [contrato, setContrato] = useState('')
  const [colaborador, setColaborador] = useState('')
  const [importados, setImportados] = useState(false)
  const [gerandoPdf, setGerandoPdf] = useState(false)

  const carregar = () => {
    setCarregando(true)
    setErro('')
    dashboardProducao()
      .then((l) => { setLinhas(l); setAtualizado(new Date()) })
      .catch((e) => setErro(msgErro(e)))
      .finally(() => setCarregando(false))
  }
  useEffect(carregar, [])

  const nomesContrato = useMemo(() => new Map(contratos.map((c) => [c.id, c.nome])), [contratos])

  // cadastradores que aparecem no contrato escolhido (ou em todos)
  const colaboradores = useMemo(() => {
    const m = new Map<string, { nome: string; ultimo: string }>()
    for (const l of linhas ?? []) {
      if (contrato && l.contract_id !== contrato) continue
      const k = chaveColab(l)
      const atual = m.get(k)
      if (!atual || l.ultimo > atual.ultimo) m.set(k, { nome: l.colaborador, ultimo: l.ultimo })
    }
    return [...m.entries()].map(([chave, v]) => ({ chave, nome: v.nome })).sort((a, b) => a.nome.localeCompare(b.nome))
  }, [linhas, contrato])

  useEffect(() => {
    if (colaborador && !colaboradores.some((c) => c.chave === colaborador)) setColaborador('')
  }, [colaboradores, colaborador])

  const periodo = intervalo(preset, de, ate)
  const invalido = preset === 'personalizado' && !!periodo.de && !!periodo.ate && periodo.de > periodo.ate
  const filtros: Filtros = { ...periodo, contrato, colaborador, importados }

  // cálculo leve (já vem agregado do banco): refeito a cada filtro
  const r = linhas && !invalido ? calcular(linhas, contratos, filtros, nomesContrato) : null

  const temImportados = (linhas ?? []).some((l) => l.origem === 'importacao')
  const nomeContrato = contrato ? nomesContrato.get(contrato) ?? '' : 'Todos os contratos'
  const nomeColab = colaborador ? colaboradores.find((c) => c.chave === colaborador)?.nome ?? '' : 'Todos os cadastradores'

  async function baixarPdf() {
    if (!r) return
    setGerandoPdf(true)
    try {
      const { gerarPdfDashboard } = await import('../lib/pdfDashboard')
      await gerarPdfDashboard(r, { contrato: nomeContrato, colaborador: nomeColab, importados, preset: PRESETS.find((p) => p.id === preset)!.nome })
    } catch (e) {
      setErro(msgErro(e))
    } finally {
      setGerandoPdf(false)
    }
  }

  return (
    <div className="dash">
      <div className="painel dash-filtros">
        <div className="dash-presets" role="group" aria-label="Período">
          {PRESETS.map((p) => (
            <button key={p.id} className={preset === p.id ? 'ativo' : ''} onClick={() => setPreset(p.id)}>{p.nome}</button>
          ))}
        </div>
        <div className="linha-campos">
          {preset === 'personalizado' && (
            <>
              <label className="estreito">De<input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
              <label className="estreito">Até<input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
            </>
          )}
          <label>
            Contrato
            <select value={contrato} onChange={(e) => setContrato(e.target.value)}>
              <option value="">Todos os contratos</option>
              {contratos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label>
            Cadastrador
            <select value={colaborador} onChange={(e) => setColaborador(e.target.value)}>
              <option value="">Todos os cadastradores</option>
              {colaboradores.map((c) => <option key={c.chave} value={c.chave}>{c.nome}</option>)}
            </select>
          </label>
        </div>
        <div className="dash-acoes">
          {temImportados && (
            <label className="check">
              <input type="checkbox" checked={importados} onChange={(e) => setImportados(e.target.checked)} />
              Contar pontos importados de planilha como produção
            </label>
          )}
          <span className="espaco" />
          {atualizado && <small className="nota">Atualizado às {atualizado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>}
          <button className="btn" onClick={carregar} disabled={carregando}>{carregando ? 'Atualizando…' : '↻ Atualizar'}</button>
          <button className="btn primario" onClick={baixarPdf} disabled={!r || gerandoPdf}>{gerandoPdf ? 'Gerando PDF…' : '⤓ Baixar PDF'}</button>
        </div>
      </div>

      {erro && <div className="alerta erro">{erro}</div>}
      {invalido && <div className="alerta aviso">A data inicial está depois da final.</div>}
      {!linhas && !erro && <div className="carregando">Carregando produção…</div>}

      {r && (
        <>
          <p className="dash-resumo">
            <b>{r.periodoTexto}</b> · {nomeContrato} · {nomeColab}
            {!importados && temImportados && <span className="nota"> · sem pontos importados</span>}
          </p>

          <div className="dash-kpis">
            <Kpi titulo="Pontos no período" valor={n(r.kpis.pontos)} destaque />
            <Kpi titulo="Hoje" valor={n(r.kpis.hoje)} sub={`ontem: ${n(r.kpis.ontem)}`} />
            <Kpi titulo="Média por dia trabalhado" valor={n1(r.kpis.mediaDia)} sub={`${n(r.kpis.dias)} dia(s) com produção`} />
            <Kpi
              titulo="Melhor dia"
              valor={r.kpis.melhorDia ? n(r.kpis.melhorDia.pontos) : '—'}
              sub={r.kpis.melhorDia ? `${br(r.kpis.melhorDia.dia)} (${diaSemana(r.kpis.melhorDia.dia)})` : ''}
            />
            <Kpi titulo="Cadastradores ativos" valor={n(r.kpis.colaboradores)} />
            <Kpi
              titulo="Fotos"
              valor={n(r.kpis.fotos)}
              sub={r.kpis.pontos ? `${pct(r.kpis.comFoto / r.kpis.pontos)} dos pontos com foto · ${n1(r.kpis.fotos / r.kpis.pontos)}/ponto` : ''}
            />
          </div>

          <div className="painel">
            <h3>Produção diária</h3>
            <GraficoDiario serie={r.serie} />
          </div>

          <div className="painel">
            <h3>Por contrato</h3>
            <div className="tabela-scroll">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Contrato</th>
                    <th className="num">Total geral</th>
                    <th className="num">No período</th>
                    <th className="num">Hoje</th>
                    <th className="num">Dias</th>
                    <th className="num">Média/dia</th>
                    <th className="num">Cadastradores</th>
                    <th>Último cadastro</th>
                  </tr>
                </thead>
                <tbody>
                  {r.porContrato.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/contratos/${c.id}`} className="forte">{c.nome}</Link>
                        {c.local && <small className="desc"> · {c.local}</small>}
                      </td>
                      <td className="num" title={c.importados ? `${n(c.importados)} importado(s) de planilha` : undefined}>
                        {n(c.totalGeral)}{c.importados > 0 && <small className="desc"> ({n(c.importados)} imp.)</small>}
                      </td>
                      <td className="num forte">{n(c.periodo)}</td>
                      <td className="num">{n(c.hoje)}</td>
                      <td className="num">{n(c.dias)}</td>
                      <td className="num">{n1(c.mediaDia)}</td>
                      <td className="num">{n(c.colaboradores)}</td>
                      <td>{c.ultimo ? dataHora(c.ultimo) : '—'}</td>
                    </tr>
                  ))}
                  {r.porContrato.length === 0 && <tr><td colSpan={8} className="celula-vazia">Nenhum contrato.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="nota">“Total geral” é tudo o que o contrato tem hoje, sem filtro de data. As demais colunas seguem os filtros acima.</p>
          </div>

          <div className="painel">
            <h3>Por cadastrador</h3>
            <div className="tabela-scroll">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Cadastrador</th>
                    <th>Contrato(s)</th>
                    <th className="num">No período</th>
                    <th className="num">Hoje</th>
                    <th className="num">Dias</th>
                    <th className="num">Média/dia</th>
                    <th>Melhor dia</th>
                    <th className="num">Fotos</th>
                    <th>Último cadastro</th>
                  </tr>
                </thead>
                <tbody>
                  {r.porColaborador.map((c) => (
                    <tr key={c.chave}>
                      <td className="forte">{c.nome}</td>
                      <td>{c.contratos.join(', ')}</td>
                      <td className="num forte">{n(c.periodo)}</td>
                      <td className="num">{n(c.hoje)}</td>
                      <td className="num">{n(c.dias)}</td>
                      <td className="num">{n1(c.mediaDia)}</td>
                      <td>{c.melhorDia ? `${n(c.melhorDia.pontos)} em ${brCurto(c.melhorDia.dia)}` : '—'}</td>
                      <td className="num">{n(c.fotos)}</td>
                      <td>{c.ultimo ? dataHora(c.ultimo) : '—'}</td>
                    </tr>
                  ))}
                  {r.porColaborador.length === 0 && <tr><td colSpan={9} className="celula-vazia">Nenhum ponto cadastrado no período.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {r.matriz.linhas.length > 0 && (
            <div className="painel">
              <h3>Produção diária por cadastrador</h3>
              {r.matriz.cortado && <p className="nota">Mostrando os últimos {r.matriz.dias.length} dias do período.</p>}
              <div className="tabela-scroll">
                <table className="tabela dash-matriz">
                  <thead>
                    <tr>
                      <th>Cadastrador</th>
                      {r.matriz.dias.map((d) => (
                        <th key={d} className={`num${d === hojeFortaleza() ? ' hoje' : ''}`}>
                          {brCurto(d)}<small>{diaSemana(d)}</small>
                        </th>
                      ))}
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.matriz.linhas.map((l) => {
                      const max = Math.max(...l.valores, 1)
                      return (
                        <tr key={l.chave}>
                          <td className="forte">{l.nome}</td>
                          {l.valores.map((v, i) => (
                            <td key={i} className={`num${v === 0 ? ' zero' : ''}`} style={v ? { background: `color-mix(in srgb, var(--ambar) ${Math.round(8 + (v / max) * 32)}%, transparent)` } : undefined}>
                              {v || '·'}
                            </td>
                          ))}
                          <td className="num forte">{n(l.total)}</td>
                        </tr>
                      )
                    })}
                    <tr className="dash-total">
                      <td>Total do dia</td>
                      {r.matriz.totais.map((v, i) => <td key={i} className="num">{v || '·'}</td>)}
                      <td className="num">{n(r.matriz.totais.reduce((s, v) => s + v, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Kpi({ titulo, valor, sub, destaque }: { titulo: string; valor: string; sub?: string; destaque?: boolean }) {
  return (
    <div className={destaque ? 'dash-kpi destaque' : 'dash-kpi'}>
      <span className="dash-kpi-titulo">{titulo}</span>
      <span className="dash-kpi-valor">{valor}</span>
      {sub && <span className="dash-kpi-sub">{sub}</span>}
    </div>
  )
}

function GraficoDiario({ serie }: { serie: { dia: string; pontos: number }[] }) {
  if (serie.length === 0 || serie.every((s) => s.pontos === 0)) return <p className="nota">Nenhum ponto cadastrado no período.</p>
  const max = Math.max(...serie.map((s) => s.pontos), 1)
  const muitos = serie.length > 31
  const hoje = hojeFortaleza()
  return (
    <div className={muitos ? 'dash-grafico compacto' : 'dash-grafico'}>
      {serie.map((s) => (
        <div key={s.dia} className={`dash-barra${s.dia === hoje ? ' hoje' : ''}`} title={`${br(s.dia)} (${diaSemana(s.dia)}): ${n(s.pontos)} ponto(s)`}>
          {!muitos && <span className="valor">{s.pontos || ''}</span>}
          <span className="coluna-barra" style={{ height: `${(s.pontos / max) * 100}%` }} />
          {!muitos && <span className="rotulo">{brCurto(s.dia)}</span>}
        </div>
      ))}
    </div>
  )
}
