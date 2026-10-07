import { createClient } from '@supabase/supabase-js'

// Chave publicável (pública por definição; a segurança está no RLS do banco).
const url = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://pwesznsuwypbfqrayqoz.supabase.co'
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || 'sb_publishable_jG-8DFdvH0cMCVM32KpqLA_lUCnDs7j'

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cadastro-campo-auth' },
  // Sinal fraco: nenhuma chamada fica pendurada para sempre.
  global: { fetch: (u, o) => fetch(u, { ...o, signal: o?.signal ?? AbortSignal.timeout(90_000) }) },
})

export function msgErro(e: unknown): string {
  if (!e) return 'Erro desconhecido.'
  if (typeof e === 'string') return e
  const m = (e as { message?: string }).message
  if (m === 'Failed to fetch' || m?.includes('NetworkError') || m?.includes('fetch failed') || (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') return 'Sem conexão com a internet.'
  if (m === 'Invalid login credentials') return 'E-mail ou senha incorretos.'
  return m ?? JSON.stringify(e)
}

export const estaOnline = () => navigator.onLine
