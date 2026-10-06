import { useState, type FormEvent } from 'react'
import { supabase, msgErro } from '../lib/supabase'

export default function Login() {
  const [modo, setModo] = useState<'entrar' | 'cadastrar'>('entrar')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setAviso('')
    setEnviando(true)
    try {
      if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: senha,
          options: { data: { nome }, emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        if (!data.session) setAviso('Conta criada. Confirme o e-mail recebido e depois entre.')
      }
    } catch (err) {
      const m = msgErro(err)
      setErro(m === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : m)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={enviar}>
        <div className="marca grande">
          <span className="marca-ponto" aria-hidden />
          Cadastro <b>Eficiente</b>
        </div>
        <p className="sub">Cadastro de pontos de iluminação pública</p>

        {modo === 'cadastrar' && (
          <label>
            Nome
            <input value={nome} onChange={(e) => setNome(e.target.value)} required autoComplete="name" />
          </label>
        )}
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Senha
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            minLength={6}
            autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
          />
        </label>

        {erro && <div className="alerta erro">{erro}</div>}
        {aviso && <div className="alerta ok">{aviso}</div>}

        <button className="btn primario largo" disabled={enviando}>
          {enviando ? 'Aguarde…' : modo === 'entrar' ? 'Entrar' : 'Criar conta'}
        </button>
        <button type="button" className="btn-link" onClick={() => setModo(modo === 'entrar' ? 'cadastrar' : 'entrar')}>
          {modo === 'entrar' ? 'Não tem conta? Criar acesso' : 'Já tenho conta'}
        </button>
        {modo === 'cadastrar' && (
          <p className="nota">Novas contas precisam ser liberadas por um administrador antes de acessar os contratos.</p>
        )}
      </form>
    </div>
  )
}
