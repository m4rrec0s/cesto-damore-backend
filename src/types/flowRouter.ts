export type RouterAction =
  | "route_node"
  | "ask_clarifying_question"
  | "handoff_human"
  | "respond_with_dynamic_menu";

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
  nav_category?: "product" | "info" | "checkout" | "support" | "menu";
  user_friendly_label?: string;
}

export interface DynamicMenuOption {
  label: string;
  target_node_id: string;
  nav_category?: string;
}

export interface DynamicMenuState {
  options: DynamicMenuOption[];
  generated_at: string;
  context: {
    currentNodeId: string | null;
    userMessage: string;
  };
}

export interface RouterDecision {
  action: RouterAction;
  node_id?: string;
  confidence: number;
  reason: string;
  missing_info?: string[];
  question?: string;
  llm_response?: string;
  dynamic_options?: DynamicMenuOption[];
}

