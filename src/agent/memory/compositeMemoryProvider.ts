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
    const [fileMem, row] = await Promise.all([
      openClawMemoryService.getCustomerMemory(phone),
      prisma.customerMemory.findUnique({
        where: { customer_phone: phone },
        select: { summary: true },
      }),
    ]);
    const fileBlock = openClawMemoryService.buildCustomerPrompt(fileMem);
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

    const normalizedEntry = trimmed.replace(/^pref:/i, "");
    const prefLine = `pref:${normalizedEntry}`;
    const prefKey = prefLine.split("=")[0];
    const memory = await openClawMemoryService.getCustomerMemory(phone);
    const existingSameValue = memory.inferredPreferences.some(
      (pref) => pref === prefLine || pref.startsWith(`${prefLine} @ `),
    );
    if (existingSameValue) return;

    const stampedLine = `${prefLine} @ ${new Date().toISOString()}`;
    const prefs = memory.inferredPreferences.filter(
      (p) => !p.startsWith(`${prefKey}=`),
    );
    prefs.unshift(stampedLine);
    memory.inferredPreferences = prefs.slice(0, 30);
    memory.lastUpdatedAt = new Date().toISOString();
    await openClawMemoryService.saveCustomerMemory(phone, memory);
  }
}

export const defaultMemoryProvider: IMemoryProvider = new CompositeMemoryProvider();
