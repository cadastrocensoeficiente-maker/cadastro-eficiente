import { createClient } from '@supabase/supabase-js'

// Chave publicável (pública por definição; a segurança está no RLS do banco).
const url = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://pwesznsuwypbfqrayqoz.supabase.co'
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || 'sb_publishable_jG-8DFdvH0cMCVM32KpqLA_lUCnDs7j'

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
})

/** Converte erro do Supabase/Postgres em mensagem legível. */
export function msgErro(e: unknown): string {
  if (!e) return 'Erro desconhecido.'
  if (typeof e === 'string') return e
  const anyE = e as { message?: string; details?: string; hint?: string }
  if (anyE.message?.includes('Could not find the function public.col_remove')) {
    return 'A remoção de colunas ainda não foi ativada no banco (falta rodar a migração 0004 no SQL Editor do Supabase).'
  }
  return anyE.message ?? JSON.stringify(e)
}
