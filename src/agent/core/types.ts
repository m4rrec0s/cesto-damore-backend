export interface AgentContext {
  sessionId: string;
  customerPhone: string;
  customerName?: string;
  shortTerm: ShortTermMemory;
  longTerm: LongTermProfile;
}

export interface ShortTermMemory {
  append(message: ChatMessage): void;
  getWindow(maxTokens: number): ChatMessage[];
  clear(): void;
  getAll(): ChatMessage[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LongTermProfile {
  summary: string | null;
  preferredPhrases: string[];
  commonObjections: string[];
  successPatterns: string[];
  learnings: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  source: "local" | "mcp";
}

export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
}

export interface ReactLoopMetadata {
  iterations: number;
  toolsUsed: string[];
  startedAt: Date;
  finishedAt: Date;
}
