import { BaseAgent } from "./baseAgent";
import type { ToolDefinition } from "../core/types";
import { loadPrompt } from "../prompts/loader";

export class MemoryAgent extends BaseAgent {
  readonly name = "memory";
  readonly tools: ToolDefinition[] = [];

  get prompt(): string {
    try { return loadPrompt("subagents/memory_synthesizer.md"); }
    catch { return "Você é o agente de memória. Sintetize aprendizados da conversa em formato estruturado."; }
  }
}
