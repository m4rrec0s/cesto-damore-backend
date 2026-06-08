const SENSITIVE_PATTERNS = [
  /chave\s*pix[:\s]*[\w@.\-]+/i,
  /cpf[:\s]*\d{3}\.?\d{3}\.?\d{3}-?\d{2}/i,
  /cnpj[:\s]*\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/i,
  /conta[:\s]*\d{4,}/i,
  /agência[:\s]*\d{3,}/i,
  /senha[:\s]*\S+/i,
];

const INTERNAL_LEAK_PATTERNS = [
  /\bsystem\s*prompt\b/i,
  /\bmcp[_\s]?server\b/i,
  /\btool_call\b/i,
  /\bAgente-Catalogo\b/,
  /\bfunction\s*calling\b/i,
  /\breact\s*loop\b/i,
  /\bbaseAgent\b/,
  /\bopenai\b/i,
  /\bgpt-4/i,
];

const PRICE_MANIPULATION_PATTERNS = [
  /desconto\s*(de\s*)?\d+%?\s*(aprovado|confirmado|autorizado)/i,
  /preço\s*especial\s*(de\s*)?R?\$?\s*\d/i,
];

export function safetyGuard(text: string): string {
  // Block sensitive data
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      text = text.replace(pattern, "[DADOS PROTEGIDOS]");
    }
  }

  // Block internal architecture leaks
  for (const pattern of INTERNAL_LEAK_PATTERNS) {
    if (pattern.test(text)) {
      text = text.replace(pattern, "");
    }
  }

  // Block unauthorized price confirmations
  for (const pattern of PRICE_MANIPULATION_PATTERNS) {
    if (pattern.test(text)) {
      return "Preciso confirmar esse valor com nosso especialista! Um momento 💕";
    }
  }

  return text.replace(/\n{3,}/g, "\n\n").trim();
}
