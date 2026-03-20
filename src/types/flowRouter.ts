export type RouterAction =
  | "route_node"
  | "ask_clarifying_question"
  | "handoff_human";

export interface FlowCatalogNode {
  id: string;
  type: string;
  title: string;
  summary?: string;
  when_to_use?: string;
  examples?: string[];
  keywords?: string[];
  expected_user_state?: string;
  next_best_nodes?: string[];
  requires_slots?: string[];
  bot_voice_template?: string;
  confidence_threshold?: number;
  confidence_rules?: string;
}

export interface RouterDecision {
  action: RouterAction;
  node_id?: string;
  confidence: number;
  reason: string;
  missing_info?: string[];
  question?: string;
}

