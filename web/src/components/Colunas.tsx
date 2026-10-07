import { useEffect, useState, type FormEvent } from 'react'
import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { addColumn, copyColumns, listColumns, listContracts, removeColumn, reorderColumns, updateColumn } from '../lib/api'
import { msgErro } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { COLUMN_TYPES, type ColumnType, type Contract, type ContractColumn } from '../lib/types'

const SISTEMA_FINAL = ['LATITUDE', 'LONGITUDE', 'LINK_FOTOS']

export default function Colunas({ contrato, onMudou }: { contrato: Contract; onMudou: () => void }) {
  const { isAdmin } = useAuth()
  const [colunas, setColunas] = useState<ContractColumn[]>([])
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  const [adicionando, setAdicionando] = useState(false)

  const carregar = async () => {
    try {
      setColunas(await listColumns(contrato.id))
    } catch (e) {
      setErro(msgErro(e))
    }
  }
  useEffect(() => {
    carregar()
  }, [contrato.id])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /** Toda mudança vai ao banco, que recalcula 1..N e devolve a sequência oficial. */
  async function executar(acao: () => Promise<unknown>) {
    setOcupado(true)
    setErro('')
    try {
      await acao()
      await carregar()
      onMudou()
    } catch (e) {
      setErro(msgErro(e))
      await carregar()
    } finally {
      setOcupado(false)
    }
  }

  function aoSoltar(ev: DragEndEvent) {
    const { active, over } = ev
    if (!over || active.id === over.id) return
    const de = colunas.findIndex((c) => c.id === active.id)
    const para = colunas.findIndex((c) => c.id === over.id)
    const nova = arrayMove(colunas, de, para).map((c, i) => ({ ...c, position: i + 1 }))
    setColunas(nova) // reflexo imediato; o banco confirma em seguida
    executar(() => reorderColumns(contrato.id, nova.map((c) => c.id)))
  }

  function mover(c: ContractColumn, delta: number) {
    const idx = colunas.findIndex((x) => x.id === c.id)
    const alvo = idx + delta
    if (alvo < 0 || alvo >= colunas.length) return
    const nova = arrayMove(colunas, idx, alvo)
    setColunas(nova.map((x, i) => ({ ...x, position: i + 1 })))
    executar(() => reorderColumns(contrato.id, nova.map((x) => x.id)))
  }

  function remover(c: ContractColumn) {
    if (!confirm(`Remover a coluna ${c.position} — ${c.label}?\n\nOs valores dessa coluna serão apagados de todos os pontos deste contrato. As demais colunas serão renumeradas automaticamente.`)) return
    executar(() => removeColumn(c.id))
  }

  return (
    <div className="colunas">
      <div className="explica">
        <p>
          <b>ID, LATITUDE, LONGITUDE e LINK_FOTOS</b> são colunas do sistema: fixas, sempre presentes e fora da numeração.
          As colunas configuráveis seguem sempre a sequência <b>1, 2, 3…</b> sem buracos: o sistema renumera sozinho ao criar,
          remover ou arrastar.
        </p>
      </div>
      {erro && <div className="alerta erro">{erro}</div>}

      <ol className={`lista-colunas ${ocupado ? 'ocupado' : ''}`}>
        <LinhaSistema nome="ID" desc="Gerado automaticamente · único no contrato" />
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={aoSoltar}>
          <SortableContext items={colunas.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {colunas.map((c, i) =>
              editando === c.id ? (
                <li key={c.id} className="coluna editando">
                  <FormColuna
                    inicial={c}
                    onCancelar={() => setEditando(null)}
                    onSalvar={async (label, type, required, options) => {
                      await executar(() => updateColumn(c.id, label, type, required, options))
                      setEditando(null)
                    }}
                  />
                </li>
              ) : (
                <ItemColuna
                  key={c.id}
                  coluna={c}
                  admin={isAdmin}
                  primeiro={i === 0}
                  ultimo={i === colunas.length - 1}
                  onEditar={() => setEditando(c.id)}
                  onRemover={() => remover(c)}
                  onSubir={() => mover(c, -1)}
                  onDescer={() => mover(c, 1)}
                />
              ),
            )}
          </SortableContext>
        </DndContext>
        {colunas.length === 0 && <li className="coluna vazia">Nenhuma coluna configurável ainda.</li>}
        {SISTEMA_FINAL.map((n) => (
          <LinhaSistema key={n} nome={n} desc={n === 'LINK_FOTOS' ? 'Galeria de fotos do ponto (Cloudflare R2)' : 'Capturada pelo GPS · graus decimais (WGS84 / EPSG:4326, pronto para o QGIS)'} />
        ))}
      </ol>

      {isAdmin &&
        (adicionando ? (
          <div className="painel">
            <h3>Nova coluna</h3>
            <FormColuna
              colunasExistentes={colunas}
              onCancelar={() => setAdicionando(false)}
              onSalvar={async (label, type, required, options, posicao) => {
                await executar(() => addColumn(contrato.id, label, type, required, options, posicao ?? null))
                setAdicionando(false)
              }}
            />
          </div>
        ) : (
          <div className="acoes-esquerda">
            <button className="btn primario" onClick={() => setAdicionando(true)} disabled={ocupado}>
              + Adicionar coluna
            </button>
            {colunas.length === 0 && <CopiarDe contrato={contrato} onCopiar={(origem) => executar(() => copyColumns(contrato.id, origem))} />}
          </div>
        ))}
    </div>
  )
}

function LinhaSistema({ nome, desc }: { nome: string; desc: string }) {
  return (
    <li className="coluna sistema">
      <span className="alca bloqueada" title="Coluna do sistema">🔒</span>
      <span className="seq seq-vazio">—</span>
      <span className="nome mono">{nome}</span>
      <span className="desc">{desc}</span>
    </li>
  )
}

function ItemColuna(props: {
  coluna: ContractColumn; admin: boolean; primeiro: boolean; ultimo: boolean
  onEditar: () => void; onRemover: () => void; onSubir: () => void; onDescer: () => void
}) {
  const { coluna: c, admin } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: c.id, disabled: !admin })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const tipo = COLUMN_TYPES.find((t) => t.value === c.type)?.label ?? c.type
  return (
    <li ref={setNodeRef} style={style} className={`coluna ${isDragging ? 'arrastando' : ''}`}>
      {admin ? (
        <button className="alca" aria-label={`Arrastar ${c.label}`} {...attributes} {...listeners}>
          ⠿
        </button>
      ) : (
        <span className="alca" />
      )}
      <span className="seq">{c.position}</span>
      <span className="nome">{c.label}</span>
      <span className="desc">
        {tipo}
        {c.required && <em className="obrig"> · obrigatória</em>}
        {(c.type === 'lista' || c.type === 'lista_unica') && c.options.length > 0 && <> · {c.options.join(', ')}</>}
      </span>
      {admin && (
        <span className="botoes">
          <button className="btn-icone" onClick={props.onSubir} disabled={props.primeiro} aria-label="Subir">▲</button>
          <button className="btn-icone" onClick={props.onDescer} disabled={props.ultimo} aria-label="Descer">▼</button>
          <button className="btn-link" onClick={props.onEditar}>Editar</button>
          <button className="btn-link perigo" onClick={props.onRemover}>Remover</button>
        </span>
      )}
    </li>
  )
}

