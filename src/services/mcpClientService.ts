import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import logger from "../utils/logger";

class MCPClientService {
  private client: Client | null = null;
  private transport: SSEClientTransport | null = null;
  private mcpUrl: string;

  constructor() {

    this.mcpUrl = process.env.MCP_SERVER_URL || "http://localhost:5000/mcp/sse";
  }

  private async ensureConnected(force = false) {
    if (this.client && !force) return;

    try {
      if (force) {
        logger.info("🔄 Forcing MCP reconnection...");
        await this.disconnect();
      }

      logger.info(`🔌 Connecting to MCP Server at ${this.mcpUrl}...`);

      this.transport = new SSEClientTransport(new URL(this.mcpUrl));

      this.client = new Client(
        {
          name: "CestoAmore-Backend-Client",
          version: "1.0.0",
        },
        {
          capabilities: {},
        },
      );

      await this.client.connect(this.transport);
      logger.info("✅ Connected to MCP Server successfully.");
    } catch (error: any) {
      logger.error(`❌ Failed to connect to MCP Server: ${error.message}`);
      this.client = null;
      this.transport = null;
      throw error;
    }
  }

  async listTools() {
    try {
      await this.ensureConnected();
      if (!this.client) throw new Error("MCP Client not initialized");

      const response = await this.client.listTools();
      return response.tools;
    } catch (error: any) {
      if (this.shouldRetry(error)) {
        logger.warn("🔄 MCP Session stale in listTools, retrying...");
        await this.ensureConnected(true);
        const response = await this.client!.listTools();
        return response.tools;
      }
      throw error;
    }
  }

  async listPrompts() {
    try {
      await this.ensureConnected();
      if (!this.client) throw new Error("MCP Client not initialized");

      const response = await this.client.listPrompts();
      return response.prompts;
    } catch (error: any) {
      if (this.shouldRetry(error)) {
        logger.warn("🔄 MCP Session stale in listPrompts, retrying...");
        await this.ensureConnected(true);
        const response = await this.client!.listPrompts();
        return response.prompts;
      }
      throw error;
    }
  }

  async getPrompt(name: string, args?: any) {
    try {
      await this.ensureConnected();
      if (!this.client) throw new Error("MCP Client not initialized");

      const response = await this.client.getPrompt({
        name,
        arguments: args,
      });
      return response;
    } catch (error: any) {
      if (this.shouldRetry(error)) {
        logger.warn(
          `🔄 MCP Session stale while getting prompt ${name}, retrying...`,
        );
        await this.ensureConnected(true);
        return this.client!.getPrompt({
          name,
          arguments: args,
        });
      }
      throw error;
    }
  }

  private shouldRetry(error: any): boolean {
    const msg = error.message?.toLowerCase() || "";
    return (
      msg.includes("initialize") ||
      msg.includes("not connected") ||
      msg.includes("connection closed") ||
      msg.includes("32602") ||
      msg.includes("invalid request")
    );
  }

  async callTool(name: string, args: any): Promise<any> {
    try {
      await this.ensureConnected();
      if (!this.client) throw new Error("MCP Client not initialized");

      logger.info(`🛠️ Calling MCP Tool: ${name} with args:`, args);

      const response = await this.client.callTool({
        name,
        arguments: args,
      });

      if (response.isError) {
        throw new Error(
          `Tool execution error: ${JSON.stringify(response.content)}`,
        );
      }

      const content = response.content as any[];
      const textContent = content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");

      const jsonMatch = textContent.match(
        /```json\n([\s\S]*?)\n```\n\n([\s\S]*)/,
      );
      if (jsonMatch) {
        return {
          data: JSON.parse(jsonMatch[1]),
          humanized: jsonMatch[2].trim(),
          raw: textContent,
        };
      }

      return {
        data: textContent,
        humanized: textContent,
        raw: textContent,
      };
    } catch (error: any) {
      if (this.shouldRetry(error)) {
        logger.warn(`🔄 MCP Session stale while calling ${name}, retrying...`);
        await this.ensureConnected(true);

        return this.callTool(name, args);
      }

      logger.error(`❌ Error calling MCP tool ${name}: ${error.message}`);
      throw error;
    }
  }

  async disconnect() {
    if (this.transport) {
      try {
        await this.client?.close();
      } catch (err) {}
      this.client = null;
      this.transport = null;
    }
  }
}

export default new MCPClientService();
