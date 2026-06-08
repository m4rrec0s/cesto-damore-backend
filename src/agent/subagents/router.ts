import type { AgentContext } from "../core/types";
import { CuratorAgent } from "./curatorAgent";
import { DeliveryAgent } from "./deliveryAgent";
import { CheckoutAgent } from "./checkoutAgent";
import { MemoryAgent } from "./memoryAgent";
import type { BaseAgent } from "./baseAgent";

const agents: Record<string, () => BaseAgent> = {
  curator: () => new CuratorAgent(),
  delivery: () => new DeliveryAgent(),
  checkout: () => new CheckoutAgent(),
  memory: () => new MemoryAgent(),
};

export async function delegateToAgent(
  agentName: string,
  task: string,
  context: AgentContext,
): Promise<string> {
  const factory = agents[agentName];
  if (!factory) return `Agente "${agentName}" não encontrado.`;

  const agent = factory();
  return agent.run(task, context);
}

export function getAvailableAgents(): string[] {
  return Object.keys(agents);
}
