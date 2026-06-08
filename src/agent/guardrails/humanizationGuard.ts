const ROBOTIC_PATTERNS = [
  /um momento, vou/i,
  /deixe-?me buscar/i,
  /processando sua solicitação/i,
  /acionando a ferramenta/i,
  /chamando o agente/i,
  /consultando o banco de dados/i,
  /aguarde enquanto/i,
  /como posso ajudá-?lo/i,
  /estou aqui para/i,
  /\[.*?(buscando|processando|chamando).*?\]/i,
];

const ROBOTIC_WORDS = ["será feito", "solicitar", "requisição", "sistema", "processamento"];

const REPLACEMENTS: [RegExp, string][] = [
  [/\bpor favor aguarde\b/gi, ""],
  [/\bestou processando\b/gi, ""],
  [/\bconforme solicitado\b/gi, ""],
];

export function humanizationGuard(text: string): string {
  let result = text;

  // Remove robotic phrases
  for (const pattern of ROBOTIC_PATTERNS) {
    if (pattern.test(result)) {
      result = result.replace(pattern, "").trim();
    }
  }

  // Apply replacements
  for (const [pattern, replacement] of REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }

  // Clean up extra whitespace/newlines left by removals
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  return result;
}
