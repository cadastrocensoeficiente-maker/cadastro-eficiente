import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Login from './pages/Login'
import Contratos from './pages/Contratos'
import Contrato from './pages/Contrato'
import PontoForm from './pages/PontoForm'
import Fotos from './pages/Fotos'
import FotosPublicas from './pages/FotosPublicas'
import Usuarios from './pages/Usuarios'
import { URL_APK, URL_APP_CAMPO } from './components/Equipe'
import Icone from './components/Icone'

export default function App() {
  const { session, profile, carregando, isAdmin, sair } = useAuth()
  const { pathname } = useLocation()
  const naUsuarios = pathname.startsWith('/usuarios')

  // Link aberto das fotos: não exige login e não mostra nada além das fotos do ponto.
  const publico = pathname.match(/^\/f\/([^/]+)\/?$/)
  if (publico) return <FotosPublicas token={publico[1]} />

  if (carregando) return <div className="tela-centro">Carregando…</div>
  if (!session) return <Login />

  if (profile?.role === 'cadastrador') {
    return (
      <div className="login">
        <div className="login-card">
          <div className="marca grande"><span className="marca-ponto" aria-hidden /><span>Cadastro <b>Eficiente</b></span></div>
          <p>Este é o painel de gestão. Para cadastrar pontos em campo, use o <b>aplicativo de campo</b> no celular:</p>
          <a className="btn primario largo" href={URL_APP_CAMPO}><Icone nome="celular" />Abrir aplicativo de campo</a>
          <button className="btn largo" onClick={sair}><Icone nome="sair" />Sair</button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topo">
        <div className="topo-faixa">
          <Link to="/" className="marca">
            <span className="marca-ponto" aria-hidden />
            <span>Cadastro <b>Eficiente</b></span>
          </Link>
          <nav className="topo-nav" aria-label="Seções">
            <Link to="/" className={naUsuarios ? '' : 'ativo'} aria-current={naUsuarios ? undefined : 'page'}>Contratos</Link>
            {isAdmin && (
              <Link to="/usuarios" className={naUsuarios ? 'ativo' : ''} aria-current={naUsuarios ? 'page' : undefined}>Usuários</Link>
            )}
          </nav>
          <div className="usuario">
            <a className="btn-topo" href={URL_APK} title="Aplicativo Android para os cadastradores de campo">
              <Icone nome="celular" />
              <span>App de campo (APK)</span>
            </a>
            <span className="usuario-nome" title={profile?.email ?? ''}>
              <span className="usuario-texto">{profile?.nome ?? session.user.email}</span>
              <em className={`papel papel-${profile?.role}`}>{profile?.role}</em>
            </span>
            <button className="btn-topo so-icone" onClick={sair} title="Sair" aria-label="Sair">
              <Icone nome="sair" />
            </button>
          </div>
        </div>
      </header>
      <main className="conteudo">
        <Routes>
          <Route path="/" element={<Contratos />} />
          <Route path="/contratos/:contractId" element={<Contrato />} />
          <Route path="/contratos/:contractId/pontos/novo" element={<PontoForm />} />
          <Route path="/contratos/:contractId/pontos/:pointId" element={<PontoForm />} />
          <Route path="/contratos/:contractId/pontos/:pointId/fotos" element={<Fotos />} />
          <Route path="/usuarios" element={isAdmin ? <Usuarios /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}
