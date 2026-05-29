export type PrintFileType = 'foto' | 'carta' | 'outro'

export type PrinterRole = 'photo' | 'letter'

export interface PrintSizeConfig {
  widthMm: number
  heightMm: number
  label: string
}

export const PRINT_SIZES: Record<PrintFileType, PrintSizeConfig> = {
  foto:  { widthMm: 100, heightMm: 150, label: 'A6 / 10x15cm' },
  carta: { widthMm: 210, heightMm: 297, label: 'A4' },
  outro: { widthMm: 100, heightMm: 150, label: 'A6 / 10x15cm' },
}

const CARTA_KEYWORDS = ['cartão', 'cartao', 'carta', 'mensagem', 'bilhete', 'recado']

const FOTO_KEYWORDS = ['foto', 'polaroid', 'quadro', 'retrato', 'imagem', 'picture', 'print']

export function resolveCustomizationType(subfolderName: string): PrintFileType {
  const normalized = subfolderName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  if (CARTA_KEYWORDS.some((k) => normalized.includes(k))) return 'carta'
  if (FOTO_KEYWORDS.some((k) => normalized.includes(k))) return 'foto'
  return 'outro'
}

export function resolvePrinterRole(type: PrintFileType): PrinterRole {
  return type === 'carta' ? 'letter' : 'photo'
}
