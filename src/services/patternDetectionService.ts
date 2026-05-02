import prisma from "../database/prisma";
import logger from "../utils/logger";
import { createOpenAIClient } from "../config/openai";
import improvementProposalService from "./improvementProposalService";

interface PatternData {
  type: string;
  content: string;
  reasoning: string;
  confidence: number;
}

const REPITIVE_THRESHOLD = 3;
const OBJECTION_THRESHOLD = 5;

class PatternDetectionService {
  private openai = createOpenAIClient();

  async detectPatterns(sessionId: string, aiResponse: string): Promise<void> {
    try {
      const session = await prisma.aIAgentSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        logger.warn(`[PatternDetection] Session not found: ${sessionId}`);
        return;
      }

      const recentMessages = await prisma.aIAgentMessage.findMany({
        where: { session_id: sessionId },
        orderBy: { created_at: "desc" },
        take: 20,
      });

      const userMessages = recentMessages
        .filter((m) => m.role === "user")
        .map((m) => m.content);

      const repetitivePattern = await this.detectRepetitiveQuestions(
        userMessages,
        session.customer_phone
      );
      if (repetitivePattern) {
        await this.createProposal(repetitivePattern, sessionId, session.customer_phone);
      }

      const objectionPattern = await this.detectCommonObjections(
        aiResponse,
        userMessages
      );
      if (objectionPattern) {
        await this.createProposal(objectionPattern, sessionId, session.customer_phone);
      }

      const uncoveredPattern = await this.detectUncoveredScenarios(
        userMessages,
        aiResponse
      );
      if (uncoveredPattern) {
        await this.createProposal(uncoveredPattern, sessionId, session.customer_phone);
      }

      const successPattern = await this.detectSuccessPatterns(
        userMessages,
        aiResponse
      );
      if (successPattern) {
        await this.createProposal(successPattern, sessionId, session.customer_phone);
      }
    } catch (error) {
      logger.error(`[PatternDetection] Error detecting patterns: ${error}`);
    }
  }

  private async detectRepetitiveQuestions(
    userMessages: string[],
    customerPhone: string | null
  ): Promise<PatternData | null> {
    if (userMessages.length < 3) return null;

    const recentQuestions = userMessages.slice(0, 5);
    const text = recentQuestions.join(" ").toLowerCase();

    const commonPhrases = [
      "quanto custa",
      "quanto é",
      "preço",
      "valor",
      "frete",
      "entrega",
      "horário",
      "funciona",
    ];

    let matchCount = 0;
    for (const phrase of commonPhrases) {
      const regex = new RegExp(phrase, "gi");
      const matches = text.match(regex);
      if (matches && matches.length >= REPITIVE_THRESHOLD) {
        matchCount++;
      }
    }

    if (matchCount >= 2) {
      const content = this.generateRepetitivePatternContent(commonPhrases.slice(0, 2));
      return {
        type: "repetitive_question",
        content,
        reasoning: `Cliente perguntou sobre "${commonPhrases.slice(0, 2).join(", ")}" ${matchCount} vezes`,
        confidence: 0.7,
      };
    }

    return null;
  }

  private async detectCommonObjections(
    aiResponse: string,
    userMessages: string[]
  ): Promise<PatternData | null> {
    const responseLower = aiResponse.toLowerCase();
    const userLower = userMessages.join(" ").toLowerCase();

    const objectionPatterns = [
      { trigger: /muito caro|caro|preço alto|valor alto/i, name: "preço" },
      { trigger: /demora|tempo|muit[ao] tempo/i, name: "tempo" },
      { trigger: /não sei|duvida|não entendi/i, name: "dúvida" },
      { trigger: /pensar|ver|consultar/i, name: "indecisão" },
    ];

    const userObjections = userLower.split(/\.|\?|!/).filter((sentence) =>
      objectionPatterns.some((p) => p.trigger.test(sentence))
    );

    if (userObjections.length >= OBJECTION_THRESHOLD) {
      const objectionType = objectionPatterns.find((p) =>
        p.trigger.test(userObjections.join(" "))
      );

      const content = this.generateObjectionPatternContent(
        objectionType?.name || "objection"
      );

      return {
        type: "common_objection",
        content,
        reasoning: `${userObjections.length} objeções detectadas do tipo "${objectionType?.name || "desconhecido"}"`,
        confidence: 0.8,
      };
    }

    return null;
  }

  private async detectUncoveredScenarios(
    userMessages: string[],
    aiResponse: string
  ): Promise<PatternData | null> {
    if (userMessages.length < 2) return null;

    const lastUserMessage = userMessages[userMessages.length - 1];
    const responseLower = aiResponse.toLowerCase();

    const uncoveredTriggers = [
      /não sei responder|não tenho essa informação|não consigo responder/i,
      /não encontrei|não localizei|não encontrei informações/i,
      /não sei te ajudar|infelizmente não|não é possível/i,
    ];

    const isUncovered = uncoveredTriggers.some((trigger) =>
      trigger.test(responseLower)
    );

    if (isUncovered) {
      const content = this.generateUncoveredContent(lastUserMessage);

      return {
        type: "uncovered_scenario",
        content,
        reasoning: `IA não conseguiu responder adequadamente à pergunta: "${lastUserMessage.substring(0, 50)}..."`,
        confidence: 0.75,
      };
    }

    return null;
  }

  private async detectSuccessPatterns(
    userMessages: string[],
    aiResponse: string
  ): Promise<PatternData | null> {
    const responseLower = aiResponse.toLowerCase();

    const successIndicators = [
      /perfeito|vou fazer|vou querer|confirmo|acerto/i,
      /pedido|orçamento|finalizar/i,
    ];

    const hasSuccessIndicator = successIndicators.some((indicator) =>
      indicator.test(responseLower)
    );

    if (hasSuccessIndicator) {
      const content = this.generateSuccessPatternContent();

      return {
        type: "success_pattern",
        content,
        reasoning: "Detectada resposta bem-sucedida que resultou em conversão",
        confidence: 0.6,
      };
    }

    return null;
  }

  private async createProposal(
    pattern: PatternData,
    sessionId: string,
    customerPhone: string | null
  ): Promise<void> {
    const recentProposals = await prisma.improvementProposal.findMany({
      where: {
        session_id: sessionId,
        proposal_type: pattern.type,
      },
      orderBy: { detected_at: "desc" },
      take: 1,
    });

    if (recentProposals.length > 0) {
      const lastProposal = recentProposals[0];
      const hoursSinceLastProposal =
        (Date.now() - lastProposal.detected_at.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastProposal < 24) {
        logger.info(
          `[PatternDetection] Skipping duplicate proposal (within 24h): ${pattern.type}`
        );
        return;
      }
    }

    await improvementProposalService.createProposal({
      sessionId,
      customerPhone: customerPhone || undefined,
      proposalType: pattern.type as any,
      suggestedContent: pattern.content,
      reasoning: pattern.reasoning,
    });

    logger.info(`[PatternDetection] Created proposal for pattern: ${pattern.type}`);
  }

  private generateRepetitivePatternContent(topPhrases: string[]): string {
    return `# Padrão de Perguntas Repetitivas

## Problema Detectado
Cliente pergunta frequentemente sobre: ${topPhrases.join(", ")}

## Recomendação
Criar documento FAQ detalhado com respostas rápidas e claras para estas perguntas frequentes.

## Conteúdo Sugerido

### FAQ - Perguntas Frequentes

**Quanto custa?**
Nossos produtos têm preços que variam conforme tamanho e personalização. Os valores começam a partir de R$ 89,90 para cestas básicas.

**Qual o prazo de entrega?**
Entregamos em até 48 horas para João Pessoa e região. Para outras cidades, consulte o prazo específico.

**Quais formas de pagamento?**
Aceitamos PIX, cartão de crédito em até 12x, e dinheiro na retirada.

**Vocês entregam em [cidade]?**
Consulte nossa área de cobertura. Entregamos em João Pessoa, Bayeux, Santa Rita e cidades vizinhas.

---
*Gerado automaticamente em ${new Date().toISOString().split("T")[0]}*
`;
  }

  private generateObjectionPatternContent(objectionType: string): string {
    return `# Objeção Comum: ${objectionType.toUpperCase()}

## Problema Detectado
Cliente apresenta objeções recorrentes relacionadas a: ${objectionType}

## Recomendação
Criar documento de objeções com respostas estruturadas para superar essa barreira.

## Respostas Recomendadas

### Para objeção de "${objectionType}":

1. **Reconhecer a preocupação**
   "Entendo sua preocupação sobre ${objectionType}..."

2. **Oferecer solução**
   [Adicionar resposta específica baseada no tipo de objeção]

3. **Demonstrar valor**
   "Nosso produto oferece..."

4. **Fechar pergunta**
   "Posso te ajudar com mais alguma informação?"

---
*Gerado automaticamente em ${new Date().toISOString().split("T")[0]}*
`;
  }

  private generateUncoveredContent(userQuestion: string): string {
    return `# Cenário Não Coberto

## Pergunta do Cliente
"${userQuestion.substring(0, 200)}"

## Problema Detectado
A IA não conseguiu responder adequadamente a esta pergunta.

## Recomendação
Criar documento de conhecimento para cobrir este cenário.

## Conteúdo Sugerido
[Adicionar resposta apropriada para esta questão]

---
*Gerado automaticamente em ${new Date().toISOString().split("T")[0]}*
`;
  }

  private generateSuccessPatternContent(): string {
    return `# Padrão de Sucesso

## Contexto
Detectada resposta que levou à conversão/compras.

## Elementos que funcionaram
- Linguagem clara e direta
- Foco no benefício do cliente
- Call-to-action claro

## Recomendação
Documentar este padrão para参考 em treinamentos futuros.

---
*Gerado automaticamente em ${new Date().toISOString().split("T")[0]}*
`;
  }
}

export default new PatternDetectionService();