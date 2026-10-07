import type { CapacitorConfig } from '@capacitor/cli'

// APK Android do app de campo. As telas ficam DENTRO do APK (funciona sem internet);
// só o envio de dados usa a internet (Supabase + /api do Vercel).
const config: CapacitorConfig = {
  appId: 'br.com.eficienteserv.cadastrocampo',
  appName: 'Cadastro Campo',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
  },
}

export default config
