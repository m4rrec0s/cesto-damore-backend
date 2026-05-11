/**
 * 📚 PHASE 4: Skill Loader Service
 * 
 * Carrega "skills" (conhecimento) sob demanda quando LLM precisa.
 * Mantém rastreamento de quais skills estão ativos na janela de contexto.
 * 
 * Fluxo:
 * 1. Detecta intenção do cliente (delivery, customization, etc)
 * 2. Busca skill correspondente
 * 3. Valida se cabe no orçamento de tokens
 * 4. Se não caber, remove skill menos importante (LRU)
 * 5. Carrega conteúdo (Obsidian, BD, ou inline)
 * 6. Injeta no contexto da sessão
 */

import { ISkill, ISkillState, SKILLS_MANIFEST, SalesPhase, findSkillByKeyword, getSkillsForPhase, getConflictingSkills } from "../types/skills";
import TokenEstimator from "../utils/tokenEstimator";
import fs from "fs/promises";
import path from "path";

export interface SkillLoadOptions {
  forceLoad?: boolean; // Ignora constraints, carrega mesmo
  evictLRU?: boolean; // Se não couber, remove menos recentes
}

export interface SkillContextInjection {
  skillId: string;
  formattedContent: string;
  tokensConsumed: number;
}

export class SkillLoaderService {
  private static instance: SkillLoaderService;
  private skillCache: Map<string, { content: string; loadedAt: number }> = new Map();
  private readonly CACHE_TTL = 3600 * 1000; // 1 hora em ms

  private constructor() {}

  static getInstance(): SkillLoaderService {
    if (!SkillLoaderService.instance) {
      SkillLoaderService.instance = new SkillLoaderService();
    }
    return SkillLoaderService.instance;
  }

  /**
   * Carrega skill sob demanda
   */
  async loadSkill(
    skillId: string,
    options: SkillLoadOptions = {}
  ): Promise<SkillContextInjection | null> {
    const manifest = SKILLS_MANIFEST[skillId];
    if (!manifest) {
      console.warn(`❌ Skill não encontrada: ${skillId}`);
      return null;
    }

    const skill = manifest.skill;
    let content = skill.content || "";

    // 1. Se não tiver conteúdo inline, carregar de arquivo
    if (!content && skill.contentPath) {
      content = await this._loadSkillContent(skill.contentPath);
    }

    if (!content) {
      console.warn(`⚠️ Skill vazio: ${skillId}`);
      return null;
    }

    const estimate = TokenEstimator.estimate(content);
    const tokensConsumed = estimate.tokenEstimate;

    return {
      skillId,
      formattedContent: this._formatSkillContent(skill, content),
      tokensConsumed
    };
  }

  /**
   * Detecta skill que cliente está pedindo pelo keyword
   */
  detectNeededSkills(
    clientMessage: string,
    phase: SalesPhase
  ): { skillId: string; confidence: number }[] {
    const lower = clientMessage.toLowerCase();
    const candidates = Object.entries(SKILLS_MANIFEST)
      .filter(([, m]) => m.skill.requiredInPhases.includes(phase))
      .map(([skillId, m]) => {
        const skill = m.skill;
        const allKeywords = [...skill.keywords, ...(m.alternateKeywords || [])];
        
        // Conta quantos keywords matcham
        const matches = allKeywords.filter(k => lower.includes(k)).length;
        return { skillId, matches, priority: skill.priority };
      })
      .filter(c => c.matches > 0)
      .map(c => ({
        skillId: c.skillId,
        confidence: Math.min(1, (c.matches + c.priority / 10) / 10)
      }))
      .sort((a, b) => b.confidence - a.confidence);

    return candidates;
  }

  /**
   * Gerencia skills ativos na sessão
   * Remove LRU se orçamento de tokens foi excedido
   */
  async manageActiveSkills(
    currentSkills: ISkillState[],
    newSkillId: string,
    contextBudget: { utilisationPercent: number; availableForResponse: number }
  ): Promise<{
    activeSkills: ISkillState[];
    toRemove?: string[];
    canAdd: boolean;
  }> {
    const manifest = SKILLS_MANIFEST[newSkillId];
    if (!manifest) {
      return { activeSkills: currentSkills, canAdd: false };
    }

    const newSkill = manifest.skill;
    const newTokens = newSkill.tokenEstimate;

    // 1. Se cabe, apenas adicionar
    if (newTokens <= contextBudget.availableForResponse) {
      currentSkills.push({
        skillId: newSkillId,
        loadedAt: Date.now(),
        usedInTurns: 1,
        lastAccessedAt: Date.now(),
        priority: newSkill.priority
      });
      return { activeSkills: currentSkills, canAdd: true };
    }

    // 2. Se não cabe, tentar remover LRU
    if (!contextBudget.availableForResponse) {
      // Remover skill com menor priority + oldest lastAccessedAt
      const toRemove = currentSkills
        .sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          return a.lastAccessedAt - b.lastAccessedAt;
        })
        .shift();

