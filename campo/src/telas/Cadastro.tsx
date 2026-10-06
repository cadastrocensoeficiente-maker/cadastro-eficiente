import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ColunaCampo, type FotoLocal, type Valor } from '../lib/db'
import { capturarGPS, comprimirFoto, fmt3, previaTM, type Leitura } from '../lib/geo'
import { sincronizar } from '../lib/sync'
import type { Tela, Usuario } from '../App'

interface FotoTemp {
  id: string
  blob: Blob
  url: string
  nome: string
  salva?: FotoLocal
}

const vazio = (v: Valor | undefined) => v === undefined || v === null || v === ''

export default function Cadastro({ usuario, contractId, localId, irPara }: {
  usuario: Usuario; contractId: string; localId?: string; irPara: (t: Tela) => void
}) {
  const contrato = useLiveQuery(() => db.contratos.get(contractId), [contractId])
  const existente = useLiveQuery(() => (localId ? db.pontos.get(localId) : undefined), [localId])
  const fotosSalvas = useLiveQuery(() => (localId ? db.fotos.where('localPointId').equals(localId).toArray() : []), [localId])

  const [valores, setValores] = useState<Record<string, Valor>>({})
  const [leitura, setLeitura] = useState<Leitura | null>(null)
  const [capturando, setCapturando] = useState(false)
  const pararGps = useRef<(() => void) | null>(null)
  const [fotos, setFotos] = useState<FotoTemp[]>([])
  const [erro, setErro] = useState('')
  const [faltando, setFaltando] = useState<Set<string>>(new Set())
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState('')
  const topo = useRef<HTMLDivElement>(null)

  const somenteLeitura = !!existente && (existente.status === 'enviado' || existente.status === 'enviando')

  useEffect(() => {
    if (existente) {
      setValores(existente.valores)
      if (existente.latitude !== null && existente.longitude !== null) {
        setLeitura({ latitude: existente.latitude, longitude: existente.longitude, precisao: existente.precisaoM, em: existente.capturadoEm ?? existente.criadoEm })
      }
    }
  }, [existente?.localId])

  useEffect(() => () => pararGps.current?.(), [])
  useEffect(() => () => fotos.forEach((f) => URL.revokeObjectURL(f.url)), [])

  const previa = useMemo(
    () => (leitura && contrato ? previaTM(leitura.latitude, leitura.longitude, contrato.proj4) : null),
    [leitura, contrato],
  )

  function iniciarGPS() {
    setErro('')
    setCapturando(true)
    pararGps.current = capturarGPS(
      (l) => setLeitura(l),
      (l, e) => {
        setCapturando(false)
        pararGps.current = null
        if (l) setLeitura(l)
        if (e && !l) setErro(e)
      },
    )
  }

  async function adicionarFotos(lista: FileList | null) {
    if (!lista) return
    const novas: FotoTemp[] = []
    for (const arq of Array.from(lista)) {
      const blob = await comprimirFoto(arq)
      novas.push({ id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), nome: `foto_${Date.now()}.jpg` })
    }
    setFotos((f) => [...f, ...novas])
  }

  function validar(colunas: ColunaCampo[]) {
    const falta = new Set<string>()
    for (const c of colunas) {
      const v = valores[c.column_id]
      if (c.obrigatoria && vazio(v)) falta.add(c.column_id)
      if (!vazio(v) && c.tipo === 'numero' && !/^-?\d+([.,]\d+)?$/.test(String(v).trim())) falta.add(c.column_id)
      if (!vazio(v) && c.tipo === 'inteiro' && !/^-?\d+$/.test(String(v).trim())) falta.add(c.column_id)
    }
    setFaltando(falta)
    return falta
  }

  async function salvar() {
    if (!contrato) return
    const falta = validar(contrato.colunas)
    if (falta.size) {
      setErro(`Verifique: ${contrato.colunas.filter((c) => falta.has(c.column_id)).map((c) => c.rotulo).join(', ')}`)
      return
    }
    if (!leitura && !confirm('Salvar sem localização? TMX e TMY ficarão vazios.')) return
    pararGps.current?.()
    setSalvando(true)
    setErro('')
    try {
      const id = existente?.localId ?? crypto.randomUUID()
      const agora = new Date().toISOString()
      await db.transaction('rw', db.pontos, db.fotos, async () => {
        if (existente) {
          await db.pontos.update(id, {
            valores, latitude: leitura?.latitude ?? null, longitude: leitura?.longitude ?? null,
            precisaoM: leitura?.precisao ?? null, capturadoEm: leitura?.em ?? null, status: 'pendente', erro: undefined,
          })
        } else {
          await db.pontos.add({
            localId: id, contractId, userId: usuario.id, valores,
            latitude: leitura?.latitude ?? null, longitude: leitura?.longitude ?? null,
            precisaoM: leitura?.precisao ?? null, capturadoEm: leitura?.em ?? null,
            criadoEm: agora, status: 'pendente', tentativas: 0,
          })
        }
        for (const f of fotos) {
          await db.fotos.add({ id: f.id, localPointId: id, blob: f.blob, nome: f.nome, criadaEm: agora, status: 'pendente', tentativas: 0 })
        }
      })
      sincronizar() // tenta enviar já; se estiver offline, fica na fila
      fotos.forEach((f) => URL.revokeObjectURL(f.url))
      if (existente) {
        irPara({ nome: 'lista', contractId })
      } else {
        // pronto para o próximo ponto
        setValores({})
        setLeitura(null)
        setFotos([])
        setFaltando(new Set())
        setAviso(`Ponto salvo${navigator.onLine ? '' : ' no aparelho (será enviado quando houver sinal)'}.`)
        topo.current?.scrollIntoView({ behavior: 'smooth' })
        setTimeout(() => setAviso(''), 4000)
      }
    } catch (e) {
      setErro(`Não foi possível salvar no aparelho: ${(e as Error).message}`)
    } finally {
      setSalvando(false)
    }
  }

  async function adicionarFotosEnviado(lista: FileList | null) {
    if (!lista || !existente) return
    for (const arq of Array.from(lista)) {
      const blob = await comprimirFoto(arq)
      await db.fotos.add({ id: crypto.randomUUID(), localPointId: existente.localId, blob, nome: `foto_${Date.now()}.jpg`, criadaEm: new Date().toISOString(), status: 'pendente', tentativas: 0 })
    }
    sincronizar()
  }

  async function descartarPendente() {
    if (!existente || existente.status === 'enviado') return
    if (!confirm('Descartar este ponto? Ele ainda não foi enviado e será apagado deste aparelho.')) return
    await db.transaction('rw', db.pontos, db.fotos, async () => {
      await db.fotos.where('localPointId').equals(existente.localId).delete()
      await db.pontos.delete(existente.localId)
    })
    irPara({ nome: 'lista', contractId })
  }

  if (!contrato || (localId && existente === undefined)) return <div className="centro">Carregando…</div>

  const precisaoRuim = leitura?.precisao != null && leitura.precisao > 15

  return (
    <main className="tela cadastro" ref={topo}>
      <button className="voltar" onClick={() => irPara(localId ? { nome: 'lista', contractId } : { nome: 'contratos' })}>‹ Voltar</button>
      <h2 className="titulo">{contrato.nome}</h2>
      {aviso && <div className="alerta ok">{aviso}</div>}

      {/* ID — sistema */}
      <div className="sistema">
        <span className="rot">ID</span>
        <span className="mono forte">{existente?.codigo ?? (existente ? 'aguardando envio' : 'gerado pelo sistema')}</span>
      </div>

      {/* Colunas configuráveis na sequência 1..N */}
      {contrato.colunas.map((c) => (
        <Campo
          key={c.column_id}
          col={c}
          valor={valores[c.column_id]}
          invalido={faltando.has(c.column_id)}
          bloqueado={somenteLeitura}
          onChange={(v) => {
            setValores((x) => ({ ...x, [c.column_id]: v }))
            if (faltando.has(c.column_id)) setFaltando((f) => { const n = new Set(f); n.delete(c.column_id); return n })
          }}
        />
      ))}

      {/* TMX / TMY — sistema */}
      <section className="gps">
        <div className="gps-topo">
          <span className="rot">TMX · TMY</span>
          <span className="mono pequeno">EPSG {contrato.epsg}</span>
        </div>
        <div className="gps-valores">
          <div><small>TMX</small><span className="mono">{existente?.tmx !== undefined ? fmt3(existente.tmx) : fmt3(previa?.tmx)}</span></div>
          <div><small>TMY</small><span className="mono">{existente?.tmy !== undefined ? fmt3(existente.tmy) : fmt3(previa?.tmy)}</span></div>
        </div>
        {leitura && (
          <p className={`precisao ${precisaoRuim ? 'ruim' : 'boa'}`}>
            {capturando ? 'Melhorando sinal… ' : ''}Precisão ±{leitura.precisao?.toFixed(1) ?? '?'} m
            {precisaoRuim && !capturando ? ' — fraca, tente capturar de novo em local aberto' : ''}
          </p>
        )}
        {!somenteLeitura &&
          (capturando ? (
            <button type="button" className="btn gps-btn" onClick={() => pararGps.current?.()}>
              ✓ USAR ESTA LOCALIZAÇÃO
            </button>
          ) : (
            <button type="button" className="btn gps-btn" onClick={iniciarGPS}>
              📍 {leitura ? 'CAPTURAR NOVAMENTE' : 'CAPTURAR LOCALIZAÇÃO'}
            </button>
          ))}
        {!existente?.codigo && <p className="nota">Prévia calculada no aparelho. O valor oficial é confirmado no envio.</p>}
      </section>

      {/* LINK_FOTOS — sistema */}
      <section className="fotos">
        <div className="gps-topo"><span className="rot">LINK_FOTOS</span><span className="pequeno">{(fotosSalvas?.length ?? 0) + fotos.length} foto(s)</span></div>
        <div className="fotos-grade">
          {fotosSalvas?.map((f) => <MiniFoto key={f.id} foto={f} />)}
          {fotos.map((f) => (
            <div key={f.id} className="mini">
              <img src={f.url} alt="" />
              <button className="mini-x" onClick={() => { URL.revokeObjectURL(f.url); setFotos((x) => x.filter((y) => y.id !== f.id)) }} aria-label="Remover foto">×</button>
            </div>
          ))}
          <label className="mini add">
            <input type="file" accept="image/*" capture="environment" onChange={(e) => { (somenteLeitura ? adicionarFotosEnviado : adicionarFotos)(e.target.files); e.target.value = '' }} />
            <span>📷<br />Foto</span>
          </label>
        </div>
      </section>

      {erro && <div className="alerta erro">{erro}</div>}
      {existente?.status === 'erro' && <div className="alerta erro">Erro no envio: {existente.erro}</div>}

      {!somenteLeitura ? (
        <div className="rodape">
          {existente && <button className="btn perigo" onClick={descartarPendente}>Descartar</button>}
          <button className="btn primario grande" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : existente ? 'Salvar alterações' : 'Salvar e próximo'}
          </button>
        </div>
      ) : (
        <p className="nota centro-txt">Ponto já enviado. Alterações de dados são feitas pelo painel de gestão.</p>
      )}
    </main>
  )
}

