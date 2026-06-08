import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import logger from "../../utils/logger";

const MCP_TIMEOUT_MS = 30_000;

class MCPClient {
  private client: Client | null = null;
  private transport: SSEClientTransport | null = null;
  private mcpUrl: string;

  constructor() {
    this.mcpUrl = process.env.MCP_SERVER_URL || "http://localhost:5000/mcp/sse";
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureConnected();

    logger.info(`[MCPClient] Calling: ${name}`, args);

    const response = await this.withTimeout(
      this.client!.callTool({ name, arguments: args }),
    );

    if (response.isError) {
      throw new Error(`MCP tool error [${name}]: ${JSON.stringify(response.content)}`);
    }

    return this.parseResponse(response.content as any[]);
  }

  private async ensureConnected(force = false) {
    if (this.client && !force) return;

    if (force) await this.disconnect();

    this.transport = new SSEClientTransport(new URL(this.mcpUrl));
    this.client = new Client(
      { name: "CestoAmore-ReAct", version: "2.0.0" },
      { capabilities: {} },
    );

    try {
      await this.client.connect(this.transport);
    } catch (err: any) {
      this.client = null;
      this.transport = null;
      throw new Error(`MCP connection failed: ${err.message}`);
    }
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("MCP call timed out")), MCP_TIMEOUT_MS);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private parseResponse(content: any[]): unknown {
    const text = content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```\n\n([\s\S]*)/);
    if (jsonMatch) {
      try {
        return { data: JSON.parse(jsonMatch[1]), humanized: jsonMatch[2].trim() };
      } catch { /* fall through */ }
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async disconnect() {
    try { await this.client?.close(); } catch {}
    this.client = null;
    this.transport = null;
  }
}

export const mcpClient = new MCPClient();
