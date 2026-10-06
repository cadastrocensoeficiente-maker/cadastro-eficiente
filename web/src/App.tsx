import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Login from './pages/Login'
import Contratos from './pages/Contratos'
import Contrato from './pages/Contrato'
import PontoForm from './pages/PontoForm'
import Fotos from './pages/Fotos'
import Usuarios from './pages/Usuarios'

export default function App() {
  const { session, profile, carregando, isAdmin, sair } = useAuth()

  if (carregando) return <div className="tela-centro">Carregando…</div>
  if (!session) return <Login />

  return (
    <div className="app">
      <header className="topo">
        <Link to="/" className="marca">
          <span className="marca-ponto" aria-hidden />
          Cadastro <b>Eficiente</b>
        </Link>
        <nav>
          <Link to="/">Contratos</Link>
          {isAdmin && <Link to="/usuarios">Usuários</Link>}
        </nav>
        <div className="usuario">
          <span title={profile?.email ?? ''}>
            {profile?.nome ?? session.user.email} <em className={`papel papel-${profile?.role}`}>{profile?.role}</em>
          </span>
          <button className="btn-link" onClick={sair}>Sair</button>
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
