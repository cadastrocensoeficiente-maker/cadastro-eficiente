// Utilitários das funções serverless (Vercel) para o Cloudflare R2.
// As credenciais do R2 ficam SOMENTE no servidor (variáveis de ambiente do Vercel).
import { AwsClient } from 'aws4fetch'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const PADROES: Record<string, string> = {
  SUPABASE_URL: 'https://pwesznsuwypbfqrayqoz.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_jG-8DFdvH0cMCVM32KpqLA_lUCnDs7j',
  R2_BUCKET: 'cadastro-eficiente-fotos',
}

const env = (k: string) => {
  const v = process.env[k] || PADROES[k]
  // 503 = armazenamento R2 ainda não configurado: o app usa o armazenamento do Supabase.
  if (!v) throw new HttpError(k.startsWith('R2_') ? 503 : 500, k.startsWith('R2_') ? 'Armazenamento R2 não configurado.' : `Variável de ambiente ${k} não configurada no servidor.`)
  return v
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function r2() {
  const client = new AwsClient({
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    service: 's3',
    region: 'auto',
  })
  const base = `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${env('R2_BUCKET')}`
  return { client, base }
}

/** URL assinada temporária (GET para ver, PUT para enviar). */
export async function urlAssinada(method: 'GET' | 'PUT', key: string, segundos: number, contentType?: string) {
  const { client, base } = r2()
  const url = new URL(`${base}/${key.split('/').map(encodeURIComponent).join('/')}`)
  url.searchParams.set('X-Amz-Expires', String(segundos))
  const req = await client.sign(new Request(url, { method, headers: contentType ? { 'Content-Type': contentType } : {} }), {
    aws: { signQuery: true },
  })
  return req.url
}

export async function apagarObjeto(key: string) {
  const { client, base } = r2()
  const res = await client.fetch(`${base}/${key.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new HttpError(502, `R2 recusou a exclusão (${res.status}).`)
}

/**
 * Cliente Supabase agindo COMO O USUÁRIO (token dele): todas as regras de
 * RLS do banco continuam valendo dentro das funções.
 */
export async function usuario(req: Request): Promise<{ sb: SupabaseClient; role: string; userId: string }> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Não autenticado.')
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_PUBLISHABLE_KEY'), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await sb.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'Sessão inválida ou expirada.')
  const { data: perfil } = await sb.from('profiles').select('role').eq('id', data.user.id).single()
  return { sb, role: perfil?.role ?? 'pendente', userId: data.user.id }
}

// O APK Android roda as telas em https://localhost e chama esta API pela internet.
const ORIGENS_APP = ['https://localhost', 'http://localhost', 'capacitor://localhost']

function cors(req: Request): Record<string, string> {
  const origem = req.headers.get('origin') ?? ''
  if (!ORIGENS_APP.includes(origem)) return {}
  return {
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export const preflight = (req: Request) => new Response(null, { status: 204, headers: cors(req) })

export function responder(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    const h = cors(req)
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST.')
      return Response.json(await fn(req), { headers: h })
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500
      const msg = e instanceof Error ? e.message : 'Erro interno.'
      return Response.json({ error: msg }, { status, headers: h })
    }
  }
}
