import { useState } from 'react'
import { importPoints } from '../lib/api'
import { lerXlsx, mapearAutomatico, montarLinhasImportacao, normalizarCabecalho, type Destino, type PlanilhaLida } from '../lib/excel'
import { msgErro } from '../lib/supabase'
import type { ColumnType, Contract, LayoutItem } from '../lib/types'

const LOTE = 500

function destinoParaValor(d: Destino) {
  return d.tipo === 'coluna' ? `col:${d.column_id}` : d.tipo
}
function valorParaDestino(v: string): Destino {
  if (v.startsWith('col:')) return { tipo: 'coluna', column_id: v.slice(4) }
  return { tipo: v } as Destino
}

export default function Importar({ contrato, layout }: { contrato: Contract; layout: LayoutItem[] }) {
  const [planilha, setPlanilha] = useState<PlanilhaLida | null>(null)
  const [destinos, setDestinos] = useState<Destino[]>([])
  const [erro, setErro] = useState('')
  const [progresso, setProgresso] = useState('')
  const [resultado, setResultado] = useState('')

  const configuraveis = layout.filter((c) => !c.sistema).sort((a, b) => a.ordem - b.ordem)
  const tipos: Record<string, ColumnType> = Object.fromEntries(configuraveis.map((c) => [c.column_id!, c.tipo as ColumnType]))

  async function abrir(f: File | undefined) {
    if (!f) return
    setErro('')
    setResultado('')
    try {
      const p = await lerXlsx(f)
      setPlanilha(p)
      setDestinos(mapearAutomatico(p.cabecalhos, layout))
    } catch (e) {
      setErro(`Não foi possível ler a planilha: ${msgErro(e)}`)
    }
  }

  const usadas = new Set(destinos.filter((d) => d.tipo === 'coluna').map((d) => (d as { column_id: string }).column_id))
  const temCoord =
    (destinos.some((d) => d.tipo === 'latitude') && destinos.some((d) => d.tipo === 'longitude')) ||
    (destinos.some((d) => d.tipo === 'tmx') && destinos.some((d) => d.tipo === 'tmy'))
  const repetidos = destinos.filter((d, i) => d.tipo !== 'ignorar' && destinos.findIndex((x) => destinoParaValor(x) === destinoParaValor(d)) !== i)

  async function importar() {
    if (!planilha) return
    if (!confirm(`Importar ${planilha.linhas.length.toLocaleString('pt-BR')} linha(s) para ${contrato.nome}?\n\nCada linha vira um ponto novo com ID gerado pelo sistema.`)) return
    setErro('')
    setResultado('')
    const linhas = montarLinhasImportacao(planilha, destinos, tipos)
    let inseridos = 0
    let semCoord = 0
    try {
      for (let i = 0; i < linhas.length; i += LOTE) {
        setProgresso(`Importando ${Math.min(i + LOTE, linhas.length).toLocaleString('pt-BR')} de ${linhas.length.toLocaleString('pt-BR')}…`)
        const r = await importPoints(contrato.id, linhas.slice(i, i + LOTE))
        inseridos += r.inseridos
        semCoord += r.sem_coordenada
      }
      setResultado(`${inseridos.toLocaleString('pt-BR')} ponto(s) importado(s).` + (semCoord ? ` ${semCoord} sem coordenada (TMX/TMY ficaram vazios).` : ''))
      setPlanilha(null)
    } catch (e) {
      setErro(`Parou após ${inseridos.toLocaleString('pt-BR')} ponto(s) importados. Erro: ${msgErro(e)}`)
    } finally {
      setProgresso('')
    }
  }

  return (
    <div className="importar">
      <div className="explica">
        <p>
          Cada linha da planilha vira um <b>ponto novo</b>. O <b>ID</b> é sempre gerado pelo sistema (o da planilha é ignorado) e
          <b> LINK_FOTOS</b> é criado automaticamente. <b>TMX/TMY</b> são recalculados pelo sistema: se a planilha tiver latitude/longitude
          elas são usadas; se tiver só TMX/TMY, o sistema converte assumindo <span className="mono">EPSG {contrato.epsg}</span>.
        </p>
      </div>
      {configuraveis.length === 0 && <div className="alerta aviso">Crie as colunas do contrato antes de importar.</div>}

      <label className="arquivo">
        <input type="file" accept=".xlsx" onChange={(e) => abrir(e.target.files?.[0])} />
        <span className="btn">📄 Escolher planilha .xlsx</span>
      </label>

      {erro && <div className="alerta erro">{erro}</div>}
      {resultado && <div className="alerta ok">{resultado}</div>}

      {planilha && (
        <div className="painel">
          <h3>Mapeamento das colunas ({planilha.linhas.length.toLocaleString('pt-BR')} linhas)</h3>
          <table className="tabela mapa">
            <thead>
              <tr>
                <th>Coluna na planilha</th>
                <th>Exemplo</th>
                <th>Vai para</th>
              </tr>
            </thead>
            <tbody>
              {planilha.cabecalhos.map((h, i) => {
                const sistemaFixo = ['ID', 'UUID', 'LINK_FOTOS'].includes(normalizarCabecalho(h))
                return (
                  <tr key={i}>
                    <td className="mono">{h}</td>
                    <td className="exemplo">{planilha.linhas.find((l) => l[i])?.[i] ?? ''}</td>
                    <td>
                      {sistemaFixo ? (
                        <span className="desc">🔒 controlado pelo sistema — ignorado</span>
                      ) : (
                        <select
                          value={destinoParaValor(destinos[i])}
                          onChange={(e) => setDestinos(destinos.map((d, j) => (j === i ? valorParaDestino(e.target.value) : d)))}
                        >
                          <option value="ignorar">— ignorar —</option>
                          <optgroup label="Colunas do contrato (sequência)">
                            {configuraveis.map((c) => (
                              <option
                                key={c.column_id}
                                value={`col:${c.column_id}`}
                                disabled={usadas.has(c.column_id!) && destinoParaValor(destinos[i]) !== `col:${c.column_id}`}
                              >
                                {c.sequencia} — {c.rotulo}
                              </option>
                            ))}
                          </optgroup>
                          <optgroup label="Localização (convertida pelo sistema)">
                            <option value="latitude">Latitude</option>
                            <option value="longitude">Longitude</option>
                            <option value="tmx">TMX (EPSG {contrato.epsg})</option>
                            <option value="tmy">TMY (EPSG {contrato.epsg})</option>
                          </optgroup>
                        </select>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!temCoord && <div className="alerta aviso">Nenhuma coordenada mapeada: os pontos entrarão sem TMX/TMY.</div>}
          {repetidos.length > 0 && <div className="alerta erro">Há destinos repetidos no mapeamento.</div>}
          <div className="acoes">
            <button className="btn" onClick={() => setPlanilha(null)}>Cancelar</button>
            <button className="btn primario" onClick={importar} disabled={!!progresso || repetidos.length > 0}>
              {progresso || 'Importar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