function MiniFoto({ foto }: { foto: FotoLocal }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (foto.blob.size === 0) return
    const u = URL.createObjectURL(foto.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [foto.id, foto.blob.size])
  return (
    <div className={`mini ${foto.status}`}>
      {url ? <img src={url} alt="" /> : <span className="mini-ok">✓<br />enviada</span>}
      {foto.status !== 'enviado' && <span className="mini-status">{foto.status === 'erro' ? '!' : '⇡'}</span>}
    </div>
  )
}

function Campo({ col, valor, invalido, bloqueado, onChange }: {
  col: ColunaCampo; valor: Valor | undefined; invalido: boolean; bloqueado: boolean; onChange: (v: Valor) => void
}) {
  const rot = (
    <span className="campo-rot">
      <span className="seq">{col.sequencia}</span>
      {col.rotulo}
      {col.obrigatoria && <em>*</em>}
    </span>
  )
  const v = valor === null || valor === undefined ? '' : String(valor)
  const cls = `campo ${invalido ? 'invalido' : ''}`

  if (col.tipo === 'booleano') {
    return (
      <div className={cls}>
        {rot}
        <div className="seg">
          {[true, false].map((b) => (
            <button key={String(b)} type="button" disabled={bloqueado} className={valor === b ? 'ativo' : ''} onClick={() => onChange(valor === b ? null : b)}>
              {b ? 'SIM' : 'NÃO'}
            </button>
          ))}
        </div>
      </div>
    )
  }
  if (col.tipo === 'lista') {
    // poucas opções: botões grandes (mais rápido com luva/sol); muitas: lista
    if (col.opcoes.length > 0 && col.opcoes.length <= 6) {
      return (
        <div className={cls}>
          {rot}
          <div className="opcoes">
            {col.opcoes.map((o) => (
              <button key={o} type="button" disabled={bloqueado} className={v === o ? 'ativo' : ''} onClick={() => onChange(v === o ? null : o)}>
                {o}
              </button>
            ))}
          </div>
        </div>
      )
    }
    return (
      <label className={cls}>
        {rot}
        <select value={v} disabled={bloqueado} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">— selecione —</option>
          {col.opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    )
  }
  if (col.tipo === 'data') {
    return (
      <label className={cls}>
        {rot}
        <input type="date" value={v} disabled={bloqueado} onChange={(e) => onChange(e.target.value)} />
      </label>
    )
  }
  return (
    <label className={cls}>
      {rot}
      <input
        value={v}
        disabled={bloqueado}
        inputMode={col.tipo === 'numero' ? 'decimal' : col.tipo === 'inteiro' ? 'numeric' : 'text'}
        autoCapitalize="characters"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
