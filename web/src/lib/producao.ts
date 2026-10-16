import type { LinhaProducao } from './api'
import type { Contract } from './types'

/**
 * Cálculos do dashboard. Usam só os campos fixos de todo ponto (contrato, dia,
 * colaborador, origem, fotos), então valem para qualquer colunamento de contrato.
 */

export const hojeFortaleza = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
export const br = (d: string) => d.split('-').reverse().join('/')
export const brCurto = (d: string) => d.split('-').reverse().slice(0, 2).join('/')
export const n = (v: number) => v.toLocaleString('pt-BR')
export const n1 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const pct = (v: number) => `${Math.round(v * 100)}%`
export const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
export const diaSemana = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number)
  return DIAS_SEMANA[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]
}

export function somarDias(d: string, k: number) {
  const [y, m, dd] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, dd + k)).toISOString().slice(0, 10)
}

export function diasEntre(de: string, ate: string) {
  const out: string[] = []
  for (let d = de; d <= ate && out.length < 1000; d = somarDias(d, 1)) out.push(d)
  return out
}

export interface Filtros {
  de: string | null // null = desde o início
  ate: string | null // null = até hoje
  contrato: string // '' = todos
  colaborador: string // '' = todos (chave do colaborador)
  importados: boolean // incluir pontos vindos de importação de planilha
}

export const chaveColab = (l: LinhaProducao) => l.colaborador_id ?? `nome:${l.colaborador}`

export interface Kpis {
  pontos: number
  hoje: number
  ontem: number
  dias: number
  mediaDia: number
  colaboradores: number
  fotos: number
  comFoto: number
  melhorDia: { dia: string; pontos: number } | null
}

export interface LinhaContrato {
  id: string
  nome: string
  local: string
  totalGeral: number
  importados: number
  periodo: number
  hoje: number
  dias: number
  mediaDia: number
  colaboradores: number
  ultimo: string | null
}

export interface LinhaColaborador {
  chave: string
  nome: string
  contratos: string[]
  periodo: number
  hoje: number
  dias: number
  mediaDia: number
  melhorDia: { dia: string; pontos: number } | null
  fotos: number
  comFoto: number
  ultimo: string | null
}

export interface Resultado {
  kpis: Kpis
  serie: { dia: string; pontos: number }[]
  porContrato: LinhaContrato[]
  porColaborador: LinhaColaborador[]
  matriz: { dias: string[]; linhas: { chave: string; nome: string; valores: number[]; total: number }[]; totais: number[]; cortado: boolean }
  periodoTexto: string
}

const MAX_DIAS_MATRIZ = 31

