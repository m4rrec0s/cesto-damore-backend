/**
 * 💭 PHASE 3: Structured Thinking Service
 * 
 * Integra "raciocínio curto" estruturado ao prompt.
 * Formato interno que LLM vê mas cliente não:
 * 
 * ## Pensamento (PRIVADO):
 * [1-2 linhas de lógica]
 * 
 * ## Resposta:
 * [Resposta humanizada para cliente]
 */

export interface ThinkingContext {
  phase: string;
  sentimentDetected: string;
  clientHistory: string;
  currentProduct?: { name: string; price: number };
  lastMessageFromClient: string;
  sessionTurnCount: number;
}

export interface StructuredResponse {
  thinking: string;
  response: string;
  fullPrompt: string; // thinking + response juntos
}

export class StructuredThinkingService {
  private static instance: StructuredThinkingService;

  private constructor() {}

  static getInstance(): StructuredThinkingService {
    if (!StructuredThinkingService.instance) {
      StructuredThinkingService.instance = new StructuredThinkingService();
    }
    return StructuredThinkingService.instance;
  }

  /**
   * Gera prompt com pensamento estruturado
   * 
   * Instrui LLM a "pensar internamente" antes de responder.
   * O pensamento é visto apenas pelo LLM, não é enviado ao cliente.
   */
  generateThinkingPrompt(context: ThinkingContext): string {
    const thinkingTemplate = `
## ⚡ ESTRUTURA DE PENSAMENTO (PRIVADO — não mostre ao cliente)

Antes de responder, pense INTERNAMENTE em 1-2 frases sobre:
1. **Contexto**: Qual é a fase? (${context.phase})
2. **Sentimento**: Cliente está ${context.sentimentDetected}
3. **Estratégia**: O que faço nesta situação?
4. **Tom**: Qual persona devo usar?

EXEMPLO:
\`\`\`
## Pensamento (PRIVADO):
Cliente em CURATION, indeciso entre 2 opções. Devo comparar benefício, não preço. Vou usar Bianca (especialista).

## Resposta:
[Resposta humanizada para cliente...]
\`\`\`

⚠️ IMPORTANTE:
- O cliente NÃO vê "Pensamento (PRIVADO)" na resposta final
- Você escreve só "## Resposta:" ou direto a resposta
- O "Pensamento" é apenas para você organizar a lógica

---
`;

    return thinkingTemplate;
  }

  /**
   * Injeta contexto de pensamento no prompt principal
   */
  injectThinkingIntoSystemPrompt(
    systemPrompt: string,
    context: ThinkingContext
  ): string {
    const thinkingSection = this._generateThinkingGuidelines(context);
    
    // Insere após as instruções de execução silenciosa
    const insertPoint = systemPrompt.indexOf("## EXECUÇÃO SILENCIOSA");
    if (insertPoint > -1) {
      return (
        systemPrompt.substring(0, insertPoint) +
        thinkingSection +
        systemPrompt.substring(insertPoint)
      );
    }

    return systemPrompt + "\n\n" + thinkingSection;
  }

  /**
   * Gera guidelines específicas por fase e sentimento
   */
  private _generateThinkingGuidelines(context: ThinkingContext): string {
    const guidelines: Record<string, string> = {
      DISCOVERY: `
## 💭 PENSAMENTO PARA DISCOVERY (Ana)

Antes de responder, pense:
1. O cliente disse o mínimo de contexto?
2. Preciso pedir mais detalhes ou posso já chamar catálogo?
3. Estou em tom meigo + curioso (não robô)?
4. Faço UMA pergunta por vez?
      `.trim(),

      CURATION: `
## 💭 PENSAMENTO PARA CURATION (Bianca)

Antes de responder, pense:
1. Tenho produtos já? Se não, chamo rank_products_for_curation()
2. Vou apresentar 2 opções no máximo?
3. Cada opção tem justificativa ("essa combina porque...")?
4. Cliente está pronto para produto definido ou ainda indeciso?
      `.trim(),

      CUSTOMIZATION: `
## 💭 PENSAMENTO PARA CUSTOMIZATION (Lucas)

Antes de responder, pense:
1. Produto já está 100% confirmado?
2. Devo oferecer customização agora? (com prazo!)
3. Se cliente disse "não", respeito e sigo adiante?
4. Timeline é clara: "Produto hoje + caneca sábado"?
      `.trim(),

      CHECKOUT: `
## 💭 PENSAMENTO PARA CHECKOUT (Alice)

Antes de responder, pense:
1. Já coleti este dado ou estou repetindo?
2. Preciso validar com tool (date, time, freight)?
3. Devo mostrar RESUMO estruturado agora?
4. Cliente confirmou explicitamente antes de finalize_checkout()?
      `.trim()
    };

    const sentiment_overrides: Record<string, string> = {
      happy: `
ℹ️ SENTIMENTO: Cliente HAPPY
→ Compartilhe entusiasmo! 'Que legal mesmo!', 'Adorei sua energia!'
→ Use emojis alegres: 💕, 🥰, ✨
→ Ritmo rápido, dinâmico
      `.trim(),

      confused: `
ℹ️ SENTIMENTO: Cliente CONFUSED
→ Seja didático, paciencioso, com exemplos simples
→ Rephrase a ideia: 'Deixa eu descrever de outro jeito...'
→ Use estrutura clara (bullets, steps)
→ Sem pressa
      `.trim(),

      frustrated: `
ℹ️ SENTIMENTO: Cliente FRUSTRATED
→ Ação imediata, sem blá blá. 'Certo, vou resolver isso agora.'
→ Seja direto: problema → solução
→ Use ✅ como confirmação
→ Ritmo rápido, eficiente
      `.trim()
    };

    let result = guidelines[context.phase] || "";
    const sentiment = sentiment_overrides[context.sentimentDetected];
    if (sentiment) {
      result += "\n\n" + sentiment;
    }

    return result;
  }

