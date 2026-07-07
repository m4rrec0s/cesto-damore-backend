import { Router, Request, Response } from 'express'
import prisma from '../database/prisma'
import logger from '../utils/logger'
import { printAgentWSManager } from '../services/printAgentWSManager'
import { PrinterRole } from '@prisma/client'

const router = Router()

interface PrinterInfo {
  name: string
  status: number
  role?: 'photo' | 'letter' | null
}

// Helper to extract role config from a device's printers array
function getRoleConfig(printers: unknown): { photo: string | null; letter: string | null } {
  if (!Array.isArray(printers)) return { photo: null, letter: null }
  
  const photoPrinter = printers.find((p: any) => p.role === 'photo')
  const letterPrinter = printers.find((p: any) => p.role === 'letter')
  
  return {
    photo: photoPrinter?.name ?? null,
    letter: letterPrinter?.name ?? null,
  }
}

// Helper to extract print settings from a device's printSettings JSON
function getPrintSettings(printSettings: unknown): { photoSettings?: any; letterSettings?: any } {
  if (!printSettings || typeof printSettings !== 'object') return {}
  const ps = printSettings as any
  return {
    ...(ps.photo ? { photoSettings: ps.photo } : {}),
    ...(ps.letter ? { letterSettings: ps.letter } : {}),
  }
}

// Helper to update role in a device's printers array
function updatePrinterRole(
  printers: unknown,
  role: 'photo' | 'letter',
  printerName: string
): PrinterInfo[] {
  const arr: PrinterInfo[] = Array.isArray(printers) 
    ? (printers as PrinterInfo[]).map(p => ({ ...p }))
    : []
  
  // Remove this printer from any existing role
  const updated = arr.map((p) => {
    if (p.name === printerName) {
      return { ...p, role: null }
    }
    if (p.role === role) {
      return { ...p, role: null }
    }
    return p
  })
  
  // Find if printer exists in the array
  const existingIndex = updated.findIndex((p) => p.name === printerName)
  if (existingIndex >= 0) {
    updated[existingIndex] = { ...updated[existingIndex], role }
  } else {
    // Add printer with role (even if not detected yet)
    updated.push({ name: printerName, status: 0, role })
  }
  
  return updated
}

// Helper to remove a role from a device's printers array
function removePrinterRole(
  printers: unknown,
  role: 'photo' | 'letter'
): PrinterInfo[] {
  if (!Array.isArray(printers)) return []
  return (printers as PrinterInfo[]).map((p) => {
    if (p.role === role) {
      return { ...p, role: null }
    }
    return p
  })
}

// GET / - Get printer config for a device
router.get('/', async (req: Request, res: Response) => {
  try {
    const deviceId = req.query.deviceId as string | undefined
    
    if (!deviceId) {
      // Return global default (from default device or empty)
      const defaultDevice = await prisma.printDevice.findFirst({
        where: { isDefault: true }
      })
      if (!defaultDevice) {
        res.json({ photo: null, letter: null })
        return
      }
      const config = getRoleConfig(defaultDevice.printers)
      const settings = getPrintSettings(defaultDevice.printSettings)
      res.json({ ...config, ...settings })
      return
    }
    
    const device = await prisma.printDevice.findUnique({
      where: { deviceId }
    })
    
    if (!device) {
      res.json({ photo: null, letter: null })
      return
    }
    
    const config = getRoleConfig(device.printers)
    const settings = getPrintSettings(device.printSettings)
    res.json({ ...config, ...settings })
  } catch (err: any) {
    logger.error({ err }, 'printer_config_get_failed')
    res.status(500).json({ error: err.message })
  }
})

// PUT /:role - Set printer role for a device
router.put('/:role', async (req: Request, res: Response) => {
  try {
    const { role } = req.params
    if (role !== 'photo' && role !== 'letter') {
      res.status(400).json({ error: 'role deve ser photo ou letter' })
      return
    }

    const { printerName, isActive, deviceId } = req.body as {
      printerName?: string
      isActive?: boolean
      deviceId?: string
    }
    
    if (!printerName || typeof printerName !== 'string') {
      res.status(400).json({ error: 'printerName é obrigatório' })
      return
    }

    // Find target device
    let targetDeviceId = deviceId
    if (!targetDeviceId) {
      const defaultDevice = await prisma.printDevice.findFirst({
        where: { isDefault: true }
      })
      targetDeviceId = defaultDevice?.deviceId
    }
    
    if (!targetDeviceId) {
      res.status(400).json({ error: 'Nenhum dispositivo encontrado' })
      return
    }

    // Get current device
    const device = await prisma.printDevice.findUnique({
      where: { deviceId: targetDeviceId }
    })
    
    if (!device) {
      res.status(404).json({ error: 'Dispositivo não encontrado' })
      return
    }

    // Update printers array with new role
    const updatedPrinters = updatePrinterRole(device.printers, role as 'photo' | 'letter', printerName)
    
    await prisma.printDevice.update({
      where: { deviceId: targetDeviceId },
      data: { printers: updatedPrinters as any }
    })

    // Sync config to agent — target the specific device
    const config = getRoleConfig(updatedPrinters)
    const settings = getPrintSettings(device.printSettings)
    printAgentWSManager.sendToDevice(targetDeviceId, {
      type: 'PRINTER_CONFIG_UPDATE',
      config: { ...config, ...settings },
      timestamp: new Date().toISOString(),
    })

    res.json({ ...config, ...settings })
  } catch (err: any) {
    logger.error({ err }, 'printer_config_put_failed')
    res.status(500).json({ error: err.message })
  }
})

