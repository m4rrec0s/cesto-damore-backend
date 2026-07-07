import type { PrintFileType, PrintSizeConfig, PrinterRole } from '../utils/customizationTypeResolver'

export interface PrintJobFile {
  name: string
  driveFileId: string
  subfolderName: string
  type: PrintFileType
  sizeConfig: PrintSizeConfig
  printerRole: PrinterRole
}

export interface PrintJobPayload {
  jobId: string
  orderId: string
  customerName: string
  driveFolderId: string
  files: PrintJobFile[]
}

export interface PrinterConfigEntry {
  printerName: string
  isActive: boolean
}

export interface PrinterConfigMap {
  photo: string | null
  letter: string | null
}

export type WSOutboundMessage =
  | { type: 'PRINT_JOB'; jobId: string; job: PrintJobPayload; timestamp: string }
  | { type: 'CHECK_PRINTER'; timestamp: string }
  | { type: 'PRINTER_CONFIG_UPDATE'; config: PrinterConfigMap; isDefault?: boolean; timestamp: string }
  | { type: 'DEVICE_ROLE_UPDATE'; isDefault: boolean; timestamp: string }
  | {
      type: 'UPDATE_AVAILABLE'
      version: string
      downloadUrl: string
      releaseNotes: string
      timestamp: string
    }

export type WSInboundMessage =
  | { type: 'ACK'; jobId: string; timestamp: string }
  | { type: 'PRINTED'; jobId: string; timestamp: string }
  | { type: 'COMPLETED'; jobId: string; timestamp: string }
  | { type: 'FAILED'; jobId: string; error: string; timestamp: string }
  | { type: 'PRINTER_STATUS'; available: boolean; printers: string[]; timestamp: string }
  | { type: 'DOWNLOADING' | 'DOWNLOADED' | 'GENERATING_PDF' | 'PDF_GENERATED' | 'MOVING' | 'SENDING_TO_PRINTER' | 'FILE_PRINTED'; jobId: string; fileIndex: number; timestamp: string }
