/** Ícones de traço (24×24) usados nos botões do painel. Só aparência: não carregam lógica. */
const caminhos = {
  mais: 'M12 5v14M5 12h14',
  baixar: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14',
  enviar: 'M12 20V9m0 0-4.5 4.5M12 9l4.5 4.5M5 5h14',
  lixeira: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3',
  editar: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  desfazer: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  atualizar: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  sair: 'M15 4h4v16h-4M10 16l4-4-4-4M14 12H4',
  celular: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 15h2',
  fechar: 'M6 6l12 12M18 6 6 18',
  seta: 'M9 6l6 6-6 6',
  voltar: 'M15 6l-6 6 6 6',
  pdf: 'M7 3h7l5 5v13H7V3Zm7 0v5h5M10 13h6M10 17h6',
  check: 'M5 12.5 10 17l9-10',
}

export type NomeIcone = keyof typeof caminhos

export default function Icone({ nome, tamanho = 18 }: { nome: NomeIcone; tamanho?: number }) {
  return (
    <svg
      className="icone"
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={caminhos[nome]} />
    </svg>
  )
}
