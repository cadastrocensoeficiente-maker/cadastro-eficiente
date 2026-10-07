import { useEffect, useState, type FormEvent } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase, msgErro, SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { listContracts } from '../lib/api'
import { URL_APK } from '../components/Equipe'
import type { Contract, Role } from '../lib/types'

const PAPEIS: { value: Role; label: string }[] = [
  { value: 'cadastrador', label: 'Cadastrador (campo)' },
  { value: 'visualizador', label: 'Administrativo (consulta)' },
  { value: 'admin', label: 'Administrador' },
  { value: 'pendente', label: 'Pendente (sem acesso)' },
]
const nomePapel = (r: string) => PAPEIS.find((p) => p.value === r)?.label ?? r

interface UsuarioAdmin {
  id: string
  nome: string | null
  email: string
  role: Role
  created_at: string
  email_confirmado: boolean
  ativo: boolean
  ultimo_acesso: string | null
  contratos: string[]
}

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

function mensagemAcesso(email: string, senha: string, role: Role) {
  const link = role === 'cadastrador' ? `Aplicativo (Android): ${URL_APK}` : `Painel: ${window.location.origin}`
  return `Seu acesso ao Cadastro Eficiente:\nE-mail: ${email}\nSenha: ${senha}\n${link}`
}

