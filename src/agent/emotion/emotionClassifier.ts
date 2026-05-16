import type { EmotionalState } from "../../types/emotionalState";

export function classifyEmotionHeuristic(text: string): EmotionalState {
  const t = (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    /\b(urgente|corre|ja estou atrasad\w*|sem tempo|logo|preciso ja)\b/.test(
      t,
    ) ||
    /\b(rapido|rapida)\b.*\b(hoje|agora|ja)\b/.test(t)
  ) {
    return "apressado";
  }
  if (
    /\b(nao entendi|problema|ruim|pessimo|reclama|irritad|absurdo|horrivel|demor|errado)\b/.test(
      t,
    )
  ) {
    return "frustrado";
  }
  if (
    /\b(nao sei|talvez|indecis\w*|duvid\w*|qual deles|nao tenho certeza|entre um|entre uma|ou esse|ou essa|poderia ser)\b/.test(
      t,
    )
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
