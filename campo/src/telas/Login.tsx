import { useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, msgErro } from '../lib/supabase'

export default function Login({ onEntrou }: { onEntrou: (s: Session) => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    if (!navigator.onLine) {
      setErro('O primeiro acesso precisa de internet. Depois o app funciona offline.')
      return
    }
    setEnviando(true)
    setErro('')
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    if (error || !data.session) {
      setErro(msgErro(error))
      setEnviando(false)
      return
    }
    await onEntrou(data.session)
    setEnviando(false)
  }

  return (
    <form className="login" onSubmit={entrar}>
      <div className="logo" aria-hidden />
      <h1>Cadastro Campo</h1>
      <p className="sub">Eficiente · Iluminação pública</p>
      <label>
        E-mail
        <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Senha
        <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
      </label>
      {erro && <div className="alerta erro">{erro}</div>}
      <button className="btn primario grande" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      <p className="nota">Use o mesmo acesso do painel. O administrador precisa atribuir você aos contratos.</p>
    </form>
  )
}
