import type OpenAI from "openai";
import type { SalesPhase } from "../../services/phaseGateService";
import type { EmotionalState } from "../../types/emotionalState";
import { OPENAI_MODELS } from "../config/openai";
import logger from "../../utils/logger";

const INTERNAL_COT_SYSTEM = `Você é um orquestrador interno de vendas. Responda APENAS com um JSON com as chaves:
phase_focus, product_in_focus, customer_signal, strategy.
Não invente produtos; product_in_focus pode ser "n/a".
Texto curto em português (1 frase por campo onde couber).`;

export type InternalCoTResult = {
  phase_focus: string;
  product_in_focus: string;
  customer_signal: string;
  strategy: string;
};

export async function runInternalCoT(
  openai: OpenAI,
  params: {
    userMessage: string;
    phase: SalesPhase;
    emotion: EmotionalState;
    intentScore: number;
    memoryCompact: string;
  },
): Promise<InternalCoTResult | null> {
  if (process.env.INTERNAL_COT_ENABLED !== "true") return null;
  try {
    const controller = new AbortController();
    const timeoutMs = Number(process.env.INTERNAL_COT_TIMEOUT_MS || "4000");
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODELS.promptOrchestration,
      temperature: 0.2,
      max_tokens: 220,
      messages: [
        { role: "system", content: INTERNAL_COT_SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            user_message: params.userMessage,
            phase: params.phase,
            emotion: params.emotion,
            intent_score: params.intentScore,
            memory_compact: params.memoryCompact,
          }),
        },
      ],
      response_format: { type: "json_object" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InternalCoTResult>;
    if (
      !parsed.phase_focus ||
      !parsed.product_in_focus ||
      !parsed.customer_signal ||
      !parsed.strategy
    ) {
      return null;
    }
    return {
      phase_focus: String(parsed.phase_focus),
      product_in_focus: String(parsed.product_in_focus),
      customer_signal: String(parsed.customer_signal),
      strategy: String(parsed.strategy),
    };
  } catch (e) {
    logger.warn(`[internalCoT] skipped: ${e}`);
    return null;
  }
}

export function formatInternalCoTForPrompt(cot: InternalCoTResult): string {
  return `### RACIOCINIO_INTERNO_ORQUESTRACAO (nao repita nem cite ao cliente)
${JSON.stringify(cot)}`;
}
