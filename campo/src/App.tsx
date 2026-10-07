import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { db, pedirArmazenamentoPersistente } from './lib/db'
import { sincronizar } from './lib/sync'
import { aplicarAgora, iniciarAtualizacao, verificarAtualizacao, versaoTexto } from './lib/atualizacao'
import Login from './telas/Login'
import Contratos from './telas/Contratos'
import Cadastro from './telas/Cadastro'
import Lista from './telas/Lista'
import BarraStatus from './telas/BarraStatus'

export interface Usuario {
  id: string
  email: string
  nome: string
  role: string
}

export type Tela =
  | { nome: 'contratos' }
  | { nome: 'cadastro'; contractId: string; localId?: string }
  | { nome: 'lista'; contractId: string }

const CHAVE_USUARIO = 'campo-usuario'

export default function App() {
  const [usuario, setUsuario] = useState<Usuario | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(CHAVE_USUARIO) ?? 'null')
    } catch {
      return null
    }
  })
  const [verificando, setVerificando] = useState(true)
  const [tela, setTela] = useState<Tela>({ nome: 'contratos' })
  const [novaVersao, setNovaVersao] = useState(0)

  async function carregarPerfil(s: Session) {
    const { data } = await supabase.from('profiles').select('id, nome, email, role').eq('id', s.user.id).single()
    if (!data) return
    const u: Usuario = { id: data.id, email: data.email ?? s.user.email ?? '', nome: data.nome ?? '', role: data.role }
    localStorage.setItem(CHAVE_USUARIO, JSON.stringify(u))
    setUsuario(u)
  }

  useEffect(() => {
    pedirArmazenamentoPersistente()
    iniciarAtualizacao(setNovaVersao)
    supabase.auth.getSession().then(async ({ data }) => {
      // Offline: segue com o usuário guardado no aparelho para não travar o trabalho.
      if (data.session && navigator.onLine) await carregarPerfil(data.session)
      setVerificando(false)
      if (data.session) sincronizar({ contratos: true })
    })
    const aoVoltar = () => sincronizar({ contratos: true })
    window.addEventListener('online', aoVoltar)
    // Ao voltar para o app (tela ligada / troca de aplicativo), busca alterações do painel.
    const aoFocar = () => {
      if (document.visibilityState !== 'visible') return
      sincronizar({ contratos: true })
      verificarAtualizacao()
    }
    document.addEventListener('visibilitychange', aoFocar)
    const t = setInterval(() => sincronizar(), 30_000)
    return () => {
      document.removeEventListener('visibilitychange', aoFocar)
      window.removeEventListener('online', aoVoltar)
      clearInterval(t)
    }
  }, [])

  // Sem tela de "voltar" do sistema: o botão voltar do celular volta para a lista de contratos.
  useEffect(() => {
    if (tela.nome !== 'contratos') history.pushState({ t: tela.nome }, '')
    const aoVoltar = () => setTela({ nome: 'contratos' })
    window.addEventListener('popstate', aoVoltar)
    return () => window.removeEventListener('popstate', aoVoltar)
  }, [tela.nome])

  async function entrou(s: Session) {
    await carregarPerfil(s)
    await sincronizar({ contratos: true })
  }

  async function sair() {
    const pendentes = await db.pontos.where('status').anyOf('pendente', 'enviando', 'erro').count()
    const fotos = await db.fotos.where('status').anyOf('pendente', 'enviando', 'erro').count()
    if (pendentes + fotos > 0) {
      alert(`Ainda há ${pendentes} ponto(s) e ${fotos} foto(s) não enviados neste aparelho. Sincronize antes de sair.`)
      return
    }
    await supabase.auth.signOut()
    await db.contratos.clear()
    localStorage.removeItem(CHAVE_USUARIO)
    setUsuario(null)
    setTela({ nome: 'contratos' })
  }

  if (verificando && !usuario) return <div className="centro">Carregando…</div>
  if (!usuario) return <Login onEntrou={entrou} />

  if (usuario.role !== 'cadastrador' && usuario.role !== 'admin') {
    return (
      <div className="centro coluna-centro">
        <h2>Acesso não liberado</h2>
        <p>
          {usuario.role === 'pendente'
            ? 'Sua conta aguarda liberação do administrador.'
            : 'Este aplicativo é para cadastradores. Use o painel de gestão.'}
        </p>
        <button className="btn" onClick={sair}>Sair</button>
      </div>
    )
  }

  return (
    <div className="app">
      <BarraStatus usuario={usuario} onSair={sair} />
      {novaVersao > 0 && (
        <button className="faixa atualizacao" onClick={aplicarAgora}>
          Nova versão {versaoTexto(novaVersao)} pronta. Toque aqui para atualizar agora (seus pontos não são perdidos).
        </button>
      )}
      {tela.nome === 'contratos' && <Contratos usuario={usuario} irPara={setTela} />}
      {tela.nome === 'cadastro' && <Cadastro usuario={usuario} contractId={tela.contractId} localId={tela.localId} irPara={setTela} />}
      {tela.nome === 'lista' && <Lista usuario={usuario} contractId={tela.contractId} irPara={setTela} />}
    </div>
  )
}
