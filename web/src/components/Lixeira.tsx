import { useEffect, useState } from 'react'
import { listTrash, restorePoints, type PontoLixeira } from '../lib/api'
import { msgErro } from '../lib/supabase'
import type { Contract, LayoutItem } from '../lib/types'
import { exibirValor, fmtGraus } from './TabelaPontos'

/** Pontos excluídos do contrato, com opção de restaurar. */
export default function Lixeira({ contrato, layout, onFechar }: {
  contrato: Contract; layout: LayoutItem[]; onFechar: (mudou: boolean) => void
}) {
  const [itens, setItens] = useState<PontoLixeira[] | null>(null)
  const [erro, setErro] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [mudou, setMudou] = useState(false)
  const [trabalhando, setTrabalhando] = useState(false)
  const colunas = layout.filter((c) => !c.sistema).sort((a, b) => a.ordem - b.ordem).slice(0, 3)

  async function carregar() {
    try {
      setItens(await listTrash(contrato.id))
    } catch (e) {
      setErro(msgErro(e))
    }
  }
  useEffect(() => {
    carregar()
  }, [contrato.id])

  async function restaurar(ids: string[]) {
    setTrabalhando(true)
    setErro('')
    try {
      await restorePoints(ids)
      setMudou(true)
      setSel(new Set())
      await carregar()
    } catch (e) {
      setErro(msgErro(e))
    } finally {
      setTrabalhando(false)
    }
  }

  const fechar = () => onFechar(mudou)
  const todos = !!itens?.length && itens.every((i) => sel.has(i.id))

  return (
    <div className="modal-fundo" onClick={fechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Lixeira">
        <div className="modal-topo">
          <h2>🗑 Lixeira — {contrato.nome}</h2>
          <button className="btn-x" onClick={fechar} aria-label="Fechar">×</button>
        </div>
        <p className="nota">Pontos excluídos não aparecem no painel nem no Excel. Restaure para que voltem com o mesmo ID e as fotos.</p>
        {erro && <div className="alerta erro">{erro}</div>}
        {!itens ? (
          <div className="carregando">Carregando…</div>
        ) : itens.length === 0 ? (
          <div className="vazio">A lixeira está vazia.</div>
        ) : (
          <>
            <div className="barra-acao">
              <button className="btn primario" disabled={!sel.size || trabalhando} onClick={() => restaurar([...sel])}>
                ↶ Restaurar selecionados{sel.size ? ` (${sel.size})` : ''}
              </button>
              <span className="contagem">{itens.length} ponto(s) na lixeira</span>
            </div>
            <div className="tabela-scroll modal-tabela">
              <table className="tabela">
                <thead>
                  <tr>
                    <th><input type="checkbox" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(itens.map((i) => i.id)))} aria-label="Selecionar todos" /></th>
                    <th>ID</th>
                    {colunas.map((c) => <th key={c.chave}>{c.rotulo}</th>)}
                    <th>LATITUDE</th>
                    <th>LONGITUDE</th>
                    <th>Fotos</th>
                    <th>Excluído</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i) => (
                    <tr key={i.id} className={sel.has(i.id) ? 'linha-ativa' : ''}>
                      <td><input type="checkbox" checked={sel.has(i.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n })} /></td>
                      <td className="mono forte">{i.codigo}</td>
                      {colunas.map((c) => <td key={c.chave}>{exibirValor(i.valores[c.column_id!], c.tipo)}</td>)}
                      <td className="mono num">{fmtGraus(i.latitude)}</td>
                      <td className="mono num">{fmtGraus(i.longitude)}</td>
                      <td>{i.total_fotos}</td>
                      <td>{new Date(i.excluido_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{i.excluido_por_nome ? ` · ${i.excluido_por_nome}` : ''}</td>
                      <td><button className="btn" disabled={trabalhando} onClick={() => restaurar([i.id])}>↶ Restaurar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
