import type { AgentContext } from "../core/types";
import { composeMemoryBlock } from "../core/memory/composer";
import { loadPrompt } from "./loader";
import TokenEstimator from "../../utils/tokenEstimator";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const MAX_SYSTEM_PROMPT_TOKENS = 4000;

const PROMPT_BLOCKS = [
  "ana/identity.md",
  "ana/security.md",
  "ana/sales_behavior.md",
  "react/format.md",
  "react/few_shots.md",
  "ana/whatsapp_format.md",
] as const;

export function buildSystemPrompt(context: AgentContext): string {
  const now = new Date();
  const vars: Record<string, string> = {
    cliente_nome: context.customerName || "cliente",
    data_hoje: format(now, "dd/MM/yyyy (EEEE)", { locale: ptBR }),
    horario_comercial: "Seg-Sex 08:30-12:00 / 14:00-17:00 | Sáb 08:00-11:00",
  };

  const sections: string[] = [];
  let tokensUsed = 0;

  for (const block of PROMPT_BLOCKS) {
    try {
      const content = loadPrompt(block, vars);
      const est = TokenEstimator.estimate(content).tokenEstimate;
      if (tokensUsed + est > MAX_SYSTEM_PROMPT_TOKENS) break;
      sections.push(content);
      tokensUsed += est;
    } catch {
      // File not found — skip gracefully during dev
    }
  }

  // Append memory block with remaining budget
  const memoryBudget = MAX_SYSTEM_PROMPT_TOKENS - tokensUsed;
  if (memoryBudget > 100) {
    const memoryBlock = composeMemoryBlock(
      context.longTerm,
      context.shortTerm.getWindow(600),
    );
    if (memoryBlock) {
      const est = TokenEstimator.estimate(memoryBlock).tokenEstimate;
      if (est <= memoryBudget) {
        sections.push(memoryBlock);
      }
    }
  }

  return sections.join("\n\n---\n\n");
}
