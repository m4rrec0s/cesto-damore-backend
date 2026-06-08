import type { ShortTermMemory, ChatMessage } from "../types";
import TokenEstimator from "../../../utils/tokenEstimator";

export class ShortTermMemoryStore implements ShortTermMemory {
  private messages: ChatMessage[] = [];

  append(message: ChatMessage): void {
    this.messages.push(message);
  }

  getWindow(maxTokens: number): ChatMessage[] {
    const result: ChatMessage[] = [];
    let tokens = 0;

    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      const est = TokenEstimator.estimate(msg.content || "").tokenEstimate;
      if (tokens + est > maxTokens && result.length > 0) break;
      tokens += est;
      result.unshift(msg);
    }

    return result;
  }

  clear(): void {
    this.messages = [];
  }

  getAll(): ChatMessage[] {
    return [...this.messages];
  }
}
