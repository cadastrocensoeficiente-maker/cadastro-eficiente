// Banco local do aparelho (IndexedDB). Tudo o que o cadastrador faz fica aqui
// primeiro e só depois é enviado ao servidor — o app funciona sem internet.
import Dexie, { type EntityTable } from 'dexie'

export type TipoColuna = 'texto' | 'numero' | 'inteiro' | 'data' | 'booleano' | 'lista' | 'lista_unica'
export type Valor = string | number | boolean | null

/** Coluna configurável, na sequência oficial do contrato (1..N). */
export interface ColunaCampo {
  column_id: string
  chave: string
  rotulo: string
  sequencia: number
  tipo: TipoColuna
  obrigatoria: boolean
  opcoes: string[]
}

export interface ContratoLocal {
  id: string
  nome: string
  municipio: string | null
  uf: string | null
  epsg: number
  proj4: string
  colunas: ColunaCampo[]
  atualizadoEm: string
}

export type StatusEnvio = 'pendente' | 'enviando' | 'enviado' | 'erro'

export interface PontoLocal {
  localId: string // também é o client_uuid no servidor (envio idempotente)
  contractId: string
  userId: string
  valores: Record<string, Valor>
  latitude: number | null
  longitude: number | null
  precisaoM: number | null
  capturadoEm: string | null
  criadoEm: string
  status: StatusEnvio
  erro?: string
  tentativas: number
  // preenchidos pelo servidor após o envio
  serverId?: string
  codigo?: string
  tmx?: number
  tmy?: number
}

export interface FotoLocal {
  id: string
  localPointId: string
  blob: Blob
  nome: string
  criadaEm: string
  /** 'rascunho' = foto de um cadastro ainda não salvo (não é enviada). */
  status: StatusEnvio | 'rascunho'
  erro?: string
  tentativas: number
}

/**
 * Cadastro em andamento, gravado a cada alteração. Se o Android fechar o app
 * (memória cheia, câmera, ligação…), ao voltar o formulário reaparece igual.
 */
export interface Rascunho {
  chave: string // 'novo|contrato|usuario' ou 'edit|localId'
  contractId: string
  userId: string
  localId: string // id que o ponto terá ao salvar (as fotos já usam este id)
  valores: Record<string, Valor>
  leitura: { latitude: number; longitude: number; precisao: number | null; em: string } | null
  atualizadoEm: string
}

export const db = new Dexie('cadastro-campo') as Dexie & {
  contratos: EntityTable<ContratoLocal, 'id'>
  pontos: EntityTable<PontoLocal, 'localId'>
  fotos: EntityTable<FotoLocal, 'id'>
  rascunhos: EntityTable<Rascunho, 'chave'>
}

db.version(1).stores({
  contratos: 'id, nome',
  pontos: 'localId, contractId, userId, status, criadoEm, [contractId+userId]',
  fotos: 'id, localPointId, status',
})
db.version(2).stores({
  rascunhos: 'chave, contractId',
})

/** Pede ao navegador para não apagar os dados locais em caso de pouco espaço. */
export async function pedirArmazenamentoPersistente() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    /* ignora */
  }
}
