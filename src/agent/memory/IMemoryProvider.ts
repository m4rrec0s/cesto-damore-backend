import type { CustomerMemoryState } from "../../services/openClawMemoryService";

/** Perfil compacto para injeção no system prompt (arquivo + DB). */
export type CustomerProfileCompact = {
  fileBlock: string;
  dbSummary: string | null;
  mergedPromptBlock: string;
};

export interface IMemoryProvider {
  loadCustomerProfileCompact(phone: string): Promise<CustomerProfileCompact>;
  /** Micropreferência curta (ex.: pref:budget_hint=150-200) */
  appendMicropreference(phone: string, entry: string): Promise<void>;
}