function FormColuna(props: {
  inicial?: ContractColumn
  colunasExistentes?: ContractColumn[]
  onCancelar: () => void
  onSalvar: (label: string, type: ColumnType, required: boolean, options: string[], posicao?: number | null) => Promise<void>
}) {
  const { inicial, colunasExistentes } = props
  const [label, setLabel] = useState(inicial?.label ?? '')
  const [type, setType] = useState<ColumnType>(inicial?.type ?? 'texto')
  const [required, setRequired] = useState(inicial?.required ?? false)
  const [opcoes, setOpcoes] = useState((inicial?.options ?? []).join('\n'))
  const [posicao, setPosicao] = useState<string>('fim')
  const [salvando, setSalvando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setSalvando(true)
    const opts = type === 'lista' || type === 'lista_unica' ? opcoes.split(/[\n;,]/).map((s) => s.trim()).filter(Boolean) : []
    await props.onSalvar(label, type, required, opts, posicao === 'fim' ? null : Number(posicao))
    setSalvando(false)
  }

  return (
    <form onSubmit={enviar} className="form-coluna">
      <div className="linha-campos">
        <label>
          Nome da coluna
          <input value={label} onChange={(e) => setLabel(e.target.value)} required autoFocus placeholder="PLAQUETA" />
        </label>
        <label>
          Tipo
          <select value={type} onChange={(e) => setType(e.target.value as ColumnType)}>
            {COLUMN_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        {colunasExistentes && (
          <label>
            Posição
            <select value={posicao} onChange={(e) => setPosicao(e.target.value)}>
              <option value="fim">No final ({colunasExistentes.length + 1})</option>
              {colunasExistentes.map((c) => (
                <option key={c.id} value={c.position}>
                  Antes de {c.position} — {c.label} (vira {c.position})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {(type === 'lista' || type === 'lista_unica') && (
        <label>
          Opções (uma por linha)
          <textarea rows={4} value={opcoes} onChange={(e) => setOpcoes(e.target.value)} placeholder={'LED\nVAPOR DE SÓDIO\nMETÁLICA'} />
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Preenchimento obrigatório no cadastro
      </label>
      <div className="acoes">
        <button type="button" className="btn" onClick={props.onCancelar}>Cancelar</button>
        <button className="btn primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar coluna'}</button>
      </div>
    </form>
  )
}

function CopiarDe({ contrato, onCopiar }: { contrato: Contract; onCopiar: (origem: string) => void }) {
  const [contratos, setContratos] = useState<Contract[]>([])
  const [origem, setOrigem] = useState('')
  useEffect(() => {
    listContracts().then((l) => setContratos(l.filter((c) => c.id !== contrato.id)))
  }, [contrato.id])
  if (contratos.length === 0) return null
  return (
    <span className="copiar">
      ou copiar estrutura de
      <select value={origem} onChange={(e) => setOrigem(e.target.value)}>
        <option value="">— escolha um contrato —</option>
        {contratos.map((c) => (
          <option key={c.id} value={c.id}>{c.nome}</option>
        ))}
      </select>
      <button className="btn" disabled={!origem} onClick={() => onCopiar(origem)}>Copiar</button>
    </span>
  )
}
