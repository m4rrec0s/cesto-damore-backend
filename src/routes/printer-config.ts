import { Router, Request, Response } from 'express'
import prisma from '../database/prisma'
import logger from '../utils/logger'
import { printAgentWSManager } from '../services/printAgentWSManager'

const router = Router()

async function getConfigMap() {
  const configs = await prisma.printerConfig.findMany()
  const photoConfig = configs.find((c) => c.role === 'photo')
  const letterConfig = configs.find((c) => c.role === 'letter')
  return {
    photo: photoConfig?.printerName ?? null,
    letter: letterConfig?.printerName ?? null,
  }
}

function emitConfigUpdate() {
  getConfigMap()
    .then((config) => {
      printAgentWSManager.send({
        type: 'PRINTER_CONFIG_UPDATE',
        config,
        timestamp: new Date().toISOString(),
      })
    })
    .catch((err) => {
      logger.error({ err }, 'printer_config_emit_failed')
    })
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const configs = await prisma.printerConfig.findMany()
    const photo = configs.find((c) => c.role === 'photo') ?? null
    const letter = configs.find((c) => c.role === 'letter') ?? null
    res.json({ photo, letter })
  } catch (err: any) {
    logger.error({ err }, 'printer_config_get_failed')
    res.status(500).json({ error: err.message })
  }
})

router.put('/:role', async (req: Request, res: Response) => {
  try {
    const { role } = req.params
    if (role !== 'photo' && role !== 'letter') {
      res.status(400).json({ error: 'role deve ser photo ou letter' })
      return
    }

    const { printerName, isActive } = req.body as { printerName?: string; isActive?: boolean }
    if (!printerName || typeof printerName !== 'string') {
      res.status(400).json({ error: 'printerName é obrigatório' })
      return
    }

    await prisma.printerConfig.upsert({
      where: { role },
      create: { role, printerName, isActive: isActive ?? true },
      update: { printerName, isActive: isActive ?? true },
    })

    emitConfigUpdate()

    const config = await prisma.printerConfig.findUnique({ where: { role } })
    res.json(config)
  } catch (err: any) {
    logger.error({ err }, 'printer_config_put_failed')
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:role', async (req: Request, res: Response) => {
  try {
    const { role } = req.params
    if (role !== 'photo' && role !== 'letter') {
      res.status(400).json({ error: 'role deve ser photo ou letter' })
      return
    }

    await prisma.printerConfig.deleteMany({ where: { role } })
    emitConfigUpdate()
    res.json({ success: true })
  } catch (err: any) {
    logger.error({ err }, 'printer_config_delete_failed')
    res.status(500).json({ error: err.message })
  }
})

export function createPrinterConfigRoutes(parentRouter: Router) {
  parentRouter.use('/admin/printer-config', router)
}
