import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createPoint, deletePoint, getContract, getLayout, getPoint, listPhotos, photoUrls, updatePoint, uploadPhoto } from '../lib/api'
import { comprimir } from '../lib/fotos'
import { msgErro } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { juntarLista, separarLista, type Contract, type LayoutItem, type Photo, type PointRow, type Valor } from '../lib/types'
import { fmtGraus } from '../components/TabelaPontos'
import Icone from '../components/Icone'

interface Local {
  latitude: number
  longitude: number
  precisao_m: number | null
  capturado_em: string
}

export default function PontoForm() {
  const { contractId, pointId } = useParams()
  const navigate = useNavigate()
  const { podeEditar, isAdmin } = useAuth()
  const novo = !pointId
  const [contrato, setContrato] = useState<Contract | null>(null)
  const [layout, setLayout] = useState<LayoutItem[]>([])
  const [ponto, setPonto] = useState<PointRow | null>(null)
  const [valores, setValores] = useState<Record<string, Valor>>({})
  const [local, setLocal] = useState<Local | null>(null)
  const [capturando, setCapturando] = useState(false)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [fotos, setFotos] = useState<Photo[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [enviandoFoto, setEnviandoFoto] = useState('')
  const [erroFoto, setErroFoto] = useState('')

  async function carregarFotos(id: string) {
    try {
      const f = await listPhotos(id)
      setFotos(f)
      setUrls(f.length ? await photoUrls(f) : {})
    } catch (e) {
      setErroFoto(msgErro(e))
    }
  }

  /** Adiciona fotos manualmente (arquivo do computador ou galeria do celular) ao ponto já salvo. */
  async function adicionarFotos(arquivos: FileList | null) {
    if (!arquivos?.length || !ponto) return
    setErroFoto('')
    const lista = Array.from(arquivos)
    let enviadas = 0
    try {
      for (let i = 0; i < lista.length; i++) {
        setEnviandoFoto(`Enviando ${i + 1} de ${lista.length}…`)
        const blob = await comprimir(lista[i])
        await uploadPhoto(ponto.id, ponto.contract_id, blob, `${ponto.ID}_${Date.now()}_${i + 1}.jpg`)
        enviadas++
      }
    } catch (e) {
      setErroFoto(`${enviadas} de ${lista.length} foto(s) enviada(s). Erro: ${msgErro(e)}`)
    } finally {
      setEnviandoFoto('')
      await carregarFotos(ponto.id)
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        const [c, l] = await Promise.all([getContract(contractId!), getLayout(contractId!)])
        setContrato(c)
        setLayout(l)
        if (pointId) {
          const p = await getPoint(pointId)
          setPonto(p)
          setValores(p.valores ?? {})
          carregarFotos(p.id)
          if (p.latitude !== null && p.longitude !== null) {
            setLocal({ latitude: p.latitude, longitude: p.longitude, precisao_m: p.precisao_m, capturado_em: p.capturado_em ?? p.created_at })
          }
        }
      } catch (e) {
        setErro(msgErro(e))
      }
    })()
  }, [contractId, pointId])

  function capturar() {
    if (!navigator.geolocation) {
      setErro('Este aparelho não oferece GPS ao navegador.')
      return
    }
    setErro('')
    setCapturando(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const l: Local = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          precisao_m: pos.coords.accuracy ? Math.round(pos.coords.accuracy * 100) / 100 : null,
          capturado_em: new Date(pos.timestamp).toISOString(),
        }
        setLocal(l)
        setCapturando(false)
      },
      (err) => {
        setCapturando(false)
        setErro(
          err.code === err.PERMISSION_DENIED
            ? 'Permissão de localização negada. Libere o GPS para este site nas configurações do navegador.'
            : err.code === err.TIMEOUT
              ? 'O GPS demorou para responder. Vá para um local aberto e tente de novo.'
              : 'Não foi possível obter a localização.',
        )
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
    )
  }

  const configuraveis = layout.filter((c) => !c.sistema).sort((a, b) => a.ordem - b.ordem)

  async function salvar(e: FormEvent, depois: 'fotos' | 'novo' | 'lista') {
    e.preventDefault()
    const faltando = configuraveis.filter((c) => c.obrigatoria && (valores[c.column_id!] === undefined || valores[c.column_id!] === '' || valores[c.column_id!] === null))
    if (faltando.length) {
      setErro(`Preencha: ${faltando.map((c) => c.rotulo).join(', ')}`)
      return
    }
    setSalvando(true)
    setErro('')
    try {
      const dados = {
        latitude: local?.latitude ?? null,
        longitude: local?.longitude ?? null,
        precisao_m: local?.precisao_m ?? null,
        capturado_em: local?.capturado_em ?? null,
        valores,
      }
      let id = pointId
      if (novo) id = (await createPoint(contractId!, dados)).id
      else await updatePoint(pointId!, dados)

      if (depois === 'fotos') navigate(`/contratos/${contractId}/pontos/${id}/fotos`)
      else if (depois === 'novo') {
        setValores({})
        setLocal(null)
        navigate(`/contratos/${contractId}/pontos/novo`, { replace: true })
        window.scrollTo(0, 0)
      } else navigate(`/contratos/${contractId}`)
    } catch (err) {
      setErro(msgErro(err))
    } finally {
      setSalvando(false)
    }
  }

  async function excluir() {
    if (!ponto || !confirm(`Excluir o ponto ${ponto.ID}? Ele vai para a lixeira do contrato e pode ser restaurado.`)) return
    try {
      await deletePoint(ponto.id)
      navigate(`/contratos/${contractId}`)
    } catch (e) {
      setErro(msgErro(e))
    }
  }

  if (!contrato) return erro ? <div className="alerta erro">{erro}</div> : <div className="carregando">Carregando…</div>
  const somenteLeitura = !podeEditar

  return (
    <section className="ponto-form">
      <div className="trilha">
        <Link to="/">Contratos</Link> / <Link to={`/contratos/${contractId}`}>{contrato.nome}</Link> / <span>{novo ? 'Novo ponto' : `Ponto ${ponto?.ID ?? ''}`}</span>
      </div>

      <form onSubmit={(e) => salvar(e, novo ? 'fotos' : 'lista')}>
        {/* ID — sistema */}
        <div className="campo-sistema">
          <span className="rotulo-sistema">ID</span>
          <span className="mono valor-id">{novo ? 'gerado ao salvar' : ponto?.ID}</span>
        </div>

        {configuraveis.length === 0 && <div className="alerta aviso">Este contrato ainda não tem colunas configuradas.</div>}

        {configuraveis.map((c) => (
          <Campo
            key={c.column_id}
            item={c}
            valor={valores[c.column_id!]}
            desabilitado={somenteLeitura}
            onChange={(v) => setValores({ ...valores, [c.column_id!]: v })}
          />
        ))}

        {/* LATITUDE / LONGITUDE — sistema */}
        <div className="bloco-gps">
          <div className="gps-cabecalho">
            <span className="rotulo-sistema">LATITUDE · LONGITUDE</span>
            <span className="desc mono">graus decimais · WGS84</span>
          </div>
          <div className="gps-valores">
            <div>
              <small>LATITUDE</small>
              <span className="mono">{fmtGraus(local?.latitude)}</span>
            </div>
            <div>
              <small>LONGITUDE</small>
              <span className="mono">{fmtGraus(local?.longitude)}</span>
            </div>
          </div>
          {local?.precisao_m != null && (
            <p className="desc">
              <span className={local.precisao_m > 15 ? 'precisao ruim' : 'precisao boa'}>Precisão do GPS ±{Number(local.precisao_m).toFixed(1)} m</span>
            </p>
          )}
          {!somenteLeitura && (
            <button type="button" className="btn gps largo" onClick={capturar} disabled={capturando}>
              {capturando ? '📡 Capturando localização…' : local ? '📍 CAPTURAR NOVAMENTE' : '📍 CAPTURAR LOCALIZAÇÃO'}
            </button>
          )}
        </div>

        {/* DATA_CADASTRO · HORA_CADASTRO · COLABORADOR — sistema */}
        {!novo && ponto && (
          <div className="campo-sistema">
            <span className="rotulo-sistema">CADASTRO</span>
            <span className="mono">{ponto.DATA_CADASTRO ?? '—'} · {ponto.HORA_CADASTRO ?? '—'} · {ponto.COLABORADOR ?? '—'}</span>
          </div>
        )}

        {/* LINK_FOTOS — sistema · fotos do ponto com envio manual */}
        {!novo && ponto && (
          <div className="bloco-fotos">
            <div className="gps-cabecalho">
              <span className="rotulo-sistema">FOTOS</span>
              <Link className="btn-fotos" to={ponto.LINK_FOTOS}><Icone nome="camera" tamanho={15} />Ver fotos ({fotos.length})</Link>
            </div>
            {fotos.length > 0 && (
              <div className="fotos-ponto">
                {fotos.map((f) => (
                  <Link key={f.id} to={ponto.LINK_FOTOS} className="miniatura" title={f.nome_arquivo ?? 'foto'}>
                    {urls[f.id] ? <img src={urls[f.id]} alt={f.nome_arquivo ?? 'foto'} loading="lazy" /> : <span>…</span>}
                  </Link>
                ))}
              </div>
            )}
            {fotos.length === 0 && <p className="desc">Nenhuma foto neste ponto ainda.</p>}
            {!somenteLeitura && (
              <div className="barra-fotos">
                <label className="arquivo">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={!!enviandoFoto}
                    onChange={(e) => { adicionarFotos(e.target.files); e.target.value = '' }}
                  />
                  <span className="btn"><Icone nome="enviar" />Adicionar foto</span>
                </label>
                {enviandoFoto && <span className="enviando">{enviandoFoto}</span>}
              </div>
            )}
            {erroFoto && <div className="alerta erro">{erroFoto}</div>}
          </div>
        )}

        {erro && <div className="alerta erro">{erro}</div>}

        {!somenteLeitura && (
          <div className="acoes fixas">
            {novo ? (
              <>
                <button type="button" className="btn" disabled={salvando} onClick={(e) => salvar(e as unknown as FormEvent, 'novo')}>
                  Salvar e novo
                </button>
                <button className="btn primario" disabled={salvando}>
                  {salvando ? 'Salvando…' : 'Salvar e tirar fotos'}
                </button>
              </>
            ) : (
              <>
                {isAdmin && (
                  <button type="button" className="btn perigo empurra" onClick={excluir}><Icone nome="lixeira" />Excluir ponto</button>
                )}
                <button className="btn primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
              </>
            )}
          </div>
        )}
      </form>
    </section>
  )
}

