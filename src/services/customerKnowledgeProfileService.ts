import prisma from "../database/prisma";
import logger from "../utils/logger";
import { createOpenAIClient } from "../config/openai";
import obsidianKnowledgeService from "./obsidianKnowledgeService";

interface Learning {
  patterns: string[];
  successfulPhrases: string[];
  objectionsHandled: string[];
  upsellsThatWorked: string[];
  preferredProducts: string[];
  preferences: Record<string, string>;
}

class CustomerKnowledgeProfileService {
  private openai = createOpenAIClient();

  async getOrCreateProfile(customerPhone: string) {
    let profile = await prisma.customerKnowledgeProfile.findUnique({
      where: { customer_phone: customerPhone },
    });

    if (!profile) {
      profile = await prisma.customerKnowledgeProfile.create({
        data: {
          customer_phone: customerPhone,
          learnings: JSON.stringify({
            patterns: [],
            successfulPhrases: [],
            objectionsHandled: [],
            upsellsThatWorked: [],
            preferredProducts: [],
            preferences: {},
          }),
          preferred_phrases: [],
          common_objections: [],
          success_patterns: [],
          last_updated_by: "SYSTEM",
          auto_updates: true,
        },
      });
    }

    return profile;
  }

  async learnFromSession(sessionId: string): Promise<void> {
    try {
      const session = await prisma.aIAgentSession.findUnique({
        where: { id: sessionId },
      });

      if (!session?.customer_phone) {
        logger.warn(`[CustomerKnowledgeProfile] No customer phone for session: ${sessionId}`);
        return;
      }

      const messages = await prisma.aIAgentMessage.findMany({
        where: { session_id: sessionId },
        orderBy: { created_at: "asc" },
      });

      const hasConversion = this.detectConversion(messages);
      const hasObjections = this.detectObjections(messages);

      if (!hasConversion && !hasObjections) {
        logger.info(`[CustomerKnowledgeProfile] No significant learning from session: ${sessionId}`);
        return;
      }

      const learnings = await this.extractLearnings(messages);

      await this.updateProfile(session.customer_phone, learnings, hasConversion);
      await this.updateGeneralKnowledge(learnings, hasConversion);

      logger.info(`[CustomerKnowledgeProfile] Learned from session: ${sessionId}`);
    } catch (error) {
      logger.error(`[CustomerKnowledgeProfile] Error learning from session: ${error}`);
    }
  }

  private detectConversion(messages: any[]): boolean {
    const assistantMessages = messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content.toLowerCase());

    const conversionIndicators = [
      "perfeito",
      "pedido",
      "vou fazer",
      "vou querer",
      "confirmo",
      "acerto",
      "finalizar",
    ];

