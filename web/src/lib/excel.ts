import ExcelJS from 'exceljs'
import type { LayoutItem, PointRow, ColumnType, Valor } from './types'

/** Normaliza um cabeçalho de planilha para comparar com o nome técnico da coluna. */
export function normalizarCabecalho(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function formatarValor(v: Valor | undefined, tipo: string): string | number | boolean | Date | null {
  if (v === null || v === undefined || v === '') return null
  if (tipo === 'booleano') return v === true ? 'SIM' : 'NÃO'
  if (tipo === 'data' && typeof v === 'string') {
    const [y, m, d] = v.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d))
  }
  if ((tipo === 'numero' || tipo === 'inteiro') && typeof v === 'number') return v
  return v as string | number
}

/**
 * Exportação: ordem OBRIGATÓRIA vem de contract_layout():
 * ID · configuráveis 1..N · TMX · TMY · LINK_FOTOS
 */
export async function exportarXlsx(nomeContrato: string, layout: LayoutItem[], pontos: PointRow[], origem: string) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Cadastro Eficiente'
  wb.created = new Date()
  const ws = wb.addWorksheet('PONTOS', { views: [{ state: 'frozen', ySplit: 1 }] })

  const ordenado = [...layout].sort((a, b) => a.ordem - b.ordem)
  ws.columns = ordenado.map((c) => ({
    header: c.rotulo,
    key: c.chave,
    width: c.chave === 'LINK_FOTOS' ? 16 : c.chave === 'ID' ? 10 : Math.max(12, c.rotulo.length + 4),
  }))

  for (const p of pontos) {
    const linha: (string | number | boolean | Date | null | ExcelJS.CellHyperlinkValue)[] = ordenado.map((c) => {
      switch (c.chave) {
        case 'ID':
          return p.ID
        case 'TMX':
          return p.TMX === null ? null : Number(p.TMX)
        case 'TMY':
          return p.TMY === null ? null : Number(p.TMY)
        case 'LINK_FOTOS':
          return { text: p.total_fotos > 0 ? `📷 Ver fotos (${p.total_fotos})` : '📷 Ver fotos', hyperlink: origem + p.LINK_FOTOS }
        default:
          return formatarValor(p.valores[c.column_id!], c.tipo)
      }
    })
    ws.addRow(linha)
  }

  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2A37' } }
  ordenado.forEach((c, i) => {
    if (c.sistema) ws.getRow(1).getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB45309' } }
    if (c.chave === 'TMX' || c.chave === 'TMY') ws.getColumn(i + 1).numFmt = '0.000'
    if (c.tipo === 'data') ws.getColumn(i + 1).numFmt = 'dd/mm/yyyy'
    if (c.chave === 'ID') ws.getColumn(i + 1).numFmt = '@'
  })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ordenado.length } }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  const data = new Date().toISOString().slice(0, 10)
  a.href = URL.createObjectURL(blob)
  a.download = `${normalizarCabecalho(nomeContrato)}_${data}.xlsx`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

// ------------------------------------------------------------------ IMPORTAÇÃO

export interface PlanilhaLida {
  cabecalhos: string[]
  linhas: (string | null)[][]
}

function celulaParaTexto(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text
    if ('result' in v) return v.result === undefined || v.result === null ? null : String(v.result)
    if ('richText' in v) return v.richText.map((t) => t.text).join('')
    return null
  }
  const s = String(v).trim()
  return s === '' ? null : s
}

export async function lerXlsx(arquivo: File): Promise<PlanilhaLida> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await arquivo.arrayBuffer())
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('A planilha está vazia.')
  const cabecalhos: string[] = []
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    cabecalhos[col - 1] = celulaParaTexto(cell.value) ?? `COLUNA_${col}`
  })
  const linhas: (string | null)[][] = []
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return
    const l: (string | null)[] = []
    for (let i = 0; i < cabecalhos.length; i++) l.push(celulaParaTexto(row.getCell(i + 1).value))
    if (l.some((x) => x !== null)) linhas.push(l)
  })
  return { cabecalhos, linhas }
}

/** Destinos possíveis de um cabeçalho da planilha. */
export type Destino =
  | { tipo: 'ignorar' }
  | { tipo: 'coluna'; column_id: string }
  | { tipo: 'latitude' }
  | { tipo: 'longitude' }
  | { tipo: 'tmx' }
  | { tipo: 'tmy' }

export const DESTINOS_SISTEMA_IGNORADOS = ['ID', 'UUID', 'LINK_FOTOS', 'FOTOS']

export function mapearAutomatico(cabecalhos: string[], layout: LayoutItem[]): Destino[] {
  const usados = new Set<string>()
  return cabecalhos.map((h) => {
    const n = normalizarCabecalho(h)
    if (DESTINOS_SISTEMA_IGNORADOS.includes(n)) return { tipo: 'ignorar' }
    if (['LAT', 'LATITUDE'].includes(n)) return { tipo: 'latitude' }
    if (['LON', 'LONG', 'LNG', 'LONGITUDE'].includes(n)) return { tipo: 'longitude' }
    if (['TMX', 'X', 'UTM_X', 'COORD_X', 'E', 'ESTE'].includes(n)) return { tipo: 'tmx' }
    if (['TMY', 'Y', 'UTM_Y', 'COORD_Y', 'N', 'NORTE'].includes(n)) return { tipo: 'tmy' }
    const col = layout.find((c) => !c.sistema && c.chave === n && !usados.has(c.column_id!))
    if (col) {
      usados.add(col.column_id!)
      return { tipo: 'coluna', column_id: col.column_id! }
    }
    return { tipo: 'ignorar' }
  })
}

export function montarLinhasImportacao(planilha: PlanilhaLida, destinos: Destino[], tipos: Record<string, ColumnType>) {
  return planilha.linhas.map((l) => {
    const item: { valores: Record<string, string>; latitude?: string; longitude?: string; tmx?: string; tmy?: string } = {
      valores: {},
    }
    destinos.forEach((d, i) => {
      const v = l[i]
      if (v === null || v === undefined) return
      if (d.tipo === 'coluna') {
        // datas em dd/mm/aaaa -> aaaa-mm-dd
        if (tipos[d.column_id] === 'data') {
          const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v)
          item.valores[d.column_id] = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v
        } else item.valores[d.column_id] = v
      } else if (d.tipo !== 'ignorar') item[d.tipo] = v
    })
    return item
  })
}
