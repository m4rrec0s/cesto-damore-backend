import type { ToolResult } from "../core/types";
import { getToolByName } from "./registry";
import { mcpClient } from "./mcpClient";
import { validateArgs } from "./validators/schemaValidator";
import logger from "../../utils/logger";

export async function invokeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = getToolByName(name);
  if (!tool) {
    return { success: false, data: null, error: `Unknown tool: ${name}` };
  }

  // Validate args against schema
  const validation = validateArgs(args, tool.inputSchema);
  if (!validation.valid) {
    return { success: false, data: null, error: `Invalid args: ${validation.error}` };
  }

  try {
    if (tool.source === "mcp") {
      const data = await mcpClient.callTool(name, args);
      return { success: true, data };
    }

    // Local tools (none yet — placeholder for future)
    return { success: false, data: null, error: `No local handler for: ${name}` };
  } catch (err: any) {
    logger.error(`[Invoker] ${name} failed: ${err.message}`);
    return { success: false, data: null, error: err.message };
  }
}