  /**
   * Extrai "pensamento" de resposta que pode ter incluído
   */
  extractThinkingFromResponse(fullResponse: string): {
    thinking: string;
    response: string;
  } {
    // Procura por padrão "## Pensamento (PRIVADO):"
    const thinkingMatch = fullResponse.match(
      /##\s*Pensamento\s*\(PRIVADO\):([\s\S]*?)(?:##\s*Resposta:|$)/
    );

    if (thinkingMatch) {
      const thinking = thinkingMatch[1].trim();
      const responseStart = fullResponse.indexOf("## Resposta:");
      const response = responseStart > -1
        ? fullResponse.substring(responseStart + 12).trim()
        : fullResponse.replace(thinkingMatch[0], "").trim();

      return { thinking, response };
    }

    // Se não tiver o padrão, retorna tudo como resposta
    return { thinking: "", response: fullResponse };
  }

  /**
   * Gera exemplo de resposta com pensamento estruturado
   */
  generateExample(phase: string): StructuredResponse {
    const examples: Record<string, StructuredResponse> = {
      DISCOVERY: {
        thinking: "Cliente quer presentear alguém mas não deu detalhes. Preciso entender: pra quem? Qual ocasião? Vou perguntar UMA coisa (Bianca style: meiga, curiosa).",
        response: "Que legal! Me conta aí: pra quem é esse presentinho especial? 😊",
        fullPrompt: `## Pensamento (PRIVADO):
Cliente quer presentear alguém mas não deu detalhes. Preciso entender: pra quem? Qual ocasião? Vou perguntar UMA coisa (Bianca style: meiga, curiosa).

## Resposta:
Que legal! Me conta aí: pra quem é esse presentinho especial? 😊`
      },

      CURATION: {
        thinking: "Cliente está indeciso entre caneca e quadro. Ambos com foto. Vou comparar: caneca leva 6h extra, quadro é pronta entrega. Diferença de preço? Benefício?",
        response: "Ótimo! Deixa eu mostrar a diferença! 💭\n\nEssa primeira (quadro) é pronta entrega — ideal se é pra amanhã. Essa segunda (caneca) leva 6h a mais (fica MUITO legal). Qual seu vibe: rápido ou super especial?",
        fullPrompt: `## Pensamento (PRIVADO):
Cliente está indeciso entre caneca e quadro. Ambos com foto. Vou comparar: caneca leva 6h extra, quadro é pronta entrega. Diferença de preço? Benefício?

## Resposta:
Ótimo! Deixa eu mostrar a diferença! 💭

Essa primeira (quadro) é pronta entrega — ideal se é pra amanhã. Essa segunda (caneca) leva 6h a mais (fica MUITO legal). Qual seu vibe: rápido ou super especial?`
      },

      CUSTOMIZATION: {
        thinking: "Produto confirmado (caneca de café). Cliente perguntou: 'posso adicionar foto?'. Sim, mas 6h comerciais. Devo avisar antes de oferecer (não surpresa de frete/preço).",
        response: "Sim! A gente coloca sua foto na caneca. Vai ficar incrível! ✨ A única coisa é: leva 6h a mais (manda a foto quando finalizar). Quer mesmo?",
        fullPrompt: `## Pensamento (PRIVADO):
Produto confirmado (caneca de café). Cliente perguntou: 'posso adicionar foto?'. Sim, mas 6h comerciais. Devo avisar antes de oferecer (não surpresa de frete/preço).

## Resposta:
Sim! A gente coloca sua foto na caneca. Vai ficar incrível! ✨ A única coisa é: leva 6h a mais (manda a foto quando finalizar). Quer mesmo?`
      },

      CHECKOUT: {
        thinking: "Alice, coleta final. Falta ENDEREÇO. Já temos: produto (buquê), data (segunda), horário (10h), pagamento (PIX). Depois calcular frete.",
        response: "Perfeito! Então buquê na segunda às 10h por PIX. Agora me passa o endereço: é em Campina Grande? Qual bairro? 📍",
        fullPrompt: `## Pensamento (PRIVADO):
Alice, coleta final. Falta ENDEREÇO. Já temos: produto (buquê), data (segunda), horário (10h), pagamento (PIX). Depois calcular frete.

## Resposta:
Perfeito! Então buquê na segunda às 10h por PIX. Agora me passa o endereço: é em Campina Grande? Qual bairro? 📍`
      }
    };

    return examples[phase] || examples.DISCOVERY;
  }
}

export default StructuredThinkingService.getInstance();