function Campo({ item, valor, desabilitado, onChange }: { item: LayoutItem; valor: Valor | undefined; desabilitado: boolean; onChange: (v: Valor) => void }) {
  const rotulo = (
    <span className="rotulo">
      <span className="seq">{item.sequencia}</span>
      {item.rotulo}
      {item.obrigatoria && <em className="obrig">*</em>}
    </span>
  )
  const v = valor === null || valor === undefined ? '' : valor

  switch (item.tipo) {
    case 'booleano':
      return (
        <div className="campo">
          {rotulo}
          <div className="segmentado">
            {[true, false].map((b) => (
              <button type="button" key={String(b)} disabled={desabilitado} className={valor === b ? 'ativo' : ''} onClick={() => onChange(valor === b ? null : b)}>
                {b ? 'SIM' : 'NÃO'}
              </button>
            ))}
          </div>
        </div>
      )
    case 'lista': {
      const marcados = separarLista(valor)
      return (
        <div className="campo">
          {rotulo}
          <div className="opcoes-multi">
            {item.opcoes.map((o) => {
              const ativo = marcados.includes(o)
              return (
                <button
                  type="button"
                  key={o}
                  disabled={desabilitado}
                  className={ativo ? 'ativo' : ''}
                  aria-pressed={ativo}
                  onClick={() => onChange(juntarLista(ativo ? marcados.filter((x) => x !== o) : [...marcados, o], item.opcoes))}
                >
                  {ativo ? '✓ ' : ''}{o}
                </button>
              )
            })}
          </div>
          <span className="desc">Pode marcar mais de uma opção.</span>
        </div>
      )
    }
    case 'lista_unica':
      return (
        <label className="campo">
          {rotulo}
          <select value={String(v)} disabled={desabilitado} onChange={(e) => onChange(e.target.value || null)} required={item.obrigatoria}>
            <option value="">— selecione —</option>
            {item.opcoes.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
      )
    case 'numero':
    case 'inteiro':
      return (
        <label className="campo">
          {rotulo}
          <input
            inputMode={item.tipo === 'numero' ? 'decimal' : 'numeric'}
            value={String(v)}
            disabled={desabilitado}
            required={item.obrigatoria}
            pattern={item.tipo === 'numero' ? '-?[0-9]+([.,][0-9]+)?' : '-?[0-9]+'}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )
    case 'data':
      return (
        <label className="campo">
          {rotulo}
          <input type="date" value={String(v)} disabled={desabilitado} required={item.obrigatoria} onChange={(e) => onChange(e.target.value)} />
        </label>
      )
    default:
      return (
        <label className="campo">
          {rotulo}
          <input value={String(v)} disabled={desabilitado} required={item.obrigatoria} onChange={(e) => onChange(e.target.value)} />
        </label>
      )
  }
}
