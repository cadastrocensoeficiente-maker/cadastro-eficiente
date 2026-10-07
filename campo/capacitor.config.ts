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
    // Atualização das telas pelo próprio app (modo manual, sem servidor externo de terceiros)
    CapacitorUpdater: { autoUpdate: false, statsUrl: '', updateUrl: '', channelUrl: '', autoDeletePrevious: true, appReadyTimeout: 15000 },
  },
}

export default config
