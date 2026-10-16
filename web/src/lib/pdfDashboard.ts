import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { br, brCurto, dataHora, diaSemana, n, n1, pct, type Resultado } from './producao'

// Cores da marca: azul Eficiente e branco
const AZUL: [number, number, number] = [11, 78, 162]
const AZUL_CLARO: [number, number, number] = [232, 240, 251]
const AZUL_PROFUNDO: [number, number, number] = [8, 42, 92]
const FUNDO_ALT: [number, number, number] = [246, 249, 253]
const TINTA: [number, number, number] = [14, 26, 43]
const TINTA_2: [number, number, number] = [71, 85, 105]
const LINHA: [number, number, number] = [213, 223, 236]

interface Info {
  contrato: string
  colaborador: string
  importados: boolean
  preset: string
}

/** Gera e baixa o PDF do dashboard (A4 paisagem), com os mesmos filtros da tela. */
export async function gerarPdfDashboard(r: Resultado, info: Info) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 12
  let y = M

  // ---------- cabeçalho ----------
  doc.setFillColor(...AZUL)
  doc.circle(M + 2, y + 2.6, 2, 'F')
  doc.setTextColor(...TINTA)
  doc.setFont('helvetica', 'bold').setFontSize(15)
  doc.text('Cadastro Eficiente — Dashboard de produção', M + 6, y + 4)
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...TINTA_2)
  doc.text(`Gerado em ${dataHora(new Date().toISOString())}`, W - M, y + 4, { align: 'right' })
  y += 10
  doc.setFontSize(9.5).setTextColor(...TINTA)
  doc.text(`Período: ${r.periodoTexto}   ·   Contrato: ${info.contrato}   ·   Cadastrador: ${info.colaborador}${info.importados ? '   ·   inclui importados' : ''}`, M, y)
  y += 3
  doc.setDrawColor(...LINHA).line(M, y, W - M, y)
  y += 5

  // ---------- KPIs ----------
  const k = r.kpis
  const kpis: [string, string, string][] = [
    ['Pontos no período', n(k.pontos), ''],
    ['Hoje', n(k.hoje), `ontem: ${n(k.ontem)}`],
    ['Média por dia trabalhado', n1(k.mediaDia), `${n(k.dias)} dia(s) com produção`],
    ['Melhor dia', k.melhorDia ? n(k.melhorDia.pontos) : '—', k.melhorDia ? `${br(k.melhorDia.dia)} (${diaSemana(k.melhorDia.dia)})` : ''],
    ['Cadastradores ativos', n(k.colaboradores), ''],
    ['Fotos', n(k.fotos), k.pontos ? `${pct(k.comFoto / k.pontos)} com foto · ${n1(k.fotos / k.pontos)}/ponto` : ''],
  ]
  const gap = 3
  const bw = (W - 2 * M - gap * (kpis.length - 1)) / kpis.length
  kpis.forEach(([t, v, s], i) => {
    const x = M + i * (bw + gap)
    if (i === 0) doc.setFillColor(...AZUL_CLARO)
    else doc.setFillColor(...FUNDO_ALT)
    doc.setDrawColor(...(i === 0 ? AZUL : LINHA))
    doc.roundedRect(x, y, bw, 19, 1.5, 1.5, 'FD')
    doc.setFontSize(7.5).setTextColor(...TINTA_2).setFont('helvetica', 'normal')
    doc.text(t, x + 3, y + 5)
    doc.setFontSize(15).setTextColor(...TINTA).setFont('helvetica', 'bold')
    doc.text(v, x + 3, y + 12.5)
    if (s) {
      doc.setFontSize(6.8).setTextColor(...TINTA_2).setFont('helvetica', 'normal')
      doc.text(s, x + 3, y + 16.8, { maxWidth: bw - 5 })
    }
  })
  y += 25

  // ---------- gráfico diário ----------
  const serie = r.serie
  if (serie.some((s) => s.pontos > 0)) {
    const h = 42
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...TINTA)
    doc.text('Produção diária', M, y)
    y += 3
    const areaW = W - 2 * M
    const max = Math.max(...serie.map((s) => s.pontos), 1)
    const passo = areaW / serie.length
    const larg = Math.max(Math.min(passo * 0.7, 12), 0.4)
    const base = y + h - 6
    const mostrarRotulos = serie.length <= 31
    doc.setDrawColor(...LINHA).line(M, base, W - M, base)
    serie.forEach((s, i) => {
      const x = M + i * passo + (passo - larg) / 2
      const bh = (s.pontos / max) * (h - 12)
      if (bh > 0) {
        doc.setFillColor(...AZUL)
        doc.rect(x, base - bh, larg, bh, 'F')
      }
      if (mostrarRotulos) {
        doc.setFont('helvetica', 'normal').setFontSize(6.3).setTextColor(...TINTA_2)
        doc.text(brCurto(s.dia), x + larg / 2, base + 3.5, { align: 'center' })
        if (s.pontos) {
          doc.setTextColor(...TINTA).setFont('helvetica', 'bold')
          doc.text(String(s.pontos), x + larg / 2, base - bh - 1, { align: 'center' })
        }
      }
    })
    if (!mostrarRotulos) {
      doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(...TINTA_2)
      doc.text(br(serie[0].dia), M, base + 3.5)
      doc.text(br(serie[serie.length - 1].dia), W - M, base + 3.5, { align: 'right' })
      doc.text(`máx. ${n(max)}/dia`, M, y + 2)
    }
    y += h
  }

  const estilo = {
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, textColor: TINTA, lineColor: LINHA, lineWidth: 0.1 },
    headStyles: { fillColor: AZUL_PROFUNDO, textColor: 255, fontStyle: 'bold' as const },
    alternateRowStyles: { fillColor: FUNDO_ALT },
    margin: { left: M, right: M },
  }
  const titulo = (t: string) => {
    if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); y = M }
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...TINTA)
    doc.text(t, M, y + 2)
    y += 4
  }
  const depois = () => { y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7 }
  const numCols = (de: number, ate: number) => Object.fromEntries(Array.from({ length: ate - de + 1 }, (_, i) => [de + i, { halign: 'right' as const }]))

  // ---------- por contrato ----------
  titulo('Por contrato')
  autoTable(doc, {
    ...estilo,
    startY: y,
    head: [['Contrato', 'Total geral', 'No período', 'Hoje', 'Dias', 'Média/dia', 'Cadastradores', 'Último cadastro']],
    body: r.porContrato.map((c) => [
      c.local ? `${c.nome} · ${c.local}` : c.nome,
      c.importados ? `${n(c.totalGeral)} (${n(c.importados)} imp.)` : n(c.totalGeral),
      n(c.periodo), n(c.hoje), n(c.dias), n1(c.mediaDia), n(c.colaboradores), c.ultimo ? dataHora(c.ultimo) : '—',
    ]),
    columnStyles: { ...numCols(1, 6), 2: { halign: 'right', fontStyle: 'bold' } },
  })
  depois()

  // ---------- por cadastrador ----------
  titulo('Por cadastrador')
  autoTable(doc, {
    ...estilo,
    startY: y,
    head: [['Cadastrador', 'Contrato(s)', 'No período', 'Hoje', 'Dias', 'Média/dia', 'Melhor dia', 'Fotos', 'Último cadastro']],
    body: r.porColaborador.length
      ? r.porColaborador.map((c) => [
          c.nome, c.contratos.join(', '), n(c.periodo), n(c.hoje), n(c.dias), n1(c.mediaDia),
          c.melhorDia ? `${n(c.melhorDia.pontos)} em ${brCurto(c.melhorDia.dia)}` : '—', n(c.fotos), c.ultimo ? dataHora(c.ultimo) : '—',
        ])
      : [['Nenhum ponto cadastrado no período.', '', '', '', '', '', '', '', '']],
    columnStyles: { ...numCols(2, 5), 7: { halign: 'right' }, 2: { halign: 'right', fontStyle: 'bold' }, 0: { fontStyle: 'bold' } },
  })
  depois()

  // ---------- matriz cadastrador × dia ----------
  const mz = r.matriz
  if (mz.linhas.length) {
    titulo(`Produção diária por cadastrador${mz.cortado ? ` (últimos ${mz.dias.length} dias do período)` : ''}`)
    const poucos = mz.dias.length <= 16
    autoTable(doc, {
      ...estilo,
      startY: y,
      styles: { ...estilo.styles, fontSize: poucos ? 8 : 6.5, cellPadding: poucos ? 1.5 : 0.9, halign: 'right' },
      head: [['Cadastrador', ...mz.dias.map((d) => `${brCurto(d)}\n${diaSemana(d)}`), 'Total']],
      body: [
        ...mz.linhas.map((l) => [l.nome, ...l.valores.map((v) => (v ? String(v) : '·')), n(l.total)]),
        ['Total do dia', ...mz.totais.map((v) => (v ? String(v) : '·')), n(mz.totais.reduce((s, v) => s + v, 0))],
      ],
      headStyles: { ...estilo.headStyles, halign: 'center' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold' }, [mz.dias.length + 1]: { fontStyle: 'bold' } },
      didParseCell: (d) => {
        if (d.section === 'body' && d.row.index === mz.linhas.length) {
          d.cell.styles.fontStyle = 'bold'
          d.cell.styles.fillColor = AZUL_CLARO
        }
      },
    })
  }

  // ---------- rodapé ----------
  const paginas = doc.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...TINTA_2)
    const H = doc.internal.pageSize.getHeight()
    doc.text('Produção = pontos cadastrados (contados pela data/hora do cadastro, horário de Fortaleza). Não depende das colunas de cada contrato.', M, H - 6)
    doc.text(`Página ${i} de ${paginas}`, W - M, H - 6, { align: 'right' })
  }

  const limpa = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase()
  const partes = ['DASHBOARD', info.contrato === 'Todos os contratos' ? 'GERAL' : limpa(info.contrato)]
  if (info.colaborador !== 'Todos os cadastradores') partes.push(limpa(info.colaborador))
  partes.push(limpa(r.periodoTexto.replace(/^Todo o período /, 'TUDO ')))
  doc.save(`${partes.join('_')}.pdf`)
}