    return assistantMessages.some((msg) =>
      conversionIndicators.some((indicator) => msg.includes(indicator))
    );
  }

  private detectObjections(messages: any[]): boolean {
    const userMessages = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content.toLowerCase());

    const objectionIndicators = [
      "caro",
      "muito",
      "pensar",
      "duvida",
      "não sei",
      "né",
    ];

    const objectionCount = userMessages.filter((msg) =>
      objectionIndicators.some((indicator) => msg.includes(indicator))
    ).length;

    return objectionCount >= 2;
  }

  private async extractLearnings(messages: any[]): Promise<Learning> {
    const conversation = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n")
      .slice(0, 3000);

    const systemPrompt = `Analise estas mensagens de uma conversa de atendimento e extraia aprendizados em JSON:
    
${conversation}

Retorne JSON com:
{
  "patterns": ["padrões detectados no comportamento do cliente"],
  "successfulPhrases": ["frases que funcionaram bem do lado do atendente"],
  "objectionsHandled": ["objeções que foram tratadas"],
  "upsellsThatWorked": ["upsells que foram aceitos"],
  "preferredProducts": ["produtos mencionados como preferência"],
  "preferences": {"chave": "valor"} com preferências detectadas
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Extract learnings" },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content || "{}";
      return JSON.parse(content) as Learning;
    } catch (error) {
      logger.warn(`[CustomerKnowledgeProfile] Failed to extract learnings: ${error}`);
      return {
        patterns: [],
        successfulPhrases: [],
        objectionsHandled: [],
        upsellsThatWorked: [],
        preferredProducts: [],
        preferences: {},
      };
    }
  }

  private async updateProfile(
    customerPhone: string,
    learnings: Learning,
    isConversion: boolean
  ): Promise<void> {
    const profile = await this.getOrCreateProfile(customerPhone);

    const currentLearnings: Learning = JSON.parse(
      profile.learnings || '{"patterns":[]}'
    );

    const mergedLearnings: Learning = {
      patterns: [
        ...new Set([...currentLearnings.patterns, ...learnings.patterns]),
      ].slice(0, 20),
      successfulPhrases: [
        ...new Set([...currentLearnings.successfulPhrases, ...learnings.successfulPhrases]),
      ].slice(0, 15),
      objectionsHandled: [
        ...new Set([...currentLearnings.objectionsHandled, ...learnings.objectionsHandled]),
      ].slice(0, 15),
      upsellsThatWorked: [
        ...new Set([...currentLearnings.upsellsThatWorked, ...learnings.upsellsThatWorked]),
      ].slice(0, 10),
      preferredProducts: [
        ...new Set([...currentLearnings.preferredProducts, ...learnings.preferredProducts]),
      ].slice(0, 10),
      preferences: {
        ...currentLearnings.preferences,
        ...learnings.preferences,
      },
    };

    const updatedPhrases = [
      ...new Set([
        ...profile.preferred_phrases,
        ...learnings.successfulPhrases,
      ]),
    ].slice(0, 20);

    const updatedObjections = [
      ...new Set([
        ...profile.common_objections,
        ...learnings.objectionsHandled,
      ]),
    ].slice(0, 15);

    const updatedSuccessPatterns = isConversion
      ? [...new Set([...profile.success_patterns, ...learnings.patterns])].slice(0, 15)
      : profile.success_patterns;

    await prisma.customerKnowledgeProfile.update({
      where: { customer_phone: customerPhone },
      data: {
        learnings: JSON.stringify(mergedLearnings),
        preferred_phrases: updatedPhrases,
        common_objections: updatedObjections,
        success_patterns: updatedSuccessPatterns,
        last_updated_by: "SYSTEM",
      },
    });
  }

  private async updateGeneralKnowledge(
    learnings: Learning,
    isConversion: boolean
  ): Promise<void> {
    if (learnings.objectionsHandled.length > 0) {
      const existingDocs = await obsidianKnowledgeService.getDocumentsByCategory(
        "objection"
      );

      if (existingDocs.length === 0) {
        await obsidianKnowledgeService.createDocument({
          title: "Objeções Comuns - Auto-gerado",
          content: this.buildObjectionsDocument(learnings.objectionsHandled),
          category: "objection",
          phases: ["DISCOVERY", "CURATION"],
          tags: ["auto-generated", "objections"],
          createdBy: "SYSTEM",
        });
      }
    }

    if (isConversion && learnings.patterns.length > 0) {
      logger.info(`[CustomerKnowledgeProfile] Session resulted in conversion, updating success patterns`);
    }
  }

  private buildObjectionsDocument(objections: string[]): string {
    return `# Objeções Comuns Detectadas

## Lista de objeções tratados em atendimentos

${objections.map((o, i) => `${i + 1}. ${o}`).join("\n")}

---
*Atualizado automaticamente em ${new Date().toISOString().split("T")[0]}*
*Este documento é gerado automaticamente pelo sistema de aprendizado*
`;
  }

  async getCustomerLearningsContext(customerPhone: string): Promise<string> {
    const profile = await this.getOrCreateProfile(customerPhone);
    const learnings: Learning = JSON.parse(profile.learnings || "{}");

    if (!learnings.patterns || learnings.patterns.length === 0) {
      return "Nenhum aprendizado registrado para este cliente.";
    }

    let context = "## Contexto do Cliente\n\n";

    if (learnings.preferredProducts.length > 0) {
      context += `- **Produtos preferidos:** ${learnings.preferredProducts.join(", ")}\n`;
    }

    if (learnings.objectionsHandled.length > 0) {
      context += `- **Objeções já tratadas:** ${learnings.objectionsHandled.join(", ")}\n`;
    }

    if (learnings.successfulPhrases.length > 0) {
      context += `- **Frases que funcionaram:** ${learnings.successfulPhrases.slice(0, 3).join(", ")}\n`;
    }

    return context;
  }

  async getProfile(customerPhone: string) {
    const profile = await this.getOrCreateProfile(customerPhone);
    return {
      ...profile,
      learnings: JSON.parse(profile.learnings || "{}"),
    };
  }

  async updatePreferences(
    customerPhone: string,
    preferences: Record<string, string>
  ): Promise<void> {
    const profile = await this.getOrCreateProfile(customerPhone);
    const currentLearnings: Learning = JSON.parse(
      profile.learnings || '{"preferences":{}}'
    );

    const updatedLearnings = {
      ...currentLearnings,
      preferences: {
        ...currentLearnings.preferences,
        ...preferences,
      },
    };

    await prisma.customerKnowledgeProfile.update({
      where: { customer_phone: customerPhone },
      data: {
        learnings: JSON.stringify(updatedLearnings),
        last_updated_by: "MANUAL",
      },
    });
  }

  async disableAutoUpdates(customerPhone: string): Promise<void> {
    await prisma.customerKnowledgeProfile.update({
      where: { customer_phone: customerPhone },
      data: { auto_updates: false },
    });
  }
}

export default new CustomerKnowledgeProfileService();