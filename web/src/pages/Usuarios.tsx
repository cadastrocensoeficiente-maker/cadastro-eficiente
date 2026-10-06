import { useEffect, useState } from 'react'
import { supabase, msgErro } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Profile, Role } from '../lib/types'

const PAPEIS: { value: Role; label: string }[] = [
  { value: 'pendente', label: 'Pendente (sem acesso)' },
  { value: 'visualizador', label: 'Administrativo (consulta)' },
  { value: 'cadastrador', label: 'Cadastrador' },
  { value: 'admin', label: 'Administrador' },
]

export default function Usuarios() {
  const { profile: eu } = useAuth()
  const [lista, setLista] = useState<Profile[]>([])
  const [erro, setErro] = useState('')

  const carregar = async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at')
    if (error) setErro(msgErro(error))
    else setLista(data as Profile[])
  }
  useEffect(() => {
    carregar()
  }, [])

  async function mudar(p: Profile, role: Role) {
    setErro('')
    const { error } = await supabase.from('profiles').update({ role }).eq('id', p.id)
    if (error) setErro(msgErro(error))
    await carregar()
  }

  return (
    <section>
      <div className="cabecalho-pagina">
        <h1>Usuários</h1>
      </div>
      <p className="sub">
        Quem cria conta pela tela de login aparece aqui. <b>Cadastrador</b> cria e edita pontos e fotos; <b>Visualizador</b> só consulta;
        <b> Administrador</b> configura contratos e colunas, importa e exclui.
      </p>
      {erro && <div className="alerta erro">{erro}</div>}
      <div className="tabela-scroll">
        <table className="tabela">
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Papel</th>
              <th>Desde</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id}>
                <td>{p.nome}</td>
                <td>{p.email}</td>
                <td>
                  <select value={p.role} disabled={p.id === eu?.id} onChange={(e) => mudar(p, e.target.value as Role)}>
                    {PAPEIS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </td>
                <td>{new Date(p.created_at).toLocaleDateString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
