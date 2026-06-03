export type PlaybookStep = {
  toolName: string;
  description: string;
  params: Record<string, string>;
  expectedOutcome?: string;
  critical: boolean;
};

export type PlaybookTrigger = {
  type: "tool_sequence" | "task_keyword" | "manual";
  pattern?: string[];
  keywords?: string[];
};
