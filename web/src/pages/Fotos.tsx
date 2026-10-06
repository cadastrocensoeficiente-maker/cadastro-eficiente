import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { deletePhoto, getContract, getPoint, listPhotos, photoUrls, uploadPhoto } from '../lib/api'
import { msgErro } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Contract, Photo, PointRow } from '../lib/types'

/** Reduz a foto para no máximo 2048 px e JPEG 85% — economiza dados móveis e armazenamento. */
async function comprimir(arquivo: File): Promise<Blob> {
  if (!arquivo.type.startsWith('image/')) return arquivo
  try {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' })
    const max = 2048
    const escala = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * escala)
    const h = Math.round(bmp.height * escala)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85))
    return blob && blob.size < arquivo.size ? blob : arquivo
  } catch {
    return arquivo
  }
}

export default function Fotos() {
  const { contractId, pointId } = useParams()
  const { podeEditar, isAdmin } = useAuth()
  const [contrato, setContrato] = useState<Contract | null>(null)
  const [ponto, setPonto] = useState<PointRow | null>(null)
  const [fotos, setFotos] = useState<Photo[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState('')
  const [aberta, setAberta] = useState<Photo | null>(null)

  async function carregar() {
    try {
      const [c, p, f] = await Promise.all([getContract(contractId!), getPoint(pointId!), listPhotos(pointId!)])
      setContrato(c)
      setPonto(p)
      setFotos(f)
      if (f.length) {
        try {
          setUrls((await photoUrls(pointId!)).urls)
        } catch (e) {
          setErro(msgErro(e))
        }
      }
    } catch (e) {
      setErro(msgErro(e))
    }
  }

  useEffect(() => {
    carregar()
  }, [pointId])

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length || !ponto) return
    setErro('')
    const lista = Array.from(arquivos)
    try {
      for (let i = 0; i < lista.length; i++) {
        setEnviando(`Enviando ${i + 1} de ${lista.length}…`)
        const blob = await comprimir(lista[i])
        const nome = `${ponto.ID}_${Date.now()}_${i + 1}.jpg`
        await uploadPhoto(ponto.id, blob, nome)
      }
      await carregar()
    } catch (e) {
      setErro(msgErro(e))
    } finally {
      setEnviando('')
    }
  }

  async function excluir(f: Photo) {
    if (!confirm('Excluir esta foto definitivamente?')) return
    try {
      await deletePhoto(f.id)
      setAberta(null)
      await carregar()
    } catch (e) {
      setErro(msgErro(e))
    }
  }

  if (!ponto || !contrato) return erro ? <div className="alerta erro">{erro}</div> : <div className="carregando">Carregando…</div>

  return (
    <section>
      <div className="trilha">
        <Link to="/">Contratos</Link> / <Link to={`/contratos/${contractId}`}>{contrato.nome}</Link> /{' '}
        <Link to={`/contratos/${contractId}/pontos/${pointId}`}>Ponto {ponto.ID}</Link> / <span>Fotos</span>
      </div>
      <div className="cabecalho-pagina">
        <h1>
          Fotos do ponto <span className="mono">{ponto.ID}</span>
        </h1>
        <span className="contagem">{fotos.length} foto(s)</span>
      </div>

      {podeEditar && (
        <div className="barra-fotos">
          <label className="arquivo">
            <input type="file" accept="image/*" capture="environment" onChange={(e) => { enviar(e.target.files); e.target.value = '' }} />
            <span className="btn primario">📷 Tirar foto</span>
          </label>
          <label className="arquivo">
            <input type="file" accept="image/*" multiple onChange={(e) => { enviar(e.target.files); e.target.value = '' }} />
            <span className="btn">🖼 Escolher da galeria</span>
          </label>
          {enviando && <span className="enviando">{enviando}</span>}
        </div>
      )}
      {erro && <div className="alerta erro">{erro}</div>}

      {fotos.length === 0 ? (
        <div className="vazio">Nenhuma foto neste ponto ainda.</div>
      ) : (
        <div className="galeria">
          {fotos.map((f) => (
            <button key={f.id} className="miniatura" onClick={() => setAberta(f)}>
              {urls[f.id] ? <img src={urls[f.id]} alt={f.nome_arquivo ?? 'foto'} loading="lazy" /> : <span>…</span>}
              <small>{new Date(f.created_at).toLocaleString('pt-BR')}</small>
            </button>
          ))}
        </div>
      )}

      {aberta && (
        <div className="lightbox" onClick={() => setAberta(null)}>
          <img src={urls[aberta.id]} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="lightbox-acoes" onClick={(e) => e.stopPropagation()}>
            <a className="btn" href={urls[aberta.id]} target="_blank" rel="noreferrer">Abrir original</a>
            {isAdmin && <button className="btn perigo" onClick={() => excluir(aberta)}>Excluir</button>}
            <button className="btn" onClick={() => setAberta(null)}>Fechar</button>
          </div>
        </div>
      )}
    </section>
  )
}
