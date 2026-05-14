/**
 * Score 0–100 de intenção de compra por turno (heurísticas leves).
 */

export type PurchaseIntentSignals = {
  asksDeadline: boolean;
  mentionsRecipient: boolean;
  mentionsDate: boolean;
  sameProductReturns: number;
};

export function detectAsksDeadline(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\bprazo\b/.test(t) ||
    /\bquando\s+(chega|fica|entrega)\b/.test(t) ||
    /\b(em\s+)?quanto\s+tempo\b/.test(t) ||
    /\b(ainda)\s+d[aá]\s+tempo\b/.test(t)
  );
}

export function detectMentionsRecipient(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(para|pra)\s+(minha|meu|o|a)\s+/.test(t) ||
    /\b(esposa|marido|namorad|mãe|pai|filh|amig|chefe|aniversariante)\b/.test(t) ||
    /\bdestinat[aá]rio\b/.test(t)
  );
}

export function detectMentionsDate(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(t) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(t) ||
    /\b(hoje|amanh[ãa]|s[aá]bado|domingo|segunda|ter[cç]a|quarta|quinta|sexta)\b/.test(t)
  );
}

export function purchaseIntentScore(s: PurchaseIntentSignals): number {
  let sc = 0;
  if (s.asksDeadline) sc += 20;
  if (s.mentionsRecipient) sc += 15;
  if (s.mentionsDate) sc += 15;
  if (s.sameProductReturns >= 2) sc += 25;
  if (s.sameProductReturns >= 3) sc += 10;
  return Math.min(100, sc);
}

export function buildPurchaseIntentSignals(
  userMessage: string,
  sameProductReturns: number,
): PurchaseIntentSignals {
  return {
    asksDeadline: detectAsksDeadline(userMessage),
    mentionsRecipient: detectMentionsRecipient(userMessage),
    mentionsDate: detectMentionsDate(userMessage),
    sameProductReturns,
  };
}
