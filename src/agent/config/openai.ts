import OpenAI from "openai";

const defaultAgentModel = process.env.OPENAI_AGENT_MODEL?.trim() || "gpt-4o-mini";
const defaultAdvancedAgentModel =
  process.env.OPENAI_AGENT_ADVANCED_MODEL?.trim() || defaultAgentModel;

export const OPENAI_MODELS = {
  agentDefault: defaultAgentModel,
  agentAdvanced: defaultAdvancedAgentModel,
  agentCuration: process.env.OPENAI_AGENT_CURATION_MODEL?.trim() || "gpt-4o-mini",
  summary: process.env.OPENAI_SUMMARY_MODEL?.trim() || "gpt-4o-mini",
  promptOrchestration:
    process.env.OPENAI_PROMPT_ORCHESTRATION_MODEL?.trim() || "gpt-4o-mini",
  incremental: process.env.OPENAI_INCREMENTAL_MODEL?.trim() || "gpt-4o-mini",
} as const;

export function createOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}
