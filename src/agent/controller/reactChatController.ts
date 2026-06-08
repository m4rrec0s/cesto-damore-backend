import { Request, Response } from "express";
import { initSession } from "../core/sessionManager";
import { runReactLoop } from "../core/reactEngine";
import { buildSystemPrompt } from "../prompts/builder";
import { getAllTools } from "../tools/registry";
import { invokeTool } from "../tools/invoker";
import { applyGuardrails } from "../guardrails";
import logger from "../../utils/logger";

export async function reactChat(req: Request, res: Response) {
  try {
    const { message, customerPhone, customerName } = req.body;

    if (!message || !customerPhone) {
      return res.status(400).json({ error: "message and customerPhone required" });
    }

    const context = await initSession({
      customerPhone,
      customerName: customerName || undefined,
    });

    const { response, metadata } = await runReactLoop(context, message, {
      tools: getAllTools(),
      invokeTool,
      buildSystemPrompt,
    });

    const finalResponse = applyGuardrails(response);

    return res.json({
      response: finalResponse,
      metadata: {
        sessionId: context.sessionId,
        iterations: metadata.iterations,
        toolsUsed: metadata.toolsUsed,
        durationMs: metadata.finishedAt.getTime() - metadata.startedAt.getTime(),
      },
    });
  } catch (err: any) {
    logger.error(`[react-chat] Error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
