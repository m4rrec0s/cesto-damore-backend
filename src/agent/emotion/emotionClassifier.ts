import type { EmotionalState } from "../../types/emotionalState";

export function classifyEmotionHeuristic(text: string): EmotionalState {
  const t = (text || "").toLowerCase();
  if (
    /\b(rápido|rápida|urgente|corre|já estou atrasad|sem tempo|logo)\b/.test(t)
  ) {
    return "apressado";
  }
  if (
    /\b(não entendi|nao entendi|problema|ruim|péssimo|pessimo|reclama|irritad|absurdo)\b/.test(
      t,
    )
  ) {
    return "frustrado";
  }
  if (
    /\b(não sei|nao sei|talvez| ou |entre |duvid|dúvid|indecis)\b/.test(t)
  ) {
    return "indeciso";
  }
  return "animado";
}

export function buildEmotionalTonePromptBlock(state: EmotionalState): string {
  const rules: Record<EmotionalState, string> = {
    animado:
      "Tom: entusiasmo genuíno, celebre a ocasião com leveza (sem exagerar em emojis).",
    indeciso:
      "Tom: consultivo e paciente; ofereça no máximo 2 caminhos claros; evite pressa.",
    frustrado:
      "Tom: empático em primeiro lugar; reconheça o incômodo; respostas curtas; ofereça handoff humano se persistir.",
    apressado:
      "Tom: objetivo; prefira bullets curtos; vá direto ao próximo passo útil.",
  };
  return `### TOM_ATENDIMENTO\nestado_emocional: ${state}\n${rules[state]}`;
}