// PUT /:role/settings - Update print settings for a role on a device
router.put('/:role/settings', async (req: Request, res: Response) => {
  try {
    const { role } = req.params
    if (role !== 'photo' && role !== 'letter') {
      res.status(400).json({ error: 'role deve ser photo ou letter' })
      return
    }

    const { settings, deviceId } = req.body as {
      settings?: { paperSize?: string; orientation?: string; fitToPage?: boolean; customFlags?: string }
      deviceId?: string
    }

    let targetDeviceId = deviceId
    if (!targetDeviceId) {
      const defaultDevice = await prisma.printDevice.findFirst({
        where: { isDefault: true }
      })
      targetDeviceId = defaultDevice?.deviceId
    }

    if (!targetDeviceId) {
      res.status(400).json({ error: 'Nenhum dispositivo encontrado' })
      return
    }

    const device = await prisma.printDevice.findUnique({
      where: { deviceId: targetDeviceId }
    })

    if (!device) {
      res.status(404).json({ error: 'Dispositivo não encontrado' })
      return
    }

    // Merge settings into printSettings JSON
    const currentSettings = (device.printSettings as any) || {}
    const updatedSettings = {
      ...currentSettings,
      [role]: settings || null,
    }

    await prisma.printDevice.update({
      where: { deviceId: targetDeviceId },
      data: { printSettings: updatedSettings as any }
    })

    // Sync config to agent
    const config = getRoleConfig(device.printers)
    const allSettings = getPrintSettings(updatedSettings)
    printAgentWSManager.sendToDevice(targetDeviceId, {
      type: 'PRINTER_CONFIG_UPDATE',
      config: { ...config, ...allSettings },
      timestamp: new Date().toISOString(),
    })

    res.json({ ...config, ...allSettings })
  } catch (err: any) {
    logger.error({ err }, 'printer_config_settings_put_failed')
    res.status(500).json({ error: err.message })
  }
})

// DELETE /:role - Remove printer role from a device
router.delete('/:role', async (req: Request, res: Response) => {
  try {
    const { role } = req.params
    if (role !== 'photo' && role !== 'letter') {
      res.status(400).json({ error: 'role deve ser photo ou letter' })
      return
    }

    const deviceId = req.query.deviceId as string | undefined
    
    let targetDeviceId = deviceId
    if (!targetDeviceId) {
      const defaultDevice = await prisma.printDevice.findFirst({
        where: { isDefault: true }
      })
      targetDeviceId = defaultDevice?.deviceId
    }
    
    if (!targetDeviceId) {
      res.status(400).json({ error: 'Nenhum dispositivo encontrado' })
      return
    }

    const device = await prisma.printDevice.findUnique({
      where: { deviceId: targetDeviceId }
    })
    
    if (!device) {
      res.status(404).json({ error: 'Dispositivo não encontrado' })
      return
    }

    const updatedPrinters = removePrinterRole(device.printers, role as 'photo' | 'letter')
    
    await prisma.printDevice.update({
      where: { deviceId: targetDeviceId },
      data: { printers: updatedPrinters as any }
    })

    // Sync config to agent — target the specific device
    const config = getRoleConfig(updatedPrinters)
    const settings = getPrintSettings(device.printSettings)
    printAgentWSManager.sendToDevice(targetDeviceId, {
      type: 'PRINTER_CONFIG_UPDATE',
      config: { ...config, ...settings },
      timestamp: new Date().toISOString(),
    })

    res.json({ success: true })
  } catch (err: any) {
    logger.error({ err }, 'printer_config_delete_failed')
    res.status(500).json({ error: err.message })
  }
})

export function createPrinterConfigRoutes(parentRouter: Router) {
  parentRouter.use('/admin/printer-config', router)
}
