export type Role = 'admin' | 'cadastrador' | 'visualizador' | 'pendente'

export interface Profile {
  id: string
  nome: string | null
  email: string | null
  role: Role
  created_at: string
}

export interface Contract {
  id: string
  nome: string
  municipio: string | null
  uf: string | null
  epsg: number
  id_digitos: number
  ativo: boolean
  created_at: string
}

export type ColumnType = 'texto' | 'numero' | 'inteiro' | 'data' | 'booleano' | 'lista' | 'lista_unica'

export const COLUMN_TYPES: { value: ColumnType; label: string }[] = [
  { value: 'texto', label: 'Texto' },
  { value: 'numero', label: 'Número (decimal)' },
  { value: 'inteiro', label: 'Número inteiro' },
  { value: 'data', label: 'Data' },
  { value: 'booleano', label: 'Sim / Não' },
  { value: 'lista', label: 'Lista (marcar uma ou várias)' },
  { value: 'lista_unica', label: 'Lista (uma opção só)' },
]

export interface ContractColumn {
  id: string
  contract_id: string
  name: string
  label: string
  type: ColumnType
  options: string[]
  required: boolean
  position: number
}

/** Linha de contract_layout(): ordem oficial ID · 1..N · LATITUDE · LONGITUDE · LINK_FOTOS */
export interface LayoutItem {
  ordem: number
  chave: string
  rotulo: string
  sistema: boolean
  sequencia: number | null
  column_id: string | null
  tipo: ColumnType | 'sistema'
  obrigatoria: boolean
  opcoes: string[]
}

export type Valor = string | number | boolean | null

export interface PointRow {
  id: string
  contract_id: string
  seq: number
  ID: string
  valores: Record<string, Valor>
  TMX: number | null
  TMY: number | null
  LATITUDE: number | null
  LONGITUDE: number | null
  LINK_FOTOS: string
  total_fotos: number
  latitude: number | null
  longitude: number | null
  precisao_m: number | null
  capturado_em: string | null
  origem_coord: 'gps' | 'importacao' | 'manual_admin'
  created_at: string
  updated_at: string
}

export interface Photo {
  id: string
  point_id: string
  contract_id: string
  r2_key: string
  nome_arquivo: string | null
  content_type: string
  tamanho_bytes: number | null
  created_at: string
}

/** Lista múltipla: valor gravado como "A, B" na ordem das opções. */
export const separarLista = (v: unknown): string[] =>
  v === null || v === undefined || v === '' ? [] : String(v).split(',').map((x) => x.trim()).filter(Boolean)
export const juntarLista = (itens: string[], opcoes: string[]) => {
  const ordem = opcoes.length ? opcoes.filter((o) => itens.includes(o)) : itens
  return ordem.length ? ordem.join(', ') : null
}
