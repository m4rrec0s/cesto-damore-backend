import OpenAI from "openai";
import prisma from "../../database/prisma";
import { createOpenAIClient, OPENAI_MODELS } from "../config/openai";
import { buildSystemPrompt as defaultBuildSystemPrompt } from "../prompts/builder";
import type {
  AgentContext,
  ChatMessage,
  ToolDefinition,
  ToolResult,
  ReactLoopMetadata,
} from "./types";
import logger from "../../utils/logger";

const MAX_REACT_ITERATIONS = 8;

type ToolInvoker = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

interface ReactEngineOptions {
  tools: ToolDefinition[];
  invokeTool: ToolInvoker;
  buildSystemPrompt?: (ctx: AgentContext) => string;
}

export async function runReactLoop(
  context: AgentContext,
  userMessage: string,
  options: ReactEngineOptions,
): Promise<{ response: string; metadata: ReactLoopMetadata }> {
  const openai = createOpenAIClient();
  const startedAt = new Date();
  const toolsUsed: string[] = [];

  // 1. Build system prompt
  const systemPrompt = options.buildSystemPrompt
    ? options.buildSystemPrompt(context)
    : defaultBuildSystemPrompt(context);

  // 2. Prepare OpenAI tools format
  const openaiTools: OpenAI.ChatCompletionTool[] = options.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));

  // 3. Build message history for the LLM
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...formatHistoryForLLM(context.shortTerm.getWindow(3000)),
    { role: "user", content: userMessage },
  ];

  // Append user message to short-term
  context.shortTerm.append({ role: "user", content: userMessage });

  // 4. ReAct loop
  let iterations = 0;

  while (iterations < MAX_REACT_ITERATIONS) {
    iterations++;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODELS.agentDefault,
      messages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      temperature: 0.7,
    });

    const choice = completion.choices[0];
    if (!choice) throw new Error("No completion choice returned");

    const assistantMessage = choice.message;

    // If no tool calls → final answer
    if (!assistantMessage.tool_calls?.length) {
      const finalText = assistantMessage.content || "";
      context.shortTerm.append({ role: "assistant", content: finalText });

      const metadata: ReactLoopMetadata = {
        iterations,
        toolsUsed,
        startedAt,
        finishedAt: new Date(),
      };

      await persistMessage(context.sessionId, "assistant", finalText, metadata);

      return { response: finalText, metadata };
    }

    // Tool calls → execute each, inject observations
    messages.push({
      role: "assistant",
      content: assistantMessage.content || null,
      tool_calls: assistantMessage.tool_calls,
    });

    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall.type !== "function") continue;
      const fnName = (toolCall as any).function.name;
      const fnArgs = safeParseArgs((toolCall as any).function.arguments);

      toolsUsed.push(fnName);
      logger.info(`[ReactEngine] Tool call: ${fnName}`, fnArgs);

      let result: ToolResult;
      try {
        result = await options.invokeTool(fnName, fnArgs);
      } catch (err: any) {
        result = { success: false, data: null, error: err.message };
      }

      const observation = result.success
        ? JSON.stringify(result.data)
        : `Error: ${result.error}`;

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: observation,
      });
    }
  }

  // Max iterations reached — force a final answer
  const fallback = "Desculpe, não consegui processar sua solicitação. Pode reformular?";
  context.shortTerm.append({ role: "assistant", content: fallback });

  const metadata: ReactLoopMetadata = {
    iterations,
    toolsUsed,
    startedAt,
    finishedAt: new Date(),
  };

  await persistMessage(context.sessionId, "assistant", fallback, metadata);

  return { response: fallback, metadata };
}



function formatHistoryForLLM(
  history: ChatMessage[],
): OpenAI.ChatCompletionMessageParam[] {
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function persistMessage(
  sessionId: string,
  role: string,
  content: string,
  metadata: ReactLoopMetadata,
): Promise<void> {
  try {
    await prisma.aIAgentMessage.create({
      data: {
        session_id: sessionId,
        role,
        content,
        metadata: JSON.stringify({
          react_iterations: metadata.iterations,
          tools_used: metadata.toolsUsed,
          duration_ms: metadata.finishedAt.getTime() - metadata.startedAt.getTime(),
        }),
      },
    });
  } catch (err: any) {
    logger.error(`[ReactEngine] Failed to persist message: ${err.message}`);
  }
}