const dataHora = (s: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nunca'

export default function Usuarios() {
  const { profile: eu } = useAuth()
  const [lista, setLista] = useState<UsuarioAdmin[]>([])
  const [contratos, setContratos] = useState<Contract[]>([])
  const [erro, setErro] = useState('')
  const [novo, setNovo] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const carregar = async () => {
    const { data, error } = await supabase.rpc('admin_usuarios')
    if (error) setErro(msgErro(error))
    else setLista(data as UsuarioAdmin[])
  }
  useEffect(() => {
    carregar()
    listContracts().then(setContratos).catch(() => {})
  }, [])

  const nomeContrato = (id: string) => contratos.find((c) => c.id === id)?.nome ?? '—'
  const filtrados = lista.filter((u) =>
    !busca.trim() || `${u.nome} ${u.email}`.toLowerCase().includes(busca.trim().toLowerCase()),
  )
  const emEdicao = lista.find((u) => u.id === editando)

  return (
    <section>
      <div className="cabecalho-pagina">
        <h1>Usuários</h1>
        {!novo && !editando && <button className="btn primario" onClick={() => setNovo(true)}>+ Novo usuário</button>}
      </div>
      <p className="sub">
        <b>Cadastrador</b> usa o aplicativo de campo e só vê os contratos marcados para ele; <b>Administrativo</b> consulta o
        painel; <b>Administrador</b> configura contratos, colunas, equipes, usuários, importa e exclui.
      </p>

      {novo && <NovoUsuario contratos={contratos} onFechar={() => setNovo(false)} onCriado={carregar} />}
      {emEdicao && (
        <EditarUsuario
          key={emEdicao.id}
          usuario={emEdicao}
          souEu={emEdicao.id === eu?.id}
          contratos={contratos}
          onFechar={() => setEditando(null)}
          onSalvo={carregar}
        />
      )}
      {erro && <div className="alerta erro">{erro}</div>}

      <div className="barra-ferramentas">
        <input className="busca" placeholder="Buscar por nome ou e-mail…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="contagem">{lista.length} usuário(s)</span>
      </div>
      <div className="tabela-scroll">
        <table className="tabela">
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Papel</th>
              <th>Contratos</th>
              <th>Situação</th>
              <th>Último acesso</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((u) => (
              <tr key={u.id} className={editando === u.id ? 'linha-ativa' : ''}>
                <td>{u.nome}{u.id === eu?.id && <em className="desc"> (você)</em>}</td>
                <td>{u.email}</td>
                <td><em className={`papel papel-${u.role}`}>{nomePapel(u.role)}</em></td>
                <td className="celula-contratos" title={u.contratos.map(nomeContrato).join(', ')}>
                  {u.role === 'cadastrador'
                    ? u.contratos.length ? u.contratos.map(nomeContrato).join(', ') : <span className="desc">nenhum</span>
                    : <span className="desc">todos</span>}
                </td>
                <td>
                  {!u.ativo ? <span className="situacao bloqueado">Bloqueado</span>
                    : !u.email_confirmado ? <span className="situacao aguardando">E-mail não confirmado</span>
                    : u.role === 'pendente' ? <span className="situacao aguardando">Sem acesso</span>
                    : <span className="situacao ativo">Ativo</span>}
                </td>
                <td className="desc">{dataHora(u.ultimo_acesso)}</td>
                <td>
                  <button className="btn" onClick={() => { setNovo(false); setEditando(u.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SeletorContratos({ contratos, marcados, onChange }: { contratos: Contract[]; marcados: Set<string>; onChange: (s: Set<string>) => void }) {
  return (
    <fieldset className="contratos-check">
      <legend>Contratos em que cadastra</legend>
      {contratos.length === 0 ? (
        <p className="nota">Nenhum contrato cadastrado ainda.</p>
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
                onChange(n)
              }}
            />
            {c.nome}{!c.ativo && <span className="desc"> (inativo)</span>}
          </label>
        ))
      )}
    </fieldset>
  )
}

function EditarUsuario({ usuario, souEu, contratos, onFechar, onSalvo }: {
  usuario: UsuarioAdmin; souEu: boolean; contratos: Contract[]; onFechar: () => void; onSalvo: () => Promise<void>
}) {
  const [nome, setNome] = useState(usuario.nome ?? '')
  const [role, setRole] = useState<Role>(usuario.role)
  const [ativo, setAtivo] = useState(usuario.ativo)
  const [marcados, setMarcados] = useState(new Set(usuario.contratos))
  const [novaSenha, setNovaSenha] = useState('')
  const [msgSenha, setMsgSenha] = useState('')
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setOk('')
    setSalvando(true)
    try {
      const { error } = await supabase.rpc('admin_atualizar_usuario', { p_user: usuario.id, p_nome: nome, p_role: role, p_ativo: ativo })
      if (error) throw error
      const antes = new Set(usuario.contratos)
      const mudancas = contratos
        .filter((c) => antes.has(c.id) !== marcados.has(c.id))
        .map((c) => supabase.rpc('membro_definir', { p_contract: c.id, p_user: usuario.id, p_ativo: marcados.has(c.id) }))
      for (const r of await Promise.all(mudancas)) if (r.error) throw r.error
      await onSalvo()
      onFechar()
    } catch (err) {
      setErro(msgErro(err))
    } finally {
      setSalvando(false)
    }
  }

  async function definirSenha() {
    setErro('')
    const senha = novaSenha || senhaProvisoria()
    const { error } = await supabase.rpc('admin_definir_senha', { p_user: usuario.id, p_senha: senha })
    if (error) return setErro(msgErro(error))
    setNovaSenha('')
    setMsgSenha(mensagemAcesso(usuario.email, senha, usuario.role))
  }

  async function confirmarEmail() {
    setErro('')
    const { error } = await supabase.rpc('admin_confirmar_email', { p_user: usuario.id })
    if (error) return setErro(msgErro(error))
    setOk('E-mail confirmado. A pessoa já pode entrar.')
    await onSalvo()
  }

  return (
    <form className="painel" onSubmit={salvar}>
      <h3>Editar usuário — {usuario.email}</h3>
      <div className="linha-campos">
        <label>
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} required />
        </label>
        <label>
          Papel
          <select value={role} disabled={souEu} onChange={(e) => setRole(e.target.value as Role)}>
            {PAPEIS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
      </div>
      {souEu && <p className="nota">Você não pode mudar o seu próprio papel nem se bloquear.</p>}

      {role === 'cadastrador' && <SeletorContratos contratos={contratos} marcados={marcados} onChange={setMarcados} />}

      <label className="check">
        <input type="checkbox" checked={ativo} disabled={souEu} onChange={(e) => setAtivo(e.target.checked)} />
        Acesso ativo {!ativo && <span className="desc">— bloqueado: não consegue entrar no painel nem no aplicativo</span>}
      </label>

      <div className="secao-senha">
        <b>Senha</b>
        <p className="nota">Defina uma nova senha quando a pessoa esquecer. Deixe em branco para gerar uma automaticamente.</p>
        <span className="linha-senha">
          <input className="mono" placeholder="nova senha (opcional)" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} minLength={6} />
          <button type="button" className="btn" onClick={definirSenha}>Definir nova senha</button>
        </span>
        {msgSenha && (
          <>
            <pre className="mensagem-acesso">{msgSenha}</pre>
            <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(msgSenha)}>Copiar mensagem</button>
          </>
        )}
      </div>

      {!usuario.email_confirmado && (
        <div className="alerta aviso linha-acao">
          <span>Esta pessoa ainda não confirmou o e-mail e por isso não consegue entrar.</span>
          <button type="button" className="btn" onClick={confirmarEmail}>Liberar sem confirmação</button>
        </div>
      )}
      {ok && <div className="alerta ok">{ok}</div>}
      {erro && <div className="alerta erro">{erro}</div>}

      <div className="acoes">
        <button type="button" className="btn" onClick={onFechar}>Fechar</button>
        <button className="btn primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar alterações'}</button>
      </div>
    </form>
  )
}

function NovoUsuario({ contratos, onFechar, onCriado }: { contratos: Contract[]; onFechar: () => void; onCriado: () => Promise<void> }) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState(senhaProvisoria)
  const [role, setRole] = useState<Role>('cadastrador')
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [pronto, setPronto] = useState<string | null>(null)

  async function criar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setSalvando(true)
    try {
      const em = email.trim().toLowerCase()
      const { data, error } = await clienteCadastro().auth.signUp({
        email: em,
        password: senha,
        options: { data: { nome: nome.trim() }, emailRedirectTo: window.location.origin },
      })
      if (error) throw error
      const user = data.user
      // Supabase devolve identities vazio quando o e-mail já tem conta.
      if (!user || (user.identities && user.identities.length === 0)) {
        throw new Error('Este e-mail já tem conta. Procure a pessoa na lista e use "Editar".')
      }
      const r1 = await supabase.rpc('admin_atualizar_usuario', { p_user: user.id, p_nome: nome.trim(), p_role: role, p_ativo: true })
      if (r1.error) throw r1.error
      // Conta criada pelo administrador já entra liberada, sem depender do e-mail de confirmação.
      const r2 = await supabase.rpc('admin_confirmar_email', { p_user: user.id })
      if (r2.error) throw r2.error
      if (role === 'cadastrador') {
        for (const cid of marcados) {
          const r3 = await supabase.rpc('membro_definir', { p_contract: cid, p_user: user.id, p_ativo: true })
          if (r3.error) throw r3.error
        }
      }
      setPronto(mensagemAcesso(em, senha, role))
      await onCriado()
    } catch (err) {
      const m = msgErro(err)
      setErro(
        m.includes('rate limit') || m.includes('security purposes')
          ? 'O Supabase limitou temporariamente a criação de contas (limite de e-mails por hora do plano gratuito). Aguarde alguns minutos e tente de novo.'
          : m.includes('Password') ? 'A senha precisa ter pelo menos 6 caracteres.' : m,
      )
    } finally {
      setSalvando(false)
    }
  }

  if (pronto) {
    return (
      <div className="painel">
        <h3>Usuário criado</h3>
        <p className="sub">A conta já está liberada. Envie estes dados para a pessoa (por exemplo, pelo WhatsApp):</p>
        <pre className="mensagem-acesso">{pronto}</pre>
        <div className="acoes">
          <button className="btn" onClick={() => navigator.clipboard.writeText(pronto)}>Copiar mensagem</button>
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
            {PAPEIS.filter((p) => p.value !== 'pendente').map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
      </div>
      {role === 'cadastrador' && <SeletorContratos contratos={contratos.filter((c) => c.ativo)} marcados={marcados} onChange={setMarcados} />}
      {erro && <div className="alerta erro">{erro}</div>}
      <div className="acoes">
        <button type="button" className="btn" onClick={onFechar}>Cancelar</button>
        <button className="btn primario" disabled={salvando}>{salvando ? 'Criando…' : 'Criar usuário'}</button>
      </div>
    </form>
  )
}
