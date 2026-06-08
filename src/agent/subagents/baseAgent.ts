import OpenAI from "openai";
import { createOpenAIClient, OPENAI_MODELS } from "../config/openai";
import type { AgentContext, ToolDefinition, ToolResult } from "../core/types";
import { invokeTool } from "../tools/invoker";
import logger from "../../utils/logger";

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly prompt: string;
  abstract readonly tools: ToolDefinition[];
  protected maxIterations = 5;

  async run(task: string, context: AgentContext): Promise<string> {
    const openai = createOpenAIClient();

    const openaiTools: OpenAI.ChatCompletionTool[] = this.tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema as any },
    }));

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: this.prompt },
      { role: "user", content: task },
    ];

    let iterations = 0;
    while (iterations < this.maxIterations) {
      iterations++;

      const completion = await openai.chat.completions.create({
        model: OPENAI_MODELS.agentDefault,
        messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        temperature: 0.4,
      });

      const msg = completion.choices[0]?.message;
      if (!msg) break;

      if (!msg.tool_calls?.length) {
        return msg.content || "";
      }

      messages.push({ role: "assistant", content: msg.content || null, tool_calls: msg.tool_calls });

      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        const fn = (tc as any).function;
        let result: ToolResult;
        try {
          result = await invokeTool(fn.name, JSON.parse(fn.arguments || "{}"));
        } catch (err: any) {
          result = { success: false, data: null, error: err.message };
        }
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.success ? JSON.stringify(result.data) : `Error: ${result.error}`,
        });
      }
    }

    logger.warn(`[${this.name}] Max iterations reached`);
    return "Não foi possível completar a tarefa.";
  }
}
