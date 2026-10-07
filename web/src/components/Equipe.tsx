import { useEffect, useState } from 'react'
import { supabase, msgErro } from '../lib/supabase'
import type { Contract } from '../lib/types'

interface Membro {
  user_id: string
  nome: string | null
  email: string | null
  role: string
  membro: boolean
  pontos: number
}

export const URL_APK =
  'https://github.com/cadastrocensoeficiente-maker/cadastro-eficiente/releases/latest/download/cadastro-campo.apk'

export const URL_APP_CAMPO = (import.meta.env.VITE_APP_CAMPO_URL as string) || 'https://cadastro-campo.vercel.app'

export default function Equipe({ contrato }: { contrato: Contract }) {
  const [lista, setLista] = useState<Membro[]>([])
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)

  const carregar = async () => {
    const { data, error } = await supabase.rpc('equipe_do_contrato', { p_contract: contrato.id })
    if (error) setErro(msgErro(error))
    else setLista(data as Membro[])
  }
  useEffect(() => {
    carregar()
  }, [contrato.id])

  async function alternar(m: Membro) {
    setOcupado(m.user_id)
    setErro('')
    const { error } = await supabase.rpc('membro_definir', { p_contract: contrato.id, p_user: m.user_id, p_ativo: !m.membro })
    if (error) setErro(msgErro(error))
    await carregar()
    setOcupado(null)
  }

  const naEquipe = lista.filter((m) => m.membro)

  return (
    <div>
      <div className="explica">
        <p>
          Os cadastradores marcados aqui veem este contrato no <b>aplicativo de campo</b> (<a href={URL_APK}>baixar APK Android</a> ou{' '}
          <a href={URL_APP_CAMPO} target="_blank" rel="noreferrer">versão web</a>). Quem não estiver na
          equipe não vê nem envia pontos deste contrato. Para alguém aparecer na lista, libere o papel <b>Cadastrador</b> na tela Usuários.
        </p>
      </div>
      {erro && <div className="alerta erro">{erro}</div>}
      <p className="sub">{naEquipe.length} pessoa(s) na equipe deste contrato.</p>
      <div className="tabela-scroll">
        <table className="tabela">
          <thead>
            <tr>
              <th>Na equipe</th>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Papel</th>
              <th style={{ textAlign: 'right' }}>Pontos cadastrados</th>
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 ? (
              <tr>
                <td colSpan={5} className="celula-vazia">Nenhum cadastrador liberado ainda. Libere em Usuários.</td>
              </tr>
            ) : (
              lista.map((m) => (
                <tr key={m.user_id}>
                  <td>
                    <label className="check">
                      <input type="checkbox" checked={m.membro} disabled={ocupado === m.user_id} onChange={() => alternar(m)} />
                      {m.membro ? 'Sim' : 'Não'}
                    </label>
                  </td>
                  <td>{m.nome}</td>
                  <td>{m.email}</td>
                  <td><em className={`papel papel-${m.role}`}>{m.role}</em></td>
                  <td className="num mono">{Number(m.pontos).toLocaleString('pt-BR')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
