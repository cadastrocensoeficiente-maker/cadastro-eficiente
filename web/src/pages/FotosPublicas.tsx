import { useEffect, useState } from 'react'
import { SUPABASE_KEY, SUPABASE_URL } from '../lib/supabase'

/**
 * Página aberta (sem login) com SOMENTE as fotos de um ponto.
 * Endereço: /f/<código do ponto>. Não usa a sessão do sistema e só conversa
 * com a função "fotos-publicas", que devolve o ID do ponto e as fotos dele.
 */
interface FotoPublica {
  id: string
  url: string
  data: string
}

export default function FotosPublicas({ token }: { token: string }) {
  const [ponto, setPonto] = useState<string | null>(null)
  const [fotos, setFotos] = useState<FotoPublica[] | null>(null)
  const [erro, setErro] = useState('')
  const [aberta, setAberta] = useState<number | null>(null)

  useEffect(() => {
    document.title = 'Fotos do ponto'
    fetch(`${SUPABASE_URL}/functions/v1/fotos-publicas?t=${encodeURIComponent(token)}`, {
      headers: { apikey: SUPABASE_KEY },
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error ?? 'Não foi possível carregar as fotos.')
        setPonto(j.ponto ?? null)
        setFotos(j.fotos ?? [])
        if (j.ponto) document.title = `Fotos do ponto ${j.ponto}`
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar as fotos.'))
  }, [token])

  useEffect(() => {
    if (aberta === null || !fotos) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberta(null)
      if (e.key === 'ArrowRight') setAberta((i) => (i === null ? i : (i + 1) % fotos.length))
      if (e.key === 'ArrowLeft') setAberta((i) => (i === null ? i : (i - 1 + fotos.length) % fotos.length))
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aberta, fotos])

  return (
    <div className="publico">
      <header className="topo">
        <div className="topo-faixa">
          <span className="marca">
            <span className="marca-ponto" aria-hidden />
            <span>Cadastro <b>Eficiente</b></span>
          </span>
        </div>
      </header>
      <main className="conteudo">
        {erro ? (
          <div className="vazio">{erro}</div>
        ) : !fotos ? (
          <div className="carregando">Carregando fotos…</div>
        ) : (
          <section>
            <div className="cabecalho-pagina">
              <h1>
                Fotos do ponto {ponto && <span className="mono">{ponto}</span>}
              </h1>
              <span className="contagem">{fotos.length} foto(s)</span>
            </div>
            {fotos.length === 0 ? (
              <div className="vazio">Este ponto ainda não tem fotos.</div>
            ) : (
              <div className="galeria">
                {fotos.map((f, i) => (
                  <button key={f.id} className="miniatura" onClick={() => setAberta(i)}>
                    <img src={f.url} alt={`Foto ${i + 1}`} loading="lazy" />
                    <small>{new Date(f.data).toLocaleString('pt-BR')}</small>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {aberta !== null && fotos?.[aberta] && (
        <div className="lightbox" onClick={() => setAberta(null)}>
          <img src={fotos[aberta].url} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="lightbox-acoes" onClick={(e) => e.stopPropagation()}>
            {fotos.length > 1 && (
              <button className="btn" onClick={() => setAberta((aberta - 1 + fotos.length) % fotos.length)}>‹ Anterior</button>
            )}
            <a className="btn" href={fotos[aberta].url} target="_blank" rel="noreferrer">Abrir original</a>
            <button className="btn" onClick={() => setAberta(null)}>Fechar</button>
            {fotos.length > 1 && (
              <button className="btn" onClick={() => setAberta((aberta + 1) % fotos.length)}>Próxima ›</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
