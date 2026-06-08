import type { LongTermProfile, ChatMessage } from "../types";
import TokenEstimator from "../../../utils/tokenEstimator";

const MAX_MEMORY_TOKENS = 1200;

export function composeMemoryBlock(
  longTerm: LongTermProfile,
  shortTermMessages: ChatMessage[],
): string {
  const sections: string[] = [];
  let tokensUsed = 0;

  // Priority 1: Long-term profile
  const profileBlock = buildProfileBlock(longTerm);
  if (profileBlock) {
    const est = TokenEstimator.estimate(profileBlock).tokenEstimate;
    if (est <= MAX_MEMORY_TOKENS) {
      sections.push(profileBlock);
      tokensUsed += est;
    }
  }

  // Priority 2: Recent conversation summary
  const remaining = MAX_MEMORY_TOKENS - tokensUsed;
  if (remaining > 50 && shortTermMessages.length > 0) {
    const historyBlock = buildHistoryBlock(shortTermMessages, remaining);
    if (historyBlock) sections.push(historyBlock);
  }

  return sections.join("\n\n");
}

function buildProfileBlock(profile: LongTermProfile): string | null {
  const lines: string[] = [];

  if (profile.summary) {
    lines.push(`[Perfil do Cliente]\n${profile.summary}`);
  }
  if (profile.preferredPhrases.length > 0) {
    lines.push(`[Frases que funcionam]\n${profile.preferredPhrases.slice(0, 5).join("; ")}`);
  }
  if (profile.commonObjections.length > 0) {
    lines.push(`[Objeções comuns]\n${profile.commonObjections.slice(0, 5).join("; ")}`);
  }
  if (profile.successPatterns.length > 0) {
    lines.push(`[Padrões de sucesso]\n${profile.successPatterns.slice(0, 5).join("; ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

function buildHistoryBlock(
  messages: ChatMessage[],
  maxTokens: number,
): string | null {
  const lines: string[] = [];
  let tokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "tool") continue;
    const line = `${msg.role}: ${msg.content}`;
    const est = TokenEstimator.estimate(line).tokenEstimate;
    if (tokens + est > maxTokens) break;
    tokens += est;
    lines.unshift(line);
  }

  if (lines.length === 0) return null;
  return `[Histórico recente]\n${lines.join("\n")}`;
}
