import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ColunaCampo, type FotoLocal, type PontoLocal, type Valor } from '../lib/db'
import { capturarGPS, comprimirFoto, fmtGraus, type Leitura } from '../lib/geo'
import { NATIVO } from '../lib/config'
import { fotografarPara } from '../lib/camera'
import { sincronizar } from '../lib/sync'
import type { Tela, Usuario } from '../App'

const vazio = (v: Valor | undefined) => v === undefined || v === null || v === ''

export default function Cadastro({ usuario, contractId, localId, irPara }: {
  usuario: Usuario; contractId: string; localId?: string; irPara: (t: Tela) => void
}) {
  const contrato = useLiveQuery(() => db.contratos.get(contractId).then((c) => c ?? null), [contractId])
  const chave = localId ? `edit|${localId}` : `novo|${contractId}|${usuario.id}`

  // Tudo o que está na tela é gravado no aparelho (tabela "rascunhos") a cada
  // alteração; as fotos vão direto para o banco. Assim, se o Android fechar o
  // app (câmera, pouca memória), nada se perde.
  const [carregado, setCarregado] = useState(false)
  const [alvoId, setAlvoId] = useState('') // localId que o ponto terá / já tem
  const [existenteInicial, setExistente] = useState<PontoLocal | undefined>()
  const existenteVivo = useLiveQuery(() => (localId ? db.pontos.get(localId) : undefined), [localId])
  const existente = existenteVivo ?? existenteInicial
  const [valores, setValores] = useState<Record<string, Valor>>({})
  const [leitura, setLeitura] = useState<Leitura | null>(null)
  const [recuperado, setRecuperado] = useState(false)
  const sujo = useRef(false)

  const [capturando, setCapturando] = useState(false)
  const pararGps = useRef<(() => void) | null>(null)
  const [erro, setErro] = useState('')
  const [faltando, setFaltando] = useState<Set<string>>(new Set())
  const [salvando, setSalvando] = useState(false)
  const [abrindoCamera, setAbrindoCamera] = useState(false)
  const [aviso, setAviso] = useState('')
  /** Depois de salvar: pergunta se abre um novo ponto (o formulário só limpa no "Sim"). */
  const [salvo, setSalvo] = useState(false)
  const topo = useRef<HTMLDivElement>(null)

  const fotos = useLiveQuery(() => (alvoId ? db.fotos.where('localPointId').equals(alvoId).sortBy('criadaEm') : []), [alvoId])

  useEffect(() => {
    let vivo = true
    setCarregado(false)
    sujo.current = false
    ;(async () => {
      const [r, p] = await Promise.all([db.rascunhos.get(chave), localId ? db.pontos.get(localId) : undefined])
      if (!vivo) return
      if (localId && !p) {
        // ponto já sincronizado e removido do aparelho
        await db.rascunhos.delete(chave)
        irPara({ nome: 'lista', contractId })
        return
      }
      setExistente(p)
      const editavel = !p || p.status === 'pendente' || p.status === 'erro'
      if (r && editavel) {
        setAlvoId(r.localId)
        setValores(r.valores)
        setLeitura(r.leitura)
        sujo.current = true
        const temFoto = (await db.fotos.where({ localPointId: r.localId }).count()) > 0
        setRecuperado(Object.values(r.valores).some((v) => !vazio(v)) || !!r.leitura || temFoto)
      } else if (p) {
        setAlvoId(p.localId)
        setValores(p.valores)
        setLeitura(p.latitude !== null && p.longitude !== null
          ? { latitude: p.latitude, longitude: p.longitude, precisao: p.precisaoM, em: p.capturadoEm ?? p.criadoEm }
          : null)
      } else {
        setAlvoId(crypto.randomUUID())
        setValores({})
        setLeitura(null)
      }
      setCarregado(true)
    })()
    return () => {
      vivo = false
    }
  }, [chave])

  const somenteLeitura = !!existente && (existente.status === 'enviado' || existente.status === 'enviando')

  /** Grava o formulário no aparelho (chamado a cada alteração). */
  async function gravarRascunho(v = valores, l = leitura) {
    if (!carregado || !alvoId || somenteLeitura) return
    sujo.current = true
    await db.rascunhos.put({ chave, contractId, userId: usuario.id, localId: alvoId, valores: v, leitura: l, atualizadoEm: new Date().toISOString() })
  }
  useEffect(() => {
    if (sujo.current) gravarRascunho().catch(() => {})
  }, [valores, leitura])

  useEffect(() => () => pararGps.current?.(), [])

  function iniciarGPS() {
    setErro('')
    setCapturando(true)
    sujo.current = true
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

  /** Status das fotos novas: rascunho até salvar o ponto; direto na fila se o ponto já existe. */
  const statusFotoNova: FotoLocal['status'] = existente ? 'pendente' : 'rascunho'

  /** Navegador (sem APK): arquivo da câmera/galeria. */
  async function adicionarArquivos(lista: FileList | null) {
    if (!lista || !alvoId) return
    for (const arq of Array.from(lista)) {
      const blob = await comprimirFoto(arq)
      await db.fotos.add({ id: crypto.randomUUID(), localPointId: alvoId, blob, nome: `foto_${Date.now()}.jpg`, criadaEm: new Date().toISOString(), status: statusFotoNova, tentativas: 0 })
    }
    if (existente) sincronizar()
    else await gravarRascunho()
  }

  /** APK: abre direto a câmera do celular. */
  async function fotografar() {
    if (abrindoCamera || !alvoId) return
    setErro('')
    setAbrindoCamera(true)
    pararGps.current?.() // libera memória e o GPS enquanto a câmera está aberta
    try {
      if (!existente) await gravarRascunho() // garante o formulário salvo antes de sair para a câmera
      await fotografarPara({ localPointId: alvoId, status: statusFotoNova })
      if (existente) sincronizar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setAbrindoCamera(false)
    }
  }

  async function removerFoto(f: FotoLocal) {
    if (f.status === 'enviado' || f.status === 'enviando') return
    if (!confirm('Remover esta foto?')) return
    await db.fotos.delete(f.id)
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

  function limparFormulario(novoId = crypto.randomUUID()) {
    sujo.current = false
    setAlvoId(novoId)
    setValores({})
    setLeitura(null)
    setFaltando(new Set())
    setRecuperado(false)
    setErro('')
  }

  async function descartarRascunho() {
    if (!confirm('Limpar o formulário? Os dados e fotos deste cadastro (ainda não salvo) serão apagados.')) return
    pararGps.current?.()
    await db.transaction('rw', db.rascunhos, db.fotos, async () => {
      await db.fotos.where('localPointId').equals(alvoId).and((f) => f.status === 'rascunho').delete()
      await db.rascunhos.delete(chave)
    })
    if (existente) irPara({ nome: 'lista', contractId })
    else limparFormulario()
  }

  async function salvar() {
    if (!contrato) return
    const falta = validar(contrato.colunas)
    if (falta.size) {
      setErro(`Verifique: ${contrato.colunas.filter((c) => falta.has(c.column_id)).map((c) => c.rotulo).join(', ')}`)
      return
    }
    if (!leitura && !confirm('Salvar sem localização? LATITUDE e LONGITUDE ficarão vazias.')) return
    pararGps.current?.()
    setSalvando(true)
    setErro('')
    try {
      const id = alvoId
      const agora = new Date().toISOString()
      await db.transaction('rw', db.pontos, db.fotos, db.rascunhos, async () => {
        const dados = {
          valores, latitude: leitura?.latitude ?? null, longitude: leitura?.longitude ?? null,
          precisaoM: leitura?.precisao ?? null, capturadoEm: leitura?.em ?? null,
        }
        if (existente) {
          await db.pontos.update(id, { ...dados, status: 'pendente', erro: undefined })
        } else {
          await db.pontos.add({ localId: id, contractId, userId: usuario.id, ...dados, criadoEm: agora, status: 'pendente', tentativas: 0 })
        }
        await db.fotos.where('localPointId').equals(id).and((f) => f.status === 'rascunho').modify({ status: 'pendente' })
        await db.rascunhos.delete(chave)
      })
      sujo.current = false
      if (existente) {
        irPara({ nome: 'lista', contractId })
      } else {
        // pronto para o próximo ponto
        // Não mexe na tela agora (evita o "pulo"): mostra a pergunta por cima.
        setSalvo(true)
      }
    } catch (e) {
      setErro(`Não foi possível salvar no aparelho: ${(e as Error).message}`)
    } finally {
      setSalvando(false)
    }
  }

  function abrirNovoPonto() {
    limparFormulario()
    setSalvo(false)
    setAviso('Ponto anterior salvo no celular. Toque em SINCRONIZAR para enviar.')
    window.scrollTo({ top: 0, behavior: 'auto' })
    setTimeout(() => setAviso(''), 4000)
  }

  async function descartarPendente() {
    if (!existente || existente.status === 'enviado') return
    if (!confirm('Descartar este ponto? Ele ainda não foi enviado e será apagado deste aparelho.')) return
    await db.transaction('rw', db.pontos, db.fotos, db.rascunhos, async () => {
      await db.fotos.where('localPointId').equals(existente.localId).delete()
      await db.pontos.delete(existente.localId)
      await db.rascunhos.delete(chave)
    })
    irPara({ nome: 'lista', contractId })
  }

  async function voltar() {
    pararGps.current?.()
    if (existente && sujo.current && !somenteLeitura) {
      if (!confirm('Sair sem salvar as alterações deste ponto?')) return
      await db.rascunhos.delete(chave)
    }
    // cadastro novo: o que foi preenchido fica guardado e reaparece ao voltar
    irPara(localId ? { nome: 'lista', contractId } : { nome: 'contratos' })
  }

  if (contrato === null) {
    return (
      <main className="tela">
        <button className="voltar" onClick={() => irPara({ nome: 'contratos' })}>‹ Contratos</button>
        <div className="vazio">Este contrato não está mais disponível neste aparelho.</div>
      </main>
    )
  }
  if (!contrato || !carregado) return <div className="centro">Carregando…</div>

  const precisaoRuim = leitura?.precisao != null && leitura.precisao > 15

  return (
    <main className="tela cadastro" ref={topo}>
      {salvo && (
        <div className="dialogo-fundo" role="dialog" aria-modal="true" aria-labelledby="dlg-salvo">
          <div className="dialogo">
            <div className="dialogo-ok">✓</div>
            <h3 id="dlg-salvo">Ponto salvo no celular</h3>
            <p>{fotos?.length ? `${fotos.length} foto(s) junto. ` : ''}Ele será enviado quando você tocar em SINCRONIZAR.</p>
            <p className="dialogo-pergunta">Abrir novo ponto?</p>
            <button type="button" className="btn primario grande" onClick={abrirNovoPonto} autoFocus>Sim, novo ponto</button>
            <button type="button" className="btn" onClick={() => { setSalvo(false); irPara({ nome: 'lista', contractId }) }}>Não, ver pontos salvos</button>
          </div>
        </div>
      )}
      <button className="voltar" onClick={voltar}>‹ Voltar</button>
      <h2 className="titulo">{contrato.nome}</h2>
      {aviso && <div className="alerta ok">{aviso}</div>}
      {recuperado && (
        <div className="alerta ok recuperado">
          <span>Cadastro em andamento recuperado — continue de onde parou.</span>
          <button type="button" className="btn" onClick={descartarRascunho}>Limpar formulário</button>
        </div>
      )}

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
            sujo.current = true
            setValores((x) => ({ ...x, [c.column_id]: v }))
            if (faltando.has(c.column_id)) setFaltando((f) => { const n = new Set(f); n.delete(c.column_id); return n })
          }}
        />
      ))}

      {/* LATITUDE / LONGITUDE — sistema */}
      <section className="gps">
        <div className="gps-topo">
          <span className="rot">LATITUDE · LONGITUDE</span>
          <span className="mono pequeno">graus decimais · WGS84</span>
        </div>
        <div className="gps-valores">
          <div><small>LATITUDE</small><span className="mono">{fmtGraus(leitura?.latitude)}</span></div>
          <div><small>LONGITUDE</small><span className="mono">{fmtGraus(leitura?.longitude)}</span></div>
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
      </section>

      {/* LINK_FOTOS — sistema */}
      <section className="fotos">
        <div className="gps-topo"><span className="rot">LINK_FOTOS</span><span className="pequeno">{fotos?.length ?? 0} foto(s)</span></div>
        <div className="fotos-grade">
          {fotos?.map((f) => <MiniFoto key={f.id} foto={f} onRemover={() => removerFoto(f)} />)}
          {NATIVO ? (
            <button type="button" className="mini add" onClick={fotografar} disabled={abrindoCamera}>
              <span>{abrindoCamera ? '…' : '📷'}<br />Foto</span>
            </button>
          ) : (
            <label className="mini add">
              <input type="file" accept="image/*" capture="environment" onChange={(e) => { adicionarArquivos(e.target.files); e.target.value = '' }} />
              <span>📷<br />Foto</span>
            </label>
          )}
        </div>
      </section>

      {erro && <div className="alerta erro">{erro}</div>}
      {existente?.status === 'erro' && <div className="alerta erro">Erro no envio: {existente.erro}</div>}

      {!somenteLeitura ? (
        <div className="rodape">
          {existente && <button className="btn perigo" onClick={descartarPendente}>Descartar</button>}
          <button className="btn primario grande" onClick={salvar} disabled={salvando || salvo || abrindoCamera}>
            {salvando ? 'Salvando…' : existente ? 'Salvar alterações' : 'Salvar e próximo'}
          </button>
        </div>
      ) : (
        <p className="nota centro-txt">Ponto já enviado. Alterações de dados são feitas pelo painel de gestão.</p>
      )}
    </main>
  )
}