      if (toRemove) {
        const remainingSkills = currentSkills.filter(s => s.skillId !== toRemove.skillId);
        const freedTokens = SKILLS_MANIFEST[toRemove.skillId]?.skill.tokenEstimate || 0;
        
        if (freedTokens >= newTokens) {
          remainingSkills.push({
            skillId: newSkillId,
            loadedAt: Date.now(),
            usedInTurns: 1,
            lastAccessedAt: Date.now(),
            priority: newSkill.priority
          });
          return { activeSkills: remainingSkills, toRemove: [toRemove.skillId], canAdd: true };
        }
      }
    }

    return { activeSkills: currentSkills, canAdd: false };
  }

  /**
   * Formata skill para injetar no prompt
   */
  private _formatSkillContent(skill: ISkill, content: string): string {
    return `
## 📚 SKILL: ${skill.name}
**Categoria:** ${skill.category}
**Prioridade:** ${skill.priority}/10

${content}

---
    `.trim();
  }

  /**
   * Carrega conteúdo de skill de arquivo
   */
  private async _loadSkillContent(contentPath: string): Promise<string> {
    // Primeiro checar cache
    const cached = this.skillCache.get(contentPath);
    if (cached && Date.now() - cached.loadedAt < this.CACHE_TTL) {
      return cached.content;
    }

    try {
      const fullPath = path.join(process.cwd(), "knowledge", contentPath);
      const content = await fs.readFile(fullPath, "utf-8");
      
      // Cachear
      this.skillCache.set(contentPath, { content, loadedAt: Date.now() });
      return content;
    } catch (err) {
      console.warn(`⚠️ Não consegui ler skill: ${contentPath}`, err);
      return "";
    }
  }

  /**
   * Injeta skills ativos no prompt
   */
  injectSkillsIntoPrompt(
    systemPrompt: string,
    activeSkills: ISkillState[],
    skillInjections: SkillContextInjection[]
  ): string {
    if (activeSkills.length === 0) {
      return systemPrompt;
    }

    const skillsSection = skillInjections
      .map(injection => injection.formattedContent)
      .join("\n\n");

    // Insere antes das regras de execução
    const insertPoint = systemPrompt.indexOf("## EXECUÇÃO SILENCIOSA");
    if (insertPoint > -1) {
      return (
        systemPrompt.substring(0, insertPoint) +
        "## 📚 CONHECIMENTO ATIVO\n" +
        skillsSection +
        "\n\n" +
        systemPrompt.substring(insertPoint)
      );
    }

    return systemPrompt + "\n\n## 📚 CONHECIMENTO ATIVO\n" + skillsSection;
  }

  /**
   * Reportar estado dos skills (debugging)
   */
  reportSkillState(activeSkills: ISkillState[], contextBudget: any): string {
    const lines = [
      "=== ACTIVE SKILLS ===",
      ...activeSkills.map(s => {
        const manifest = SKILLS_MANIFEST[s.skillId];
        const tokens = manifest?.skill.tokenEstimate || 0;
        return `• ${manifest?.skill.name} (${tokens} tokens, usedInTurns: ${s.usedInTurns})`;
      }),
      `---`,
      `Total Skills: ${activeSkills.length}`,
      `Total Tokens (skills): ${activeSkills.reduce((sum, s) => sum + (SKILLS_MANIFEST[s.skillId]?.skill.tokenEstimate || 0), 0)}`,
      `Context Utilisation: ${(contextBudget.utilisationPercent * 100).toFixed(1)}%`,
      "====================="
    ];
    return lines.join("\n");
  }

  /**
   * Cleanup: remover skills expirados
   */
  cleanupExpiredSkills(activeSkills: ISkillState[], maxAge: number = 600000): ISkillState[] {
    // max 10 min
    const now = Date.now();
    return activeSkills.filter(s => now - s.lastAccessedAt < maxAge);
  }
}

export default SkillLoaderService.getInstance();
