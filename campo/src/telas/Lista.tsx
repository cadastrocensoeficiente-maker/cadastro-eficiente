import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PontoLocal } from '../lib/db'
import BotaoSincronizar from './Sincronizar'
import type { Tela, Usuario } from '../App'

const ROTULO: Record<PontoLocal['status'], string> = {
  pendente: 'No celular',
  enviando: 'Enviando',
  enviado: 'Fotos pendentes',
  erro: 'Erro',
}

export default function Lista({ usuario, contractId, irPara }: { usuario: Usuario; contractId: string; irPara: (t: Tela) => void }) {
  const contrato = useLiveQuery(() => db.contratos.get(contractId), [contractId])
  const pontos = useLiveQuery(
    () => db.pontos.where('[contractId+userId]').equals([contractId, usuario.id]).reverse().sortBy('criadoEm'),
    [contractId, usuario.id],
  )
  const fotos = useLiveQuery(async () => {
    const ids = (pontos ?? []).map((p) => p.localId)
    const fs = await db.fotos.where('localPointId').anyOf(ids).toArray()
    const m: Record<string, { total: number; pend: number; erro?: string }> = {}
    for (const f of fs) {
      m[f.localPointId] ??= { total: 0, pend: 0 }
      m[f.localPointId].total++
      if (f.status !== 'enviado') m[f.localPointId].pend++
      if (f.status === 'erro' && f.erro) m[f.localPointId].erro = f.erro
    }
    return m
  }, [pontos])

  if (!contrato || !pontos) return <div className="centro">Carregando…</div>
  const primeira = contrato.colunas[0]

  return (
    <main className="tela">
      <button className="voltar" onClick={() => irPara({ nome: 'contratos' })}>‹ Contratos</button>
      <div className="titulo-linha">
        <h2 className="titulo">{contrato.nome}</h2>
        <button className="btn primario" onClick={() => irPara({ nome: 'cadastro', contractId })}>+ Novo</button>
      </div>
      <p className="nota">{pontos.length} ponto(s) guardados no celular. Ao sincronizar, eles são enviados e saem desta lista.</p>
      <BotaoSincronizar userId={usuario.id} />

      {pontos.length === 0 ? (
        <div className="vazio">Nenhum ponto no celular. Tudo já foi sincronizado.</div>
      ) : (
        <ul className="lista">
          {pontos.map((p) => {
            const f = fotos?.[p.localId]
            const editavel = p.status === 'pendente' || p.status === 'erro'
            return (
              <li key={p.localId} className={`item status-${p.status}`}>
                <button className="item-corpo" onClick={() => irPara({ nome: 'cadastro', contractId, localId: p.localId })}>
                  <span className="item-id mono">{p.codigo ?? '— —'}</span>
                  <span className="item-txt">
                    {primeira ? String(p.valores[primeira.column_id] ?? '(sem ' + primeira.rotulo.toLowerCase() + ')') : ''}
                    <small>
                      {new Date(p.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {f ? ` · 📷 ${f.total}${f.pend ? ` (${f.pend} a enviar)` : ''}` : ''}
                    </small>
                  </span>
                  <span className={`chip ${p.status}`}>{ROTULO[p.status]}</span>
                </button>
                {p.status === 'erro' && (
                  <div className="item-erro">
                    <span>{p.erro}</span>
                  </div>
                )}
                {f?.erro && <div className="item-erro"><span>Foto: {f.erro}</span></div>}
                {!editavel && p.status === 'enviado' && f?.pend ? <div className="item-info">Ponto enviado; as fotos vão na próxima sincronização.</div> : null}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