function MiniFoto({ foto, onRemover }: { foto: FotoLocal; onRemover: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (foto.blob.size === 0) return
    const u = URL.createObjectURL(foto.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [foto.id, foto.blob.size])
  return (
    <div className={`mini ${foto.status}`}>
      {url ? <img src={url} alt="" decoding="async" /> : <span className="mini-ok">✓<br />enviada</span>}
      {foto.status !== 'enviado' && foto.status !== 'rascunho' && <span className="mini-status">{foto.status === 'erro' ? '!' : '⇡'}</span>}
      {foto.status !== 'enviado' && foto.status !== 'enviando' && (
        <button type="button" className="mini-x" onClick={onRemover} aria-label="Remover foto">×</button>
      )}
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
    // várias opções: cada toque marca/desmarca; grava "A, B" na ordem das opções
    const marcados = v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []
    const alternar = (o: string) => {
      const novo = marcados.includes(o) ? marcados.filter((x) => x !== o) : [...marcados, o]
      const ordem = col.opcoes.filter((x) => novo.includes(x))
      onChange(ordem.length ? ordem.join(', ') : null)
    }
    return (
      <div className={cls}>
        {rot}
        <div className="opcoes">
          {col.opcoes.map((o) => {
            const ativo = marcados.includes(o)
            return (
              <button key={o} type="button" disabled={bloqueado} className={ativo ? 'ativo' : ''} aria-pressed={ativo} onClick={() => alternar(o)}>
                {ativo ? '✓ ' : ''}{o}
              </button>
            )
          })}
        </div>
        <span className="pequeno">Pode marcar mais de uma opção{marcados.length > 1 ? ` · ${marcados.length} marcadas` : ''}.</span>
      </div>
    )
  }
  if (col.tipo === 'lista_unica') {
    // um item só: lista que abre ao tocar e o cadastrador escolhe
    return (
      <label className={`${cls} campo-select`}>
        {rot}
        <select value={v} disabled={bloqueado} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Toque para selecionar…</option>
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
