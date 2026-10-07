import { useEffect, useState, type FormEvent } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase, msgErro, SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { listContracts } from '../lib/api'
import { URL_APK, URL_APP_CAMPO } from '../components/Equipe'
import type { Contract, Profile, Role } from '../lib/types'

const PAPEIS: { value: Role; label: string }[] = [
  { value: 'pendente', label: 'Pendente (sem acesso)' },
  { value: 'visualizador', label: 'Administrativo (consulta)' },
  { value: 'cadastrador', label: 'Cadastrador' },
  { value: 'admin', label: 'Administrador' },
]

// Cliente separado, sem guardar sessão: criar a conta de outra pessoa
// não pode trocar o login do administrador que está usando o painel.
const clienteCadastro = () =>
  createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'cadastro-novo-usuario' },
  })

function senhaProvisoria() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const a = new Uint32Array(10)
  crypto.getRandomValues(a)
  return Array.from(a, (n) => c[n % c.length]).join('')
}

export default function Usuarios() {
  const { profile: eu } = useAuth()
  const [lista, setLista] = useState<Profile[]>([])
  const [erro, setErro] = useState('')
  const [novo, setNovo] = useState(false)

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
        {!novo && <button className="btn primario" onClick={() => setNovo(true)}>+ Novo usuário</button>}
      </div>
      <p className="sub">
        <b>Cadastrador</b> usa o aplicativo de campo e só vê os contratos em que está na equipe; <b>Administrativo</b> consulta o
        painel; <b>Administrador</b> configura contratos, colunas, equipes, importa e exclui. Quem criar conta sozinho pela tela de
        login também aparece aqui, para você liberar.
      </p>
      {novo && <NovoUsuario onFechar={() => setNovo(false)} onCriado={carregar} />}
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

function NovoUsuario({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState(senhaProvisoria)
  const [role, setRole] = useState<Role>('cadastrador')
  const [contratos, setContratos] = useState<Contract[]>([])
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [pronto, setPronto] = useState<{ email: string; senha: string; confirmar: boolean; role: Role } | null>(null)

  useEffect(() => {
    listContracts().then((l) => setContratos(l.filter((c) => c.ativo))).catch(() => {})
  }, [])

  async function criar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setSalvando(true)
    try {
      const destino = role === 'cadastrador' ? URL_APP_CAMPO : window.location.origin
      const { data, error } = await clienteCadastro().auth.signUp({
        email: email.trim().toLowerCase(),
        password: senha,
        options: { data: { nome: nome.trim() }, emailRedirectTo: destino },
      })
      if (error) throw error
      const user = data.user
      // Supabase devolve identities vazio quando o e-mail já tem conta.
      if (!user || (user.identities && user.identities.length === 0)) {
        throw new Error('Este e-mail já tem conta. Procure a pessoa na lista abaixo e ajuste o papel.')
      }
      const { error: e2 } = await supabase.from('profiles').update({ role, nome: nome.trim() }).eq('id', user.id)
      if (e2) throw e2
      if (role === 'cadastrador') {
        for (const cid of marcados) {
          const { error: e3 } = await supabase.rpc('membro_definir', { p_contract: cid, p_user: user.id, p_ativo: true })
          if (e3) throw e3
        }
      }
      setPronto({ email: email.trim().toLowerCase(), senha, confirmar: !data.session, role })
      onCriado()
    } catch (err) {
      const m = msgErro(err)
      setErro(
        m.includes('rate limit') || m.includes('security purposes')
          ? 'O Supabase limitou o envio de e-mails de confirmação (limite por hora do plano gratuito). Tente de novo mais tarde ou desative a confirmação de e-mail no Supabase.'
          : m.includes('Password') ? 'A senha precisa ter pelo menos 6 caracteres.' : m,
      )
    } finally {
      setSalvando(false)
    }
  }

  if (pronto) {
    const link = pronto.role === 'cadastrador' ? `Aplicativo (Android): ${URL_APK}` : `Painel: ${window.location.origin}`
    const msg = `Seu acesso ao Cadastro Eficiente foi criado.\nE-mail: ${pronto.email}\nSenha provisória: ${pronto.senha}\n${link}${
      pronto.confirmar ? '\nAntes do primeiro acesso, confirme o e-mail que você recebeu.' : ''
    }`
    return (
      <div className="painel">
        <h3>Usuário criado</h3>
        {pronto.confirmar && (
          <div className="alerta aviso">
            A pessoa recebeu um e-mail de confirmação e só consegue entrar depois de clicar no link.
          </div>
        )}
        <p className="sub">Envie estes dados para a pessoa (por exemplo, pelo WhatsApp):</p>
        <pre className="mensagem-acesso">{msg}</pre>
        <div className="acoes">
          <button className="btn" onClick={() => navigator.clipboard.writeText(msg)}>Copiar mensagem</button>
          <button className="btn primario" onClick={onFechar}>Concluir</button>
        </div>
      </div>
    )
  }

  return (
    <form className="painel" onSubmit={criar}>
      <h3>Novo usuário</h3>
      <div className="linha-campos">
        <label>
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} required autoFocus />
        </label>
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
      </div>
      <div className="linha-campos">
        <label>
          Senha provisória
          <span className="linha-senha">
            <input className="mono" value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={6} />
            <button type="button" className="btn" onClick={() => setSenha(senhaProvisoria())}>Gerar outra</button>
          </span>
        </label>
        <label>
          Papel
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {PAPEIS.filter((p) => p.value !== 'pendente').map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
      </div>
      {role === 'cadastrador' && (
        <fieldset className="contratos-check">
          <legend>Contratos em que vai cadastrar</legend>
          {contratos.length === 0 ? (
            <p className="nota">Nenhum contrato ativo ainda. Depois você inclui a pessoa na aba Equipe do contrato.</p>
          ) : (
            contratos.map((c) => (
              <label key={c.id} className="check">
                <input
                  type="checkbox"
                  checked={marcados.has(c.id)}
                  onChange={(e) => {
                    const n = new Set(marcados)
                    if (e.target.checked) n.add(c.id)
                    else n.delete(c.id)
                    setMarcados(n)
                  }}
                />
                {c.nome}
              </label>
            ))
          )}
        </fieldset>
      )}
      {erro && <div className="alerta erro">{erro}</div>}
      <div className="acoes">
        <button type="button" className="btn" onClick={onFechar}>Cancelar</button>
        <button className="btn primario" disabled={salvando}>{salvando ? 'Criando…' : 'Criar usuário'}</button>
      </div>
    </form>
  )
}
