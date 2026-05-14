import prisma from "../../database/prisma";
import openClawMemoryService from "../../services/openClawMemoryService";
import type { IMemoryProvider, CustomerProfileCompact } from "./IMemoryProvider";

function buildMergedBlock(fileBlock: string, dbSummary: string | null): string {
  const db = dbSummary?.trim();
  if (!db) return fileBlock;
  return `${fileBlock}\n\n### CUSTOMER_MEMORY_DB\n${db.slice(0, 1200)}`;
}

export class CompositeMemoryProvider implements IMemoryProvider {
  async loadCustomerProfileCompact(phone: string): Promise<CustomerProfileCompact> {
    const fileMem = await openClawMemoryService.getCustomerMemory(phone);
    const fileBlock = openClawMemoryService.buildCustomerPrompt(fileMem);
    const row = await prisma.customerMemory.findUnique({
      where: { customer_phone: phone },
      select: { summary: true },
    });
    const dbSummary = row?.summary ?? null;
    return {
      fileBlock,
      dbSummary,
      mergedPromptBlock: buildMergedBlock(fileBlock, dbSummary),
    };
  }

  async appendMicropreference(phone: string, entry: string): Promise<void> {
    const trimmed = entry.trim();
    if (!trimmed || !phone) return;
    const memory = await openClawMemoryService.getCustomerMemory(phone);
    const line = `pref:${trimmed}`;
    const prefs = memory.inferredPreferences.filter((p) => p !== line);
    prefs.unshift(line);
    memory.inferredPreferences = prefs.slice(0, 30);
    memory.lastUpdatedAt = new Date().toISOString();
    await openClawMemoryService.saveCustomerMemory(phone, memory);
  }
}

export const defaultMemoryProvider: IMemoryProvider = new CompositeMemoryProvider();
