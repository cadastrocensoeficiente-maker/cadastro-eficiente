import { useEffect, useState } from 'react'
import { countPoints, listAllPoints, type FiltroPeriodo } from '../lib/api'
import { msgErro } from '../lib/supabase'
import type { Contract, LayoutItem } from '../lib/types'

type Modo = 'todos' | 'dia' | 'intervalo'

const hoje = () => {
  // dia de hoje em Fortaleza (-03:00)
  const d = new Date(Date.now() - 3 * 3600_000)
  return d.toISOString().slice(0, 10)
}
const br = (d: string) => d.split('-').reverse().join('/')

/** Baixar planilha: tudo de uma vez, ou só um dia / um período de cadastro. */
export default function Exportar({ contrato, layout, onFechar }: { contrato: Contract; layout: LayoutItem[]; onFechar: () => void }) {
  const [modo, setModo] = useState<Modo>('todos')
  const [dia, setDia] = useState(hoje())
  const [de, setDe] = useState(hoje())
  const [ate, setAte] = useState(hoje())
  const [total, setTotal] = useState<number | null>(null)
  const [progresso, setProgresso] = useState('')
  const [erro, setErro] = useState('')

  const invalido = modo === 'intervalo' && (!de || !ate || de > ate)
  const filtro: FiltroPeriodo | undefined =
    modo === 'dia' ? { de: dia, ate: dia } : modo === 'intervalo' ? { de, ate } : undefined
  const chave = JSON.stringify(filtro ?? {})

  // conta quantos pontos entram no arquivo antes de baixar
  useEffect(() => {
    if (invalido || (modo === 'dia' && !dia)) { setTotal(null); return }
    let vivo = true
    setTotal(null)
    const t = setTimeout(() => {
      countPoints(contrato.id, filtro)
        .then((n) => vivo && setTotal(n))
        .catch((e) => vivo && setErro(msgErro(e)))
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [contrato.id, chave, invalido])

  async function baixar() {
    setErro('')
    setProgresso('Lendo pontos…')
    try {
      const pontos = await listAllPoints(
        contrato.id,
        (n, t) => setProgresso(`Lendo pontos… ${n.toLocaleString('pt-BR')} de ${t.toLocaleString('pt-BR')}`),
        filtro,
      )
      setProgresso('Gerando planilha…')
      const { exportarXlsx } = await import('../lib/excel')
      const sufixo = modo === 'dia' ? `_DIA_${dia}` : modo === 'intervalo' ? `_${de}_A_${ate}` : ''
      await exportarXlsx(contrato.nome, layout, pontos, window.location.origin, sufixo)
      onFechar()
    } catch (e) {
      setErro(msgErro(e))
    } finally {
      setProgresso('')
    }
  }

  const ocupado = !!progresso
  return (
    <div className="modal-fundo" onClick={() => !ocupado && onFechar()}>
      <div className="modal modal-estreito" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Baixar planilha">
        <div className="modal-topo">
          <h2>⬇ Baixar planilha — {contrato.nome}</h2>
          <button className="btn-x" onClick={onFechar} disabled={ocupado} aria-label="Fechar">×</button>
        </div>
        <p className="nota">Todos os pontos em um único arquivo Excel, na ordem oficial das colunas. Filtre pela data do cadastro se quiser só uma parte.</p>

        <fieldset className="periodo" disabled={ocupado}>
          <label className={modo === 'todos' ? 'ativo' : ''}>
            <input type="radio" name="periodo" checked={modo === 'todos'} onChange={() => setModo('todos')} />
            <span><b>Todos os pontos</b><small>tudo o que já foi cadastrado no contrato</small></span>
          </label>
          <label className={modo === 'dia' ? 'ativo' : ''}>
            <input type="radio" name="periodo" checked={modo === 'dia'} onChange={() => setModo('dia')} />
            <span><b>Um dia</b><small>somente os pontos cadastrados na data escolhida</small></span>
          </label>
          {modo === 'dia' && (
            <div className="datas">
              <input type="date" value={dia} max={hoje()} onChange={(e) => setDia(e.target.value)} aria-label="Dia" />
            </div>
          )}
          <label className={modo === 'intervalo' ? 'ativo' : ''}>
            <input type="radio" name="periodo" checked={modo === 'intervalo'} onChange={() => setModo('intervalo')} />
            <span><b>Período</b><small>de uma data até outra (as duas entram)</small></span>
          </label>
          {modo === 'intervalo' && (
            <div className="datas">
              <label>De <input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
              <label>Até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
            </div>
          )}
        </fieldset>

        {invalido && <div className="alerta aviso">A data inicial precisa ser igual ou anterior à final.</div>}
        {erro && <div className="alerta erro">{erro}</div>}

        <div className="exportar-rodape">
          <span className="contagem">
            {invalido ? '' : total === null ? 'Contando pontos…' :
              `${total.toLocaleString('pt-BR')} ponto(s)${modo === 'dia' ? ` em ${br(dia)}` : modo === 'intervalo' ? ` de ${br(de)} a ${br(ate)}` : ''}`}
          </span>
          <button className="btn primario" onClick={baixar} disabled={ocupado || invalido || !total}>
            {progresso || '⬇ Baixar Excel'}
          </button>
        </div>
      </div>
    </div>
  )
}