export function calcular(linhas: LinhaProducao[], contratos: Contract[], f: Filtros, nomesContrato: Map<string, string>): Resultado {
  const hoje = hojeFortaleza()
  const ontem = somarDias(hoje, -1)
  const ate = f.ate ?? hoje
  const primeiroDia = linhas.reduce<string | null>((m, l) => (m === null || l.dia < m ? l.dia : m), null)
  const de = f.de ?? primeiroDia ?? hoje

  const daOrigem = (l: LinhaProducao) => f.importados || l.origem !== 'importacao'
  const doEscopo = (l: LinhaProducao) =>
    (!f.contrato || l.contract_id === f.contrato) && (!f.colaborador || chaveColab(l) === f.colaborador) && daOrigem(l)
  const escopo = linhas.filter(doEscopo)
  const noPeriodo = escopo.filter((l) => l.dia >= de && l.dia <= ate)

  // ---------- série diária ----------
  const porDia = new Map<string, number>()
  for (const l of noPeriodo) porDia.set(l.dia, (porDia.get(l.dia) ?? 0) + l.pontos)
  const dias = diasEntre(de, ate)
  const serie = (dias.length <= 400 ? dias : [...porDia.keys()].sort()).map((d) => ({ dia: d, pontos: porDia.get(d) ?? 0 }))

  // ---------- KPIs ----------
  const pontos = noPeriodo.reduce((s, l) => s + l.pontos, 0)
  const diasTrab = porDia.size
  let melhor: Kpis['melhorDia'] = null
  for (const [dia, p] of porDia) if (!melhor || p > melhor.pontos) melhor = { dia, pontos: p }
  const kpis: Kpis = {
    pontos,
    hoje: escopo.filter((l) => l.dia === hoje).reduce((s, l) => s + l.pontos, 0),
    ontem: escopo.filter((l) => l.dia === ontem).reduce((s, l) => s + l.pontos, 0),
    dias: diasTrab,
    mediaDia: diasTrab ? pontos / diasTrab : 0,
    colaboradores: new Set(noPeriodo.map(chaveColab)).size,
    fotos: noPeriodo.reduce((s, l) => s + l.fotos, 0),
    comFoto: noPeriodo.reduce((s, l) => s + l.com_foto, 0),
    melhorDia: melhor,
  }

  // ---------- por contrato ----------
  const visiveis = contratos.filter((c) => !f.contrato || c.id === f.contrato)
  const porContrato: LinhaContrato[] = visiveis.map((c) => {
    const todas = linhas.filter((l) => l.contract_id === c.id)
    const sel = noPeriodo.filter((l) => l.contract_id === c.id)
    const diasC = new Set(sel.map((l) => l.dia)).size
    const p = sel.reduce((s, l) => s + l.pontos, 0)
    const ult = todas.reduce<string | null>((m, l) => (m === null || l.ultimo > m ? l.ultimo : m), null)
    return {
      id: c.id,
      nome: c.nome,
      local: [c.municipio, c.uf].filter(Boolean).join(' / '),
      totalGeral: todas.reduce((s, l) => s + l.pontos, 0),
      importados: todas.filter((l) => l.origem === 'importacao').reduce((s, l) => s + l.pontos, 0),
      periodo: p,
      hoje: escopo.filter((l) => l.contract_id === c.id && l.dia === hoje).reduce((s, l) => s + l.pontos, 0),
      dias: diasC,
      mediaDia: diasC ? p / diasC : 0,
      colaboradores: new Set(sel.map(chaveColab)).size,
      ultimo: ult,
    }
  })
  porContrato.sort((a, b) => b.periodo - a.periodo || b.totalGeral - a.totalGeral || a.nome.localeCompare(b.nome))

  // ---------- por cadastrador ----------
  const grupos = new Map<string, LinhaProducao[]>()
  for (const l of noPeriodo) {
    const k = chaveColab(l)
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k)!.push(l)
  }
  const porColaborador: LinhaColaborador[] = [...grupos.entries()].map(([chave, ls]) => {
    const dd = new Map<string, number>()
    for (const l of ls) dd.set(l.dia, (dd.get(l.dia) ?? 0) + l.pontos)
    let m: LinhaColaborador['melhorDia'] = null
    for (const [dia, p] of dd) if (!m || p > m.pontos) m = { dia, pontos: p }
    const p = ls.reduce((s, l) => s + l.pontos, 0)
    const recente = ls.reduce((a, b) => (b.ultimo > a.ultimo ? b : a))
    return {
      chave,
      nome: recente.colaborador,
      contratos: [...new Set(ls.map((l) => nomesContrato.get(l.contract_id) ?? '?'))].sort(),
      periodo: p,
      hoje: ls.filter((l) => l.dia === hoje).reduce((s, l) => s + l.pontos, 0),
      dias: dd.size,
      mediaDia: dd.size ? p / dd.size : 0,
      melhorDia: m,
      fotos: ls.reduce((s, l) => s + l.fotos, 0),
      comFoto: ls.reduce((s, l) => s + l.com_foto, 0),
      ultimo: recente.ultimo,
    }
  })
  porColaborador.sort((a, b) => b.periodo - a.periodo || a.nome.localeCompare(b.nome))

  // ---------- matriz cadastrador × dia (últimos 31 dias do período) ----------
  const cortado = dias.length > MAX_DIAS_MATRIZ
  const diasMatriz = cortado ? dias.slice(-MAX_DIAS_MATRIZ) : dias
  const idx = new Map(diasMatriz.map((d, i) => [d, i]))
  const linhasMatriz = porColaborador.map((c) => {
    const valores = diasMatriz.map(() => 0)
    for (const l of grupos.get(c.chave) ?? []) {
      const i = idx.get(l.dia)
      if (i !== undefined) valores[i] += l.pontos
    }
    return { chave: c.chave, nome: c.nome, valores, total: valores.reduce((s, v) => s + v, 0) }
  })
  const totais = diasMatriz.map((_, i) => linhasMatriz.reduce((s, l) => s + l.valores[i], 0))

  const periodoTexto =
    f.de === null && f.ate === null ? `Todo o período (${br(de)} a ${br(ate)})` : de === ate ? br(de) : `${br(de)} a ${br(ate)}`

  return { kpis, serie, porContrato, porColaborador, matriz: { dias: diasMatriz, linhas: linhasMatriz, totais, cortado }, periodoTexto }
}
