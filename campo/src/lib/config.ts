// No navegador (PWA) a API fica no mesmo endereço do app.
// No APK as telas rodam de dentro do aparelho, então a API precisa do endereço completo.
export const NATIVO = import.meta.env.VITE_NATIVO === '1'
export const API_BASE = NATIVO ? ((import.meta.env.VITE_API_BASE as string) || 'https://cadastro-campo.vercel.app') : ''
export const URL_APK =
  'https://github.com/cadastrocensoeficiente-maker/cadastro-eficiente/releases/latest/download/cadastro-campo.apk'
